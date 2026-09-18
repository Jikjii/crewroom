import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile, lstat, statfs, rm, realpath } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform, Writable } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBackup, parseFlags, safeMediaFilename, snapshotMediaFiles } from "./backup.mjs";
import { restoreBackup } from "./restore.mjs";

const DAY = 86_400_000, GiB = 1024 ** 3, RESERVE = 64 * 1024 ** 2;
const RUN = /^run-(\d{13})-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MANIFEST_LIMIT = 4 * 1024 ** 2;
const active = new Set();

function positiveInteger(value, fallback, max, name) {
  const input = value === undefined || value === "" ? fallback : value;
  if (!/^\d+$/.test(String(input)) || !Number.isSafeInteger(Number(input)) || Number(input) < 1 || Number(input) > max)
    throw new Error(`${name} is outside its allowed range.`);
  return Number(input);
}

/** Deliberately supports only R2's private HTTPS S3 endpoint, never public bucket URLs. */
export function validateCloudBackupConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Cloud backup configuration is missing.");
  if (!/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/.test(config.endpoint || ""))
    throw new Error("BACKUP_S3_ENDPOINT must be the account's HTTPS R2 S3 endpoint.");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket || "")) throw new Error("BACKUP_S3_BUCKET must be a valid private bucket name.");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*(\/[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(config.prefix || "") || config.prefix.length > 160)
    throw new Error("BACKUP_PREFIX must contain only safe nonempty path segments.");
  for (const name of ["accessKeyId", "secretAccessKey"])
    if (typeof config[name] !== "string" || !config[name].trim() || /[\s\x00-\x1f]/.test(config[name]) || config[name].length > 512)
      throw new Error("Cloud backup access credentials are missing or malformed.");
  return {
    endpoint: config.endpoint.replace(/\/$/, ""), bucket: config.bucket, prefix: config.prefix,
    accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey,
    retentionDays: positiveInteger(config.retentionDays, 7, 14, "BACKUP_RETENTION_DAYS"),
    maxBytes: positiveInteger(config.maxBytes, GiB, 4 * GiB, "BACKUP_MAX_BYTES"),
  };
}

export function cloudBackupConfigFromEnv(env = process.env) {
  if (env.BACKUP_ENABLED === undefined || env.BACKUP_ENABLED === "" || env.BACKUP_ENABLED === "false") return null;
  if (env.BACKUP_ENABLED !== "true") throw new Error("BACKUP_ENABLED must be true or false.");
  return validateCloudBackupConfig({
    endpoint: env.BACKUP_S3_ENDPOINT, bucket: env.BACKUP_S3_BUCKET,
    accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY,
    prefix: env.BACKUP_PREFIX || "crewroom-beta/v1", retentionDays: env.BACKUP_RETENTION_DAYS,
    maxBytes: env.BACKUP_MAX_BYTES,
  });
}

