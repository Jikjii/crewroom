import { DatabaseSync } from "node:sqlite";
import { readFile, lstat, readdir, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags, safeMediaFilename, sha256, snapshotMediaFiles } from "./backup.mjs";

async function checkHash(file, expected) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(expected || "") || await sha256(file) !== expected)
    throw new Error(`Backup verification failed for ${path.basename(file)}.`);
}

export async function restoreBackup({ source, destination, confirmedStopped = false }) {
  if (!confirmedStopped) throw new Error("Stop the API and explicitly pass --confirm-server-stopped. Restore never overwrites a running or existing database.");
  source = path.resolve(source); destination = path.resolve(destination);
  if (source === destination || destination.startsWith(`${source}${path.sep}`) || source.startsWith(`${destination}${path.sep}`))
    throw new Error("Restore source and target must be separate directories.");
  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
  if (manifest.format !== "crewroom-backup-v1" || manifest.database?.filename !== "crewroom.sqlite" || !Array.isArray(manifest.media))
    throw new Error("Unsupported or incomplete Crewroom backup.");
  const filenames = new Set();
  for (const media of manifest.media) {
    if (!safeMediaFilename(media.filename) || filenames.has(media.filename)) throw new Error("Invalid or repeated backup media filename.");
    filenames.add(media.filename);
    await checkHash(path.join(source, "media", media.filename), media.sha256);
  }
  const databaseFile = path.join(source, "crewroom.sqlite");
  await checkHash(databaseFile, manifest.database.sha256);
  const db = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Backup database integrity check failed.");
    const referenced = snapshotMediaFiles(db);
    if (referenced.length !== filenames.size || referenced.some((filename) => !filenames.has(filename)))
      throw new Error("Backup media list does not match the database snapshot.");
  } finally { db.close(); }
  try {
    const stat = await lstat(destination);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await readdir(destination)).length)
      throw new Error("Restore target must be a new or empty real directory. Existing data is never replaced.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(destination, { mode: 0o700 });
  }
  // COPYFILE_EXCL also refuses files introduced after the empty-target check.
  await copyFile(databaseFile, path.join(destination, "crewroom.sqlite"), 1);
  await mkdir(path.join(destination, "media"), { mode: 0o700 });
  for (const media of manifest.media)
    await copyFile(path.join(source, "media", media.filename), path.join(destination, "media", media.filename), 1);
  return { directory: destination, mediaCount: manifest.media.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseFlags(process.argv.slice(2), ["--from", "--to", "--confirm-server-stopped"]);
    if (!args["--from"] || !args["--to"]) throw new Error("Usage: node scripts/restore.mjs --from BACKUP_DIRECTORY --to EMPTY_DATA_DIRECTORY --confirm-server-stopped");
    const result = await restoreBackup({ source: args["--from"], destination: args["--to"], confirmedStopped: args["--confirm-server-stopped"] === true });
    console.log(`Verified restore completed in ${result.directory} (${result.mediaCount} uploaded photos). Inspect it before starting the API with this DATA_DIR.`);
  } catch (error) { console.error(`Restore refused or failed: ${error.message}`); process.exitCode = 1; }
}
