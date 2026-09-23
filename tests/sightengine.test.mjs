import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createSightengineModerator, SIGHTENGINE_SETUP } from '../server/sightengine.mjs';

const configuration = { apiUser: 'test-user', apiSecret: 'test-secret', imageWorkflow: 'wfl_images', videoWorkflow: 'wfl_videos', workflowsVerified: true, minRequestIntervalMs: 0 };
const classes = ['sexual', 'discriminatory', 'insulting', 'violent', 'toxic'];
const textOK = () => ({ status: 'success', request: { id: 'req_text' }, moderation_classes: { available: classes, ...Object.fromEntries(classes.map(name => [name, 0.01])) }, 'self-harm': { matches: [] } });
const selfHarmOK = () => ({ status: 'success', request: { id: 'req_self_harm' }, moderation_classes: { available: ['self-harm'], 'self-harm': 0.01 } });
const imageOK = () => ({
  status: 'success', request: { id: 'req_image' }, workflow: { id: 'wfl_images' }, summary: { action: 'accept', reject_prob: 0.01, reject_reason: [] },
  nudity: { sexual_activity: 0.01, sexual_display: 0.01, erotica: 0.01 },
  gore: { prob: 0.01 },
  offensive: { nazi: 0.01, supremacist: 0.01, terrorist: 0.01, confederate: 0.01, asian_swastika: 0.01, middle_finger: 0.01 },
  violence: { prob: 0.01 },
  'self-harm': { prob: 0.01 },
});
const imageTextOK = () => ({ status: 'success', request: { id: 'req_image_text' }, text: { content: '', language: 'en', detected_categories: [], detections: {} } });
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
  assert.equal(photos.readiness.textSelfHarmLanguage, 'en');
  assert.equal(photos.readiness.textSelfHarmMultilingualRules, true);
  assert.match(SIGHTENGINE_SETUP.textSelfHarmLimit, /English-only/);
  assert.deepEqual(SIGHTENGINE_SETUP.visualModels, ['nudity-2.1', 'gore-2.0', 'offensive-2.0', 'violence', 'self-harm']);
  assert.equal(SIGHTENGINE_SETUP.imageTextModel, 'ocr,text-content-2.0');
  assert.equal(SIGHTENGINE_SETUP.imageTextLanguage, 'en');
  assert.equal(photos.readiness.imageTextScript, 'Latin');
});

test('all text and every image must pass; requests use fixed HTTPS multipart without public URLs or local filenames', async t => {
  const f = await fixture(t), calls = [];
  const moderator = createSightengineModerator({ ...configuration, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return json(url.endsWith('/text/check.json') ? options.body.get('models') === 'general' ? textOK() : selfHarmOK() : url.endsWith('/check-workflow.json') ? imageOK() : imageTextOK());
  } });
  const result = await moderator.screen(submission([{ file: f.image, kind: 'image' }, { file: f.image, kind: 'image' }]));
  assert.equal(result.decision, 'pass'); assert.equal(calls.length, 6);
  assert.deepEqual(calls.map(call => call.url), ['https://api.sightengine.com/1.0/text/check.json', 'https://api.sightengine.com/1.0/text/check.json', 'https://api.sightengine.com/1.0/check-workflow.json', 'https://api.sightengine.com/1.0/check.json', 'https://api.sightengine.com/1.0/check-workflow.json', 'https://api.sightengine.com/1.0/check.json']);
  for (const { options } of calls) {
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('api_user'), 'test-user'); assert.equal(options.body.get('api_secret'), 'test-secret');
    assert.equal(options.body.has('url'), false); assert.equal(options.body.has('stream_url'), false);
  }
  assert.equal(calls[0].options.body.get('models'), 'general');
  assert.equal(calls[0].options.body.get('mode'), 'ml,rules');
  assert.equal(calls[0].options.body.get('categories'), 'self-harm');
  assert.equal(calls[0].options.body.get('lang'), 'en,es');
  assert.equal(calls[1].options.body.get('models'), 'self-harm');
  assert.equal(calls[1].options.body.get('mode'), 'ml');
  assert.equal(calls[1].options.body.get('lang'), 'en');
  assert.equal(calls[1].options.body.has('categories'), false);
  assert.equal(calls[2].options.body.get('workflow'), 'wfl_images');
  assert.equal(calls[2].options.body.get('media').name, 'image');
  assert.equal(await calls[2].options.body.get('media').text(), 'image-byte-fixture');
  for (const i of [3, 5]) {
    assert.equal(calls[i].options.body.get('models'), 'ocr,text-content-2.0');
    assert.equal(calls[i].options.body.get('text_categories'), 'sexual,insult,inappropriate,discriminatory,violence,self_harm,grooming,extremism');
    assert.equal(calls[i].options.body.get('opt_lang'), 'en');
    assert.equal(calls[i].options.body.get('media').name, 'image');
    assert.equal(await calls[i].options.body.get('media').text(), 'image-byte-fixture');
  }
});

