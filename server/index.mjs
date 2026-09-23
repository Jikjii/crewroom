import { fileURLToPath } from "node:url";
import path from "node:path";
import { createApp } from "./app.mjs";
import { createSightengineModerator } from './sightengine.mjs';
import { loadRuntime } from "./runtime.mjs";
import { cloudBackupConfigFromEnv } from "../scripts/backup-cloud.mjs";
import { backupDestinationId, createBackupScheduler, runBackupWorker } from "./backup-scheduler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = loadRuntime(process.env, root);
const { port, host } = runtime;
const backupConfig = cloudBackupConfigFromEnv(process.env);
if (runtime.production) {
  const { checkProduction } = await import("../scripts/preflight.mjs");
  const result = await checkProduction({ root });
  if (!result.ok) throw new Error(`Production preflight failed: ${result.errors.join(" ")}`);
  result.warnings.forEach((warning) => console.warn(warning));
}
let mailSender;
if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
  const { createResendSender } = await import("./accounts.mjs");
  mailSender = createResendSender({ apiKey: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM });
}
const moderationProvider = runtime.moderationMode === 'hybrid' ? createSightengineModerator({
  apiUser: process.env.SIGHTENGINE_API_USER,
  apiSecret: process.env.SIGHTENGINE_API_SECRET,
  imageWorkflow: process.env.SIGHTENGINE_IMAGE_WORKFLOW,
  videoWorkflow: process.env.SIGHTENGINE_VIDEO_WORKFLOW,
  workflowsVerified: process.env.SIGHTENGINE_WORKFLOWS_VERIFIED === 'true',
  audioModerationEnabled: process.env.SIGHTENGINE_AUDIO_MODERATION_ENABLED === 'true',
}) : undefined;
if (runtime.moderationMode === 'hybrid' && !moderationProvider?.ready)
  throw new Error('Hybrid moderation is not configured: set Sightengine credentials and a verified image workflow before activation.');
const server = createApp({ ...runtime, mailSender, moderationProvider });
const backups = backupConfig ? createBackupScheduler({
  statusPath: path.join(path.dirname(runtime.dbPath), "backup-status.json"),
  destinationId: backupDestinationId(backupConfig),
  run: ({ signal }) => runBackupWorker({ root, signal }),
}) : null;
server.on("error", (error) => {
  console.error(`Crewroom could not start: ${error.code || error.name}`);
  process.exit(1);
});
server.listen(port, host, () => {
  console.log(`Crewroom API listening on http://${host}:${port}${runtime.production ? " behind the configured HTTPS proxy" : ""}`);
  if (runtime.production && !mailSender)
    console.warn("Password-reset email is unavailable until RESEND_API_KEY and MAIL_FROM are configured.");
  backups?.start();
  if (runtime.production && !backups) console.warn("Automatic offsite backups are disabled; configure the backup destination and BACKUP_ENABLED=true.");
});
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const closed = new Promise(resolve => server.close(resolve));
    await backups?.stop();
    await closed;
    process.exit(0);
  });
