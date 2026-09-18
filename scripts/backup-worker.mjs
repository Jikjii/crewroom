import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntime } from "../server/runtime.mjs";
import { cloudBackupConfigFromEnv, runCloudBackup, verifyCloudBackup } from "./backup-cloud.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--verify-latest")) throw new Error("Invalid arguments.");
  const config = cloudBackupConfigFromEnv(process.env);
  if (!config) throw new Error("Backups are disabled.");
  const stagingRoot = process.env.CREWROOM_BACKUP_WORK_DIR || undefined;
  const summary = args[0] === "--verify-latest"
    ? await verifyCloudBackup({ config, stagingRoot })
    : await runCloudBackup({ runtime: loadRuntime(process.env, root), config, stagingRoot });
  console.log(JSON.stringify({ ok: true, summary }));
} catch {
  // Deliberately do not print provider errors: they can include identifiers or request data.
  console.error("CREWROOM_BACKUP_FAILED: check backup configuration, storage access, space, and service logs.");
  process.exitCode = 1;
}
