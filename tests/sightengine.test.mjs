import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createSightengineModerator, SIGHTENGINE_SETUP } from '../server/sightengine.mjs';

const configuration = { apiUser: 'test-user', apiSecret: 'test-secret', imageWorkflow: 'wfl_images', videoWorkflow: 'wfl_videos', workflowsVerified: true, minRequestIntervalMs: 0 };
const classes = ['sexual', 'discriminatory', 'insulting', 'violent', 'toxic', 'self-harm'];
const textOK = () => ({ status: 'success', request: { id: 'req_text' }, moderation_classes: { available: classes, ...Object.fromEntries(classes.map(name => [name, 0.01])) } });
const imageOK = () => ({
  status: 'success', request: { id: 'req_image' }, workflow: { id: 'wfl_images' }, summary: { action: 'accept', reject_prob: 0.01, reject_reason: [] },
  nudity: { sexual_activity: 0.01, sexual_display: 0.01, erotica: 0.01 },
  gore: { prob: 0.01 },
  offensive: { nazi: 0.01, supremacist: 0.01, terrorist: 0.01, confederate: 0.01, asian_swastika: 0.01, middle_finger: 0.01 },
  violence: { prob: 0.01 },
  'self-harm': { prob: 0.01 },
});
const imageTextOK = () => ({ status: 'success', request: { id: 'req_image_text' }, text: { language: 'en', detected_categories: [], detections: {} } });
const videoOK = () => ({ status: 'success', request: { id: 'req_video' }, workflow: { id: 'wfl_videos' }, summary: imageOK().summary, data: { frames: [{ info: { position: 0 } }] } });
const audioOK = () => ({ status: 'success', request: { id: 'req_audio' }, data: { audio: { profanity: [] }, frames: [{ info: { position: 0 }, text: imageTextOK().text }] } });
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
  assert.deepEqual(SIGHTENGINE_SETUP.visualModels, ['nudity-2.1', 'gore-2.0', 'offensive-2.0', 'violence', 'self-harm']);
  assert.equal(SIGHTENGINE_SETUP.imageTextModel, 'text-content-2.0');
});

test('all text and every image must pass; requests use fixed HTTPS multipart without public URLs or local filenames', async t => {
  const f = await fixture(t), calls = [];
  const moderator = createSightengineModerator({ ...configuration, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return json(url.endsWith('/text/check.json') ? textOK() : url.endsWith('/check-workflow.json') ? imageOK() : imageTextOK());
  } });
  const result = await moderator.screen(submission([{ file: f.image, kind: 'image' }, { file: f.image, kind: 'image' }]));
  assert.equal(result.decision, 'pass'); assert.equal(calls.length, 5);
  assert.deepEqual(calls.map(call => call.url), ['https://api.sightengine.com/1.0/text/check.json', 'https://api.sightengine.com/1.0/check-workflow.json', 'https://api.sightengine.com/1.0/check.json', 'https://api.sightengine.com/1.0/check-workflow.json', 'https://api.sightengine.com/1.0/check.json']);
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
  for (const i of [2, 4]) {
    assert.equal(calls[i].options.body.get('models'), 'text-content-2.0');
    assert.equal(calls[i].options.body.get('text_categories'), 'sexual,insult,inappropriate,discriminatory,violence,self_harm,grooming,extremism');
    assert.equal(calls[i].options.body.get('opt_lang'), 'en,es');
    assert.equal(calls[i].options.body.get('media').name, 'image');
    assert.equal(await calls[i].options.body.get('media').text(), 'image-byte-fixture');
  }
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

test('accepted image workflows must still return valid core scores from every required visual model', async t => {
  const f = await fixture(t);
  const fields = {
    nudity: ['sexual_activity', 'sexual_display', 'erotica'],
    gore: ['prob'],
    offensive: ['nazi', 'supremacist', 'terrorist', 'confederate', 'asian_swastika', 'middle_finger'],
    violence: ['prob'],
    'self-harm': ['prob'],
  };
  const mutations = [];
  for (const [model, scores] of Object.entries(fields)) {
    mutations.push(body => { delete body[model]; });
    mutations.push(body => { body[model] = null; });
    mutations.push(body => { body[model] = []; });
    for (const field of scores) {
      mutations.push(body => { delete body[model][field]; });
      for (const invalid of ['0.01', null, false, -0.01, 1.01, Infinity, NaN]) mutations.push(body => { body[model][field] = invalid; });
    }
  }
  for (const mutate of mutations) {
    const body = imageOK(); mutate(body); let calls = 0;
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async () => { calls++; return json(body); } });
    assert.equal((await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file: f.image }] })).reason, 'image_coverage_missing');
    assert.equal(calls, 1, 'do not incur OCR charges after incomplete visual coverage');
  }
  const zeros = imageOK();
  for (const [model, scores] of Object.entries(fields)) for (const field of scores) zeros[model][field] = 0;
  const moderator = createSightengineModerator({ ...configuration, fetchImpl: async url => json(url.endsWith('/check-workflow.json') ? zeros : imageTextOK()) });
  assert.equal((await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file: f.image }] })).decision, 'pass');
});

