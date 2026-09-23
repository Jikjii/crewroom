import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runLiveModerationChecks } from '../scripts/check-moderation-live.mjs';

const configuration = Object.freeze({
  MODERATION_MODE: 'manual', SIGHTENGINE_API_USER: 'fixture-user',
  SIGHTENGINE_API_SECRET: 'fixture-secret-should-never-be-printed',
  SIGHTENGINE_IMAGE_WORKFLOW: 'wfl_fixture',
  SIGHTENGINE_WORKFLOWS_VERIFIED: 'false',
});
const classes = ['sexual', 'discriminatory', 'insulting', 'violent', 'toxic', 'self-harm'];
const demoHashes = new Set([
  '231356cce1efea102462bd4721b2ac8bcd1838e5e57c55a162f9f7a2d0feb371',
  '34c12a7686422dfaa6a5cfce0a190799364dfc3ae16b5ec3a13bcfb76053da27',
  'f524f9c33bddd08b23f8d2ae39d04d35dd939c24cf830ae273a4b77efe7cb095',
]);
const response = body => new Response(JSON.stringify({ status: 'success', request: { id: 'synthetic-request' }, ...body }), { headers: { 'Content-Type': 'application/json' } });

test('live fixture harness refuses missing consent, unknown arguments, automatic mode, missing credentials and video setup without any network request', async () => {
  for (const [argv, env] of [
    [[], configuration], [['--public-demo-fixtures', '--file', 'private.jpg'], configuration],
    [['--public-demo-fixtures'], { ...configuration, MODERATION_MODE: 'hybrid' }],
    [['--public-demo-fixtures'], { ...configuration, MODERATION_MODE: undefined }],
    [['--public-demo-fixtures'], { ...configuration, SIGHTENGINE_API_SECRET: '' }],
    [['--public-demo-fixtures'], { ...configuration, SIGHTENGINE_VIDEO_WORKFLOW: 'wfl_video' }],
    [['--public-demo-fixtures'], { ...configuration, SIGHTENGINE_AUDIO_MODERATION_ENABLED: 'true' }],
  ]) {
    let calls = 0;
    const lines = [];
    const result = await runLiveModerationChecks({ argv, env, fetchImpl: async () => { calls++; throw new Error('must not call'); }, write: line => lines.push(line) });
    assert.equal(result.success, false);
    assert.equal(result.exitCode, 1);
    assert.equal(calls, 0);
    assert.equal(lines.length, 1);
    assert.equal(lines.join('').includes(configuration.SIGHTENGINE_API_SECRET), false);
  }
});

test('live fixture harness uses only fixed public fixtures, validates specific hold reasons, leaves configuration unchanged, and keeps Starter video offline', async () => {
  const before = JSON.stringify(configuration), lines = [], calls = [];
  const result = await runLiveModerationChecks({
    argv: ['--public-demo-fixtures'], env: configuration, write: line => lines.push(line),
    fetchImpl: async (url, { body }) => {
      calls.push(url);
      assert.equal(body.get('api_secret'), configuration.SIGHTENGINE_API_SECRET);
      if (url.endsWith('/text/check.json')) {
        const scores = Object.fromEntries(classes.map(name => [name, 0.01]));
        if (body.get('text').includes('kill')) scores.violent = 0.99;
        return response({ moderation_classes: { available: classes, ...scores } });
      }
      if (url.endsWith('/check-workflow.json')) return response({
        workflow: { id: 'wfl_fixture' }, summary: { action: 'accept', reject_prob: 0.01, reject_reason: [] },
        nudity: { sexual_activity: 0.01, sexual_display: 0.01, erotica: 0.01 },
        gore: { prob: 0.01 },
        offensive: { nazi: 0.01, supremacist: 0.01, terrorist: 0.01, confederate: 0.01, asian_swastika: 0.01, middle_finger: 0.01 },
        violence: { prob: 0.01 }, 'self-harm': { prob: 0.01 },
      });
      assert.ok(url.endsWith('/check.json'));
      assert.equal(body.get('models'), 'text-content-2.0');
      const bytes = Buffer.from(await body.get('media').arrayBuffer());
      const isDemo = demoHashes.has(createHash('sha256').update(bytes).digest('hex'));
      return response({ text: { language: 'en', detected_categories: isDemo ? [] : ['violence'], detections: isDemo ? {} : { violence: [{ match: 'sensitive synthetic extracted text' }] } } });
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.total, 7);
  assert.equal(result.passed, 7);
  assert.equal(result.requests, 10);
  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 10);
  assert.equal(calls.some(url => url.includes('/video/')), false);
  assert.equal(JSON.stringify(configuration), before);
  const outcomes = lines.map(line => JSON.parse(line));
  assert.equal(outcomes.find(item => item.id === 'starter-video-human-review').requests, 0);
  for (const sensitive of [configuration.SIGHTENGINE_API_SECRET, configuration.SIGHTENGINE_API_USER, 'I will kill you.', 'sensitive synthetic extracted text', '/var/data/', '/tmp/']) assert.equal(lines.join('').includes(sensitive), false);
});

test('provider failure cannot masquerade as successful threat detection, and raw errors never reach output', async () => {
  const lines = [];
  const result = await runLiveModerationChecks({
    argv: ['--public-demo-fixtures'], env: configuration, write: line => lines.push(line),
    fetchImpl: async () => { throw new Error('fixture-secret-should-never-be-printed private payload'); },
  });
  assert.equal(result.success, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.passed, 1); // Only the deliberate no-network video hold.
  assert.equal(result.requests, 6);
  assert.equal(lines.join('').includes('private payload'), false);
  assert.equal(lines.join('').includes(configuration.SIGHTENGINE_API_SECRET), false);
  const threat = lines.map(line => JSON.parse(line)).find(item => item.id === 'synthetic-threatening-caption');
  assert.equal(threat.actual, 'review');
  assert.equal(threat.success, false);
  assert.equal(threat.code, 'provider_unavailable');
});
