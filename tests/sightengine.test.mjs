import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createSightengineModerator, SIGHTENGINE_SETUP } from '../server/sightengine.mjs';

const configuration = { apiUser: 'test-user', apiSecret: 'test-secret', imageWorkflow: 'wfl_images', videoWorkflow: 'wfl_videos', workflowsVerified: true, minRequestIntervalMs: 0 };
const classes = ['sexual', 'discriminatory', 'insulting', 'violent', 'toxic', 'self-harm'];
const textOK = () => ({ status: 'success', request: { id: 'req_text' }, moderation_classes: { available: classes, ...Object.fromEntries(classes.map(name => [name, 0.01])) } });
const imageOK = () => ({ status: 'success', request: { id: 'req_image' }, workflow: { id: 'wfl_images' }, summary: { action: 'accept', reject_prob: 0.01, reject_reason: [] } });
const videoOK = () => ({ ...imageOK(), workflow: { id: 'wfl_videos' }, data: { frames: [{ info: { position: 0 } }] } });
const audioOK = () => ({ status: 'success', request: { id: 'req_audio' }, data: { audio: { profanity: [] } } });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const submission = media => ({ type: 'post', text: 'My foam cosplay build', media });

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'crewroom-sightengine-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Provider is mocked; uploaded bytes need not encode real images or video.
  const image = path.join(dir, 'private-cosplay-image.jpg'), video = path.join(dir, 'private-cosplay-video.mp4');
  await writeFile(image, Buffer.from('image-byte-fixture'));
  await writeFile(video, Buffer.from('video-byte-fixture'));
  return { dir, image, video, videoItem: { file: video, kind: 'video', posterFile: image, duration: 10 } };
}

test('Sightengine preparation performs no I/O and is disabled without verified configuration', async () => {
  for (const config of [{}, { ...configuration, workflowsVerified: false }, { ...configuration, apiSecret: '' }, { ...configuration, textLanguages: 'invalid' }]) {
    let calls = 0;
    const moderator = createSightengineModerator({ ...config, fetchImpl: async () => { calls++; throw new Error('unexpected'); } });
    assert.equal(moderator.ready, false);
    assert.equal((await moderator.screen(submission([]))).decision, 'review');
    assert.equal(calls, 0);
    assert.equal(JSON.stringify(moderator).includes('test-secret'), false);
  }
  const photos = createSightengineModerator(configuration);
  assert.equal(photos.ready, true);
  assert.equal(photos.videoReady, false);
  const videos = createSightengineModerator({ ...configuration, audioModerationEnabled: true });
  assert.equal(videos.videoReady, true);
  assert.equal(videos.readiness.audioEnglishOnly, true);
  assert.match(SIGHTENGINE_SETUP.audioLimit, /not comprehensive or multilingual/);
});

test('all text and every image must pass; requests use fixed HTTPS multipart without public URLs or local filenames', async t => {
  const f = await fixture(t), calls = [];
  const moderator = createSightengineModerator({ ...configuration, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return json(url.endsWith('/text/check.json') ? textOK() : imageOK());
  } });
  const result = await moderator.screen(submission([{ file: f.image, kind: 'image' }, { file: f.image, kind: 'image' }]));
  assert.equal(result.decision, 'pass'); assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.url), ['https://api.sightengine.com/1.0/text/check.json', 'https://api.sightengine.com/1.0/check-workflow.json', 'https://api.sightengine.com/1.0/check-workflow.json']);
  for (const { options } of calls) {
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('api_user'), 'test-user'); assert.equal(options.body.get('api_secret'), 'test-secret');
    assert.equal(options.body.has('url'), false); assert.equal(options.body.has('stream_url'), false);
  }
  assert.equal(calls[0].options.body.get('models'), 'general,self-harm');
  assert.equal(calls[0].options.body.get('lang'), 'en,es');
  assert.equal(calls[1].options.body.get('workflow'), 'wfl_images');
  assert.equal(calls[1].options.body.get('media').name, 'image');
  assert.equal(await calls[1].options.body.get('media').text(), 'image-byte-fixture');
});

