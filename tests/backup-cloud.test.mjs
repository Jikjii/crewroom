import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBackup } from "../scripts/backup.mjs";
import { cloudBackupConfigFromEnv, validateCloudBackupConfig, runCloudBackup, verifyCloudBackup, pruneCloudBackups } from "../scripts/backup-cloud.mjs";

const NOW = 1_790_000_000_000, DAY = 86_400_000;
const config = Object.freeze({ endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`, bucket: "crewroom-backup-test", prefix: "crewroom-beta/v1",
  accessKeyId: "test-access-key", secretAccessKey: "test-secret-key", retentionDays: 7, maxBytes: 1024 ** 2 });

class FakeS3 {
  objects = new Map(); calls = []; failPut = null; tamperRead = null; badHead = false;
  async send(command) {
    const action = command.constructor.name, input = command.input;
    this.calls.push({ action, key: input.Key });
    if (action === "ListObjectsV2Command") return { Contents: [...this.objects].filter(([Key]) => Key.startsWith(input.Prefix)).map(([Key, object]) => ({ Key, LastModified: object.modified })) };
    if (action === "PutObjectCommand") {
      if (this.failPut?.(input.Key)) throw new Error("simulated upload failure");
      const chunks = [];
      for await (const chunk of input.Body) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      assert.equal(body.length, input.ContentLength);
      this.objects.set(input.Key, { body, metadata: input.Metadata, modified: new Date(NOW) });
      return {};
    }
    if (action === "DeleteObjectCommand") { this.objects.delete(input.Key); return {}; }
    const object = this.objects.get(input.Key);
    if (!object) throw new Error("simulated missing object");
    if (action === "HeadObjectCommand") return { ContentLength: object.body.length, Metadata: this.badHead ? {} : object.metadata };
    if (action === "GetObjectCommand") {
      const body = Buffer.from(object.body);
      if (this.tamperRead?.(input.Key)) body[0] ^= 255;
      return { ContentLength: body.length, Body: Readable.from([body]) };
    }
    throw new Error(`unexpected action: ${action}`);
  }
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "crewroom-cloud-test-"));
  const live = path.join(root, "live"), stagingRoot = path.join(root, "staging");
  const runtime = { dbPath: path.join(live, "crewroom.sqlite"), mediaDir: path.join(live, "media") };
  await mkdir(runtime.mediaDir, { recursive: true }); await mkdir(stagingRoot);
  const db = new DatabaseSync(runtime.dbPath);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE notes(body TEXT); INSERT INTO notes VALUES('committed live data'); CREATE TABLE social_media(filename TEXT, exampleFilename TEXT); INSERT INTO social_media VALUES('media_test.jpg',NULL);");
  await writeFile(path.join(runtime.mediaDir, "media_test.jpg"), "private photo bytes");
  t.after(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  return { root, runtime, stagingRoot, db, client: new FakeS3() };
}

test("cloud configuration is explicit, HTTPS-only, private-endpoint scoped, and bounded", () => {
  assert.equal(cloudBackupConfigFromEnv({}), null);
  assert.equal(cloudBackupConfigFromEnv({ BACKUP_ENABLED: "false" }), null);
  assert.throws(() => cloudBackupConfigFromEnv({ BACKUP_ENABLED: "yes" }), /true or false/);
  const parsed = cloudBackupConfigFromEnv({ BACKUP_ENABLED: "true", BACKUP_S3_ENDPOINT: config.endpoint, BACKUP_S3_BUCKET: config.bucket,
    BACKUP_S3_ACCESS_KEY_ID: config.accessKeyId, BACKUP_S3_SECRET_ACCESS_KEY: config.secretAccessKey });
  assert.equal(parsed.retentionDays, 7); assert.equal(parsed.maxBytes, 1024 ** 3); assert.equal(parsed.prefix, config.prefix);
  for (const endpoint of ["http://localhost", "https://127.0.0.1", "https://example.com", `${config.endpoint}/path`, `${config.endpoint}?secret=x`, `https://user:secret@${"a".repeat(32)}.r2.cloudflarestorage.com`])
    assert.throws(() => validateCloudBackupConfig({ ...config, endpoint }), /ENDPOINT/);
  for (const prefix of ["", "/", "../other", "crewroom/../other", "crewroom//other", "crewroom/"])
    assert.throws(() => validateCloudBackupConfig({ ...config, prefix }), /PREFIX/);
  for (const retentionDays of [0, 15, "7junk", 1.5]) assert.throws(() => validateCloudBackupConfig({ ...config, retentionDays }), /RETENTION/);
  for (const maxBytes of [0, -1, 2 ** 40, "100bad"]) assert.throws(() => validateCloudBackupConfig({ ...config, maxBytes }), /MAX_BYTES/);
  assert.throws(() => validateCloudBackupConfig({ ...config, secretAccessKey: "" }), /credentials/);
});

