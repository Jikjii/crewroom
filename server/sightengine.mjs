import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

const ENDPOINTS = Object.freeze({
  text: 'https://api.sightengine.com/1.0/text/check.json',
  image: 'https://api.sightengine.com/1.0/check-workflow.json',
  imageText: 'https://api.sightengine.com/1.0/check.json',
  video: 'https://api.sightengine.com/1.0/video/check-workflow-sync.json',
  audio: 'https://api.sightengine.com/1.0/video/check-sync.json',
});
const GENERAL_TEXT_CLASSES = ['sexual', 'discriminatory', 'insulting', 'violent', 'toxic'];
const OCR_CATEGORIES = Object.freeze(['sexual', 'insult', 'inappropriate', 'discriminatory', 'violence', 'self_harm', 'grooming', 'extremism']);
const IMAGE_CORE_SCORES = Object.freeze({
  nudity: Object.freeze(['sexual_activity', 'sexual_display', 'erotica']),
  gore: Object.freeze(['prob']),
  offensive: Object.freeze(['nazi', 'supremacist', 'terrorist', 'confederate', 'asian_swastika', 'middle_finger']),
  violence: Object.freeze(['prob']),
  'self-harm': Object.freeze(['prob']),
});
const SUPPORTED_TEXT_LANGUAGES = ['en', 'fr', 'it', 'pt', 'es', 'ru', 'tr'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 12_000;

// Preparation only. The operator must create, test, and explicitly verify both
// workflows before enabling them. A workflow ID alone proves no policy coverage.
// Rules should route uncertain cosplay/prop/costume matches to human review.
// https://sightengine.com/docs/image-moderation-workflows
// https://sightengine.com/docs/video-moderation-workflows
// https://sightengine.com/docs/text-moderation-ml-models
// https://sightengine.com/docs/audio-profanity-model
// https://sightengine.com/docs/ocr-text-moderation-in-images-2.0
export const SIGHTENGINE_SETUP = Object.freeze({
  visualModels: Object.freeze(['nudity-2.1', 'gore-2.0', 'offensive-2.0', 'violence', 'self-harm']),
  visualPolicy: 'Review explicit nudity/sexual activity, graphic injury, hate symbols, violence/threats and self-harm. Calibrate costumes, skin exposure, stage blood and props with beta examples before enabling. Every required model must run; no early ACCEPT branches. Disable legacy workflow Text Analysis: the adapter separately requires OCR 2.0.',
  imageTextModel: 'ocr,text-content-2.0',
  imageTextLanguage: 'en',
  imageTextCategories: OCR_CATEGORIES,
  imageTextPolicy: 'Extract Latin-script text with OCR and apply OCR 2.0 rules to each image/poster and sampled video frames when enabled. Any category match requires review. Recognized text must additionally pass general classification and self-harm rules in configured languages, plus English-only self-harm ML. Only complete, explicitly empty OCR results can skip contextual text checks. This is not comprehensive coverage of non-Latin scripts.',
  textModels: 'general,self-harm',
  textGeneralModel: 'general',
  textRuleCategories: 'self-harm',
  textSelfHarmModel: 'self-harm',
  textSelfHarmLanguage: 'en',
  textSelfHarmLimit: 'General classification and self-harm rules use configured languages. The additional self-harm ML classifier is English-only; live API rejects Spanish for this classifier. Rules do not provide equivalent contextual or comprehensive multilingual self-harm classification.',
  textReviewThreshold: 0.5,
  audioModel: 'audio-profanity',
  audioLanguage: 'en',
  audioLimit: 'English profanity, slurs, insults and obscenity only. The response does not establish spoken language. This is not comprehensive or multilingual speech classification; configure only after accepting this limitation and keeping report/human-review fallbacks.',
  videoLimit: 'Synchronous API: positive duration strictly below 60 seconds; sampled visuals and embedded text, the documented English audio model, and both poster checks must all pass. Longer/unknown duration requires human review.',
  pricingURL: 'https://sightengine.com/pricing',
});

function result(decision, code) {
  return { decision, reason: code, codes: [code], provider: 'sightengine' };
}
class ScreeningFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function fail(code) { throw new ScreeningFailure(code); }
function probability(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }
function identifier(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

async function localMedia(file, kind, signal) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) fail('invalid_media');
  signal.throwIfAborted();
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    const maxBytes = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (!before.isFile() || before.size <= 0 || before.size > maxBytes) fail('invalid_media');
    // Read the already validated, immutable server asset through its open handle.
    // Avoid public media URLs and never send the filesystem path as the filename.
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(bytes, offset, Math.min(1024 * 1024, bytes.length - offset), offset);
      if (!bytesRead) fail('media_changed');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail('media_changed');
    signal.throwIfAborted();
    return new Blob([bytes], { type: kind === 'video' ? 'video/mp4' : 'application/octet-stream' });
  } catch (error) {
    if (signal.aborted || error instanceof ScreeningFailure) throw error;
    fail('media_unavailable');
  } finally { await handle?.close(); }
}