test('text scores must cover every model class and be finite probabilities below the review threshold', async () => {
  for (const mutate of [
    body => { body.moderation_classes.violent = 0.5; },
    body => { delete body.moderation_classes['self-harm']; },
    body => { body.moderation_classes.available = ['toxic']; },
    body => { body.moderation_classes.sexual = '0.01'; },
    body => { body.moderation_classes.insulting = -1; },
    body => { body.moderation_classes.toxic = null; },
  ]) {
    const body = textOK(); mutate(body);
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async () => json(body) });
    assert.equal((await moderator.screen(submission([]))).decision, 'review');
  }
});

test('image rejection, missing acceptance, wrong workflow, and inconsistent acceptance always require review', async t => {
  const f = await fixture(t);
  for (const mutate of [
    body => { body.summary.action = 'reject'; },
    body => { delete body.summary.action; },
    body => { body.summary.action = 'ACCEPT'; },
    body => { body.workflow.id = 'wfl_other'; },
    body => { body.summary.reject_reason = [{ text: 'unsafe' }]; },
    body => { body.summary.reject_prob = 0.9; },
    body => { body.status = 'failure'; },
  ]) {
    const body = imageOK(); mutate(body);
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async () => json(body) });
    assert.equal((await moderator.screen({ type: 'post', text: '', media: [{ file: f.image, kind: 'image' }] })).decision, 'review');
  }
});

test('one flagged image prevents publication even after earlier images pass', async t => {
  const f = await fixture(t); let calls = 0;
  const moderator = createSightengineModerator({ ...configuration, fetchImpl: async () => {
    calls++; const body = imageOK(); if (calls === 2) body.summary.action = 'reject'; return json(body);
  } });
  assert.equal((await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file: f.image }, { kind: 'image', file: f.image }] })).reason, 'image_flagged');
  assert.equal(calls, 2);
});

test('video requires explicit audio configuration, known short duration, and a poster before any network transfer', async t => {
  const f = await fixture(t);
  for (const [extra, item] of [
    [{}, f.videoItem], [{ audioModerationEnabled: true }, { ...f.videoItem, duration: undefined }],
    [{ audioModerationEnabled: true }, { ...f.videoItem, duration: 60 }],
    [{ audioModerationEnabled: true }, { ...f.videoItem, duration: -1 }],
    [{ audioModerationEnabled: true }, { ...f.videoItem, posterFile: undefined }],
    [{ audioModerationEnabled: true, videoWorkflow: '' }, f.videoItem],
  ]) {
    let calls = 0;
    const moderator = createSightengineModerator({ ...configuration, ...extra, fetchImpl: async () => { calls++; return json(videoOK()); } });
    assert.equal((await moderator.screen(submission([item]))).decision, 'review');
    assert.equal(calls, 0);
  }
});

test('configured video screening checks text, actual clip visuals, actual audio and poster independently', async t => {
  const f = await fixture(t), calls = [];
  const responses = [textOK(), videoOK(), audioOK(), imageOK()];
  const moderator = createSightengineModerator({ ...configuration, audioModerationEnabled: true, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return json(responses[calls.length - 1]);
  } });
  assert.equal((await moderator.screen(submission([f.videoItem]))).decision, 'pass');
  assert.equal(calls.length, 4);
  assert.equal(calls[1].url, 'https://api.sightengine.com/1.0/video/check-workflow-sync.json');
  assert.equal(calls[2].url, 'https://api.sightengine.com/1.0/video/check-sync.json');
  assert.equal(calls[2].options.body.get('models'), 'audio-profanity');
  assert.equal(await calls[1].options.body.get('media').text(), 'video-byte-fixture');
  assert.equal(await calls[2].options.body.get('media').text(), 'video-byte-fixture');
  assert.equal(await calls[3].options.body.get('media').text(), 'image-byte-fixture');
});

test('missing video frames, missing audio results, flagged speech and flagged posters cannot pass', async t => {
  const f = await fixture(t);
  for (const change of [
    responses => { responses[0].data.frames = []; },
    responses => { delete responses[1].data.audio; },
    responses => { responses[1].data.audio.profanity = null; },
    responses => { responses[1].data.audio.profanity = [{ match: 'private speech' }]; },
    responses => { responses[2].summary.action = 'reject'; },
  ]) {
    const responses = [videoOK(), audioOK(), imageOK()]; change(responses); let count = 0;
    const moderator = createSightengineModerator({ ...configuration, audioModerationEnabled: true, fetchImpl: async () => json(responses[count++]) });
    const decision = await moderator.screen({ type: 'post', text: '', media: [f.videoItem] });
    assert.equal(decision.decision, 'review');
    assert.equal(JSON.stringify(decision).includes('private speech'), false);
  }
});

