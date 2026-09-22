import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.mjs';

const DAY = 86_400_000;
const FAKE_TOKEN = 'A'.repeat(43);
const request = { email: 'cosplayer@example.test', device: 'iphone', ageConfirmed: true, updatesConsent: false };

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'crewroom-beta-'));
  let clock = Date.UTC(2026, 8, 20, 16), app, base;
  const sent = [], logs = [];
  const config = { dbPath: path.join(directory, 'crewroom.sqlite'), mediaDir: path.join(directory, 'media'),
    appOrigin: 'https://joincrewroom.example', supportEmail: 'support@crewroom.example',
    now: () => clock, mailSender: async message => sent.push(message),
    clientIp: req => req.headers['x-test-client'] || 'default',
    logger: { error: (...items) => logs.push(items), warn: (...items) => logs.push(items) }, ...options };
  async function start() {
    app = createApp(config);
    await new Promise((resolve, reject) => { app.once('error', reject); app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${app.address().port}`;
  }
  async function stop() { if (app?.listening) await new Promise((resolve, reject) => app.close(error => error ? reject(error) : resolve())); }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  await start();
  function inspect(fn) { const db = new DatabaseSync(config.dbPath); try { return fn(db); } finally { db.close(); } }
  async function call(endpoint, payload, { method = payload === undefined ? 'GET' : 'POST', headers = {} } = {}) {
    const response = await fetch(base + endpoint, { method,
      headers: { ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function signup(extra = {}, headers) {
    const result = await call('/api/beta/signup', { ...request, ...extra }, { headers });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result;
  }
  function token(kind, message = sent.at(-1)) {
    const found = message?.text.match(new RegExp(`#${kind}=([A-Za-z0-9_-]{43})`));
    assert.ok(found, `Expected ${kind} link in mock email`);
    return found[1];
  }
  return { config, sent, logs, inspect, call, signup, token, start, stop, raw: (endpoint, options) => fetch(base + endpoint, options),
    advance: milliseconds => { clock += milliseconds; }, get now() { return clock; } };
}

test('beta signup validates eligibility and explicit consent before storing or sending', async t => {
  const f = await fixture(t);
  const usersBefore = f.inspect(db => db.prepare('SELECT count(*) AS n FROM users').get().n);
  for (const extra of [{ email: '' }, { email: 'not-an-email' }, { email: '<a>@example.test' }, { email: 12 },
    { device: 'tablet' }, { device: null }, { ageConfirmed: false }, { ageConfirmed: 'true' },
    { updatesConsent: 'true' }, { updatesConsent: undefined }, { source: [] }, { source: { utm_source: 'a'.repeat(121) } }]) {
    assert.equal((await f.call('/api/beta/signup', { ...request, ...extra })).status, 400, JSON.stringify(extra));
  }
  assert.equal(f.sent.length, 0);
  assert.equal(f.inspect(db => db.prepare('SELECT count(*) AS n FROM beta_subscribers').get().n), 0);
  for (const device of ['iphone', 'android', 'both']) await f.signup({ email: `${device}@example.test`, device });
  assert.equal(f.sent.length, 3);
  assert.equal(f.inspect(db => db.prepare('SELECT count(*) AS n FROM users').get().n), usersBefore, 'beta requests do not create app accounts');
  assert.equal((await f.call('/api/beta/signup', { ...request, website: 'https://spam.example' })).status, 201);
  assert.equal(f.sent.length, 3, 'honeypot submissions do not send email');
});

test('beta stays pending until explicit email confirmation; receipt details transfer and tokens are hashed and single-use', async t => {
  const f = await fixture(t);
  const signup = await f.signup({ email: '  CosPlayer@EXAMPLE.TEST ', updatesConsent: true,
    source: { utm_source: 'instagram', utm_campaign: 'NYC\u0000 crews', ignored: 'discard me' } });
  assert.equal(signup.headers.get('set-cookie'), null);
  assert.equal(signup.headers.get('cache-control'), 'no-store');
  assert.equal(f.sent[0].to, 'cosplayer@example.test');
  assert.match(f.sent[0].text, /does not guarantee a place or create an app account/);
  const confirmToken = f.token('confirm'), unsubscribeToken = f.token('unsubscribe');
  let subscriber = f.inspect(db => db.prepare('SELECT * FROM beta_subscribers').get());
  assert.equal(subscriber.state, 'pending');
  assert.equal(subscriber.updatesConsent, 0, 'unconfirmed opt-in does not enter a marketing list');
  assert.equal(subscriber.confirmedAt, null);
  const stored = f.inspect(db => JSON.stringify([
    db.prepare('SELECT * FROM beta_requests').all(), db.prepare('SELECT * FROM beta_unsubscribe_tokens').all(),
  ]));
  for (const raw of [signup.body.receiptToken, confirmToken, unsubscribeToken]) assert.equal(stored.includes(raw), false);
  assert.equal((await f.call('/api/beta/details', { receiptToken: signup.body.receiptToken, role: 'maker', nextShoot: 'Prospect Park next month' })).status, 200);
  assert.equal(f.inspect(db => db.prepare('SELECT role FROM beta_subscribers').get().role), '', 'receipt data is pending, not a confirmed preference');
  await f.stop(); await f.start();
  assert.equal((await f.call(`/api/beta/confirm?token=${confirmToken}`)).status, 404, 'email prefetch via GET cannot confirm');
  const confirmed = await f.call('/api/beta/confirm', { token: confirmToken });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.role, 'maker');
  assert.equal(confirmed.body.updatesConsent, true);
  subscriber = f.inspect(db => db.prepare('SELECT * FROM beta_subscribers').get());
  assert.equal(subscriber.state, 'confirmed'); assert.equal(subscriber.confirmedAt, f.now);
  assert.equal(subscriber.nextShoot, 'Prospect Park next month');
  assert.deepEqual(JSON.parse(subscriber.source), { utm_source: 'instagram', utm_campaign: 'NYC crews' });
  const storedRequest = f.inspect(db => db.prepare('SELECT * FROM beta_requests').get());
  assert.equal(storedRequest.confirmHash, null); assert.equal(storedRequest.receiptHash, null);
  assert.notEqual(storedRequest.manageHash, confirmed.body.manageToken);
  assert.equal((await f.call('/api/beta/confirm', { token: confirmToken })).status, 400);
  assert.equal((await f.call('/api/beta/details', { receiptToken: signup.body.receiptToken, role: 'other' })).status, 400);
  assert.doesNotMatch(JSON.stringify(f.logs), /cosplayer@example|Prospect Park/);
});