test('one flagged image prevents publication even after earlier images pass', async t => {
  const f = await fixture(t); let calls = 0;
  const moderator = createSightengineModerator({ ...configuration, fetchImpl: async url => {
    calls++;
    const body = url.endsWith('/check-workflow.json') ? imageOK() : imageTextOK();
    if (calls === 3) body.summary.action = 'reject'; return json(body);
  } });
  assert.equal((await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file: f.image }, { kind: 'image', file: f.image }] })).reason, 'image_flagged');
  assert.equal(calls, 3);
});

test('embedded text cannot bypass moderation even when the visual workflow accepts', async t => {
  const f = await fixture(t);
  for (const category of SIGHTENGINE_SETUP.imageTextCategories) {
    let calls = 0;
    const ocr = imageTextOK();
    ocr.text.detected_categories = [category];
    ocr.text.detections = { [category]: { severity: 'low', details: [{ match: 'private extracted words', severity: 'low' }] } };
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async url => {
      calls++; return json(url.endsWith('/check-workflow.json') ? imageOK() : ocr);
    } });
    const decision = await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file: f.image }] });
    assert.equal(decision.reason, 'image_text_flagged');
    assert.equal(calls, 2);
    assert.equal(JSON.stringify(decision).includes('private extracted words'), false);
  }
});

test('OCR requires the current complete schema, configured language and no category matches or contradictory details', async t => {
  const f = await fixture(t);
  for (const mutate of [
    body => { delete body.text; },
    body => { body.text = null; },
    body => { body.text = []; },
    body => { body.text = { profanity: [], extremism: [] }; },
    body => { delete body.text.detected_categories; },
    body => { body.text.detected_categories = null; },
    body => { body.text.detected_categories = 'none'; },
    body => { body.text.detected_categories = [null]; },
    body => { body.text.detected_categories = ['']; },
    body => { delete body.text.detections; },
    body => { body.text.detections = []; },
    body => { body.text.detections = null; },
    body => { body.text.detections = { violence: { details: [] } }; },
    body => { body.text.detected_categories = ['violence']; },
    body => { delete body.text.language; },
    body => { body.text.language = null; },
    body => { body.text.language = 'fr'; },
    body => { body.text.language = ''; },
  ]) {
    const body = imageTextOK(); mutate(body);
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async url => json(url.endsWith('/check-workflow.json') ? imageOK() : body) });
    assert.equal((await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file: f.image }] })).decision, 'review');
  }
  const spanish = imageTextOK(); spanish.text.language = 'es';
  const moderator = createSightengineModerator({ ...configuration, fetchImpl: async url => json(url.endsWith('/check-workflow.json') ? imageOK() : spanish) });
  assert.equal((await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file: f.image }] })).decision, 'pass');
});

test('later-image OCR matches and OCR service failures prevent publication of the whole post', async t => {
  const f = await fixture(t);
  for (const lastResponse of [
    () => { const body = imageTextOK(); body.text.detected_categories = ['grooming']; return json(body); },
    () => json({ status: 'failure', error: 'private extracted words test-secret' }, 429),
    () => json({ status: 'success', request: { id: 'req_partial' } }),
  ]) {
    let calls = 0;
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async url => {
      calls++; return calls === 4 ? lastResponse() : json(url.endsWith('/check-workflow.json') ? imageOK() : imageTextOK());
    } });
    const decision = await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file: f.image }, { kind: 'image', file: f.image }] });
    assert.equal(decision.decision, 'review'); assert.equal(calls, 4);
    assert.equal(JSON.stringify(decision).includes('test-secret'), false);
  }
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

