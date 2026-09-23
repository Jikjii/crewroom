import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { fixture, password } from './social-fixture.mjs';

const pass = () => ({ decision: 'pass', codes: [], provider: 'sightengine' });
const review = () => ({ decision: 'review', codes: ['needs-context'], provider: 'sightengine' });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function eventually(check, message = 'Expected asynchronous moderation result') {
  const until = Date.now() + 4000;
  let value;
  do {
    value = await check();
    if (value) return value;
    await delay(15);
  } while (Date.now() < until);
  assert.fail(message);
}
function dbRead(f, sql, ...params) {
  const db = new DatabaseSync(f.config.dbPath, { readOnly: true });
  try { return db.prepare(sql).get(...params); }
  finally { db.close(); }
}
function dbWrite(f, sql, ...params) {
  const db = new DatabaseSync(f.config.dbPath);
  try { return db.prepare(sql).run(...params); }
  finally { db.close(); }
}
async function hybrid(t, screen = async () => pass(), extra = {}) {
  return fixture(t, { moderationMode: 'hybrid', moderationProvider: { ready: true, videoReady: true, screen }, moderationPollMs: 10, ...extra });
}
async function approvedProfile(client, name) {
  const profile = await client.publicProfile(name);
  await eventually(async () => (await client.ok('/api/social/me')).reviewStatus === 'approved', 'Profile never passed screening');
  return profile;
}
async function publishedPost(f, owner, input = {}) {
  const post = await owner.post(input);
  await eventually(async () => (await f.client().request(`/api/social/posts/${post.id}`)).status === 200, 'Post never became public');
  return post;
}

test('hybrid publishes screened public profiles, photos and comments without operator approval', async t => {
  const received = [];
  const f = await hybrid(t, async input => { received.push(input); return pass(); });
  const owner = f.client(), guest = f.client(), anonymous = f.client();
  const configuration = await anonymous.ok('/api/social/moderation-config');
  assert.deepEqual(configuration, { mode: 'hybrid', automaticScreening: true, automaticVideoScreening: true, provider: 'sightengine' });
  await approvedProfile(owner, 'AutoMaker');
  await approvedProfile(guest, 'AutoReader');
  const post = await publishedPost(f, owner);
  const publicPost = await anonymous.ok(`/api/social/posts/${post.id}`);
  assert.equal((await anonymous.request(publicPost.post.media[0].url)).status, 200);
  assert.equal(publicPost.post.reviewReason, undefined, 'Internal screening details are owner-only');
  const comment = await guest.ok(`/api/social/posts/${post.id}/comments`, 'POST', { body: 'Beautiful seam finishing!' });
  await eventually(async () => (await anonymous.ok(`/api/social/posts/${post.id}`)).comments.some(c => c.id === comment.id));
  assert.equal((await owner.ok('/api/social/notifications')).filter(n => n.type === 'comment').length, 1);
  assert.ok(received.some(input => input.type === 'profile'));
  assert.ok(received.some(input => input.type === 'post' && input.media.length === 1));
  assert.ok(received.some(input => input.type === 'comment'));
});

test('a passing post stays inaccessible while its public creator profile is held', async t => {
  const f = await hybrid(t, async input => input.type === 'profile' ? review() : pass());
  const owner = f.client(), anonymous = f.client();
  const profile = await owner.publicProfile('HeldIdentity');
  const post = await owner.post();
  await eventually(() => dbRead(f, 'SELECT reviewStatus FROM social_posts WHERE id=?', post.id)?.reviewStatus === 'approved');
  assert.equal((await owner.ok('/api/social/me')).reviewStage, 'held');
  assert.equal((await anonymous.request(`/api/social/profiles/${profile.handle}`)).status, 404);
  assert.equal((await anonymous.request(`/api/social/posts/${post.id}`)).status, 404);
  assert.equal((await anonymous.request(post.media[0].url)).status, 404);
  assert.equal((await owner.request(post.media[0].url)).status, 200);
});

test('an unavailable provider advertises no automatic screening and keeps public submissions held', async t => {
  let called = false;
  const f = await hybrid(t, undefined, { moderationProvider: { ready: false, videoReady: true, screen: async () => { called = true; return pass(); } } });
  const owner = f.client(), anonymous = f.client();
  assert.deepEqual(await anonymous.ok('/api/social/moderation-config'), {
    mode: 'hybrid', automaticScreening: false, automaticVideoScreening: false, provider: null,
  });
  await owner.publicProfile('UnconfiguredMaker');
  const post = await owner.post();
  assert.equal((await owner.ok(`/api/social/posts/${post.id}`)).post.reviewStage, 'held');
  assert.equal((await anonymous.request(`/api/social/posts/${post.id}`)).status, 404);
  assert.equal(called, false);
});

