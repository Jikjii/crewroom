import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBackupScheduler, readBackupStatus, backupDestinationId } from "../server/backup-scheduler.mjs";

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), "crewroom-scheduler-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return path.join(root, "backup-status.json");
}
const quiet = { info() {}, error() {} };
const summary = { runId: "sample-run", bytes: 123, mediaCount: 1 };

test("scheduler survives restart, runs overdue work once and retries a failed backup", async (t) => {
  const statusPath = await setup(t);
  let current = Date.parse("2026-09-18T06:00:00Z"), calls = 0, fail = false;
  const options = { statusPath, destinationId: "bucket-a", now: () => current, log: quiet,
    run: async () => { calls++; if (fail) throw new Error("secret provider detail"); return summary; } };
  const first = createBackupScheduler(options);
  assert.equal((await first.tick()).completed, true);
  const originalSuccess = (await readBackupStatus(statusPath, "bucket-a")).lastSuccessAt;
  await first.stop();
  const restarted = createBackupScheduler(options);
  assert.equal((await restarted.tick()).skipped, true);
  assert.equal(calls, 1);
  current += 24 * 60 * 60 * 1000;
  fail = true;
  assert.equal((await restarted.tick()).failed, true);
  assert.equal((await readBackupStatus(statusPath, "bucket-a")).lastSuccessAt, originalSuccess);
  assert.equal((await restarted.tick()).skipped, true);
  current += 15 * 60 * 1000;
  fail = false;
  assert.equal((await restarted.tick()).completed, true);
  assert.equal(calls, 3);
  assert.equal((await readFile(statusPath, "utf8")).includes("secret provider detail"), false);
  await restarted.stop();
});

test("overlapping ticks share one job and shutdown aborts the worker", async (t) => {
  const statusPath = await setup(t);
  let calls = 0, ready;
  const started = new Promise(resolve => { ready = resolve; });
  const scheduler = createBackupScheduler({ statusPath, destinationId: "one", log: quiet,
    run: ({ signal }) => new Promise((resolve, reject) => {
      calls++; ready();
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  const a = scheduler.tick(), b = scheduler.tick();
  assert.equal(a, b);
  await started;
  await scheduler.stop();
  assert.equal(calls, 1);
  assert.equal((await a).failed, true);
  assert.equal((await scheduler.tick()).stopped, true);
});

test("corrupt state, changed destination and far-future timestamps do not suppress backups", async (t) => {
  const statusPath = await setup(t);
  const now = Date.parse("2026-09-18T06:00:00Z");
  let calls = 0;
  for (const text of ["not-json", JSON.stringify({ version: 1, destinationId: "old", lastSuccessAt: new Date(now).toISOString() }),
    JSON.stringify({ version: 1, destinationId: "new", lastSuccessAt: { toString: null, valueOf: null }, nextAttemptAt: [] }),
    JSON.stringify({ version: 1, destinationId: "new", lastSuccessAt: "2099-01-01T00:00:00Z", nextAttemptAt: "2099-01-01T00:00:00Z" })]) {
    await writeFile(statusPath, text);
    const scheduler = createBackupScheduler({ statusPath, destinationId: "new", now: () => now, log: quiet, run: async () => { calls++; return summary; } });
    assert.equal((await scheduler.tick()).completed, true);
    await scheduler.stop();
  }
  assert.equal(calls, 4);
  const original = backupDestinationId({ endpoint: "https://one", bucket: "backup", prefix: "crewroom/v1" });
  assert.notEqual(original, backupDestinationId({ endpoint: "https://one", bucket: "other", prefix: "crewroom/v1" }));
});

test("failed status bookkeeping does not prevent remote backup or cause minute-by-minute duplication", async (t) => {
  const statusPath = path.join(await setup(t), "missing-parent", "status.json");
  let calls = 0;
  const scheduler = createBackupScheduler({ statusPath, destinationId: "one", log: quiet, run: async () => { calls++; return summary; } });
  assert.equal((await scheduler.tick()).completed, true);
  assert.equal((await scheduler.tick()).skipped, true);
  assert.equal(calls, 1);
  await scheduler.stop();
});