test('normalized duplicate submissions cannot change confirmed preferences until the owner confirms the new request', async t => {
  const f = await fixture(t);
  await f.signup({ updatesConsent: true });
  const originalConfirmation = await f.call('/api/beta/confirm', { token: f.token('confirm') });
  await f.call('/api/beta/preferences', { token: originalConfirmation.body.manageToken, updatesConsent: true, role: 'cosplayer', nextShoot: 'Original plan' });
  const original = f.inspect(db => db.prepare('SELECT * FROM beta_subscribers').get());
  f.advance(61_000);
  const duplicate = await f.signup({ email: 'COSPLAYER@example.test', device: 'android', updatesConsent: false });
  const newToken = f.token('confirm');
  await f.call('/api/beta/details', { receiptToken: duplicate.body.receiptToken, role: 'photographer', nextShoot: 'New request plan' });
  assert.deepEqual(f.inspect(db => db.prepare('SELECT * FROM beta_subscribers').get()), original);
  assert.equal((await f.call('/api/beta/preferences', { token: duplicate.body.receiptToken, updatesConsent: false })).status, 400);
  assert.equal((await f.call('/api/beta/confirm', { token: newToken })).status, 200);
  const updated = f.inspect(db => db.prepare('SELECT * FROM beta_subscribers').get());
  assert.equal(updated.device, 'android'); assert.equal(updated.updatesConsent, 0);
  assert.equal(updated.role, 'photographer'); assert.equal(updated.nextShoot, 'New request plan');
  assert.equal(f.inspect(db => db.prepare('SELECT count(*) AS n FROM beta_subscribers').get().n), 1);
  assert.equal((await f.call('/api/beta/preferences', { token: originalConfirmation.body.manageToken, updatesConsent: true })).status, 400, 'older manage session is revoked');
});