async function readResponse(response, signal) {
  if (!response?.ok || response.status !== 200) fail('provider_unavailable');
  if (!response.headers?.get('content-type')?.toLowerCase().includes('application/json')) fail('invalid_response');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) fail('invalid_response');
  if (!response.body?.getReader) fail('invalid_response');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) fail('invalid_response');
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
    if (body?.status !== 'success' || typeof body.request?.id !== 'string' || !body.request.id) fail('invalid_response');
    return body;
  } catch (error) {
    if (signal.aborted || error instanceof ScreeningFailure) throw error;
    fail('invalid_response');
  } finally {
    signal.removeEventListener('abort', cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function requireWorkflowAccept(body, workflow, kind) {
  if (body.workflow?.id !== workflow) fail('workflow_mismatch');
  if (body.summary?.action === 'reject') fail(`${kind}_flagged`);
  if (body.summary?.action !== 'accept') fail('invalid_response');
  if (body.summary.reject_reason !== undefined && (!Array.isArray(body.summary.reject_reason) || body.summary.reject_reason.length)) fail('inconsistent_response');
  if (body.summary.reject_prob !== undefined && !probability(body.summary.reject_prob)) fail('invalid_response');
  if (body.summary.reject_prob >= 0.5) fail(`${kind}_flagged`);
  // A saved workflow can be edited after operator verification. Its ACCEPT
  // summary alone does not prove every required model still ran. Validate the
  // documented core outputs for photos/posters; policy thresholds remain in
  // the verified workflow so costume and prop exceptions are not lost here.
  if (kind === 'image' && Object.entries(IMAGE_CORE_SCORES).some(([model, fields]) => !object(body[model]) || fields.some(field => !probability(body[model][field])))) fail('image_coverage_missing');
  if (kind === 'video' && (!Array.isArray(body.data?.frames) || body.data.frames.length === 0)) fail('video_coverage_missing');
}

function requireImageTextAccept(text) {
  // OCR 2.0 reports triggered categories and their match details, not a safe
  // boolean or a probability. Legacy text.profanity results are not coverage.
  // Deliberately do not retain, log or return provider-extracted private text.
  if (!object(text) || !Array.isArray(text.detected_categories) || !text.detected_categories.every(value => typeof value === 'string' && value.length > 0) || (!object(text.detections) && !Array.isArray(text.detections))) fail('image_text_coverage_missing');
  if (text.detected_categories.length || Object.keys(text.detections).length) fail('image_text_flagged');
  if (typeof text.content !== 'string' || text.content.length > MAX_TEXT_CHARACTERS) fail('image_text_coverage_missing');
  // Live clean fixtures serialize empty detections as [] and no-text language as
  // null. Accept only explicit empty content with that null sentinel, never an
  // omitted language/content field. Raw OCR supports Latin script via en; its
  // recognized text receives the configured multilingual checks below.
  if (text.language !== SIGHTENGINE_SETUP.imageTextLanguage && !(text.language === null && text.content === '')) fail('image_text_language_unverified');
  return text.content;
}

function requireTextAccept(body, requiredClasses, flaggedCode, missingCode) {
  const scores = body.moderation_classes;
  if (!object(scores) || !Array.isArray(scores.available) || requiredClasses.some(key => !scores.available.includes(key) || !probability(scores[key]))) fail(missingCode);
  if (requiredClasses.some(key => scores[key] >= SIGHTENGINE_SETUP.textReviewThreshold)) fail(flaggedCode);
}

/**
 * No I/O happens during construction. `ready` means photo/text configuration is
 * complete, not that credentials or policy have been verified by a live request.
 * The caller owns publishing state, immutable version-bound jobs, retries, and
 * privacy eligibility. Never invoke screen() for a private draft.
 *
 * Audio moderation has no detected-language field in its documented response.
 * Enabling it explicitly accepts English-only profanity coverage, not a claim
 * that every language or every form of harmful speech has been classified.
 */
export function createSightengineModerator({
  apiUser = '', apiSecret = '', imageWorkflow = '', videoWorkflow = '',
  workflowsVerified = false, audioModerationEnabled = false,
  textLanguages = 'en,es', fetchImpl = fetch, timeoutMs = 45_000,
  totalTimeoutMs = 120_000, minRequestIntervalMs = 1100,
} = {}) {
  const credentials = identifier(apiUser) && typeof apiSecret === 'string' && apiSecret.length > 0 && apiSecret.length <= 256 && !/[\r\n]/.test(apiSecret);
  const languages = typeof textLanguages === 'string' ? [...new Set(textLanguages.split(',').map(value => value.trim()))] : [];
  const languageConfig = languages.length > 0 && languages.every(value => SUPPORTED_TEXT_LANGUAGES.includes(value));
  const verified = workflowsVerified === true;
  const ready = Boolean(credentials && identifier(imageWorkflow) && verified && languageConfig);
  const videoReady = Boolean(ready && identifier(videoWorkflow) && audioModerationEnabled === true);
  const readiness = Object.freeze({
    ready, videoReady, credentialsConfigured: Boolean(credentials), workflowsVerified: verified,
    text: Boolean(credentials && verified && languageConfig), images: ready,
    textSelfHarmLanguage: 'en', textSelfHarmMultilingualRules: true,
    imageTextScript: 'Latin', imageTextContextualChecks: true,
    videoVisuals: Boolean(ready && identifier(videoWorkflow)),
    videoAudio: Boolean(ready && identifier(videoWorkflow) && audioModerationEnabled === true),
    audioLanguage: 'en', audioEnglishOnly: true,
  });
  const requestTimeout = Number.isFinite(timeoutMs) ? Math.min(60_000, Math.max(10, timeoutMs)) : 45_000;
  const totalTimeout = Number.isFinite(totalTimeoutMs) ? Math.min(180_000, Math.max(10, totalTimeoutMs)) : 120_000;
  // Starter permits one request per second. The worker owns cross-process and
  // aggregate billing limits; this spaces sequential requests within an instance.
  const requestInterval = Number.isFinite(minRequestIntervalMs) ? Math.min(10_000, Math.max(0, minRequestIntervalMs)) : 1100;
  const imageTextFields = Object.freeze({ models: SIGHTENGINE_SETUP.imageTextModel, text_categories: OCR_CATEGORIES.join(','), opt_lang: SIGHTENGINE_SETUP.imageTextLanguage });
  let lastRequestAt = 0;
  let busy = false;

  async function request(endpoint, fields, media, overallSignal) {
    overallSignal.throwIfAborted();
    const delay = Math.max(0, lastRequestAt + requestInterval - Date.now());
    if (delay) await new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(waitTimer); reject(new ScreeningFailure('screening_interrupted')); };
      const waitTimer = setTimeout(() => { overallSignal.removeEventListener('abort', stop); resolve(); }, delay);
      overallSignal.addEventListener('abort', stop, { once: true });
      if (overallSignal.aborted) stop();
    });
    overallSignal.throwIfAborted();
    lastRequestAt = Date.now();
    const controller = new AbortController();
    const signal = AbortSignal.any([overallSignal, controller.signal]);
    const timer = setTimeout(() => controller.abort(new Error('moderation_timeout')), requestTimeout);
    let abortListener;
    const aborted = new Promise((_, reject) => {
      abortListener = () => reject(new ScreeningFailure('screening_interrupted'));
      signal.addEventListener('abort', abortListener, { once: true });
      if (signal.aborted) abortListener();
    });
    try {
      const body = new FormData();
      body.set('api_user', apiUser);
      body.set('api_secret', apiSecret);
      for (const [name, value] of Object.entries(fields)) body.set(name, String(value));
      if (media) body.set('media', media.blob, media.kind === 'video' ? 'video.mp4' : 'image');
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(endpoint, { method: 'POST', body, signal, redirect: 'error', headers: { Accept: 'application/json' } });
          return readResponse(response, signal);
        })(),
        aborted,
      ]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abortListener);
    }
  }

  async function screenText(text, signal, flaggedCode = 'text_flagged', missingCode = 'text_coverage_missing') {
    // The live provider rejects Spanish (including en,es) for self-harm ML,
    // despite the combined language list in its docs. Keep multilingual general
    // classification + explicit self-harm rules, then require English-only ML.
    const body = await request(ENDPOINTS.text, { text, mode: 'ml,rules', models: SIGHTENGINE_SETUP.textGeneralModel, categories: SIGHTENGINE_SETUP.textRuleCategories, lang: languages.join(',') }, null, signal);
    requireTextAccept(body, GENERAL_TEXT_CLASSES, flaggedCode, missingCode);
    if (!Array.isArray(body['self-harm']?.matches)) fail(missingCode);
    if (body['self-harm'].matches.length) fail(flaggedCode);
    const selfHarm = await request(ENDPOINTS.text, { text, mode: 'ml', models: SIGHTENGINE_SETUP.textSelfHarmModel, lang: SIGHTENGINE_SETUP.textSelfHarmLanguage }, null, signal);
    requireTextAccept(selfHarm, ['self-harm'], flaggedCode, missingCode);
  }

  async function screenImageText(text, signal) {
    const content = requireImageTextAccept(text);
    if (content.trim()) await screenText(content, signal, 'image_text_flagged', 'image_text_coverage_missing');
  }

  async function screen(input = {}, { signal: callerSignal } = {}) {
    if (!ready) return result('review', 'provider_not_configured');
    if (busy) return result('review', 'screening_busy');
    if (!input || typeof input !== 'object' || !['post', 'profile', 'comment'].includes(input.type) || typeof input.text !== 'string' || input.text.length > MAX_TEXT_CHARACTERS || !Array.isArray(input.media) || input.media.length > 4) return result('review', 'invalid_submission');
    const media = input.media;
    if (media.some(item => !item || !['image', 'video'].includes(item.kind))) return result('review', 'invalid_media');
    if (media.some(item => item.kind === 'video') && (media.length !== 1 || input.type !== 'post')) return result('review', 'invalid_media');
    // Do not incur text/image API charges for videos that cannot get full coverage.
    for (const item of media.filter(item => item.kind === 'video')) {
      if (!readiness.videoAudio) return result('review', 'video_screening_not_configured');
      if (!Number.isFinite(item.duration) || item.duration <= 0 || item.duration >= 60) return result('review', 'video_duration_requires_review');
      if (typeof item.posterFile !== 'string') return result('review', 'video_poster_missing');
    }
    if (!input.text.trim() && !media.length) return result('review', 'empty_submission');
    busy = true;
    const controller = new AbortController();
    const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(new Error('moderation_timeout')), totalTimeout);
    try {
      signal.throwIfAborted();
      if (input.text.trim()) await screenText(input.text, signal);
      for (const item of media) {
        const blob = await localMedia(item.file, item.kind, signal);
        if (item.kind === 'image') {
          const body = await request(ENDPOINTS.image, { workflow: imageWorkflow }, { blob, kind: 'image' }, signal);
          requireWorkflowAccept(body, imageWorkflow, 'image');
          const imageText = await request(ENDPOINTS.imageText, imageTextFields, { blob, kind: 'image' }, signal);
          await screenImageText(imageText.text, signal);
        } else {
          const body = await request(ENDPOINTS.video, { workflow: videoWorkflow }, { blob, kind: 'video' }, signal);
          requireWorkflowAccept(body, videoWorkflow, 'video');
          // The documented sync video API can combine audio and visual models.
          // Requiring OCR here avoids relying on legacy workflow text rules.
          const audio = await request(ENDPOINTS.audio, { ...imageTextFields, models: `${SIGHTENGINE_SETUP.audioModel},${SIGHTENGINE_SETUP.imageTextModel}` }, { blob, kind: 'video' }, signal);
          if (!Array.isArray(audio.data?.audio?.profanity)) fail('audio_coverage_missing');
          if (audio.data.audio.profanity.length) fail('audio_flagged');
          if (!Array.isArray(audio.data?.frames) || !audio.data.frames.length) fail('image_text_coverage_missing');
          for (const frame of audio.data.frames) await screenImageText(frame?.text, signal);
          const poster = await localMedia(item.posterFile, 'image', signal);
          const checkedPoster = await request(ENDPOINTS.image, { workflow: imageWorkflow }, { blob: poster, kind: 'image' }, signal);
          requireWorkflowAccept(checkedPoster, imageWorkflow, 'image');
          const posterText = await request(ENDPOINTS.imageText, imageTextFields, { blob: poster, kind: 'image' }, signal);
          await screenImageText(posterText.text, signal);
        }
      }
      signal.throwIfAborted();
      return result('pass', 'automated_checks_passed');
    } catch (error) {
      // Provider messages can contain submitted text, URLs and credentials. Only
      // fixed local codes cross the adapter boundary; no provider payload logging.
      return result('review', signal.aborted ? 'screening_interrupted' : error instanceof ScreeningFailure ? error.code : 'provider_unavailable');
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  }
  return Object.freeze({ provider: 'sightengine', ready, videoReady, readiness, screen });
}
