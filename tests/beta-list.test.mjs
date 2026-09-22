import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../server/beta-list.mjs', import.meta.url));

function fixture(t, { schema = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'crewroom-beta-list-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'crewroom.sqlite');
  const db = new DatabaseSync(dbPath);
  if (schema) {
    db.exec(`CREATE TABLE beta_subscribers (
      email TEXT PRIMARY KEY, state TEXT, device TEXT, updatesConsent INTEGER,
      role TEXT, nextShoot TEXT, source TEXT, ageConfirmedAt INTEGER,
      confirmedAt INTEGER, createdAt INTEGER, updatedAt INTEGER, consentVersion TEXT,
      privateFutureField TEXT
    ); CREATE TABLE beta_requests (token TEXT); INSERT INTO beta_requests VALUES ('NEVER-PRINT-TOKEN');`);
    const insert = db.prepare('INSERT INTO beta_subscribers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    insert.run('pending@example.test', 'pending', 'iphone', 1, 'maker', '', '{}', 1, null, 1, 1, 'beta-1', 'NEVER-PRINT-PRIVATE');
    insert.run('first@example.test', 'confirmed', 'iphone', 0, 'cosplayer', 'October shoot', '{"utm_source":"instagram"}', 1, 2, 2, 2, 'beta-1', 'NEVER-PRINT-PRIVATE');
    insert.run('second@example.test', 'confirmed', 'both', 1, 'photographer', 'City shoot', '{}', 1, 3, 3, 3, 'beta-1', 'NEVER-PRINT-PRIVATE');
    insert.run('third@example.test', 'confirmed', 'android', 1, '', '', '{}', 1, 4, 3, 4, 'beta-1', 'NEVER-PRINT-PRIVATE');
  }
  db.close();
  return { dbPath, run: (...args) => spawnSync(process.execPath, [cli, '--db', dbPath, ...args], { encoding: 'utf8' }) };
}

test('beta operator summary exposes only aggregates and leaves SQLite unchanged', t => {
  const f = fixture(t);
  const before = readFileSync(f.dbPath);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    total: 4, states: { pending: 1, confirmed: 3 },
    devices: { iphone: 2, android: 1, both: 1 }, confirmedLaunchUpdates: 2,
  });
  assert.doesNotMatch(result.stdout, /@|NEVER-PRINT|October|City/);
  assert.deepEqual(readFileSync(f.dbPath), before);
});

test('beta operator list excludes unconfirmed people and private fields, filters consent, and paginates consistently', t => {
  const f = fixture(t);
  const first = f.run('--list', '--limit=2');
  assert.equal(first.status, 0, first.stderr);
  const page = JSON.parse(first.stdout);
  assert.equal(page.total, 3);
  assert.equal(page.count, 2);
  assert.equal(page.nextOffset, 2);
  assert.deepEqual(page.subscribers.map(row => row.email), ['first@example.test', 'second@example.test']);
  assert.deepEqual(Object.keys(page.subscribers[0]).sort(), ['email', 'device', 'role', 'nextShoot', 'createdAt', 'confirmedAt', 'updatesConsent', 'source'].sort());
  assert.deepEqual(page.subscribers[0].source, { utm_source: 'instagram' });
  assert.doesNotMatch(first.stdout, /pending@example|NEVER-PRINT/);
  const last = JSON.parse(f.run('--list', '--limit', '2', '--offset', String(page.nextOffset)).stdout);
  assert.deepEqual(last.subscribers.map(row => row.email), ['third@example.test']);
  assert.equal(last.nextOffset, null);
  const consented = JSON.parse(f.run('--list', '--updates-only').stdout);
  assert.equal(consented.total, 2);
  assert.deepEqual(consented.subscribers.map(row => row.email), ['second@example.test', 'third@example.test']);
  const beyond = JSON.parse(f.run('--list', '--offset=100').stdout);
  assert.equal(beyond.count, 0);
  assert.equal(beyond.nextOffset, null);
});

test('beta operator rejects invalid arguments and never creates a database or waitlist schema', t => {
  const f = fixture(t, { schema: false });
  for (const args of [['--list', '--limit', '0'], ['--list', '--limit=501'], ['--list', '--offset=-1'],
    ['--list', '--offset', '1.5'], ['--list', '--offset', '9007199254740992'], ['--list=true'],
    ['--updates-only'], ['--all'], ['--db'], ['--list', '--list']]) {
    const result = f.run(...args);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(result.stdout, '');
  }
  const missingSchema = f.run();
  assert.equal(missingSchema.status, 1);
  assert.match(missingSchema.stderr, /Start or deploy the updated Crewroom server first/);
  const db = new DatabaseSync(f.dbPath, { readOnly: true });
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(), []);
  db.close();
  const missingPath = path.join(path.dirname(f.dbPath), 'does-not-exist.sqlite');
  const missingDb = spawnSync(process.execPath, [cli, '--db', missingPath], { encoding: 'utf8' });
  assert.equal(missingDb.status, 1);
  assert.equal(existsSync(missingPath), false);
  assert.equal(f.run('--help').status, 0);
});
