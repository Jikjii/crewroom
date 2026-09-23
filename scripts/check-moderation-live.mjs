import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createSightengineModerator } from '../server/sightengine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_REQUESTS = 10;
const DEMOS = Object.freeze([
  { name: 'armor-workbench', hash: '231356cce1efea102462bd4721b2ac8bcd1838e5e57c55a162f9f7a2d0feb371' },
  { name: 'forest-maker', hash: '34c12a7686422dfaa6a5cfce0a190799364dfc3ae16b5ec3a13bcfb76053da27' },
  { name: 'sky-portrait', hash: 'f524f9c33bddd08b23f8d2ae39d04d35dd939c24cf830ae273a4b77efe7cb095' },
]);
const SAFE_CODES = new Set([
  'automated_checks_passed', 'text_flagged', 'image_flagged', 'image_text_flagged',
  'image_coverage_missing', 'image_text_coverage_missing', 'image_text_language_unverified', 'text_coverage_missing',
  'video_screening_not_configured', 'provider_not_configured', 'provider_unavailable',
  'invalid_response', 'inconsistent_response', 'workflow_mismatch', 'screening_interrupted',
  'screening_busy', 'invalid_media', 'media_unavailable', 'media_changed',
]);
const THREAT_FIXTURE = 'I will kill you.';
const HARMLESS_FIXTURE = 'I made this costume from foam and fabric. I enjoyed building it with my friends.';

// Path-based lettering keeps this OCR fixture readable even in the slim Render
// image without installed fonts. It is synthetic test data, never a user upload.
const GLYPHS = Object.freeze({
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
});

