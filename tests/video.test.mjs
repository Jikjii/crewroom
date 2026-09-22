import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm, stat, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { fixture, password } from './social-fixture.mjs';
import { decideContent, reviewPacketHTML } from '../server/content-review.mjs';
import { createVideoProcessor, isHDRVideoStream, VIDEO_MAX_BYTES } from '../server/video.mjs';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const canEncode = spawnSync(ffmpeg, ['-version']).status === 0 && spawnSync(ffprobe, ['-version']).status === 0;
const nativeTest = (name, run) => test(name, { skip: canEncode ? false : 'Install ffmpeg and ffprobe to validate real video uploads.' }, run);
let directory, clip, longClip, hdrClip, hlgClip;
before(async () => {
  if (!canEncode) return;
  directory = await mkdtemp(path.join(tmpdir(), 'crewroom-video-fixtures-'));
  const input = path.join(directory, 'portrait.mov');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x480:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac',
    '-metadata', 'location=+40.7128-074.0060/', '-metadata', 'title=Private phone title', '-y', input]);
  clip = await readFile(input);
  const long = path.join(directory, 'too-long.mp4');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:size=16x16:rate=1',
    '-t', '61', '-c:v', 'libx264', '-threads', '1', '-y', long]);
  longClip = await readFile(long);
  const hdr = path.join(directory, 'hdr.mp4');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', input, '-c:v', 'libx264', '-threads', '1',
    '-vf', 'setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc', '-c:a', 'copy', '-y', hdr]);
  hdrClip = await readFile(hdr);
  const hdrMetadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', hdr], { encoding: 'utf8' }));
  assert.equal(hdrMetadata.streams[0].color_transfer, 'smpte2084', 'fixture must actually contain PQ metadata');
  const hlg = path.join(directory, 'hlg.mp4');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', input, '-c:v', 'libx264', '-threads', '1',
    '-vf', 'setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc', '-c:a', 'copy', '-y', hlg]);
  hlgClip = await readFile(hlg);
  const hlgMetadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', hlg], { encoding: 'utf8' }));
  assert.equal(hlgMetadata.streams[0].color_transfer, 'arib-std-b67', 'fixture must actually contain HLG metadata');
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function raw(f, client, route, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(f.base + route, { method, headers: {
    ...(client?.state.token ? { Authorization: `Bearer ${client.state.token}` } : {}), ...headers,
  }, body });
  const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, body: value, headers: response.headers };
}
const upload = (f, client, data = clip, type = 'video/quicktime') => raw(f, client, '/api/social/videos', { method: 'POST', body: data, headers: { 'Content-Type': type } });
function dbRead(f, fn) { const db = new DatabaseSync(f.config.dbPath); try { return fn(db); } finally { db.close(); } }
function approve(f, type, id, extra = {}) {
  return dbRead(f, db => decideContent(db, { type, id, version: f.inspect(type, id).version, decision: 'approved', mediaDir: f.config.mediaDir, ...extra }));
}

nativeTest('video upload is authenticated, validates actual clip bytes and duration, and cleans rejected files', async t => {
  const f = await fixture(t), owner = f.client();
  await owner.signup('ClipOwner');
  assert.equal((await upload(f, null)).status, 401);
  assert.equal((await upload(f, owner, clip, 'text/plain')).status, 415);
  assert.equal((await upload(f, owner, Buffer.from('#EXTM3U\nhttps://example.com/private.mp4'))).status, 400);
  assert.equal((await upload(f, owner, Buffer.alloc(0))).status, 400);
  const long = await upload(f, owner, longClip, 'video/mp4');
  assert.equal(long.status, 400); assert.match(long.body.error, /60 seconds/);
  const hdr = await upload(f, owner, hdrClip, 'video/mp4');
  assert.equal(hdr.status, 400); assert.match(hdr.body.error, /HDR video is not supported/);
  const hlg = await upload(f, owner, hlgClip, 'video/mp4');
  assert.equal(hlg.status, 400); assert.match(hlg.body.error, /HDR video is not supported/);
  assert.deepEqual(await readdir(f.config.mediaDir), []);
  const config = await owner.ok('/api/social/video-config');
  assert.deepEqual(config, { enabled: true, maxBytes: VIDEO_MAX_BYTES, maxDuration: 60 });
  // Declared limits are checked before iterating the request body.
  const processor = createVideoProcessor();
  await assert.rejects(processor.upload({ headers: { 'content-type': 'video/mp4', 'content-length': String(VIDEO_MAX_BYTES + 1) } }, f.config.mediaDir, 'media_test'), /50 MB/);
  const oversized = Readable.from([Buffer.alloc(VIDEO_MAX_BYTES + 1)]);
  oversized.headers = { 'content-type': 'video/mp4' };
  await assert.rejects(processor.upload(oversized, f.config.mediaDir, 'media_large'), /50 MB/);
  assert.deepEqual(await readdir(f.config.mediaDir), []);
});