test('general text scores must cover every model class and be finite probabilities below the review threshold', async () => {
  for (const mutate of [
    body => { body.moderation_classes.violent = 0.5; },
    body => { delete body.moderation_classes.discriminatory; },
    body => { body.moderation_classes.available = ['toxic']; },
    body => { body.moderation_classes.sexual = '0.01'; },
    body => { body.moderation_classes.insulting = -1; },
    body => { body.moderation_classes.toxic = null; },
  ]) {
    const body = textOK(); mutate(body);
    let calls = 0;
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async () => { calls++; return json(body); } });
    assert.equal((await moderator.screen(submission([]))).decision, 'review');
    assert.equal(calls, 1);
  }
});

test('multilingual self-harm rules must explicitly succeed before the English classifier can run', async () => {
  for (const [change, expected] of [
    [body => { delete body['self-harm']; }, 'text_coverage_missing'],
    [body => { body['self-harm'] = null; }, 'text_coverage_missing'],
    [body => { body['self-harm'].matches = null; }, 'text_coverage_missing'],
    [body => { body['self-harm'].matches = {}; }, 'text_coverage_missing'],
    [body => { delete body['self-harm'].matches; }, 'text_coverage_missing'],
    [body => { body['self-harm'].matches = [{ match: 'private submitted text' }]; }, 'text_flagged'],
  ]) {
    const body = textOK(); change(body); let calls = 0;
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async () => { calls++; return json(body); } });
    const decision = await moderator.screen(submission([]));
    assert.equal(decision.reason, expected); assert.equal(calls, 1);
    assert.equal(JSON.stringify(decision).includes('private submitted text'), false);
  }
});

test('English self-harm ML must also return its own valid passing score after multilingual checks pass', async () => {
  for (const mutate of [
    body => { body.moderation_classes['self-harm'] = 0.5; },
    body => { body.moderation_classes['self-harm'] = '0.01'; },
    body => { body.moderation_classes['self-harm'] = null; },
    body => { body.moderation_classes['self-harm'] = -1; },
    body => { delete body.moderation_classes['self-harm']; },
    body => { body.moderation_classes.available = []; },
    body => { delete body.moderation_classes; },
  ]) {
    const selfHarm = selfHarmOK(); mutate(selfHarm); let calls = 0;
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async () => json(++calls === 1 ? textOK() : selfHarm) });
    assert.equal((await moderator.screen(submission([]))).decision, 'review');
    assert.equal(calls, 2);
  }
  let calls = 0;
  const failingSecondRequest = createSightengineModerator({ ...configuration, fetchImpl: async () => ++calls === 1 ? json(textOK()) : json({ error: 'provider denied' }, 400) });
  assert.equal((await failingSecondRequest.screen(submission([]))).decision, 'review');
  assert.equal(calls, 2);
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

test('OCR requires complete raw content, valid result containers and known language even when rules report no matches', async t => {
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
    body => { body.text.detections = null; },
    body => { body.text.detections = { violence: { details: [] } }; },
    body => { body.text.detected_categories = ['violence']; },
    body => { delete body.text.language; },
    body => { body.text.language = null; body.text.content = 'unknown language'; },
    body => { body.text.language = null; body.text.content = ' '; },
    body => { body.text.language = 'fr'; },
    body => { body.text.language = 'es'; },
    body => { body.text.language = ''; },
    body => { delete body.text.content; },
    body => { body.text.content = null; },
    body => { body.text.content = []; },
    body => { body.text.content = 'x'.repeat(12_001); },
  ]) {
    const body = imageTextOK(); mutate(body);
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async url => json(url.endsWith('/check-workflow.json') ? imageOK() : body) });
    assert.equal((await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file: f.image }] })).decision, 'review');
  }
});

test('explicit no-text OCR accepts documented objects and calibrated empty arrays with null language without extra text requests', async t => {
  const f = await fixture(t);
  for (const [language, detections] of [['en', {}], ['en', []], [null, {}], [null, []]]) {
    let calls = 0;
    const emptyOCR = imageTextOK(); emptyOCR.text.language = language; emptyOCR.text.detections = detections;
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async url => { calls++; return json(url.endsWith('/check-workflow.json') ? imageOK() : emptyOCR); } });
    assert.equal((await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file: f.image }] })).decision, 'pass');
    assert.equal(calls, 2);
  }
});