test('HTTP failures, non-JSON, malformed JSON, incomplete success and oversized bodies fail closed without leaking messages', async () => {
  for (const response of [
    () => json({ error: 'test-secret private contents' }, 429),
    () => new Response('<html>test-secret</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{oops', { headers: { 'Content-Type': 'application/json' } }),
    () => json({ status: 'success' }),
    () => new Response(' '.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
    () => { const error = new Error('test-secret'); error.moderationCode = 'test-secret'; throw error; },
  ]) {
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async () => response() });
    const decision = await moderator.screen(submission([]));
    assert.equal(decision.decision, 'review');
    assert.equal(JSON.stringify(decision).includes('test-secret'), false);
  }
});

test('requests and response bodies are bounded by time, and caller cancellation prevents publication', async () => {
  const hungFetch = createSightengineModerator({ ...configuration, timeoutMs: 15, fetchImpl: async () => new Promise(() => {}) });
  assert.equal((await hungFetch.screen(submission([]))).reason, 'screening_interrupted');
  const hungBody = createSightengineModerator({ ...configuration, timeoutMs: 15, fetchImpl: async () => new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } }) });
  assert.equal((await hungBody.screen(submission([]))).decision, 'review');
  const aborted = new AbortController(); aborted.abort(); let calls = 0;
  const moderator = createSightengineModerator({ ...configuration, fetchImpl: async () => { calls++; return json(textOK()); } });
  assert.equal((await moderator.screen(submission([]), { signal: aborted.signal })).reason, 'screening_interrupted');
  assert.equal(calls, 0);
});

test('adapter admits one screening at a time and recovers after completion', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const moderator = createSightengineModerator({ ...configuration, fetchImpl: async () => { await gate; return json(textOK()); } });
  const first = moderator.screen(submission([]));
  assert.equal((await moderator.screen(submission([]))).reason, 'screening_busy');
  release();
  assert.equal((await first).decision, 'pass');
  assert.equal((await moderator.screen(submission([]))).decision, 'pass');
});

test('request pacing respects the overall deadline and never starts a transfer after cancellation', async t => {
  const f = await fixture(t); let calls = 0;
  const moderator = createSightengineModerator({ ...configuration, minRequestIntervalMs: 1000, totalTimeoutMs: 20, fetchImpl: async () => { calls++; return json(textOK()); } });
  const result = await moderator.screen(submission([{ kind: 'image', file: f.image }]));
  assert.equal(result.reason, 'screening_interrupted');
  assert.equal(calls, 1);
});

test('local files must be regular bounded files, not URLs, symlinks, missing files or directories', async t => {
  const f = await fixture(t), link = path.join(f.dir, 'link.jpg'), large = path.join(f.dir, 'large.jpg');
  await symlink(f.image, link); await writeFile(large, 'a'); await truncate(large, 10 * 1024 * 1024 + 1);
  for (const file of ['https://example.com/image.jpg', 'relative.jpg', link, large, f.dir, path.join(f.dir, 'missing')]) {
    let calls = 0;
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async () => { calls++; return json(imageOK()); } });
    const decision = await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file }] });
    assert.equal(decision.decision, 'review'); assert.equal(calls, 0);
    assert.equal(JSON.stringify(decision).includes(file), false);
  }
});

test('unsupported submissions and oversized text are reviewed rather than silently truncated or partially screened', async () => {
  let calls = 0;
  const moderator = createSightengineModerator({ ...configuration, fetchImpl: async () => { calls++; return json(textOK()); } });
  for (const value of [null, {}, { type: 'other', text: 'hi', media: [] }, { type: 'post', text: '', media: [] }, { type: 'post', text: 'x'.repeat(12_001), media: [] }, { type: 'post', text: 'hi', media: [{ kind: 'audio', file: '/tmp/file' }] }, { type: 'post', text: 'hi', media: new Array(5).fill({ kind: 'image', file: '/tmp/file' }) }]) {
    assert.equal((await moderator.screen(value)).decision, 'review');
  }
  assert.equal(calls, 0);
});