nativeTest('video transcodes to H264/AAC, strips source metadata, creates a poster, and serves authorized ranges', async t => {
  const f = await fixture(t), owner = f.client(), stranger = f.client();
  await owner.signup('Encoder'); await stranger.signup('Spectator');
  const uploaded = await upload(f, owner);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const asset = uploaded.body;
  assert.equal(asset.kind, 'video'); assert.equal(asset.width, 320); assert.equal(asset.height, 480);
  assert.ok(asset.duration > 0 && asset.duration <= 60); assert.ok(asset.posterUrl.endsWith('/poster'));
  const saved = dbRead(f, db => db.prepare('SELECT * FROM social_media WHERE id=?').get(asset.id));
  const metadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(f.config.mediaDir, saved.filename)], { encoding: 'utf8' }));
  assert.equal(metadata.streams.find(stream => stream.codec_type === 'video').codec_name, 'h264');
  assert.equal(metadata.streams.find(stream => stream.codec_type === 'audio').codec_name, 'aac');
  assert.equal(metadata.format.tags?.location, undefined); assert.equal(metadata.format.tags?.title, undefined);
  assert.ok((await stat(path.join(f.config.mediaDir, saved.filename))).size < 24 * 1024 * 1024);
  for (const viewer of [null, stranger]) {
    assert.equal((await raw(f, viewer, asset.url, { headers: { Range: 'bytes=0-10' } })).status, 404);
    assert.equal((await raw(f, viewer, asset.posterUrl)).status, 404);
  }
  const whole = await raw(f, owner, asset.url);
  assert.equal(whole.status, 200); assert.equal(whole.headers.get('content-type'), 'video/mp4');
  assert.equal(whole.headers.get('cache-control'), 'private, no-store');
  assert.ok(whole.body.indexOf('moov') < whole.body.indexOf('mdat'), 'faststart metadata precedes video data');
  const part = await raw(f, owner, asset.url, { headers: { Range: 'bytes=4-19' } });
  assert.equal(part.status, 206); assert.deepEqual(part.body, whole.body.subarray(4, 20));
  assert.equal(part.headers.get('content-range'), `bytes 4-19/${whole.body.length}`);
  const suffix = await raw(f, owner, asset.url, { headers: { Range: 'bytes=-12' } });
  assert.equal(suffix.status, 206); assert.deepEqual(suffix.body, whole.body.subarray(-12));
  assert.equal((await raw(f, owner, asset.url, { headers: { Range: 'bytes=0-1,4-5' } })).status, 416);
  assert.equal((await raw(f, owner, asset.url, { headers: { Range: `bytes=${whole.body.length}-` } })).status, 416);
  const head = await raw(f, owner, asset.url, { method: 'HEAD', headers: { Range: 'bytes=0-1' } });
  assert.equal(head.status, 206); assert.equal(head.body.length, 0);
  const poster = await raw(f, owner, asset.posterUrl); assert.equal(poster.status, 200); assert.equal(poster.headers.get('content-type'), 'image/jpeg');
});

