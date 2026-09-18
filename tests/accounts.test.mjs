import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { createApp } from '../server/app.mjs';
import { createResendSender, releaseReadiness } from '../server/accounts.mjs';
import { inspectContent, decideContent } from '../server/content-review.mjs';

const PASSWORD = 'long-enough-old-password';
const NEW_PASSWORD = 'long-enough-new-password';
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'crewroom-accounts-'));
  const config = { dbPath: path.join(directory, 'data.sqlite'), mediaDir: path.join(directory, 'media'), appOrigin: 'http://localhost:8081', logger: { error: () => {}, warn: () => {} }, ...options };
  let app, base;
  async function start() { app = createApp(config); await new Promise((resolve, reject) => { app.once('error', reject); app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${app.address().port}`; }
  async function stop() { if (app?.listening) await new Promise((resolve, reject) => app.close(error => error ? reject(error) : resolve())); }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  await start();
  function inspect(fn) { const database = new DatabaseSync(config.dbPath); try { return fn(database); } finally { database.close(); } }
  function client(mode = 'native') {
    const state = { token: null, cookie: null, csrf: null, user: null };
    return {
      state,
      async call(endpoint, method = 'GET', payload, extra = {}) {
        const headers = { ...extra.headers };
        if (mode === 'native' && state.token) headers.Authorization = `Bearer ${state.token}`;
        if (mode === 'web') { headers.Origin = config.appOrigin; if (state.cookie) headers.Cookie = state.cookie; if (state.csrf && extra.csrf !== false) headers['X-CSRF-Token'] = state.csrf; }
        if (payload !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetch(base + endpoint, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
        const body = await response.json();
        if (body.sessionToken) state.token = body.sessionToken;
        if (body.user) state.user = body.user;
        if (Object.hasOwn(body, 'csrfToken')) state.csrf = body.csrfToken;
        if (response.headers.get('set-cookie')) state.cookie = response.headers.get('set-cookie').split(';')[0];
        // Account-deletion scenarios use explicitly reviewed public fixtures.
        if (response.ok && method !== 'GET' && body.reviewStatus === 'pending') inspect(db => {
          const type = body.userId ? 'profile' : body.postId ? 'comment' : 'post';
          const id = body.userId || body.id;
          const item = inspectContent(db, type, id, config.mediaDir);
          decideContent(db, { type, id, version: item.version, decision: 'approved', imagesReviewed: true, mediaDir: config.mediaDir });
        });
        return { status: response.status, body, headers: response.headers };
      },
      async signup(name, policy = {}) { const response = await this.call('/api/auth/signup', 'POST', { name, email: `${name.toLowerCase()}@example.test`, password: PASSWORD, ...policy }); assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body.user; },
      async crew(name) { const result = await this.call('/api/crews', 'POST', { name }); assert.equal(result.status, 201); return result.body; },
      async workspace() { const result = await this.call('/api/workspace'); assert.equal(result.status, 200); return result.body; },
      async project(crewId, title = 'Shared project') { const result = await this.call('/api/projects', 'POST', { crewId, title }); assert.equal(result.status, 201); return result.body; },
      async publish(name) { const result = await this.call('/api/social/me', 'PATCH', { handle: name.toLowerCase(), displayName: name, visibility: 'public', openToCollab: true }); assert.equal(result.status, 200); return result.body; },
      async post(title, credits = []) {
        const image = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#5599cc' } }).png().toBuffer();
        const media = await this.call('/api/social/media', 'POST', { base64: image.toString('base64'), mimeType: 'image/png' }); assert.equal(media.status, 201);
        const result = await this.call('/api/social/posts', 'POST', { title, stage: 'finished', visibility: 'public', mediaIds: [media.body.id], credits }); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body;
      },
    };
  }
  return { directory, config, client, inspect, start, stop, get base() { return base; } };
}

test('password reset stays disabled until configured and Resend adapter uses only injected transport', async t => {
  const f = await fixture(t), anon = f.client();
  assert.equal((await anon.call('/api/public-config')).body.resetAvailable, false);
  assert.equal((await anon.call('/api/auth/password-reset/request', 'POST', { email: 'nobody@example.test' })).status, 503);
  assert.equal(createResendSender({}), undefined);
  const deliveries = [];
  const sender = createResendSender({ apiKey: 'test-only-key', from: 'Crewroom <test@example.test>', fetchImpl: async (...args) => { deliveries.push(args); return { ok: true }; } });
  assert.equal(deliveries.length, 0);
  await sender({ to: 'recipient@example.test', subject: 'Test', text: 'Hello', html: '<p>Hello</p>' });
  assert.equal(deliveries.length, 1); assert.equal(deliveries[0][0], 'https://api.resend.com/emails');
  assert.equal(deliveries[0][1].headers.Authorization, 'Bearer test-only-key');
  assert.deepEqual(JSON.parse(deliveries[0][1].body).to, ['recipient@example.test']);
});

test('reset requests are generic; stored tokens are hashed, single-use, expiring, persistent, and revoke every session', async t => {
  let clock = Date.now(); const sent = [];
  const f = await fixture(t, { now: () => clock, mailSender: async message => { sent.push(message); } });
  const owner = f.client(), otherSession = f.client(), anon = f.client(); const user = await owner.signup('ResetOwner');
  await otherSession.call('/api/auth/login', 'POST', { email: user.email, password: PASSWORD });
  const known = await anon.call('/api/auth/password-reset/request', 'POST', { email: user.email });
  const unknown = await anon.call('/api/auth/password-reset/request', 'POST', { email: 'unknown@example.test' });
  assert.deepEqual(known.body, unknown.body); assert.equal(known.status, 200); assert.equal(sent.length, 1);
  const resetUrl = sent[0].text.match(/http:\/\/localhost:8081\/reset-password\?token=[\w-]+/)[0];
  const token = new URL(resetUrl).searchParams.get('token');
  const rows = f.inspect(db => db.prepare('SELECT * FROM account_password_resets').all());
  assert.equal(rows.length, 1); assert.notEqual(rows[0].tokenHash, token); assert.equal(JSON.stringify(rows).includes(token), false);
  await f.stop(); await f.start();
  assert.equal((await anon.call('/api/auth/password-reset/confirm', 'POST', { token, password: NEW_PASSWORD })).status, 200);
  assert.equal((await owner.call('/api/workspace')).status, 401); assert.equal((await otherSession.call('/api/workspace')).status, 401);
  assert.equal((await anon.call('/api/auth/password-reset/confirm', 'POST', { token, password: PASSWORD })).status, 400);
  assert.equal((await anon.call('/api/auth/login', 'POST', { email: user.email, password: PASSWORD })).status, 401);
  assert.equal((await anon.call('/api/auth/login', 'POST', { email: user.email, password: NEW_PASSWORD })).status, 200);
  await anon.call('/api/auth/password-reset/request', 'POST', { email: user.email });
  const expiringToken = new URL(sent.at(-1).text.match(/http:\/\/localhost:8081\/reset-password\?token=[\w-]+/)[0]).searchParams.get('token');
  clock += 31 * 60_000;
  assert.equal((await anon.call('/api/auth/password-reset/confirm', 'POST', { token: expiringToken, password: PASSWORD })).status, 400);
});

test('policy acceptance is configurable, recorded, and secure cookies/client IP injection work behind a trusted proxy', async t => {
  const options = { production: true, appOrigin: 'https://crewroom.example', secureCookies: true, operatorName: 'Test Operator', supportEmail: 'support@example.test', policiesApproved: true, policyVersion: '2026-09', clientIp: req => req.headers['x-test-client'] || 'fallback' };
  const f = await fixture(t, options), person = f.client();
  const config = (await person.call('/api/public-config')).body;
  assert.equal(config.requirePolicyAcceptance, true); assert.equal(config.operator, 'Test Operator'); assert.equal(config.privacyPolicyUrl, 'https://crewroom.example/privacy');
  assert.equal((await person.call('/api/auth/signup', 'POST', { name: 'Policy', email: 'policy@example.test', password: PASSWORD })).status, 400);
  const result = await person.call('/api/auth/signup', 'POST', { name: 'Policy', email: 'policy@example.test', password: PASSWORD, policyAccepted: true, ageConfirmed: true, policyVersion: '2026-09' });
  assert.equal(result.status, 201); assert.match(result.headers.get('set-cookie'), /; Secure/);
  assert.equal(f.inspect(db => db.prepare('SELECT policyVersion FROM account_policy_acceptances WHERE userId=?').get(result.body.user.id)).policyVersion, '2026-09');
  assert.equal((await person.call('/api/crews', 'POST', { name: 'Not allowed' }, { headers: { Origin: 'http://localhost:8081' } })).status, 403);
  const readiness = releaseReadiness(options); assert.equal(readiness.ready, true); assert.equal(readiness.resetAvailable, false); assert.equal(readiness.warnings.length, 1);
  assert.equal(releaseReadiness({ production: true }).ready, false);

  // A small separate limiter proves the app uses only the injected client-IP function.
  const rateFixture = await fixture(t, { rateLimit: 1, clientIp: req => req.headers['x-test-client'] || 'same' });
  const anon = rateFixture.client();
  assert.equal((await anon.call('/api/demo', 'POST', {}, { headers: { 'x-test-client': 'first' } })).status, 201);
  assert.equal((await anon.call('/api/demo', 'POST', {}, { headers: { 'x-test-client': 'first' } })).status, 429);
  assert.equal((await anon.call('/api/demo', 'POST', {}, { headers: { 'x-test-client': 'second' } })).status, 201);
});

test('account deletion transfers shared crews, preserves others work, removes full FK graph/media, and revokes sessions', async t => {
  let clock = Date.now(); const f = await fixture(t, { now: () => clock });
  const a = f.client(), b = f.client(), c = f.client(), secondSession = f.client();
  const ua = await a.signup('DeleteAster'), ub = await b.signup('KeepBirch'), uc = await c.signup('KeepCedar');
  await a.publish('deleteaster'); await b.publish('keepbirch'); await c.publish('keepcedar');
  await secondSession.call('/api/auth/login', 'POST', { email: ua.email, password: PASSWORD });
  const shared = await a.crew('Shared crew'), solo = await a.crew('Solo crew'), others = await b.crew('Someone else’s crew');
  async function invite(owner, crew, joiner) { const invitation = (await owner.call(`/api/crews/${crew.id}/invites`, 'POST', {})).body; clock += 1000; const result = await joiner.call(`/api/invites/${invitation.token}/accept`, 'POST', {}); assert.equal(result.status, 200); return invitation; }
  await invite(a, shared, b); await invite(a, shared, c); const consumed = await invite(b, others, a);
  const issued = (await a.call(`/api/crews/${shared.id}/invites`, 'POST', {})).body;
  const project = await a.project(shared.id), soloProject = await a.project(solo.id), otherProject = await b.project(others.id);
  const ws = await a.workspace(), memberA = ws.members.find(m => m.crewId === shared.id && m.userId === ua.id), memberB = ws.members.find(m => m.crewId === shared.id && m.userId === ub.id);
  const ownTask = (await a.call('/api/tasks', 'POST', { projectId: project.id, title: 'Keep this unassigned', assigneeId: memberA.id })).body;
  const othersTask = (await a.call('/api/tasks', 'POST', { projectId: project.id, title: 'Keep Birch’s task', assigneeId: memberB.id })).body;
  await a.call('/api/lineup', 'POST', { projectId: project.id, memberId: memberA.id, character: 'Departing' });
  await a.call('/api/lineup', 'POST', { projectId: project.id, memberId: memberB.id, character: 'Staying' });
  const ownPost = await a.post('Delete my work');
  const otherPost = await b.post('Preserve this work', [{ name: ua.name, role: 'Former collaborator', profileId: ua.id }]);
  await a.call(`/api/social/posts/${otherPost.id}/comments`, 'POST', { body: 'My comment to remove' });
  await b.call(`/api/social/posts/${ownPost.id}/comments`, 'POST', { body: 'A descendant comment' });
  await a.call(`/api/social/profiles/${ub.id}/follow`, 'POST', { following: true });
  await b.call(`/api/social/profiles/${ua.id}/follow`, 'POST', { following: true });
  await a.call(`/api/social/posts/${otherPost.id}/save`, 'POST', { saved: true });
  await b.call(`/api/social/posts/${ownPost.id}/save`, 'POST', { saved: true });
  await a.call('/api/social/reports', 'POST', { targetType: 'post', targetId: otherPost.id, reason: 'other' });
  await b.call('/api/social/reports', 'POST', { targetType: 'post', targetId: ownPost.id, reason: 'other' });
  const request = await b.call('/api/social/requests', 'POST', { recipientId: ua.id, title: 'Accepted shared project', role: 'Maker', message: 'Let us make this together.' });
  assert.equal(request.status, 201);
  const accepted = await a.call(`/api/social/requests/${request.body.id}`, 'PATCH', { action: 'accept' }); assert.equal(accepted.status, 200);
  await a.call('/api/social/blocks', 'POST', { userId: uc.id });
  const preview = await a.call('/api/account/deletion-preview'); assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.ownedCrews.find(crew => crew.id === shared.id).successor, { userId: ub.id, name: ub.name });
  assert.equal(preview.body.ownedCrews.find(crew => crew.id === solo.id).action, 'delete');
  const ownFilename = f.inspect(db => db.prepare('SELECT filename FROM social_media WHERE id=?').get(ownPost.media[0].id)).filename;
  const otherFilename = f.inspect(db => db.prepare('SELECT filename FROM social_media WHERE id=?').get(otherPost.media[0].id)).filename;
  assert.equal((await a.call('/api/account', 'DELETE', { password: 'incorrect', confirmationToken: preview.body.confirmationToken })).status, 403);
  assert.ok(await stat(path.join(f.config.mediaDir, ownFilename)));
  const deleted = await a.call('/api/account', 'DELETE', { password: PASSWORD, confirmationToken: preview.body.confirmationToken }); assert.equal(deleted.status, 200, JSON.stringify(deleted.body)); assert.equal(deleted.body.mediaCleanupPending, false);
  assert.equal((await secondSession.call('/api/workspace')).status, 401);
  const kept = await b.workspace();
  assert.equal(kept.crews.find(crew => crew.id === shared.id).ownerId, ub.id);
  assert.equal(kept.crews.find(crew => crew.id === accepted.body.crewId).ownerId, ub.id);
  assert.ok(kept.projects.some(p => p.id === project.id)); assert.ok(kept.projects.some(p => p.id === otherProject.id));
  assert.equal(kept.tasks.find(task => task.id === ownTask.id).assigneeId, null); assert.equal(kept.tasks.find(task => task.id === othersTask.id).assigneeId, memberB.id);
  assert.ok(kept.lineup.some(line => line.memberId === memberB.id)); assert.equal(kept.lineup.some(line => line.memberId === memberA.id), false);
  assert.equal(kept.activity.some(item => item.actorName === ua.name), false);
  assert.equal((await b.call(`/api/invites/${issued.token}`)).status, 404);
  assert.equal((await b.call(`/api/invites/${consumed.token}`)).status, 404);
  assert.equal((await b.call(`/api/social/posts/${ownPost.id}`)).status, 404);
  const keptPost = await c.call(`/api/social/posts/${otherPost.id}`); assert.equal(keptPost.status, 200); assert.equal(keptPost.body.post.credits[0].name, 'Deleted creator');
  await assert.rejects(stat(path.join(f.config.mediaDir, ownFilename)), { code: 'ENOENT' }); assert.ok(await stat(path.join(f.config.mediaDir, otherFilename)));
  f.inspect(db => {
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('SELECT id FROM users WHERE id=?').get(ua.id), undefined);
    assert.equal(db.prepare('SELECT id FROM social_content_reviews WHERE targetId=? OR targetId=?').get(ua.id, ownPost.id), undefined);
    assert.equal(db.prepare('SELECT id FROM projects WHERE id=?').get(soloProject.id), undefined);
    assert.equal(db.prepare('SELECT id FROM social_requests WHERE id=?').get(request.body.id), undefined);
    assert.equal(db.prepare('SELECT actorName FROM activity WHERE actorUserId=?').get(ua.id), undefined);
  });
  await f.stop(); await f.start();
  assert.equal((await b.workspace()).crews.find(crew => crew.id === shared.id).ownerId, ub.id);
});

test('deletion requires auth and CSRF, demo deletion needs no password, and a failing deletion transaction preserves data', async t => {
  const f = await fixture(t), anon = f.client(), web = f.client('web');
  assert.equal((await anon.call('/api/account/deletion-preview')).status, 401);
  assert.equal((await anon.call('/api/account', 'DELETE', {})).status, 401);
  const demo = await web.call('/api/demo', 'POST', {}); assert.equal(demo.status, 201);
  assert.equal((await web.call('/api/account', 'DELETE', {}, { csrf: false })).status, 403);
  const real = f.client(); const user = await real.signup('AtomicDelete'); const crew = await real.crew('Keep on failure');
  const confirmationToken = (await real.call('/api/account/deletion-preview')).body.confirmationToken;
  f.inspect(db => db.exec("CREATE TRIGGER reject_account_delete BEFORE DELETE ON users WHEN OLD.email='atomicdelete@example.test' BEGIN SELECT RAISE(ABORT,'test-only failure'); END;"));
  assert.equal((await real.call('/api/account', 'DELETE', { password: PASSWORD, confirmationToken })).status, 500);
  assert.equal((await real.workspace()).crews[0].id, crew.id);
  assert.ok(f.inspect(db => db.prepare('SELECT id FROM users WHERE id=?').get(user.id)));
  f.inspect(db => db.exec('DROP TRIGGER reject_account_delete'));
  assert.equal((await real.call('/api/account', 'DELETE', { password: PASSWORD, confirmationToken })).status, 200);
  const demoToken = (await web.call('/api/account/deletion-preview')).body.confirmationToken;
  assert.equal((await web.call('/api/account', 'DELETE', { confirmationToken: demoToken })).status, 200);
  assert.equal((await web.call('/api/session')).body.user, null);
});

test('deletion confirmation becomes stale when a new member or plan changes the reviewed scope', async t => {
  const f = await fixture(t), owner = f.client(), joiner = f.client(); const user = await owner.signup('ReviewOwner'); const successor = await joiner.signup('ReviewJoiner');
  const crew = await owner.crew('Initially solo');
  const firstPreview = (await owner.call('/api/account/deletion-preview')).body;
  assert.equal(firstPreview.ownedCrews[0].action, 'delete');
  const invite = (await owner.call(`/api/crews/${crew.id}/invites`, 'POST', {})).body;
  await joiner.call(`/api/invites/${invite.token}/accept`, 'POST', {});
  const stale = await owner.call('/api/account', 'DELETE', { password: PASSWORD, confirmationToken: firstPreview.confirmationToken });
  assert.equal(stale.status, 409); assert.match(stale.body.error, /Review deletion again/);
  assert.equal((await owner.workspace()).crews[0].ownerId, user.id);
  const secondPreview = (await owner.call('/api/account/deletion-preview')).body;
  assert.equal(secondPreview.ownedCrews[0].successor.userId, successor.id);
  await owner.project(crew.id, 'New plan after review');
  assert.equal((await owner.call('/api/account', 'DELETE', { password: PASSWORD, confirmationToken: secondPreview.confirmationToken })).status, 409);
  const finalPreview = (await owner.call('/api/account/deletion-preview')).body;
  assert.equal((await owner.call('/api/account', 'DELETE', { password: PASSWORD, confirmationToken: finalPreview.confirmationToken })).status, 200);
  assert.equal((await joiner.workspace()).crews[0].ownerId, successor.id);
});
