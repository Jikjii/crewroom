import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { loadRuntime, getClientIp, publicHttpsOrigin } from "../server/runtime.mjs";
import { createBackup } from "../scripts/backup.mjs";
import { restoreBackup } from "../scripts/restore.mjs";
import { checkProduction, writeBuildInfo } from "../scripts/preflight.mjs";

const production = (dataDir) => ({
  NODE_ENV: "production", DATA_DIR: dataDir, APP_ORIGIN: "https://crewroom.acme.studio",
  OPERATOR_NAME: "Acme Studio LLC", SUPPORT_EMAIL: "support@acme.studio", POLICIES_APPROVED: "true",
});

async function temporary(t) {
  const root = await mkdtemp(path.join(tmpdir(), "crewroom-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("production requires deliberate public configuration and persistent paths", async (t) => {
  const root = await temporary(t);
  const env = production(path.join(root, "data"));
  const config = loadRuntime(env, root);
  assert.equal(config.secureCookies, true);
  assert.equal(config.dbPath, path.join(root, "data", "crewroom.sqlite"));
  assert.equal(config.mediaDir, path.join(root, "data", "media"));
  assert.equal(config.privacyPolicyUrl, "https://crewroom.acme.studio/privacy");
  assert.equal(config.trustProxyHops, 0);
  assert.throws(() => loadRuntime({ ...env, DATA_DIR: "" }, root), /persistent/);
  assert.throws(() => loadRuntime({ ...env, DATA_DIR: "relative" }, root), /absolute/);
  assert.throws(() => loadRuntime({ ...env, POLICIES_APPROVED: "false" }, root), /POLICIES_APPROVED/);
  assert.throws(() => loadRuntime({ ...env, SUPPORT_EMAIL: "hello@example.com" }, root), /SUPPORT_EMAIL/);
  assert.throws(() => loadRuntime({ ...env, RESEND_API_KEY: "test" }, root), /together/);
  assert.throws(() => loadRuntime({ ...env, TRUST_PROXY_HOPS: "2junk" }, root), /TRUST_PROXY_HOPS/);
  for (const url of ["http://crewroom.acme.studio", "https://localhost", "https://localhost.", "https://LOCALHOST.", "https://example.com.", "https://APP.EXAMPLE.COM.", "https://crewroom.test.", "https://127.0.0.1", "https://192.168.1.170", "https://app.example.com", "https://crewroom.test", "https://user:password@crewroom.acme.studio", "https://crewroom.acme.studio/path"])
    assert.throws(() => publicHttpsOrigin(url), /HTTPS/);
  assert.equal(publicHttpsOrigin("https://crewroom.acme.studio/"), "https://crewroom.acme.studio");
  const development = loadRuntime({}, root);
  assert.equal(development.secureCookies, false);
  assert.equal(development.host, "127.0.0.1");
});

test("trusted-proxy IP selection ignores forged leftmost values and rejects malformed chains", () => {
  const req = { socket: { remoteAddress: "::ffff:10.0.0.2" }, headers: { "x-forwarded-for": "203.0.113.9, 198.51.100.10" } };
  assert.equal(getClientIp(req), "10.0.0.2");
  assert.equal(getClientIp(req, 1), "198.51.100.10");
  assert.equal(getClientIp(req, 2), "203.0.113.9");
  assert.equal(getClientIp(req, 3), "10.0.0.2");
  for (const spelling of ["2001:DB8:0000:0000:0000:0000:0000:0001", "2001:db8::1"])
    assert.equal(getClientIp({ ...req, headers: { "x-forwarded-for": spelling } }, 1), "2001:db8::1");
  for (const spelling of ["::ffff:192.0.2.1", "0:0:0:0:0:FFFF:C000:0201", "::ffff:c000:201"])
    assert.equal(getClientIp({ ...req, headers: { "x-forwarded-for": spelling } }, 1), "192.0.2.1");
  for (const value of ["bad, 198.51.100.10", ["198.51.100.10"], "198.51.100.10:443", "1".repeat(1025), Array(17).fill("198.51.100.10").join(",")])
    assert.equal(getClientIp({ ...req, headers: { "x-forwarded-for": value } }, 1), "10.0.0.2");
});

test("online SQLite backup includes committed WAL data and referenced photos, then restores without overwrite", async (t) => {
  const root = await temporary(t);
  const live = path.join(root, "live"), mediaDir = path.join(live, "media"), dbPath = path.join(live, "crewroom.sqlite");
  await mkdir(mediaDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  t.after(() => db.close());
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes(body) VALUES('committed while live'); CREATE TABLE social_media(filename TEXT, exampleFilename TEXT);");
  db.prepare("INSERT INTO social_media VALUES(?,NULL)").run("media_test.jpg");
  db.prepare("INSERT INTO social_media VALUES('',?)").run("fictional-example.png");
  await writeFile(path.join(mediaDir, "media_test.jpg"), Buffer.from("test image bytes"));
  await writeFile(path.join(mediaDir, "orphan.jpg"), "not referenced");
  const destination = path.join(root, "backup");
  const manifest = await createBackup({ dbPath, mediaDir, destination });
  assert.equal(manifest.media.length, 1);
  assert.deepEqual(await readdir(path.join(destination, "media")), ["media_test.jpg"]);
  db.prepare("INSERT INTO notes(body) VALUES(?)").run("after snapshot");
  const restored = path.join(root, "restored");
  await assert.rejects(() => restoreBackup({ source: destination, destination: restored }), /Stop the API/);
  await restoreBackup({ source: destination, destination: restored, confirmedStopped: true });
  const copy = new DatabaseSync(path.join(restored, "crewroom.sqlite"), { readOnly: true });
  assert.equal(copy.prepare("SELECT COUNT(*) AS count FROM notes").get().count, 1);
  copy.close();
  assert.equal(await readFile(path.join(restored, "media", "media_test.jpg"), "utf8"), "test image bytes");
  await assert.rejects(() => restoreBackup({ source: destination, destination: restored, confirmedStopped: true }), /never replaced/);
  await assert.rejects(() => createBackup({ dbPath, mediaDir, destination }), /EEXIST/);
  await writeFile(path.join(destination, "media", "media_test.jpg"), "tampered");
  await assert.rejects(() => restoreBackup({ source: destination, destination: path.join(root, "tampered"), confirmedStopped: true }), /verification failed/);
});

test("a missing photo prevents a misleading completed backup", async (t) => {
  const root = await temporary(t), dbPath = path.join(root, "live.sqlite"), mediaDir = path.join(root, "media"), destination = path.join(root, "backup");
  await mkdir(mediaDir);
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE social_media(filename TEXT, exampleFilename TEXT); INSERT INTO social_media VALUES('missing.jpg',NULL);");
  db.close();
  await assert.rejects(() => createBackup({ dbPath, mediaDir, destination }), /ENOENT/);
  assert.equal((await readdir(root)).includes("backup"), false);
});

test("preflight detects stale public client configuration and reports missing recovery delivery", async (t) => {
  const root = await temporary(t);
  await mkdir(path.join(root, "dist"));
  await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>");
  const env = { ...production(path.join(root, "data")), EXPO_PUBLIC_API_URL: "https://crewroom.acme.studio", EXPO_PUBLIC_WEB_URL: "https://crewroom.acme.studio" };
  await writeBuildInfo(env, root);
  const result = await checkProduction({ root, env });
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.ok(result.warnings.some((message) => message.includes("Password-reset")));
  const stale = await checkProduction({ root, env: { ...env, APP_ORIGIN: "https://other.acme.studio" } });
  assert.equal(stale.ok, false);
  assert.ok(stale.errors.some((message) => message.includes("differs")));
  assert.equal((await checkProduction({ root, env, nodeVersion: "22.0.0" })).ok, false);
});