nativeTest('video public review requires a complete clip assertion and fingerprints video plus poster; older feeds stay photo-only', async t => {
  const f = await fixture(t), owner = f.client(), viewer = f.client();
  const profile = await owner.publicProfile('ClipMaker');
  approve(f, 'profile', profile.userId);
  const asset = (await upload(f, owner)).body;
  const post = await owner.post({ title: 'Handmade armor in motion', mediaIds: [asset.id] });
  for (const route of [asset.url, asset.posterUrl, `/api/social/posts/${post.id}`]) assert.equal((await viewer.request(route)).status, 404);
  assert.throws(() => approve(f, 'post', post.id, { imagesReviewed: true }), /videos-reviewed/);
  const inspection = f.inspect('post', post.id), packet = reviewPacketHTML(inspection);
  assert.ok(packet.includes('<video controls')); assert.ok(packet.includes('data:video/mp4;base64,'));
  assert.ok(packet.includes('media-src data:')); assert.ok(packet.includes('Watch the entire clip with sound'));
  const posterPath = inspection.media[0].posterFile, posterBytes = await readFile(posterPath);
  await writeFile(posterPath, Buffer.concat([posterBytes, Buffer.from('changed')]));
  assert.throws(() => dbRead(f, db => decideContent(db, { type: 'post', id: post.id, version: inspection.version,
    decision: 'approved', videosReviewed: true, mediaDir: f.config.mediaDir })), /changed since inspection/);
  await writeFile(posterPath, posterBytes);
  approve(f, 'post', post.id, { videosReviewed: true });
  for (const route of [asset.url, asset.posterUrl, `/api/social/posts/${post.id}`]) assert.equal((await viewer.request(route)).status, 200);
  assert.equal((await viewer.ok('/api/social/feed')).items.some(item => item.id === post.id), false);
  assert.deepEqual((await viewer.ok('/api/social/feed?mediaType=video')).items.map(item => item.id), [post.id]);
  assert.equal((await viewer.ok('/api/social/feed?mediaType=all')).items.some(item => item.id === post.id), true);
  assert.equal((await owner.ok(`/api/social/profiles/${profile.handle}`)).posts.some(item => item.id === post.id), false);
  assert.equal((await owner.ok(`/api/social/profiles/${profile.handle}?mediaType=all`)).posts.some(item => item.id === post.id), true);
  assert.equal((await viewer.request('/api/social/feed?mediaType=audio')).status, 400);
  const image = await owner.upload();
  assert.equal((await owner.request(`/api/social/posts/${post.id}`, 'PATCH', { mediaIds: [asset.id, image.id] })).status, 400);
  await owner.ok(`/api/social/posts/${post.id}`, 'PATCH', { title: 'New caption' });
  for (const route of [asset.url, asset.posterUrl]) assert.equal((await viewer.request(route)).status, 404);
  assert.equal((await owner.request(asset.url)).status, 200);
  approve(f, 'post', post.id, { videosReviewed: true });
  const reporter = f.client(); await reporter.signup('VideoReporter');
  await reporter.ok('/api/social/reports', 'POST', { targetType: 'post', targetId: post.id, reason: 'other', details: 'Local test report.' });
  for (const route of [asset.url, asset.posterUrl]) assert.equal((await raw(f, reporter, route, { headers: { Range: 'bytes=0-1' } })).status, 404);
  await viewer.signup('VideoBlocker');
  await viewer.ok('/api/social/blocks', 'POST', { userId: profile.userId });
  for (const route of [asset.url, asset.posterUrl]) assert.equal((await raw(f, viewer, route, { headers: { Range: 'bytes=0-1' } })).status, 404);
  assert.equal((await raw(f, null, asset.url, { headers: { Range: 'bytes=0-1' } })).status, 206, 'blocking is viewer-specific');
  dbRead(f, db => db.prepare('UPDATE social_profiles SET suspendedAt=? WHERE userId=?').run(new Date().toISOString(), profile.userId));
  for (const route of [asset.url, asset.posterUrl]) assert.equal((await raw(f, null, route, { headers: { Range: 'bytes=0-1' } })).status, 404);
  await owner.ok(`/api/social/posts/${post.id}`, 'DELETE');
  assert.equal((await owner.request(asset.url)).status, 404);
  assert.equal((await owner.request(asset.posterUrl)).status, 404);
});

nativeTest('account deletion removes uploaded videos and posters along with database references', async t => {
  const f = await fixture(t), owner = f.client();
  await owner.signup('DepartingVideographer');
  const asset = (await upload(f, owner)).body;
  await owner.post({ visibility: 'private', mediaIds: [asset.id] });
  const preview = await owner.ok('/api/account/deletion-preview');
  await owner.ok('/api/account', 'DELETE', { password, confirmationToken: preview.confirmationToken });
  assert.deepEqual(await readdir(f.config.mediaDir), []);
  assert.equal(dbRead(f, db => db.prepare('SELECT count(*) n FROM social_media WHERE id=?').get(asset.id)).n, 0);
});

nativeTest('video processing admits only one upload at a time and cleans an aborted upload', async t => {
  const f = await fixture(t), processor = createVideoProcessor();
  await processor.available();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const input = Readable.from((async function* () { entered(); await gate; yield clip; })());
  input.headers = { 'content-type': 'video/quicktime' };
  const first = processor.upload(input, f.config.mediaDir, 'media_first');
  await started;
  await assert.rejects(processor.upload({ headers: { 'content-type': 'video/mp4' } }, f.config.mediaDir, 'media_second'), /Another video/);
  release(); await first;
  const canceled = Readable.from([clip]), controller = new AbortController();
  canceled.headers = { 'content-type': 'video/quicktime' };
  controller.abort();
  await assert.rejects(processor.upload(canceled, f.config.mediaDir, 'media_canceled', controller.signal), /canceled/);
  assert.equal((await readdir(f.config.mediaDir)).some(name => name.startsWith('.video-upload')), false);
});

