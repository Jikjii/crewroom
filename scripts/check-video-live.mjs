import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { cloudBackupConfigFromEnv, runCloudBackup, verifyCloudBackup } from './backup-cloud.mjs';

const MAX_BODY = 4 * 1024 * 1024;
const ensure = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { safeCode: code }); };
const emitTo = write => value => write(JSON.stringify(value));

async function syntheticClip(directory) {
  const video = path.join(directory, 'fixture.mp4'), poster = path.join(directory, 'fixture-poster.jpg');
  const run = args => execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args],
    { timeout: 20_000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  run(['-f', 'lavfi', '-i', 'testsrc2=size=160x240:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', video]);
  run(['-i', video, '-frames:v', '1', '-threads', '1', '-y', poster]);
  return { video, poster, bytes: await readFile(video) };
}

function checkedBase(baseUrl) {
  const url = new URL(baseUrl);
  ensure(url.origin === baseUrl && !url.username && !url.password &&
    (baseUrl === 'https://joincrewroom.com' || url.protocol === 'http:' && url.hostname === '127.0.0.1'), 'unsupported_origin');
  return url.origin;
}

/** No emails, public profiles/posts, review decisions, or existing accounts are changed.
 * Creates two disposable .invalid accounts and at most two one-second uploads.
 * All fixture accounts are deleted in finally, including after a failed check.
 * If cleanup cannot reach the server, a mode-0600 recovery file retains only
 * these fixture credentials; its generated path is the only non-fixed output.
 */