function makeClient(config) {
  return new S3Client({
    endpoint: config.endpoint, region: "auto", forcePathStyle: true, maxAttempts: 2,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 120_000 },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function context(config, client) {
  config = validateCloudBackupConfig(config);
  const owned = !client;
  client ||= makeClient(config);
  const total = AbortSignal.timeout(30 * 60_000);
  return {
    config, client, signal: total, close: () => { if (owned) client.destroy(); },
    send: (command) => client.send(command, { abortSignal: AbortSignal.any([total, AbortSignal.timeout(120_000)]) }),
  };
}

function checkedRunId(runId) {
  if (typeof runId !== "string" || !RUN.test(runId)) throw new Error("Invalid cloud backup run identifier.");
  return runId;
}

function ownedKey(config, key) {
  if (typeof key !== "string" || !key.startsWith(`${config.prefix}/`)) return null;
  const parts = key.slice(config.prefix.length + 1).split("/");
  const match = RUN.exec(parts[0]);
  if (!match || !(parts.length === 2 && ["crewroom.sqlite", "manifest.json"].includes(parts[1]) ||
      parts.length === 3 && parts[1] === "media" && safeMediaFilename(parts[2]))) return null;
  return { runId: parts[0], timestamp: Number(match[1]), leaf: parts.slice(1).join("/") };
}

async function listOwned(ctx) {
  const result = [], tokens = new Set();
  let token;
  for (let page = 0; page < 1000; page++) {
    const response = await ctx.send(new ListObjectsV2Command({ Bucket: ctx.config.bucket, Prefix: `${ctx.config.prefix}/`, ContinuationToken: token, MaxKeys: 1000 }));
    for (const object of response.Contents || []) {
      const parsed = ownedKey(ctx.config, object.Key);
      if (parsed) result.push({ ...object, ...parsed });
    }
    if (!response.IsTruncated) return result;
    token = response.NextContinuationToken;
    if (!token || tokens.has(token)) throw new Error("Cloud backup listing did not advance.");
    tokens.add(token);
  }
  throw new Error("Cloud backup listing exceeded its safety limit.");
}

async function prune(ctx, nowMs) {
  const cutoff = nowMs - ctx.config.retentionDays * DAY;
  let deletedObjects = 0;
  // Remove completion markers first so an interrupted prune cannot advertise a partial run.
  const objects = (await listOwned(ctx)).sort((a, b) => Number(b.leaf === "manifest.json") - Number(a.leaf === "manifest.json"));
  for (const object of objects) {
    const modified = new Date(object.LastModified).getTime();
    if (object.timestamp >= cutoff || !Number.isFinite(modified) || modified >= cutoff) continue;
    await ctx.send(new DeleteObjectCommand({ Bucket: ctx.config.bucket, Key: object.Key }));
    deletedObjects++;
  }
  return { deletedObjects };
}

/** Deletes only recognized files within this installation's rigid run prefixes. */
export async function pruneCloudBackups({ config, client, now = () => Date.now() }) {
  const ctx = context(config, client);
  try { return await prune(ctx, now()); } finally { ctx.close(); }
}

async function regular(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Backup input must be a regular file.");
  return info;
}

async function estimate(runtime) {
  await regular(runtime.dbPath);
  const db = new DatabaseSync(runtime.dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=5000;");
    let bytes = Number(db.prepare("PRAGMA page_count").get().page_count) * Number(db.prepare("PRAGMA page_size").get().page_size);
    for (const filename of snapshotMediaFiles(db)) bytes += (await regular(path.join(runtime.mediaDir, filename))).size;
    if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error("Backup size could not be estimated safely.");
    return bytes;
  } finally { db.close(); }
}

async function checkSpace(directory, bytes) {
  const info = await statfs(directory);
  if (info.bavail * info.bsize < bytes + RESERVE) throw new Error("Insufficient temporary disk space for a safe backup.");
}

async function stagingDirectory(stagingRoot, runtime) {
  const root = await realpath(stagingRoot || tmpdir());
  const temporary = await realpath(tmpdir());
  if (root !== temporary && !root.startsWith(`${temporary}${path.sep}`)) throw new Error("Cloud backup staging must be inside the operating system's temporary directory.");
  if (runtime) {
    for (const live of [path.dirname(await realpath(runtime.dbPath)), await realpath(runtime.mediaDir)])
      if (root === live || root.startsWith(`${live}${path.sep}`)) throw new Error("Cloud backup staging must be outside live persistent data.");
  }
  return await mkdtemp(path.join(root, "crewroom-cloud-"));
}

async function remoteRead(ctx, key, expected, destination) {
  const response = await ctx.send(new GetObjectCommand({ Bucket: ctx.config.bucket, Key: key }));
  if (!response.Body || Number(response.ContentLength) !== expected.bytes) {
    response.Body?.destroy?.();
    throw new Error("Remote backup object has an unexpected length.");
  }
  let bytes = 0;
  const hash = createHash("sha256");
  const inspect = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > expected.bytes) return callback(new Error("Remote backup object exceeded its declared size."));
    hash.update(chunk); callback(null, chunk);
  } });
  const sink = destination ? createWriteStream(destination, { flags: "wx", mode: 0o600 }) : new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  await pipeline(response.Body, inspect, sink, { signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(120_000)]) });
  if (bytes !== expected.bytes || hash.digest("hex") !== expected.sha256) throw new Error("Remote backup checksum verification failed.");
}