test('screening receives all submitted public text and media descriptions but no account or private crew content', async t => {
  const received = [];
  const f = await hybrid(t, async input => { received.push(input); return pass(); });
  const owner = f.client();
  await owner.signup('PayloadMaker');
  const crew = await owner.crew('PRIVATE-CREW-SENTINEL');
  await owner.project(crew.id, 'PRIVATE-PLAN-SENTINEL');
  await owner.ok('/api/social/me', 'PATCH', {
    visibility: 'public', handle: 'payloadmaker', displayName: 'PUBLIC-NAME', bio: 'PUBLIC-BIO',
    roles: ['PUBLIC-ROLE'], fandoms: ['PUBLIC-INTEREST'], city: 'PUBLIC-CITY',
    websiteUrl: 'https://example.test/public-website', instagramUrl: 'https://example.test/public-instagram',
  });
  await eventually(async () => (await owner.ok('/api/social/me')).reviewStatus === 'approved');
  const photo = await owner.upload();
  await publishedPost(f, owner, {
    mediaIds: [photo.id], mediaAlts: ['PUBLIC-ALT'], title: 'PUBLIC-TITLE', character: 'PUBLIC-CHARACTER',
    fandom: 'PUBLIC-FANDOM', body: 'PUBLIC-BODY', credits: [{ name: 'PUBLIC-CREDIT', role: 'PUBLIC-CREDIT-ROLE' }],
    opportunity: { role: 'PUBLIC-OPENING', city: 'PUBLIC-SHOOT-CITY', eventName: 'PUBLIC-EVENT', date: '2028-03-15' },
  });
  const text = received.map(input => input.text).join('\n');
  for (const expected of ['PUBLIC-NAME', 'payloadmaker', 'PUBLIC-BIO', 'PUBLIC-ROLE', 'PUBLIC-INTEREST', 'PUBLIC-CITY',
    'public-website', 'public-instagram', 'PUBLIC-ALT', 'PUBLIC-TITLE', 'PUBLIC-CHARACTER', 'PUBLIC-FANDOM',
    'PUBLIC-BODY', 'PUBLIC-CREDIT', 'PUBLIC-CREDIT-ROLE', 'PUBLIC-OPENING', 'PUBLIC-SHOOT-CITY', 'PUBLIC-EVENT', '2028-03-15'])
    assert.ok(text.includes(expected), `Missing public field: ${expected}`);
  for (const secret of ['payloadmaker@example.test', password, 'PRIVATE-CREW-SENTINEL', 'PRIVATE-PLAN-SENTINEL', '142 Secret Lane', '8259'])
    assert.ok(!JSON.stringify(received).includes(secret), `Private information sent for moderation: ${secret}`);
  assert.equal(received.find(input => input.type === 'post').media[0].kind, 'image');
});

test('private drafts and private profile edits never reach the screening provider', async t => {
  const received = [];
  const f = await hybrid(t, async input => { received.push(input); return pass(); });
  const owner = f.client(), stranger = f.client();
  await owner.signup('PrivateOnly');
  await owner.ok('/api/social/me', 'PATCH', { bio: 'PRIVATE-BIO', visibility: 'private' });
  const draft = await owner.post({ visibility: 'private', body: 'PRIVATE-DRAFT' });
  await owner.ok(`/api/social/posts/${draft.id}`, 'PATCH', { body: 'PRIVATE-DRAFT-EDIT' });
  // Several worker turns pass while an unrelated public item proves the worker is active.
  await approvedProfile(f.client(), 'WorkerWitness');
  assert.ok(received.every(input => !input.text.includes('PRIVATE-')));
  assert.equal(dbRead(f, 'SELECT count(*) AS n FROM social_moderation_jobs WHERE targetId=?', draft.id).n, 0);
  assert.equal((await stranger.request(`/api/social/posts/${draft.id}`)).status, 404);
  assert.equal((await owner.request(draft.media[0].url)).status, 200);
});

test('provider failures and malformed pass responses hold content instead of publishing it', async t => {
  const cases = [
    ['exception', () => { throw new Error('vendor unavailable'); }],
    ['missing-result', () => undefined],
    ['missing-codes', () => ({ decision: 'pass', provider: 'sightengine' })],
    ['invalid-codes', () => ({ decision: 'pass', codes: [false], provider: 'sightengine' })],
    ['wrong-provider', () => ({ decision: 'pass', codes: [], provider: 'unknown' })],
  ];
  for (const [label, result] of cases) await t.test(label, async tt => {
    const f = await hybrid(tt, async input => input.type === 'post' ? result() : pass());
    const owner = f.client(), anonymous = f.client();
    await approvedProfile(owner, 'FailureMaker');
    const post = await owner.post();
    await eventually(async () => (await owner.ok(`/api/social/posts/${post.id}`)).post.reviewStage === 'held');
    const ownPost = (await owner.ok(`/api/social/posts/${post.id}`)).post;
    assert.equal(ownPost.reviewStatus, 'pending');
    assert.ok(ownPost.reviewReason);
    assert.equal((await anonymous.request(`/api/social/posts/${post.id}`)).status, 404);
    assert.equal((await anonymous.request(post.media[0].url)).status, 404);
  });
});

