import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fixture } from './social-fixture.mjs';
import { runPrivateVideoChecks, runIsolatedVideoBackup } from '../scripts/check-video-live.mjs';

const canEncode = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version']).status === 0 &&
  spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-version']).status === 0;
const native = (name, run) => test(name, { skip: canEncode ? false : 'Requires ffmpeg/ffprobe.' }, run);
const env = { BACKUP_ENABLED: 'true', BACKUP_S3_ENDPOINT: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`,
  BACKUP_S3_BUCKET: 'crewroom-test-backups', BACKUP_PREFIX: 'crewroom-beta/v1',
  BACKUP_S3_ACCESS_KEY_ID: 'fixture-key', BACKUP_S3_SECRET_ACCESS_KEY: 'fixture-secret' };

function storedEntities(f) {
  const db = new DatabaseSync(f.config.dbPath, { readOnly: true });
  try {
    // Crewroom starts with three readonly example creators and gallery entries.
    // Preserve their actual records, not just counts: cleanup must remove only
    // our disposable fixtures and leave the pre-existing gallery untouched.
    return Object.fromEntries(['users', 'social_posts', 'social_media'].map(table =>
      [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
  } finally { db.close(); }
}

class MemoryS3 {
  objects = new Map(); calls = []; corruptRestore = false; puts = 0;
  async send(command) {
    const action = command.constructor.name, input = command.input;
    this.calls.push({ action, key: input.Key, prefix: input.Prefix });
    if (action === 'ListObjectsV2Command') return { Contents: [...this.objects.keys()].filter(Key => Key.startsWith(input.Prefix)).map(Key => ({ Key, LastModified: new Date() })) };
    if (action === 'DeleteObjectCommand') { this.objects.delete(input.Key); return {}; }
    if (action === 'PutObjectCommand') {
      const chunks = []; for await (const chunk of input.Body) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks); assert.equal(bytes.length, input.ContentLength);
      this.objects.set(input.Key, { bytes, metadata: input.Metadata }); this.puts++; return {};
    }
    const value = this.objects.get(input.Key);
    if (!value) throw new Error('Provider diagnostic with fixture-secret must not be logged');
    if (action === 'HeadObjectCommand') return { ContentLength: value.bytes.length, Metadata: value.metadata };
    if (action === 'GetObjectCommand') {
      const bytes = Buffer.from(value.bytes);
      if (this.corruptRestore && this.puts === 4 && input.Key.endsWith('fixture-poster.jpg')) bytes[0] ^= 255;
      return { ContentLength: bytes.length, Body: Readable.from([bytes]) };
    }
    throw new Error('Unexpected S3 command');
  }
}

test('live checks refuse missing opt-in and unapproved origins before network calls', async () => {
  const logs = []; let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('network must not run'); };
  assert.equal((await runPrivateVideoChecks({ argv: [], fetchImpl, write: value => logs.push(value) })).success, false);
  assert.equal((await runPrivateVideoChecks({ argv: ['--private-video-fixtures'], baseUrl: 'https://attacker.example', fetchImpl, write: value => logs.push(value) })).success, false);
  const cloud = new MemoryS3();
  assert.equal((await runIsolatedVideoBackup({ argv: [], env, client: cloud, write: value => logs.push(value) })).success, false);
  assert.equal(calls, 0); assert.deepEqual(cloud.calls, []);
  assert.ok(logs.every(line => !line.includes('fixture-secret')));
});

native('private video acceptance checks exercise real API ranges/deletion and remove both fixture accounts and files', async t => {
  let emailCalls = 0;
  const f = await fixture(t, { mailSender: async () => { emailCalls++; } }), logs = [];
  const original = storedEntities(f);
  const result = await runPrivateVideoChecks({ argv: ['--private-video-fixtures'], baseUrl: f.base, write: value => logs.push(value) });
  assert.equal(result.success, true, logs.join('\n'));
  assert.equal(result.casesPassed, 6); assert.equal(result.fixtureAccountsDeleted, 2);
  assert.equal(result.publicPostsCreated, 0); assert.equal(emailCalls, 0);
  assert.deepEqual(await readdir(f.config.mediaDir), []);
  assert.deepEqual(storedEntities(f), original);
  assert.equal(logs.some(line => /password|sessionToken|example.invalid/.test(line)), false);
});

native('a deployed upload failure still deletes fixtures and sanitizes service diagnostics', async t => {
  const f = await fixture(t), logs = [];
  const original = storedEntities(f);
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/api/social/videos') && options.headers.Authorization)
      return Response.json({ error: 'SECRET INTERNAL SERVER ERROR' }, { status: 503 });
    return fetch(url, options);
  };
  const result = await runPrivateVideoChecks({ argv: ['--private-video-fixtures'], baseUrl: f.base, fetchImpl, write: value => logs.push(value) });
  assert.equal(result.success, false); assert.equal(result.cleanupOK, true); assert.equal(result.fixtureAccountsDeleted, 2);
  assert.deepEqual(storedEntities(f), original);
  assert.equal(logs.some(line => line.includes('SECRET')), false);
});

native('video backup drill restores actual MP4/poster, deletes own cloud objects, and cannot affect production keys', async () => {
  const client = new MemoryS3(), logs = [];
  const preservedKey = `${env.BACKUP_PREFIX}/run-1790000000000-11111111-2222-4333-8444-555555555555/manifest.json`;
  client.objects.set(preservedKey, { bytes: Buffer.from('production backup sentinel'), metadata: {} });
  const result = await runIsolatedVideoBackup({ argv: ['--isolated-video-backup-drill'], env, client, write: value => logs.push(value) });
  assert.equal(result.success, true, logs.join('\n')); assert.equal(result.mediaCount, 2); assert.equal(result.uploadedObjects, 4);
  assert.deepEqual([...client.objects.keys()], [preservedKey]);
  assert.ok(client.calls.every(call => (call.key || call.prefix).startsWith('crewroom-video-drill/')));
  assert.ok(client.calls.filter(call => call.action === 'PutObjectCommand').some(call => call.key.endsWith('/fixture.mp4')));
  assert.ok(client.calls.filter(call => call.action === 'PutObjectCommand').some(call => call.key.endsWith('/fixture-poster.jpg')));
  assert.equal(logs.some(line => /fixture-secret|fixture-key|cloudflarestorage/.test(line)), false);
});

native('corrupt restored poster fails the drill and still removes its four cloud objects', async () => {
  const client = new MemoryS3(); client.corruptRestore = true;
  const result = await runIsolatedVideoBackup({ argv: ['--isolated-video-backup-drill'], env, client, write: () => {} });
  assert.equal(result.success, false); assert.equal(result.cleanupOK, true);
  assert.equal(result.code, 'isolated_video_backup_failed'); assert.equal(client.objects.size, 0);
});