async function upload(ctx, key, file, expected) {
  const body = createReadStream(file);
  try {
    await ctx.send(new PutObjectCommand({ Bucket: ctx.config.bucket, Key: key, Body: body, ContentLength: expected.bytes,
      ContentType: "application/octet-stream", Metadata: { sha256: expected.sha256, "crewroom-format": "v1" } }));
  } finally { body.destroy(); }
  const head = await ctx.send(new HeadObjectCommand({ Bucket: ctx.config.bucket, Key: key }));
  if (Number(head.ContentLength) !== expected.bytes || head.Metadata?.sha256 !== expected.sha256)
    throw new Error("Remote backup metadata verification failed.");
  // Full read-back also catches damaged content; metadata alone is not a checksum check.
  await remoteRead(ctx, key, expected);
}

/** A successful result means every uploaded byte was read back and hashed. */
export async function runCloudBackup({ runtime, config, client, now = () => Date.now(), stagingRoot }) {
  const ctx = context(config, client);
  const lock = `${ctx.config.endpoint}/${ctx.config.bucket}/${ctx.config.prefix}`;
  if (active.has(lock)) { ctx.close(); throw new Error("A cloud backup is already running."); }
  active.add(lock);
  let directory;
  try {
    const nowMs = now();
    if (!Number.isSafeInteger(nowMs) || String(nowMs).length !== 13) throw new Error("Invalid backup clock.");
    // Retention runs even if creating today's backup will fail.
    const { deletedObjects } = await prune(ctx, nowMs);
    const estimated = await estimate(runtime);
    if (estimated > ctx.config.maxBytes) throw new Error("Backup exceeds BACKUP_MAX_BYTES; review capacity before increasing it.");
    directory = await stagingDirectory(stagingRoot, runtime);
    await checkSpace(directory, estimated * 2);
    const snapshot = path.join(directory, "snapshot");
    const manifest = await createBackup({ ...runtime, destination: snapshot, maxBytes: ctx.config.maxBytes });
    manifest.database.bytes = (await regular(path.join(snapshot, "crewroom.sqlite"))).size;
    const bytes = manifest.database.bytes + manifest.media.reduce((total, file) => total + file.bytes, 0);
    if (bytes > ctx.config.maxBytes) throw new Error("Completed snapshot exceeds BACKUP_MAX_BYTES.");
    const runId = `run-${nowMs}-${randomUUID()}`;
    const prefix = `${ctx.config.prefix}/${runId}`;
    await writeFile(path.join(snapshot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await upload(ctx, `${prefix}/crewroom.sqlite`, path.join(snapshot, "crewroom.sqlite"), manifest.database);
    for (const file of manifest.media) await upload(ctx, `${prefix}/media/${file.filename}`, path.join(snapshot, "media", file.filename), file);
    const manifestFile = path.join(snapshot, "manifest.json");
    const manifestBytes = await readFile(manifestFile);
    if (manifestBytes.length > MANIFEST_LIMIT) throw new Error("Backup manifest exceeded its safety limit.");
    // Only this last object marks a run as complete. Earlier partial runs expire normally.
    try {
      await upload(ctx, `${prefix}/manifest.json`, manifestFile, { bytes: manifestBytes.length, sha256: createHash("sha256").update(manifestBytes).digest("hex") });
    } catch (error) {
      // An uncertain PUT might have succeeded remotely. Best-effort removal leaves failed
      // runs unadvertised; network outages can still require lifecycle/manual cleanup.
      try { await ctx.send(new DeleteObjectCommand({ Bucket: ctx.config.bucket, Key: `${prefix}/manifest.json` })); } catch { /* Preserve the original failure. */ }
      throw error;
    }
    return { runId, completedAt: new Date(now()).toISOString(), bytes, mediaCount: manifest.media.length, deletedObjects, verified: true };
  } finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { active.delete(lock); ctx.close(); }
  }
}

function validateManifest(manifest, maxBytes) {
  if (manifest?.format !== "crewroom-backup-v1" || manifest.database?.filename !== "crewroom.sqlite" || !Array.isArray(manifest.media))
    throw new Error("Unsupported or incomplete remote backup manifest.");
  const names = new Set();
  let bytes = 0;
  for (const file of [manifest.database, ...manifest.media]) {
    if (!Number.isSafeInteger(file?.bytes) || file.bytes < 0 || !HASH.test(file.sha256 || "")) throw new Error("Invalid remote backup file metadata.");
    bytes += file.bytes;
  }
  for (const file of manifest.media) {
    if (!safeMediaFilename(file.filename) || names.has(file.filename)) throw new Error("Invalid or duplicate remote media filename.");
    names.add(file.filename);
  }
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > maxBytes) throw new Error("Remote backup exceeds the download safety limit.");
  return bytes;
}

