import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DAY = 24 * 60 * 60 * 1000;
const RETRY = 15 * 60 * 1000;

export function backupDestinationId(config) {
  return createHash("sha256").update(JSON.stringify([config.endpoint, config.bucket, config.prefix])).digest("hex");
}

export async function readBackupStatus(statusPath, destinationId) {
  try {
    const state = JSON.parse(await readFile(statusPath, "utf8"));
    if (state?.version === 1 && state.destinationId === destinationId) return {
      version: 1, destinationId,
      lastSuccessAt: typeof state.lastSuccessAt === "string" ? state.lastSuccessAt : null,
      nextAttemptAt: typeof state.nextAttemptAt === "string" ? state.nextAttemptAt : null,
      lastAttemptAt: typeof state.lastAttemptAt === "string" ? state.lastAttemptAt : null,
      failures: Number.isSafeInteger(state.failures) && state.failures >= 0 ? state.failures : 0,
      ...(typeof state.runId === "string" ? { runId: state.runId } : {}),
      ...(Number.isSafeInteger(state.bytes) ? { bytes: state.bytes } : {}),
      ...(Number.isSafeInteger(state.mediaCount) ? { mediaCount: state.mediaCount } : {}),
      state: ["healthy", "running", "failed"].includes(state.state) ? state.state : "unknown",
    };
  } catch { /* Missing/corrupt state must cause a new backup, not suppress one. */ }
  return { version: 1, destinationId, lastSuccessAt: null, failures: 0 };
}

async function persistStatus(statusPath, state) {
  const temporary = `${statusPath}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, statusPath);
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
}

/** Child isolation keeps SQLite snapshot work and upload bookkeeping off the API event loop. */
export async function runBackupWorker({ root, env = process.env, signal, timeoutMs = 30 * 60 * 1000, verify = false }) {
  const workDir = await mkdtemp(path.join(tmpdir(), "crewroom-backup-worker-"));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, "scripts", "backup-worker.mjs"), ...(verify ? ["--verify-latest"] : [])], {
        cwd: root, env: { ...env, CREWROOM_BACKUP_WORK_DIR: workDir }, stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "", stopped = false, killTimer;
      const stop = () => {
        stopped = true;
        child.kill("SIGTERM");
        killTimer ??= setTimeout(() => child.kill("SIGKILL"), 5000);
        killTimer.unref();
      };
      const timer = setTimeout(stop, timeoutMs);
      timer.unref();
      const clean = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener("abort", stop); };
      signal?.addEventListener("abort", stop, { once: true });
      if (signal?.aborted) stop();
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.length > 65536) stop();
      });
      // SDK errors can contain request information. Only a fixed failure code leaves the worker.
      child.stderr.resume();
      child.once("error", () => { clean(); reject(new Error("BACKUP_WORKER_START_FAILED")); });
      child.once("close", (code) => {
        clean();
        if (stopped || code !== 0) return reject(new Error(stopped ? "BACKUP_WORKER_INTERRUPTED" : "BACKUP_WORKER_FAILED"));
        try {
          const result = JSON.parse(output.trim());
          if (result.ok !== true || !result.summary?.runId) throw new Error();
          resolve(result.summary);
        } catch { reject(new Error("BACKUP_WORKER_INVALID_RESULT")); }
      });
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Single instance only. Successful remote backups are daily; failures retry after 15 minutes. */
export function createBackupScheduler({ statusPath, destinationId, run, now = Date.now, log = console, intervalMs = DAY, retryMs = RETRY }) {
  let active = null, stopped = false, timer, stateCache;
  const controller = new AbortController();
  const save = async (state) => {
    stateCache = state;
    try { await persistStatus(statusPath, state); }
    catch { log.error("Crewroom backup status could not be saved; scheduling continues in memory."); }
  };
  const attempt = async () => {
    const state = stateCache ??= await readBackupStatus(statusPath, destinationId);
    const current = now();
    const success = Date.parse(state.lastSuccessAt);
    const retryAt = Date.parse(state.nextAttemptAt);
    // A far-future/corrupt timestamp must never disable backups indefinitely.
    if (Number.isFinite(retryAt) && retryAt > current && retryAt <= current + intervalMs) return { skipped: true };
    if (Number.isFinite(success) && success <= current && current - success < intervalMs) return { skipped: true };
    const startedAt = new Date(current).toISOString();
    try {
      await save({ ...state, state: "running", lastAttemptAt: startedAt });
      const result = await run({ signal: controller.signal });
      const finishedAt = new Date(now()).toISOString();
      await save({
        version: 1, destinationId, state: "healthy", lastAttemptAt: startedAt,
        lastSuccessAt: finishedAt, nextAttemptAt: null, failures: 0,
        runId: result.runId, bytes: result.bytes, mediaCount: result.mediaCount,
      });
      log.info("Crewroom offsite backup completed.");
      return { completed: true, ...result };
    } catch {
      const failure = {
        ...state, state: "failed", lastAttemptAt: startedAt,
        nextAttemptAt: new Date(now() + retryMs).toISOString(),
        failures: Math.min((Number.isSafeInteger(state.failures) ? state.failures : 0) + 1, 1000000),
      };
      await save(failure);
      log.error("CREWROOM_BACKUP_FAILED: offsite backup did not complete; retry scheduled. Inspect backup status and storage configuration.");
      return { failed: true };
    }
  };
  const tick = () => {
    if (stopped) return Promise.resolve({ stopped: true });
    if (active) return active;
    active = attempt().finally(() => { active = null; });
    return active;
  };
  return {
    tick,
    start() {
      if (timer || stopped) return;
      // Database schema and initial media setup finish before the first attempt.
      timer = setInterval(() => { void tick().catch(() => log.error("CREWROOM_BACKUP_FAILED: unexpected scheduler failure.")); }, 60 * 1000);
      timer.unref();
      log.info("Crewroom daily offsite backups enabled; first due check in one minute.");
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      controller.abort();
      await active;
    },
  };
}