test('beta preference changes require a valid management session and respect validation and expiration', async t => {
  const f = await fixture(t);
  const signup = await f.signup();
  assert.equal((await f.call('/api/beta/details', { receiptToken: FAKE_TOKEN, role: 'maker' })).status, 400);
  assert.equal((await f.call('/api/beta/details', { receiptToken: signup.body.receiptToken, role: 'unlisted' })).status, 400);
  assert.equal((await f.call('/api/beta/details', { receiptToken: signup.body.receiptToken, nextShoot: 'a'.repeat(301) })).status, 400);
  const confirmed = await f.call('/api/beta/confirm', { token: f.token('confirm') });
  for (const payload of [{}, { token: FAKE_TOKEN }, { token: signup.body.receiptToken },
    { token: confirmed.body.manageToken, updatesConsent: 'false' },
    { token: confirmed.body.manageToken, updatesConsent: true, role: 'unlisted' }]) {
    assert.equal((await f.call('/api/beta/preferences', payload)).status, 400);
  }
  assert.equal((await f.call('/api/beta/preferences', { token: confirmed.body.manageToken, updatesConsent: true, role: 'organizer', nextShoot: 'In two weeks' })).status, 200);
  assert.equal(f.inspect(db => db.prepare('SELECT updatesConsent FROM beta_subscribers').get().updatesConsent), 1);
  f.advance(DAY);
  assert.equal((await f.call('/api/beta/preferences', { token: confirmed.body.manageToken, updatesConsent: false })).status, 400);
  assert.equal(f.inspect(db => db.prepare('SELECT updatesConsent FROM beta_subscribers').get().updatesConsent), 1);
});

test('beta unsubscribe is explicit, idempotent, and removes the waitlist graph without deleting the app account', async t => {
  const f = await fixture(t);
  const appAccount = await f.call('/api/auth/signup', { name: 'Cosplayer', email: request.email, password: 'long-test-account-password' });
  assert.equal(appAccount.status, 201);
  await f.signup();
  const unsubscribe = f.token('unsubscribe');
  await f.call('/api/beta/confirm', { token: f.token('confirm') });
  assert.equal((await f.call(`/api/beta/unsubscribe?token=${unsubscribe}`)).status, 404);
  assert.equal(f.inspect(db => db.prepare('SELECT count(*) AS n FROM beta_subscribers').get().n), 1);
  for (const token of [unsubscribe, unsubscribe, FAKE_TOKEN]) {
    const result = await f.call('/api/beta/unsubscribe', { token });
    assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true });
  }
  f.inspect(db => {
    for (const table of ['beta_subscribers', 'beta_requests', 'beta_unsubscribe_tokens'])
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
    assert.equal(db.prepare('SELECT id FROM users WHERE email=?').get(request.email).id, appAccount.body.user.id);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
});

test('beta mail failure returns 503, removes undeliverable request details, and leaves confirmed subscribers unchanged', async t => {
  let broken = true; const messages = [];
  const f = await fixture(t, { mailSender: async message => { if (broken) throw new Error(`Delivery rejected for ${message.to}`); messages.push(message); } });
  const failure = await f.call('/api/beta/signup', request);
  assert.equal(failure.status, 503);
  assert.equal(failure.body.receiptToken, undefined);
  for (const table of ['beta_subscribers', 'beta_requests', 'beta_unsubscribe_tokens'])
    assert.equal(f.inspect(db => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n), 0);
  assert.doesNotMatch(JSON.stringify(f.logs), /cosplayer@example|Delivery rejected/);
  broken = false; f.advance(61_000);
  await f.signup();
  await f.call('/api/beta/confirm', { token: f.token('confirm', messages[0]) });
  const original = f.inspect(db => db.prepare('SELECT * FROM beta_subscribers').get());
  broken = true; f.advance(61_000);
  assert.equal((await f.call('/api/beta/signup', { ...request, updatesConsent: true })).status, 503);
  assert.deepEqual(f.inspect(db => db.prepare('SELECT * FROM beta_subscribers').get()), original);
  assert.equal(f.inspect(db => db.prepare('SELECT count(*) AS n FROM beta_requests').get().n), 1);
});