/** Downloads and restores only inside a newly-created temporary directory, then removes it. */
export async function verifyCloudBackup({ config, runId, client, stagingRoot }) {
  const ctx = context(config, client);
  let directory;
  try {
    if (runId === undefined) {
      const latest = (await listOwned(ctx)).filter((object) => object.leaf === "manifest.json").sort((a, b) => b.timestamp - a.timestamp)[0];
      if (!latest) throw new Error("No completed cloud backup is available.");
      runId = latest.runId;
    }
    checkedRunId(runId);
    const prefix = `${ctx.config.prefix}/${runId}`;
    const head = await ctx.send(new HeadObjectCommand({ Bucket: ctx.config.bucket, Key: `${prefix}/manifest.json` }));
    const manifestLength = Number(head.ContentLength);
    if (!Number.isSafeInteger(manifestLength) || manifestLength < 1 || manifestLength > MANIFEST_LIMIT || !HASH.test(head.Metadata?.sha256 || ""))
      throw new Error("Remote manifest metadata is invalid.");
    directory = await stagingDirectory(stagingRoot);
    const source = path.join(directory, "download");
    await mkdir(path.join(source, "media"), { recursive: true, mode: 0o700 });
    const manifestFile = path.join(source, "manifest.json");
    await remoteRead(ctx, `${prefix}/manifest.json`, { bytes: manifestLength, sha256: head.Metadata.sha256 }, manifestFile);
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    const bytes = validateManifest(manifest, ctx.config.maxBytes);
    await checkSpace(directory, bytes * 2);
    await remoteRead(ctx, `${prefix}/crewroom.sqlite`, manifest.database, path.join(source, "crewroom.sqlite"));
    for (const file of manifest.media) await remoteRead(ctx, `${prefix}/media/${file.filename}`, file, path.join(source, "media", file.filename));
    // This confirmation applies ONLY to the new isolated target: no server has ever used it.
    // The live API remains untouched; this function never accepts a restore destination.
    const restored = await restoreBackup({ source, destination: path.join(directory, "isolated-restore"), confirmedStopped: true });
    return { runId, bytes, mediaCount: restored.mediaCount, verified: true };
  } finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { ctx.close(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    if (!["run", "verify", "prune"].includes(command)) throw new Error("Usage: node scripts/backup-cloud.mjs run|verify|prune [--run RUN_ID for verify]");
    const args = parseFlags(rest, command === "verify" ? ["--run"] : []);
    const config = cloudBackupConfigFromEnv();
    if (!config) throw new Error("Cloud backups are disabled. Configure the private bucket and set BACKUP_ENABLED=true.");
    let result;
    if (command === "run") {
      const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
      const dbPath = process.env.DB_PATH || path.join(process.env.DATA_DIR || path.join(root, ".data"), "crewroom.sqlite");
      const mediaDir = process.env.MEDIA_DIR || path.join(process.env.DATA_DIR || path.dirname(dbPath), "media");
      result = await runCloudBackup({ runtime: { dbPath, mediaDir }, config });
    } else if (command === "verify") result = await verifyCloudBackup({ config, runId: args["--run"] });
    else result = await pruneCloudBackups({ config });
    console.log(JSON.stringify(result));
  } catch {
    // SDK errors may contain endpoints, signed request details, or credential material.
    console.error("Cloud backup operation failed. Check configuration, storage permissions, capacity, and provider status. No live data was restored.");
    process.exitCode = 1;
  }
}