nativeTest('one processing deadline starts after upload, aborts processing, and releases temporary files and capacity', async t => {
  const mediaDir = await mkdtemp(path.join(tmpdir(), 'crewroom-video-deadline-'));
  t.after(() => rm(mediaDir, { recursive: true, force: true }));
  const processor = createVideoProcessor({ processingTimeoutMs: 1 });
  let bodyFinished = false;
  const request = Readable.from((async function* () {
    yield clip.subarray(0, 128);
    await new Promise(resolve => setTimeout(resolve, 30));
    yield clip.subarray(128);
    bodyFinished = true;
  })());
  request.headers = { 'content-type': 'video/quicktime' };
  const started = performance.now();
  await assert.rejects(processor.upload(request, mediaDir, 'media_deadline'), error => error.status === 400 && /took too long/.test(error.message));
  assert.equal(bodyFinished, true, 'processing deadline must not run during body transfer');
  assert.ok(performance.now() - started < 5000, 'deadline promptly interrupts the real subprocess');
  assert.deepEqual(await readdir(mediaDir), []);
  const retry = Readable.from([clip]); retry.headers = { 'content-type': 'video/quicktime' };
  const encoded = await createVideoProcessor().upload(retry, mediaDir, 'media_retry');
  assert.ok((await stat(path.join(mediaDir, encoded.filename))).size > 0, 'timeout released the shared processing slot');
});

nativeTest('a session revoked during an upload cannot commit the finished video', async t => {
  const f = await fixture(t), owner = f.client();
  await owner.signup('CanceledSession');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const stream = Readable.from((async function* () { yield clip.subarray(0, 512); await gate; yield clip.subarray(512); })());
  const pending = fetch(f.base + '/api/social/videos', { method: 'POST', headers: {
    Authorization: `Bearer ${owner.state.token}`, 'Content-Type': 'video/quicktime',
  }, body: stream, duplex: 'half' });
  let started = false;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await readdir(f.config.mediaDir)).some(name => name.startsWith('.video-upload-'))) { started = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(started, true, 'server accepted the upload before logout');
    await owner.ok('/api/auth/logout', 'POST', {});
  } finally { release(); }
  const response = await pending;
  assert.equal(response.status, 401, await response.text());
  assert.deepEqual(await readdir(f.config.mediaDir), []);
  assert.equal(dbRead(f, db => db.prepare("SELECT count(*) n FROM social_media WHERE kind='video'").get()).n, 0);
});

nativeTest('video admission reserves backup capacity and startup removes only abandoned upload directories', async t => {
  const f = await fixture(t);
  const stale = path.join(f.config.mediaDir, '.video-upload-ABC123');
  const unrelated = path.join(f.config.mediaDir, 'keep-this-folder');
  const external = path.join(f.directory, 'private-external');
  await mkdir(stale); await writeFile(path.join(stale, 'source.mov'), clip);
  await mkdir(unrelated); await writeFile(path.join(unrelated, 'keep.txt'), 'Keep this');
  await mkdir(external); await writeFile(path.join(external, 'keep.txt'), 'Keep external');
  const linked = path.join(f.config.mediaDir, '.video-upload-XYZ789');
  await symlink(external, linked);
  const processor = createVideoProcessor({ mediaDir: f.config.mediaDir, dbPath: f.config.dbPath, storageBudgetBytes: 1 });
  await processor.available();
  await assert.rejects(stat(stale), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(unrelated, 'keep.txt'), 'utf8'), 'Keep this');
  assert.equal(await readFile(path.join(external, 'keep.txt'), 'utf8'), 'Keep external');
  const input = Readable.from([clip]); input.headers = { 'content-type': 'video/quicktime' };
  await assert.rejects(processor.upload(input, f.config.mediaDir, 'media_quota'), /storage is full/);
  assert.equal((await readdir(f.config.mediaDir)).includes('.video-upload-XYZ789'), true, 'symlink itself is not traversed or removed');
});

test('video configuration disables uploads when the encoder is missing', async t => {
  const old = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = '/nonexistent/crewroom-test-ffmpeg';
  try {
    const f = await fixture(t), owner = f.client();
    assert.equal((await owner.ok('/api/social/video-config')).enabled, false);
    await owner.signup('WaitingForEncoder');
    assert.equal((await upload(f, owner, Buffer.from('clip'))).status, 503);
  } finally { if (old === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = old; }
});

// A Dolby Vision configuration record can be present even when color_transfer
// is unspecified (unlike the real PQ/HLG fixtures exercised through upload).
test('Dolby Vision side data and codec tags cannot fall through as SDR', () => {
  assert.equal(isHDRVideoStream({ codec_tag_string: 'hvc1', side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: 8 }] }), true);
  assert.equal(isHDRVideoStream({ codec_tag_string: 'dvh1' }), true);
  assert.equal(isHDRVideoStream({ codec_tag_string: 'dvhe' }), true);
  assert.equal(isHDRVideoStream({ codec_tag_string: 'hvc1', color_transfer: 'bt709', side_data_list: [{ side_data_type: 'Display Matrix', rotation: 90 }] }), false);
});