export async function runPrivateVideoChecks({ argv = process.argv.slice(2), baseUrl = 'https://joincrewroom.com', fetchImpl = fetch,
  write = line => console.log(line) } = {}) {
  const emit = emitTo(write);
  if (argv.length !== 1 || argv[0] !== '--private-video-fixtures') {
    emit({ event: 'preflight', success: false, code: 'explicit_private_fixture_opt_in_required' });
    return { success: false, exitCode: 1 };
  }
  let temporary, requests = 0, cleanupRequests = 0, success = false, cleanupOK = true, failedCode = 'private_video_check_failed';
  const accounts = [], cases = [];
  let base;
  const request = async (route, account, { method = 'GET', data, bytes, headers = {}, cleanup = false } = {}) => {
    ensure(/^\/api\/[A-Za-z0-9/_?=&.-]+$/.test(route), 'unexpected_api_route');
    ensure(cleanup ? ++cleanupRequests <= 12 : ++requests <= 48, 'request_budget_exceeded');
    const response = await fetchImpl(base + route, { method, redirect: 'error', signal: AbortSignal.timeout(120_000),
      headers: { ...(account?.token ? { Authorization: `Bearer ${account.token}` } : {}),
        ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: bytes ?? (data !== undefined ? JSON.stringify(data) : undefined) });
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) {
      size += chunk.length; ensure(size <= MAX_BODY, 'response_size_exceeded'); chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const body = response.headers.get('content-type')?.includes('application/json') && buffer.length ? JSON.parse(buffer) : buffer;
    return { status: response.status, headers: response.headers, body, buffer };
  };
  const passed = id => { cases.push(id); emit({ event: 'case', id, success: true }); };
  async function remove(account) {
    if (account.deleted || !account.attempted) return;
    // If signup succeeded but its response was lost, recover this fixture's own
    // session using only its generated email/password. Never accept an input ID.
    if (!account.token) {
      const login = await request('/api/auth/login', null, { method: 'POST', data: { email: account.email, password: account.password }, cleanup: true });
      if (login.status === 401) { account.deleted = true; return; }
      ensure(login.status === 200 && typeof login.body.sessionToken === 'string', 'cleanup_login_failed');
      account.token = login.body.sessionToken;
    }
    const preview = await request('/api/account/deletion-preview', account, { cleanup: true });
    ensure(preview.status === 200 && preview.body.ownedCrews?.length === 0 && preview.body.sharedCrewsPreserved === 0,
      'fixture_deletion_preview_unexpected');
    const removed = await request('/api/account', account, { method: 'DELETE', cleanup: true,
      data: { password: account.password, confirmationToken: preview.body.confirmationToken } });
    ensure(removed.status === 200, 'fixture_account_cleanup_failed');
    account.deleted = true;
    return removed.body;
  }
  try {
    base = checkedBase(baseUrl);
    temporary = await mkdtemp(path.join(tmpdir(), 'crewroom-private-video-check-'));
    const clip = await syntheticClip(temporary);
    ensure(clip.bytes.length < 512 * 1024, 'synthetic_fixture_too_large');
    const configuration = await request('/api/public-config');
    ensure(configuration.status === 200 && typeof configuration.body.policyVersion === 'string', 'public_configuration_unavailable');
    const video = await request('/api/social/video-config');
    ensure(video.status === 200 && video.body.enabled === true && video.body.maxDuration === 60, 'video_unavailable');
    passed('deployed-video-capability');
    const runId = randomUUID();
    for (const role of ['owner', 'stranger']) {
      const account = { email: `video-check-${runId}-${role}@example.invalid`, password: randomBytes(32).toString('base64url'), attempted: true };
      accounts.push(account);
      const response = await request('/api/auth/signup', null, { method: 'POST', data: {
        name: 'Private video acceptance fixture', email: account.email, password: account.password,
        policyAccepted: true, ageConfirmed: true, policyVersion: configuration.body.policyVersion,
      } });
      ensure(response.status === 201 && typeof response.body.sessionToken === 'string', 'fixture_signup_failed');
      account.token = response.body.sessionToken;
    }
    const [owner, stranger] = accounts;
    const upload = account => request('/api/social/videos', account, { method: 'POST', bytes: clip.bytes, headers: { 'Content-Type': 'video/mp4' } });
    ensure((await upload(null)).status === 401, 'anonymous_upload_not_rejected');
    const uploaded = await upload(owner);
    ensure(uploaded.status === 201 && uploaded.body.kind === 'video' && uploaded.body.duration > 0 && uploaded.body.duration <= 2,
      'video_upload_failed');
    const asset = uploaded.body;
    ensure(/^media_[a-f0-9-]+$/.test(asset.id) && asset.url === `/api/social/media/${asset.id}` && asset.posterUrl === `${asset.url}/poster`, 'unexpected_media_location');
    passed('synthetic-upload-and-poster-generation');
    const post = await request('/api/social/posts', owner, { method: 'POST', data: {
      title: 'Private video acceptance fixture', stage: 'wip', visibility: 'private', mediaIds: [asset.id],
    } });
    ensure(post.status === 201 && post.body.visibility === 'private' && /^post_[a-f0-9-]+$/.test(post.body.id), 'private_post_failed');
    const postRoute = `/api/social/posts/${post.body.id}`;
    for (const viewer of [null, stranger]) for (const route of [asset.url, asset.posterUrl, postRoute]) {
      ensure((await request(route, viewer, { headers: { Range: 'bytes=0-15' } })).status === 404, 'private_media_authorization_failed');
    }
    passed('anonymous-and-stranger-private-access-denied');
    const whole = await request(asset.url, owner), poster = await request(asset.posterUrl, owner);
    ensure(whole.status === 200 && whole.headers.get('content-type') === 'video/mp4' && whole.headers.get('cache-control') === 'private, no-store' &&
      whole.buffer.length > 0 && whole.buffer.indexOf('moov') > 0 && whole.buffer.indexOf('moov') < whole.buffer.indexOf('mdat'), 'owner_video_playback_failed');
    ensure(poster.status === 200 && poster.headers.get('content-type') === 'image/jpeg' && poster.buffer[0] === 255 && poster.buffer[1] === 216, 'owner_poster_failed');
    const range = await request(asset.url, owner, { headers: { Range: 'bytes=4-19' } });
    ensure(range.status === 206 && range.buffer.equals(whole.buffer.subarray(4, 20)) &&
      range.headers.get('content-range') === `bytes 4-19/${whole.buffer.length}`, 'authorized_range_failed');
    const suffix = await request(asset.url, owner, { headers: { Range: 'bytes=-12' } });
    ensure(suffix.status === 206 && suffix.buffer.equals(whole.buffer.subarray(-12)), 'authorized_suffix_range_failed');
    ensure((await request(asset.url, owner, { headers: { Range: 'bytes=0-1,4-5' } })).status === 416, 'multiple_ranges_not_rejected');
    const head = await request(asset.url, owner, { method: 'HEAD', headers: { Range: 'bytes=0-1' } });
    ensure(head.status === 206 && head.buffer.length === 0, 'authorized_head_failed');
    passed('owner-playback-poster-byte-ranges-and-head');
    ensure((await request(postRoute, owner, { method: 'DELETE' })).status === 200, 'private_post_delete_failed');
    for (const route of [asset.url, asset.posterUrl, postRoute]) ensure((await request(route, owner)).status === 404, 'deleted_post_media_still_available');
    passed('post-deletion-revokes-media-access');
    const second = await upload(owner);
    ensure(second.status === 201 && /^media_[a-f0-9-]+$/.test(second.body.id) &&
      second.body.url === `/api/social/media/${second.body.id}` && second.body.posterUrl === `${second.body.url}/poster`, 'second_fixture_upload_failed');
    const removedOwner = await remove(owner);
    ensure(removedOwner?.mediaCleanupPending === false, 'account_media_cleanup_pending');
    for (const route of [second.body.url, second.body.posterUrl]) ensure((await request(route)).status === 404, 'deleted_account_media_still_available');
    ensure((await request('/api/account/deletion-preview', owner)).status === 401, 'deleted_account_session_still_valid');
    passed('account-deletion-removes-access-and-revokes-session');
    success = true;
  } catch (error) { failedCode = error.safeCode || 'private_video_check_failed'; }
  finally {
    for (const account of accounts) try { await remove(account); } catch { cleanupOK = false; }
    if (temporary && !cleanupOK) {
      const recovery = path.join(temporary, 'fixture-cleanup-recovery.json');
      await writeFile(recovery, JSON.stringify({ base, accounts: accounts.filter(account => !account.deleted) }), { mode: 0o600 });
      emit({ event: 'cleanup', success: false, code: 'fixture_cleanup_needs_retry', recoveryFile: recovery });
    } else if (temporary) await rm(temporary, { recursive: true, force: true });
  }
  const result = { event: 'summary', success: success && cleanupOK, casesPassed: cases.length, requests, cleanupRequests,
    fixtureAccountsDeleted: accounts.filter(account => account.deleted).length, publicPostsCreated: 0, cleanupOK,
    ...(!success ? { code: failedCode } : {}) };
  emit(result); return { ...result, exitCode: result.success ? 0 : 1 };
}

/** Uses an isolated synthetic SQLite database and a fresh prefix disjoint from
 * the production backup prefix. It never reads the production DB/media, selects
 * a production backup, or changes its latest run. Only created keys are deleted.
 */
export async function runIsolatedVideoBackup({ argv = process.argv.slice(2), env = process.env, client,
  write = line => console.log(line) } = {}) {
  const emit = emitTo(write);
  if (argv.length !== 1 || argv[0] !== '--isolated-video-backup-drill') {
    emit({ event: 'preflight', success: false, code: 'explicit_isolated_backup_opt_in_required' });
    return { success: false, exitCode: 1 };
  }
  let temporary, ownedClient, scopedClient, requests = 0, cleanupRequests = 0, config, success = false, cleanupOK = true;
  const written = new Set();
  try {
    const production = cloudBackupConfigFromEnv(env);
    ensure(production, 'cloud_backup_configuration_missing');
    const prefix = `crewroom-video-drill/${randomUUID()}`;
    ensure(prefix !== production.prefix && !prefix.startsWith(`${production.prefix}/`) && !production.prefix.startsWith(`${prefix}/`), 'drill_prefix_not_isolated');
    config = { ...production, prefix, maxBytes: Math.min(production.maxBytes, 8 * 1024 * 1024) };
    const rawClient = client || (ownedClient = new S3Client({ endpoint: config.endpoint, region: 'auto', forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestHandler: { connectionTimeout: 5000, requestTimeout: 120_000 },
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' }));
    scopedClient = { send: async (command, options) => {
      ensure(++requests <= 48, 'cloud_request_budget_exceeded');
      const input = command.input;
      ensure(input.Bucket === config.bucket && (input.Key?.startsWith(`${prefix}/`) || input.Prefix === `${prefix}/`), 'cloud_scope_violation');
      if (command.constructor.name === 'PutObjectCommand') written.add(input.Key);
      return rawClient.send(command, options);
    } };
    temporary = await mkdtemp(path.join(tmpdir(), 'crewroom-video-backup-drill-'));
    const mediaDir = path.join(temporary, 'media'); await mkdir(mediaDir);
    await syntheticClip(mediaDir);
    const dbPath = path.join(temporary, 'crewroom.sqlite'), db = new DatabaseSync(dbPath);
    try { db.exec("CREATE TABLE social_media(filename TEXT,posterFilename TEXT,exampleFilename TEXT); INSERT INTO social_media VALUES('fixture.mp4','fixture-poster.jpg',NULL);"); }
    finally { db.close(); }
    const backup = await runCloudBackup({ runtime: { dbPath, mediaDir }, config, client: scopedClient });
    ensure(backup.verified && backup.mediaCount === 2 && written.size === 4, 'video_backup_incomplete');
    emit({ event: 'case', id: 'isolated-video-and-poster-cloud-readback', success: true });
    const restored = await verifyCloudBackup({ config, runId: backup.runId, client: scopedClient });
    ensure(restored.verified && restored.mediaCount === 2 && restored.bytes === backup.bytes, 'video_restore_incomplete');
    emit({ event: 'case', id: 'isolated-video-and-poster-cloud-restore', success: true });
    success = true;
  } catch { /* Provider errors can contain credentials/request data: emit fixed codes only. */ }
  finally {
    if (scopedClient) {
      // The completion marker is removed first. Failed PUTs are included because
      // a lost response can still mean the object was created remotely.
      const keys = [...written].sort((a, b) => Number(b.endsWith('/manifest.json')) - Number(a.endsWith('/manifest.json')));
      for (const key of keys) try {
        cleanupRequests++;
        await scopedClient.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: AbortSignal.timeout(120_000) });
      } catch { cleanupOK = false; }
      try {
        cleanupRequests++;
        const remaining = await scopedClient.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: `${config.prefix}/`, MaxKeys: 10 }), { abortSignal: AbortSignal.timeout(120_000) });
        if (remaining.IsTruncated || remaining.Contents?.length) cleanupOK = false;
      } catch { cleanupOK = false; }
    }
    ownedClient?.destroy();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
  const result = { event: 'summary', success: success && cleanupOK, cloudRequests: requests, cleanupRequests,
    uploadedObjects: written.size, mediaCount: success ? 2 : 0, cleanupOK, productionBackupChanged: false,
    ...(!cleanupOK && config ? { cleanupPrefix: config.prefix } : {}), ...(!success ? { code: 'isolated_video_backup_failed' } : {}) };
  emit(result); return { ...result, exitCode: result.success ? 0 : 1 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const result = args[0] === '--isolated-video-backup-drill' ? await runIsolatedVideoBackup() : await runPrivateVideoChecks();
    process.exitCode = result.exitCode;
  } catch { console.error(JSON.stringify({ event: 'summary', success: false, code: 'video_live_check_failed' })); process.exitCode = 1; }
}