test('editing during screening cannot apply the stale pass to revised content', async t => {
  const gate = deferred(), seen = [];
  const f = await hybrid(t, async input => {
    if (input.type !== 'post') return pass();
    seen.push(input.text);
    return input.text.includes('ORIGINAL-CAPTION') ? gate.promise : review();
  });
  const owner = f.client(), anonymous = f.client();
  await approvedProfile(owner, 'RevisionMaker');
  const post = await owner.post({ body: 'ORIGINAL-CAPTION' });
  await eventually(() => seen.length === 1);
  await owner.ok(`/api/social/posts/${post.id}`, 'PATCH', { body: 'REVISED-CAPTION-NEEDS-REVIEW' });
  gate.resolve(pass());
  await eventually(async () => (await owner.ok(`/api/social/posts/${post.id}`)).post.reviewStage === 'held');
  const ownPost = (await owner.ok(`/api/social/posts/${post.id}`)).post;
  assert.equal(ownPost.body, 'REVISED-CAPTION-NEEDS-REVIEW');
  assert.equal(ownPost.reviewStatus, 'pending');
  assert.equal((await anonymous.request(`/api/social/posts/${post.id}`)).status, 404);
  assert.equal(seen.length, 2, 'The revision received its own screening attempt');
});

test('unpublishing, deletion, suspension and operator removal win over an in-flight pass', async t => {
  for (const action of ['private-post', 'private-profile', 'delete-post', 'delete-account', 'suspend', 'operator-hide'])
    await t.test(action, async tt => {
      const gate = deferred();
      let entered = false, providerSignal;
      const f = await hybrid(tt, async (input, { signal }) => {
        if (input.type !== 'post') return pass();
        entered = true;
        providerSignal = signal;
        return gate.promise;
      });
      const owner = f.client(), anonymous = f.client();
      const profile = await approvedProfile(owner, 'RaceMaker');
      const post = await owner.post();
      await eventually(() => entered);
      if (action === 'private-post') await owner.ok(`/api/social/posts/${post.id}`, 'PATCH', { visibility: 'private' });
      if (action === 'private-profile') await owner.ok('/api/social/me', 'PATCH', { visibility: 'private' });
      if (action === 'delete-post') await owner.ok(`/api/social/posts/${post.id}`, 'DELETE');
      if (action === 'delete-account') {
        const preview = await owner.ok('/api/account/deletion-preview');
        await owner.ok('/api/account', 'DELETE', { password, confirmationToken: preview.confirmationToken });
      }
      // Existing CLI and dashboard operators share these persisted enforcement gates.
      if (action === 'suspend') dbWrite(f, 'UPDATE social_profiles SET suspendedAt=? WHERE userId=?', new Date().toISOString(), profile.userId);
      if (action === 'operator-hide') dbWrite(f, 'UPDATE social_posts SET moderatedAt=? WHERE id=?', new Date().toISOString(), post.id);
      await eventually(() => providerSignal?.aborted, `${action} did not stop further provider processing`);
      gate.resolve(pass());
      await eventually(() => {
        const job = dbRead(f, 'SELECT status FROM social_moderation_jobs WHERE targetType=? AND targetId=?', 'post', post.id);
        return !job || job.status === 'cancelled';
      }, `${action} did not cancel screening application`);
      assert.equal((await anonymous.request(`/api/social/posts/${post.id}`)).status, 404);
      assert.equal((await anonymous.request(post.media[0].url)).status, 404);
      assert.notEqual(dbRead(f, 'SELECT reviewStatus FROM social_posts WHERE id=?', post.id)?.reviewStatus, 'approved');
    });
});

test('restart recovers an interrupted queued submission without approving it blindly', async t => {
  const blocked = deferred();
  let postCalls = 0;
  const f = await hybrid(t, async input => {
    if (input.type !== 'post') return pass();
    postCalls++;
    return postCalls === 1 ? blocked.promise : pass();
  });
  const owner = f.client();
  await approvedProfile(owner, 'RestartMaker');
  const post = await owner.post();
  await eventually(() => postCalls === 1);
  await f.stop();
  assert.equal(dbRead(f, 'SELECT reviewStatus FROM social_posts WHERE id=?', post.id).reviewStatus, 'pending');
  await f.start();
  await eventually(async () => (await f.client().request(`/api/social/posts/${post.id}`)).status === 200);
  assert.equal(postCalls, 2, 'Restart rescreens the interrupted revision');
  blocked.resolve(pass());
});