test('configured video screening checks text, clip visuals, audio, frame text and both poster checks', async t => {
  const f = await fixture(t), calls = [];
  const responses = [textOK(), videoOK(), audioOK(), imageOK(), imageTextOK()];
  const moderator = createSightengineModerator({ ...configuration, audioModerationEnabled: true, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return json(responses[calls.length - 1]);
  } });
  assert.equal((await moderator.screen(submission([f.videoItem]))).decision, 'pass');
  assert.equal(calls.length, 5);
  assert.equal(calls[1].url, 'https://api.sightengine.com/1.0/video/check-workflow-sync.json');
  assert.equal(calls[2].url, 'https://api.sightengine.com/1.0/video/check-sync.json');
  assert.equal(calls[2].options.body.get('models'), 'audio-profanity,text-content-2.0');
  assert.equal(calls[2].options.body.get('opt_lang'), 'en,es');
  assert.equal(calls[2].options.body.get('text_categories'), SIGHTENGINE_SETUP.imageTextCategories.join(','));
  assert.equal(await calls[1].options.body.get('media').text(), 'video-byte-fixture');
  assert.equal(await calls[2].options.body.get('media').text(), 'video-byte-fixture');
  assert.equal(await calls[3].options.body.get('media').text(), 'image-byte-fixture');
  assert.equal(calls[4].url, 'https://api.sightengine.com/1.0/check.json');
  assert.equal(await calls[4].options.body.get('media').text(), 'image-byte-fixture');
});

test('missing video frames, missing audio results, flagged speech and flagged posters cannot pass', async t => {
  const f = await fixture(t);
  for (const change of [
    responses => { responses[0].data.frames = []; },
    responses => { delete responses[1].data.audio; },
    responses => { responses[1].data.audio.profanity = null; },
    responses => { responses[1].data.audio.profanity = [{ match: 'private speech' }]; },
    responses => { delete responses[1].data.frames; },
    responses => { responses[1].data.frames = []; },
    responses => { responses[1].data.frames = [null]; },
    responses => { delete responses[1].data.frames[0].text; },
    responses => { responses[1].data.frames.push({ text: { ...imageTextOK().text, detected_categories: ['violence'] } }); },
    responses => { responses[2].summary.action = 'reject'; },
    responses => { responses[3].text.detected_categories = ['insult']; },
    responses => { delete responses[3].text.detections; },
  ]) {
    const responses = [videoOK(), audioOK(), imageOK(), imageTextOK()]; change(responses); let count = 0;
    const moderator = createSightengineModerator({ ...configuration, audioModerationEnabled: true, fetchImpl: async () => json(responses[count++]) });
    const decision = await moderator.screen({ type: 'post', text: '', media: [f.videoItem] });
    assert.equal(decision.decision, 'review');
    assert.equal(JSON.stringify(decision).includes('private speech'), false);
  }
});

test('video poster acceptance also requires every visual model even after video and audio pass', async t => {
  const f = await fixture(t);
  for (const model of ['nudity', 'gore', 'offensive', 'violence', 'self-harm']) {
    const poster = imageOK(); delete poster[model];
    const responses = [videoOK(), audioOK(), poster]; let calls = 0;
    const moderator = createSightengineModerator({ ...configuration, audioModerationEnabled: true, fetchImpl: async () => json(responses[calls++]) });
    assert.equal((await moderator.screen({ type: 'post', text: '', media: [f.videoItem] })).reason, 'image_coverage_missing');
    assert.equal(calls, 3);
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

test('OCR cancellation and timeout hold the submission without starting another image', async t => {
  const f = await fixture(t);
  for (const cancelFromCaller of [false, true]) {
    let calls = 0;
    const controller = new AbortController();
    const moderator = createSightengineModerator({ ...configuration, timeoutMs: 15, fetchImpl: async url => {
      calls++;
      if (url.endsWith('/check-workflow.json')) return json(imageOK());
      if (cancelFromCaller) controller.abort();
      return new Promise(() => {});
    } });
    const decision = await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file: f.image }, { kind: 'image', file: f.image }] }, { signal: controller.signal });
    assert.equal(decision.reason, 'screening_interrupted');
    assert.equal(calls, 2);
  }
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