test('recognized Latin image text must pass multilingual general/rules and English self-harm checks even if OCR categories are empty', async t => {
  const f = await fixture(t), calls = [];
  const ocr = imageTextOK(); ocr.text.content = 'Hice este disfraz de espuma con mis amigos.'; ocr.text.detections = [];
  const moderator = createSightengineModerator({ ...configuration, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return json(url.endsWith('/check-workflow.json') ? imageOK() : url.endsWith('/text/check.json') ? options.body.get('models') === 'general' ? textOK() : selfHarmOK() : ocr);
  } });
  assert.equal((await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file: f.image }] })).decision, 'pass');
  assert.equal(calls.length, 4);
  assert.equal(calls[1].options.body.get('models'), 'ocr,text-content-2.0');
  assert.equal(calls[1].options.body.get('opt_lang'), 'en');
  assert.equal(calls[2].options.body.get('text'), ocr.text.content);
  assert.equal(calls[2].options.body.get('lang'), 'en,es');
  assert.equal(calls[2].options.body.get('mode'), 'ml,rules');
  assert.equal(calls[3].options.body.get('text'), ocr.text.content);
  assert.equal(calls[3].options.body.get('lang'), 'en');
});

test('contextual checks catch OCR rule misses and never expose extracted text in result codes', async t => {
  const f = await fixture(t);
  for (const [mutate, expected, expectedCalls] of [
    [(general, _selfHarm) => { general.moderation_classes.violent = 0.86; }, 'image_text_flagged', 3],
    [(general, _selfHarm) => { general['self-harm'].matches = [{ match: 'private extracted phrase' }]; }, 'image_text_flagged', 3],
    [(_general, selfHarm) => { selfHarm.moderation_classes['self-harm'] = 0.8; }, 'image_text_flagged', 4],
    [(general, _selfHarm) => { delete general['self-harm']; }, 'image_text_coverage_missing', 3],
    [(general, _selfHarm) => { delete general.moderation_classes.sexual; }, 'image_text_coverage_missing', 3],
    [(_general, selfHarm) => { delete selfHarm.moderation_classes['self-harm']; }, 'image_text_coverage_missing', 4],
  ]) {
    const general = textOK(), selfHarm = selfHarmOK(), ocr = imageTextOK(); let calls = 0;
    ocr.text.content = 'private extracted phrase'; ocr.text.detections = [];
    mutate(general, selfHarm);
    const responses = [imageOK(), ocr, general, selfHarm];
    const moderator = createSightengineModerator({ ...configuration, fetchImpl: async () => json(responses[calls++]) });
    const decision = await moderator.screen({ type: 'post', text: '', media: [{ kind: 'image', file: f.image }] });
    assert.equal(decision.reason, expected); assert.equal(calls, expectedCalls);
    assert.equal(JSON.stringify(decision).includes(ocr.text.content), false);
  }
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
  const responses = [textOK(), selfHarmOK(), videoOK(), audioOK(), imageOK(), imageTextOK()];
  const moderator = createSightengineModerator({ ...configuration, audioModerationEnabled: true, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return json(responses[calls.length - 1]);
  } });
  assert.equal((await moderator.screen(submission([f.videoItem]))).decision, 'pass');
  assert.equal(calls.length, 6);
  assert.equal(calls[2].url, 'https://api.sightengine.com/1.0/video/check-workflow-sync.json');
  assert.equal(calls[3].url, 'https://api.sightengine.com/1.0/video/check-sync.json');
  assert.equal(calls[3].options.body.get('models'), 'audio-profanity,ocr,text-content-2.0');
  assert.equal(calls[3].options.body.get('opt_lang'), 'en');
  assert.equal(calls[3].options.body.get('text_categories'), SIGHTENGINE_SETUP.imageTextCategories.join(','));
  assert.equal(await calls[2].options.body.get('media').text(), 'video-byte-fixture');
  assert.equal(await calls[3].options.body.get('media').text(), 'video-byte-fixture');
  assert.equal(await calls[4].options.body.get('media').text(), 'image-byte-fixture');
  assert.equal(calls[5].url, 'https://api.sightengine.com/1.0/check.json');
  assert.equal(await calls[5].options.body.get('media').text(), 'image-byte-fixture');
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
  const moderator = createSightengineModerator({ ...configuration, fetchImpl: async (_url, options) => { await gate; return json(options.body.get('models') === 'general' ? textOK() : selfHarmOK()); } });
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