test('editing a reported post cannot bypass its open report with a new automated pass', async t => {
  const f = await hybrid(t), owner = f.client(), reporter = f.client(), anonymous = f.client();
  await approvedProfile(owner, 'ReportedRevision');
  await reporter.signup('ReportedRevisionReader');
  const post = await publishedPost(f, owner);
  await reporter.ok('/api/social/reports', 'POST', { targetType: 'post', targetId: post.id, reason: 'harassment' });
  assert.equal((await anonymous.request(`/api/social/posts/${post.id}`)).status, 200, 'Reporting itself does not crowd-remove the post');
  await owner.ok(`/api/social/posts/${post.id}`, 'PATCH', { body: 'A revised caption after the concern.' });
  await eventually(async () => (await owner.ok(`/api/social/posts/${post.id}`)).post.reviewStage === 'held');
  assert.equal((await owner.ok(`/api/social/posts/${post.id}`)).post.reviewStatus, 'pending');
  assert.equal((await anonymous.request(`/api/social/posts/${post.id}`)).status, 404, 'A revision with an unresolved report requires operator review');
});

test('turning on hybrid mode does not publish or automatically submit legacy pending content', async t => {
  const received = [];
  const f = await fixture(t, { moderationPollMs: 10 });
  const owner = f.client(), anonymous = f.client();
  const profile = await owner.publicProfile('LegacyPending');
  const post = await owner.post();
  await f.stop();
  f.config.moderationMode = 'hybrid';
  f.config.moderationProvider = { ready: true, videoReady: true, screen: async input => { received.push(input); return pass(); } };
  await f.start();
  await approvedProfile(f.client(), 'FreshWitness');
  assert.ok(received.every(input => !input.text.includes('legacypending') && input.type !== 'post'));
  assert.equal((await owner.ok('/api/social/me')).reviewStatus, 'pending');
  assert.equal((await owner.ok(`/api/social/posts/${post.id}`)).post.reviewStatus, 'pending');
  assert.equal((await anonymous.request(`/api/social/profiles/${profile.handle}`)).status, 404);
  assert.equal((await anonymous.request(`/api/social/posts/${post.id}`)).status, 404);
});

test('reports are idempotent, hide posts, profiles and comments from their reporter, and do not crowd-delete content', async t => {
  const f = await hybrid(t), maker = f.client(), reporter = f.client(), commenter = f.client(), anonymous = f.client();
  const profile = await approvedProfile(maker, 'ReportMaker');
  await approvedProfile(reporter, 'ReportReader');
  await approvedProfile(commenter, 'CommentMaker');
  const post = await publishedPost(f, maker);
  const comment = await commenter.ok(`/api/social/posts/${post.id}/comments`, 'POST', { body: 'A sample comment for report handling.' });
  await eventually(async () => (await anonymous.ok(`/api/social/posts/${post.id}`)).comments.length === 1);
  for (let i = 0; i < 3; i++) await reporter.ok('/api/social/reports', 'POST', { targetType: 'comment', targetId: comment.id, reason: 'hate' });
  assert.equal((await reporter.ok(`/api/social/posts/${post.id}`)).comments.length, 0);
  assert.equal((await anonymous.ok(`/api/social/posts/${post.id}`)).comments.length, 1);
  for (let i = 0; i < 3; i++) await reporter.ok('/api/social/reports', 'POST', { targetType: 'post', targetId: post.id, reason: 'sexual-content' });
  assert.equal((await reporter.request(`/api/social/posts/${post.id}`)).status, 404);
  assert.equal((await reporter.request(post.media[0].url)).status, 404);
  for (let i = 0; i < 3; i++) await reporter.ok('/api/social/reports', 'POST', { targetType: 'profile', targetId: profile.userId, reason: 'child-safety' });
  assert.equal((await reporter.request(`/api/social/profiles/${profile.handle}`)).status, 404);
  assert.equal(dbRead(f, 'SELECT count(*) AS n FROM social_reports').n, 3, 'Repeated taps create one report per target and reporter');
  for (let i = 0; i < 4; i++) {
    const other = f.client();
    await other.signup(`OtherReporter${i}`);
    await other.ok('/api/social/reports', 'POST', { targetType: 'post', targetId: post.id, reason: 'threats' });
  }
  assert.equal((await anonymous.request(`/api/social/posts/${post.id}`)).status, 200, 'Raw report count does not remove work globally');
  assert.equal((await anonymous.request(`/api/social/profiles/${profile.handle}`)).status, 200);
  assert.equal(dbRead(f, 'SELECT moderatedAt FROM social_posts WHERE id=?', post.id).moderatedAt, null);
  await f.stop(); await f.start();
  assert.equal(dbRead(f, 'SELECT count(*) AS n FROM social_reports').n, 7, 'Reports survive restart');
});