test("cloud backup reads back checksums, commits manifest last, and restores privately without touching live data", async (t) => {
  const f = await fixture(t);
  const result = await runCloudBackup({ ...f, config, now: () => NOW });
  assert.equal(result.verified, true); assert.equal(result.mediaCount, 1); assert.ok(result.bytes > 0);
  const puts = f.client.calls.filter(call => call.action === "PutObjectCommand");
  assert.equal(puts.length, 3); assert.ok(puts.at(-1).key.endsWith("/manifest.json"));
  assert.equal(f.client.calls.filter(call => call.action === "GetObjectCommand").length, 3);
  assert.deepEqual(await readdir(f.stagingRoot), []);
  f.db.exec("INSERT INTO notes VALUES('after cloud backup')");
  const before = f.db.prepare("SELECT * FROM notes").all();
  const drill = await verifyCloudBackup({ ...f, config });
  assert.equal(drill.runId, result.runId); assert.equal(drill.mediaCount, 1); assert.equal(drill.verified, true);
  assert.deepEqual(f.db.prepare("SELECT * FROM notes").all(), before);
  assert.equal(await readFile(path.join(f.runtime.mediaDir, "media_test.jpg"), "utf8"), "private photo bytes");
  assert.deepEqual(await readdir(f.stagingRoot), []);
});

test("failed upload leaves no completion manifest and removes temporary private data", async (t) => {
  const f = await fixture(t); f.client.failPut = key => key.includes("/media/");
  await assert.rejects(() => runCloudBackup({ ...f, config, now: () => NOW }), /upload failure/);
  assert.equal([...f.client.objects.keys()].some(key => key.endsWith("manifest.json")), false);
  assert.deepEqual(await readdir(f.stagingRoot), []);
});

test("checksum corruption on upload read-back fails before publishing completion", async (t) => {
  const f = await fixture(t); f.client.tamperRead = key => key.endsWith("crewroom.sqlite");
  await assert.rejects(() => runCloudBackup({ ...f, config, now: () => NOW }), /checksum/);
  assert.equal([...f.client.objects.keys()].some(key => key.endsWith("manifest.json")), false);
  assert.deepEqual(await readdir(f.stagingRoot), []);
});

test("a failed completion-marker verification removes the uncertain marker", async (t) => {
  const f = await fixture(t); f.client.tamperRead = key => key.endsWith("/manifest.json");
  await assert.rejects(() => runCloudBackup({ ...f, config, now: () => NOW }), /checksum/);
  assert.equal([...f.client.objects.keys()].some(key => key.endsWith("manifest.json")), false);
  assert.deepEqual(await readdir(f.stagingRoot), []);
});

test("metadata mismatch fails without publishing a completed manifest", async (t) => {
  const f = await fixture(t); f.client.badHead = true;
  await assert.rejects(() => runCloudBackup({ ...f, config, now: () => NOW }), /metadata/);
  assert.equal([...f.client.objects.keys()].some(key => key.endsWith("manifest.json")), false);
  assert.deepEqual(await readdir(f.stagingRoot), []);
});