function threatSVG() {
  const lines = ['I WILL', 'KILL YOU'];
  const cell = 14;
  const rectangles = lines.flatMap((line, lineIndex) => [...line].flatMap((letter, index) => {
    const glyph = GLYPHS[letter];
    if (!glyph) return [];
    const left = (1280 - (line.length * 6 - 1) * cell) / 2 + index * 6 * cell;
    return glyph.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === '1'
      ? [`<rect x="${left + x * cell}" y="${225 + lineIndex * 175 + y * cell}" width="${cell}" height="${cell}"/>`] : []));
  }));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="white"/><g fill="black">${rectangles.join('')}</g></svg>`);
}

async function verifyBundledDemos() {
  for (const demo of DEMOS) {
    const file = path.join(ROOT, 'assets', 'demo', `${demo.name}.png`);
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size <= 0 || stat.size > 10 * 1024 * 1024) throw new Error('fixture_invalid');
      const hash = createHash('sha256').update(await handle.readFile()).digest('hex');
      if (hash !== demo.hash) throw new Error('fixture_changed');
    } finally { await handle.close(); }
  }
}

/**
 * A small, deliberately opt-in LIVE provider check. Only fixed public AI demo
 * images and synthetic text are accepted. Never reads the production database,
 * changes environment flags, approves content, or accepts arbitrary media paths.
 * The injected fetch/write/env parameters exist for offline tests; the CLI uses
 * server environment credentials and the normal HTTPS adapter only.
 */
export async function runLiveModerationChecks({ argv = process.argv.slice(2), env = process.env, fetchImpl = fetch, write = line => console.log(line) } = {}) {
  const emit = value => write(JSON.stringify(value));
  const stop = code => { emit({ event: 'preflight', success: false, code, requests: 0 }); return { success: false, exitCode: 1, requests: 0 }; };
  if (argv.length !== 1 || argv[0] !== '--public-demo-fixtures') return stop('explicit_public_fixture_opt_in_required');
  if (env.MODERATION_MODE !== 'manual') return stop('manual_mode_required');
  if (env.SIGHTENGINE_VIDEO_WORKFLOW?.trim() || ![undefined, '', 'false'].includes(env.SIGHTENGINE_AUDIO_MODERATION_ENABLED)) return stop('starter_photo_text_configuration_required');

  let requests = 0;
  const moderator = createSightengineModerator({
    apiUser: env.SIGHTENGINE_API_USER,
    apiSecret: env.SIGHTENGINE_API_SECRET,
    imageWorkflow: env.SIGHTENGINE_IMAGE_WORKFLOW,
    // Test-only override: the live checks help verify the prepared workflow.
    // This does not set SIGHTENGINE_WORKFLOWS_VERIFIED or activate production.
    workflowsVerified: true,
    videoWorkflow: '',
    audioModerationEnabled: false,
    fetchImpl: async (...args) => {
      if (requests >= MAX_REQUESTS) throw new Error('fixture_request_limit');
      requests++;
      return fetchImpl(...args);
    },
  });
  if (!moderator.ready) return stop('photo_text_credentials_or_workflow_missing');
  try { await verifyBundledDemos(); }
  catch { return stop('bundled_public_demo_integrity_failed'); }

  let temporary;
  const outcomes = [];
  try {
    temporary = await mkdtemp(path.join(tmpdir(), 'crewroom-public-moderation-fixtures-'));
    const ocrFile = path.join(temporary, 'synthetic-ocr-fixture.png');
    await sharp(threatSVG()).png().toFile(ocrFile);
    emit({
      event: 'start', fixtures: 7, maxRequests: MAX_REQUESTS,
      content: 'fixed_public_ai_demo_images_and_synthetic_text_only',
      workflowVerification: 'constructor_override_for_this_test_only', productionFlagsChanged: false,
      billing: 'live_provider_requests_consume_operations_per_configured_models',
      limitation: 'small_acceptance_fixture_set_not_comprehensive_safety_or_accuracy_validation',
    });
    const cases = [
      { id: 'harmless-caption', text: HARMLESS_FIXTURE, media: [], expected: 'pass', code: 'automated_checks_passed' },
      ...DEMOS.map(demo => ({ id: `public-demo-${demo.name}`, text: '', media: [{ kind: 'image', file: path.join(ROOT, 'assets', 'demo', `${demo.name}.png`) }], expected: 'pass', code: 'automated_checks_passed' })),
      { id: 'synthetic-threatening-caption', text: THREAT_FIXTURE, media: [], expected: 'review', code: 'text_flagged' },
      { id: 'synthetic-threatening-image-text', text: '', media: [{ kind: 'image', file: ocrFile }], expected: 'review', code: 'image_text_flagged' },
      // No clip exists or is needed: Starter must hold before reading media or
      // making even a caption request. Any attempted transfer fails this case.
      { id: 'starter-video-human-review', text: HARMLESS_FIXTURE, media: [{ kind: 'video', file: path.join(temporary, 'must-not-be-read.mp4'), duration: 10 }], expected: 'review', code: 'video_screening_not_configured', noRequests: true },
    ];
    for (const fixture of cases) {
      const before = requests;
      const result = await moderator.screen({ type: 'post', text: fixture.text, media: fixture.media });
      const actual = ['pass', 'review'].includes(result?.decision) ? result.decision : 'invalid';
      const code = SAFE_CODES.has(result?.reason) ? result.reason : 'unrecognized_local_code';
      const used = requests - before;
      const success = actual === fixture.expected && code === fixture.code && (!fixture.noRequests || used === 0);
      const outcome = { event: 'case', id: fixture.id, expected: fixture.expected, actual, code, requests: used, success };
      outcomes.push(outcome);
      emit(outcome);
    }
    const passed = outcomes.filter(outcome => outcome.success).length;
    const summary = { event: 'summary', success: passed === cases.length, total: cases.length, passed, failed: cases.length - passed, requests, productionFlagsChanged: false };
    emit(summary);
    return { ...summary, exitCode: summary.success ? 0 : 1 };
  } catch {
    // Neither provider messages nor unexpected exception details are safe to log.
    emit({ event: 'summary', success: false, code: 'live_fixture_check_failed', completed: outcomes.length, requests, productionFlagsChanged: false });
    return { success: false, exitCode: 1, requests };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = (await runLiveModerationChecks()).exitCode; }
  catch { console.error(JSON.stringify({ event: 'summary', success: false, code: 'live_fixture_check_failed' })); process.exitCode = 1; }
}
