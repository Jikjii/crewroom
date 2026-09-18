import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, copyFile, writeFile, lstat, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function safeMediaFilename(filename) {
  return typeof filename === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) && filename !== "." && filename !== "..";
}

export function snapshotMediaFiles(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='social_media'").get()) return [];
  const files = db.prepare("SELECT DISTINCT filename FROM social_media WHERE (exampleFilename IS NULL OR exampleFilename='') AND filename<>'' ORDER BY filename").all().map((row) => row.filename);
  if (files.some((filename) => !safeMediaFilename(filename))) throw new Error("Database contains an unsafe media filename; backup aborted.");
  return files;
}

async function regularFile(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular file: ${file}`);
  return stat;
}

export async function createBackup({ dbPath, mediaDir, destination }) {
  dbPath = path.resolve(dbPath); mediaDir = path.resolve(mediaDir); destination = path.resolve(destination);
  if (destination === mediaDir || destination.startsWith(`${mediaDir}${path.sep}`) || dbPath.startsWith(`${destination}${path.sep}`))
    throw new Error("Choose a new backup directory separate from the live database and media.");
  await regularFile(dbPath);
  await mkdir(destination, { mode: 0o700 }); // Deliberately refuses an existing destination.
  let source, snapshot;
  try {
    const databaseFile = path.join(destination, "crewroom.sqlite");
    source = new DatabaseSync(dbPath, { readOnly: true });
    source.exec("PRAGMA busy_timeout=5000;");
    await sqliteBackup(source, databaseFile);
    source.close(); source = null;
    snapshot = new DatabaseSync(databaseFile, { readOnly: true });
    if (snapshot.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("Database backup failed its integrity check.");
    const filenames = snapshotMediaFiles(snapshot);
    snapshot.close(); snapshot = null;
    await mkdir(path.join(destination, "media"), { mode: 0o700 });
    const media = [];
    // Uploads are immutable. A concurrent deletion may make a source vanish; fail rather than label it a complete backup.
    for (const filename of filenames) {
      const sourceFile = path.join(mediaDir, filename);
      await regularFile(sourceFile);
      const target = path.join(destination, "media", filename);
      await copyFile(sourceFile, target, 1);
      const stat = await regularFile(target);
      media.push({ filename, bytes: stat.size, sha256: await sha256(target) });
    }
    const manifest = {
      format: "crewroom-backup-v1", createdAt: new Date().toISOString(),
      database: { filename: "crewroom.sqlite", sha256: await sha256(databaseFile) }, media,
      note: "Point-in-time SQLite snapshot and all referenced uploaded media. Keep private and expire according to the operator's published backup retention policy.",
    };
    await writeFile(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return manifest;
  } catch (error) {
    source?.close(); snapshot?.close();
    await rm(destination, { recursive: true, force: true }); // Only the new directory created by this invocation.
    throw error;
  }
}

export function parseFlags(argv, allowed) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (!allowed.includes(flag) || Object.hasOwn(values, flag)) throw new Error(`Unknown or repeated option: ${flag}`);
    if (flag === "--confirm-server-stopped") { values[flag] = true; continue; }
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
    values[flag] = value;
  }
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseFlags(process.argv.slice(2), ["--to", "--db", "--media"]);
    if (!args["--to"]) throw new Error("Usage: node scripts/backup.mjs --to NEW_DIRECTORY [--db DB_PATH] [--media MEDIA_DIR]");
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const dbPath = args["--db"] || process.env.DB_PATH || path.join(process.env.DATA_DIR || path.join(root, ".data"), "crewroom.sqlite");
    const mediaDir = args["--media"] || process.env.MEDIA_DIR || path.join(process.env.DATA_DIR || path.dirname(dbPath), "media");
    const result = await createBackup({ dbPath, mediaDir, destination: args["--to"] });
    console.log(`Backup complete: ${path.resolve(args["--to"])} (${result.media.length} uploaded photos). Copy it to encrypted offsite storage; this command does not do that.`);
  } catch (error) { console.error(`Backup failed: ${error.message}`); process.exitCode = 1; }
}