test("restore drill rejects missing and tampered remote photos and always cleans downloads", async (t) => {
  const f = await fixture(t); const result = await runCloudBackup({ ...f, config, now: () => NOW });
  const key = `${config.prefix}/${result.runId}/media/media_test.jpg`, object = f.client.objects.get(key);
  f.client.objects.delete(key);
  await assert.rejects(() => verifyCloudBackup({ ...f, config }), /missing object/);
  assert.deepEqual(await readdir(f.stagingRoot), []);
  f.client.objects.set(key, object); f.client.tamperRead = candidate => candidate === key;
  await assert.rejects(() => verifyCloudBackup({ ...f, config }), /checksum/);
  assert.deepEqual(await readdir(f.stagingRoot), []);
  await assert.rejects(() => verifyCloudBackup({ ...f, config, runId: "../live" }), /identifier/);
});

test("retention deletes only rigid owned old run files, including incomplete runs", async () => {
  const client = new FakeS3(), old = NOW - 8 * DAY, fresh = NOW - 6 * DAY;
  const run = at => `run-${at}-11111111-2222-4333-8444-555555555555`;
  const expected = [`${config.prefix}/${run(old)}/crewroom.sqlite`, `${config.prefix}/${run(old)}/media/photo.jpg`];
  const preserved = [`another-app/${run(old)}/crewroom.sqlite`, `${config.prefix}/${run(fresh)}/manifest.json`,
    `${config.prefix}/personal-notes.txt`, `${config.prefix}/run-123/manifest.json`, `${config.prefix}/${run(old)}/media/../secret`,
    `${config.prefix}/${run(old)}/other.txt`, `${config.prefix}/${run(old)}/media/new.jpg`];
  for (const key of [...expected, ...preserved]) client.objects.set(key, { body: Buffer.from("x"), modified: new Date(old) });
  client.objects.get(preserved.at(-1)).modified = new Date(NOW);
  const result = await pruneCloudBackups({ config, client, now: () => NOW });
  assert.equal(result.deletedObjects, 2);
  assert.deepEqual([...client.objects.keys()], preserved);
});

test("capacity limit blocks backups before any upload and staging cannot be inside live storage", async (t) => {
  const f = await fixture(t);
  await assert.rejects(() => runCloudBackup({ ...f, config: { ...config, maxBytes: 1 }, now: () => NOW }), /MAX_BYTES/);
  assert.equal(f.client.calls.some(call => call.action === "PutObjectCommand"), false);
  assert.deepEqual(await readdir(f.stagingRoot), []);
  await assert.rejects(() => runCloudBackup({ ...f, config, stagingRoot: path.dirname(f.runtime.dbPath), now: () => NOW }), /outside live/);
});

test("base snapshot enforces optional byte budget without breaking its existing callers", async (t) => {
  const f = await fixture(t), destination = path.join(f.stagingRoot, "bounded");
  const dbBytes = Number(f.db.prepare("PRAGMA page_size").get().page_size) * Number(f.db.prepare("PRAGMA page_count").get().page_count);
  await assert.rejects(() => createBackup({ ...f.runtime, destination, maxBytes: dbBytes - 1 }), /maxBytes/);
  assert.deepEqual(await readdir(f.stagingRoot), []);
  await assert.rejects(() => createBackup({ ...f.runtime, destination, maxBytes: dbBytes + 1 }), /maxBytes/);
  assert.deepEqual(await readdir(f.stagingRoot), []);
  const manifest = await createBackup({ ...f.runtime, destination });
  assert.equal(manifest.media.length, 1);
});

test("retention still runs when current snapshot exceeds its capacity limit", async (t) => {
  const f = await fixture(t), old = NOW - 10 * DAY;
  const key = `${config.prefix}/run-${old}-11111111-2222-4333-8444-555555555555/crewroom.sqlite`;
  f.client.objects.set(key, { body: Buffer.from("old"), modified: new Date(old) });
  await assert.rejects(() => runCloudBackup({ ...f, config: { ...config, maxBytes: 1 }, now: () => NOW }), /MAX_BYTES/);
  assert.equal(f.client.objects.has(key), false);
});