test('beta signup is unavailable without mail or origin, and unapproved browser origins cannot mutate the waitlist', async t => {
  for (const options of [{ mailSender: undefined }, { appOrigin: undefined }]) {
    const f = await fixture(t, options);
    assert.equal((await f.call('/api/beta/config')).body.available, false);
    assert.equal((await f.call('/api/beta/signup', request)).status, 503);
    assert.equal(f.sent.length, 0);
    assert.equal(f.inspect(db => db.prepare('SELECT count(*) AS n FROM beta_subscribers').get().n), 0);
  }
  const f = await fixture(t);
  assert.deepEqual((await f.call('/api/beta/config')).body, { available: true, minimumAge: 18, supportEmail: f.config.supportEmail });
  assert.equal((await f.call('/api/beta/signup', request, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal(f.sent.length, 0);
  await f.signup({}, { Origin: f.config.appOrigin });
  assert.equal((await f.call('/api/beta/confirm', { token: f.token('confirm') }, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal(f.inspect(db => db.prepare('SELECT state FROM beta_subscribers').get().state), 'pending');
});

test('beta delivery cooldown and per-address daily limit persist across restarts and expire after one day', async t => {
  const f = await fixture(t);
  await f.signup();
  assert.equal((await f.call('/api/beta/signup', request)).status, 429);
  await f.stop(); await f.start();
  assert.equal((await f.call('/api/beta/signup', { ...request, email: 'COSPLAYER@EXAMPLE.TEST' })).status, 429);
  f.advance(60_000); await f.signup();
  f.advance(60_000); await f.signup();
  f.advance(60_000);
  assert.equal((await f.call('/api/beta/signup', request)).status, 429);
  assert.equal(f.sent.length, 3);
  const limits = f.inspect(db => db.prepare('SELECT * FROM beta_email_limits').all());
  assert.equal(JSON.stringify(limits).includes(request.email), false);
  await f.stop(); await f.start();
  assert.equal((await f.call('/api/beta/signup', request)).status, 429);
  f.advance(DAY); await f.signup();
  assert.equal(f.sent.length, 4);
});

test('beta global daily email budget caps distinct addresses and persists across server restarts', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 50; index++) await f.signup({ email: `person${index}@example.test` }, { 'x-test-client': `client-${index}` });
  assert.equal(f.sent.length, 50);
  await f.stop(); await f.start();
  assert.equal((await f.call('/api/beta/signup', { ...request, email: 'over-limit@example.test' })).status, 429);
  assert.equal(f.sent.length, 50);
  assert.equal(f.inspect(db => db.prepare('SELECT email FROM beta_subscribers WHERE email=?').get('over-limit@example.test')), undefined);
  f.advance(DAY); await f.signup({ email: 'next-day@example.test' });
  assert.equal(f.sent.length, 51);
});

test('beta retention expires pending requests after seven days and confirmed requests after 180 days', async t => {
  const f = await fixture(t);
  await f.signup({ email: 'pending@example.test' });
  const pendingToken = f.token('confirm');
  await f.signup({ email: 'confirmed@example.test' });
  await f.call('/api/beta/confirm', { token: f.token('confirm') });
  f.advance(7 * DAY);
  assert.equal((await f.call('/api/beta/confirm', { token: pendingToken })).status, 400);
  assert.deepEqual(f.inspect(db => db.prepare('SELECT email FROM beta_subscribers ORDER BY email').all()).map(row => row.email), ['confirmed@example.test']);
  f.advance(173 * DAY);
  await f.stop(); await f.start();
  assert.equal(f.inspect(db => db.prepare('SELECT count(*) AS n FROM beta_subscribers').get().n), 0);
  assert.equal(f.inspect(db => db.prepare('SELECT count(*) AS n FROM beta_unsubscribe_tokens').get().n), 0);
});

test('a fresh pending resend remains confirmable for its full seven days near the original retention deadline', async t => {
  const f = await fixture(t);
  await f.signup();
  const original = f.token('confirm');
  f.advance(6 * DAY); await f.signup();
  const refreshed = f.token('confirm');
  f.advance(2 * DAY);
  assert.equal((await f.call('/api/beta/confirm', { token: original })).status, 400);
  assert.equal((await f.call('/api/beta/confirm', { token: refreshed })).status, 200);
  assert.equal(f.inspect(db => db.prepare('SELECT state FROM beta_subscribers').get().state), 'confirmed');
});

test('fresh reconfirmation remains valid across the confirmed retention deadline without extending abandoned records indefinitely', async t => {
  const f = await fixture(t);
  await f.signup(); await f.call('/api/beta/confirm', { token: f.token('confirm') });
  f.advance(179 * DAY); await f.signup();
  const token = f.token('confirm');
  f.advance(2 * DAY);
  assert.equal((await f.call('/api/beta/confirm', { token })).status, 200);
  assert.equal(f.inspect(db => db.prepare('SELECT confirmedAt FROM beta_subscribers').get().confirmedAt), f.now);
  f.advance(179 * DAY); await f.signup();
  f.advance(7 * DAY); await f.call('/api/beta/config');
  assert.equal(f.inspect(db => db.prepare('SELECT count(*) AS n FROM beta_subscribers').get().n), 0);
});

test('public beta routes disclose no subscriber lists or GET-accessible preferences', async t => {
  const f = await fixture(t);
  const signed = await f.signup();
  const confirmed = await f.call('/api/beta/confirm', { token: f.token('confirm') });
  for (const route of ['/api/beta/signup', '/api/beta/subscribers', '/api/beta/list',
    `/api/beta/preferences?token=${confirmed.body.manageToken}`, `/api/beta/details?receiptToken=${signed.body.receiptToken}`]) {
    const result = await f.call(route);
    assert.equal(result.status, 404, route);
    assert.doesNotMatch(JSON.stringify(result.body), /cosplayer@example|manageToken|receiptToken/);
  }
  const config = await f.call('/api/beta/config');
  assert.doesNotMatch(JSON.stringify(config.body), /cosplayer@example|manageToken|receiptToken/);
  assert.equal((await f.call('/api/beta/unsubscribe', { token: 'invalid' })).status, 400);
});

test('beta page serves a standalone signup and local demo with restrictive CSP and working script/style assets', async t => {
  const f = await fixture(t);
  const response = await f.raw('/beta');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('set-cookie'), null);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'self'/); assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  const html = await response.text();
  assert.match(html, /Request beta access/);
  assert.match(html, /<form[^>]*id="signup-form"/);
  assert.match(html, /Illustrated example of Crewroom features/);
  assert.match(html, /href="\/privacy"/);
  const scriptPaths = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(scriptPaths.length > 0, 'signup has its script reference');
  for (const scriptPath of scriptPaths) {
    assert.match(scriptPath, /^\/beta\/assets\//, 'scripts are served from the beta origin');
    const script = await f.raw(scriptPath);
    assert.equal(script.status, 200); assert.match(script.headers.get('content-type'), /javascript/);
    assert.doesNotMatch(await script.text(), /<!doctype html>/i, 'script route must not fall back to the app HTML');
  }
  const stylePath = html.match(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/)?.[1];
  assert.ok(stylePath);
  const style = await f.raw(stylePath);
  assert.equal(style.status, 200); assert.match(style.headers.get('content-type'), /^text\/css/);
  const head = await f.raw('/beta/', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
});
