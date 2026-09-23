import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixture as socialFixture } from './social-fixture.mjs';
import { decideContent, inspectContent } from '../server/content-review.mjs';
import { createModerationAdmin } from '../server/moderation-admin.mjs';

function database(f, run) { const db = new DatabaseSync(f.config.dbPath); try { return run(db); } finally { db.close(); } }
async function fixture(t) {
  const f = await socialFixture(t), admin = f.client('web'), maker = f.client(), outsider = f.client(), anon = f.client();
  const operator = await admin.signup('RealOperator');
  const author = await maker.publicProfile('ReviewedMaker');
  await outsider.signup('AppleReview');
  database(f, db => db.prepare('UPDATE users SET email=? WHERE id=?').run('support@joincrewroom.com', outsider.state.token ? db.prepare("SELECT id FROM users WHERE name='AppleReview'").get().id : 'missing'));
  f.config.moderationOperatorIds = [operator.id]; await f.stop(); await f.start();
  return { ...f, admin, maker, outsider, anon, operator, author };
}
const route = item => `content/${item.type}/${item.id}`;
async function inspect(f, type, id) { return f.admin.ok(`/api/moderation/content/${type}/${id}`); }
async function decision(f, item, action, extra = {}) {
  return f.admin.request(`/api/moderation/${route(item)}/decision`, 'POST', { action, version: item.version, reason: 'Reviewed against the community rules.', textReviewed: true, ...extra });
}
function report(f, type, id, extra = {}) {
  const row = { id: `report_${Math.random().toString(36).slice(2)}`, targetType: type, targetId: id, reason: 'harassment', details: 'A report requiring a human decision.', ...extra };
  database(f, db => db.prepare(`INSERT INTO social_reports(id,reporterId,targetType,targetId,reason,details,status,createdAt) VALUES(?,?,?,?,?,?,'pending',?)`)
    .run(row.id, f.operator.id, type, id, row.reason, row.details, '2020-01-01T00:00:00.000Z'));
  return row;
}

test('moderation requires immutable operator IDs, protects every data/media route, and serves a data-free no-store shell', async t => {
  const f = await fixture(t), post = await f.maker.post(), item = await inspect(f, 'post', post.id);
  assert.equal((await f.admin.ok('/api/moderation/me')).allowed, true);
  assert.equal((await f.outsider.ok('/api/moderation/me')).allowed, false, 'support/review email has no operator privilege');
  assert.equal((await f.anon.ok('/api/moderation/me')).allowed, false);
  for (const client of [f.anon, f.outsider]) {
    for (const url of ['/api/moderation/queue', '/api/moderation/history', `/api/moderation/content/post/${post.id}`, item.media[0].url]) {
      const response = await client.request(url);
      assert.equal(response.status, client === f.anon ? 401 : 403, url);
      assert.match(response.headers.get('cache-control'), /no-store/);
    }
    assert.ok([401, 403].includes((await client.request(`/api/moderation/content/post/${post.id}/decision`, 'POST', { action: 'approve' })).status));
  }
  const shell = await f.anon.request('/moderation');
  assert.equal(shell.status, 200); assert.match(shell.headers.get('cache-control'), /no-store/);
  assert.match(shell.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(shell.body.toString().includes(f.author.userId), false);
  assert.equal(JSON.stringify(item).includes(f.config.mediaDir), false, 'no local paths leak');
  const media = await f.admin.request(item.media[0].url);
  assert.equal(media.status, 200); assert.match(media.headers.get('cache-control'), /no-store/);
  const changed = await f.admin.request(`/api/moderation/content/post/${post.id}/decision`, 'POST', {
    action: 'approve', version: item.version, reason: 'Reviewed.', textReviewed: true, imagesReviewed: true,
  }, { csrf: false });
  assert.equal(changed.status, 403);
  const wrongOrigin = await f.admin.request(`/api/moderation/content/post/${post.id}/decision`, 'POST', {}, { origin: 'https://evil.example' });
  assert.equal(wrongOrigin.status, 403);
  database(f, db => db.prepare('UPDATE users SET isDemo=1 WHERE id=?').run(f.operator.id));
  assert.equal((await f.admin.ok('/api/moderation/me')).allowed, false);
  assert.equal((await f.admin.request('/api/moderation/queue')).status, 403);
});

test('private drafts never enter operator inspection/media; queue prioritizes severe overdue reports and exposes safe screening context', async t => {
  const f = await fixture(t), publicPost = await f.maker.post(), draft = await f.maker.post({ visibility: 'private' });
  const item = await inspect(f, 'post', publicPost.id);
  assert.equal((await f.admin.request(`/api/moderation/content/post/${draft.id}`)).status, 404);
  assert.equal((await f.admin.request(`/api/moderation/media/post/${draft.id}/${draft.media[0].id}`)).status, 404);
  report(f, 'post', publicPost.id, { reason: 'child-safety' });
  const queue = await f.admin.ok('/api/moderation/queue');
  assert.equal(queue.items.some(value => value.id === draft.id), false);
  assert.equal(queue.reports[0].priority, 'urgent'); assert.equal(queue.reports[0].overdue, true);
  assert.equal(queue.items.find(value => value.id === publicPost.id).priority, 'urgent');
  assert.match(queue.policy, /not an Apple deadline/);
  // A report added after inspection invalidates an already-open approval form.
  assert.equal((await decision(f, item, 'approve', { imagesReviewed: true })).status, 409);
});

test('approvals require human checks, reject stale text/media, and transactionally audit each exact decision', async t => {
  const f = await fixture(t), post = await f.maker.post();
  let item = await inspect(f, 'post', post.id);
  assert.equal((await decision(f, item, 'approve', { textReviewed: false, imagesReviewed: true })).status, 400);
  assert.equal((await decision(f, item, 'approve')).status, 400);
  await f.maker.ok(`/api/social/posts/${post.id}`, 'PATCH', { body: 'Changed after the inspection.' });
  assert.equal((await decision(f, item, 'approve', { imagesReviewed: true })).status, 409);
  item = await inspect(f, 'post', post.id);
  const approved = await decision(f, item, 'approve', { imagesReviewed: true });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.inspection.reviewStatus, 'approved');
  const history = await f.admin.ok('/api/moderation/history');
  assert.equal(history.items.length, 1); assert.equal(history.items[0].actorId, f.operator.id);
  assert.equal(history.items[0].version, item.version); assert.equal(history.items[0].imagesReviewed, 1);
  assert.equal((await decision(f, item, 'approve', { imagesReviewed: true })).status, 409);
  // A synchronous audit failure rolls back the content mutation and legacy audit too.
  const next = await f.maker.post();
  database(f, db => {
    const current = inspectContent(db, 'post', next.id, f.config.mediaDir);
    assert.throws(() => decideContent(db, { type: 'post', id: next.id, version: current.version, mediaDir: f.config.mediaDir,
      action: 'approve', textReviewed: true, imagesReviewed: true, reason: 'Checked.', beforeCommit() { throw new Error('audit failure'); } }), /audit failure/);
    assert.equal(db.prepare('SELECT reviewStatus FROM social_posts WHERE id=?').get(next.id).reviewStatus, 'pending');
    assert.equal(db.prepare('SELECT count(*) n FROM social_content_reviews WHERE targetId=?').get(next.id).n, 0);
  });
});

test('takedown persists until explicit reviewed restoration; resolving reports never restores content', async t => {
  const f = await fixture(t), post = await f.maker.post();
  let item = await inspect(f, 'post', post.id);
  assert.equal((await decision(f, item, 'approve', { imagesReviewed: true })).status, 200);
  const complaint = report(f, 'post', post.id);
  item = await inspect(f, 'post', post.id);
  const removed = await decision(f, item, 'takedown');
  assert.equal(removed.status, 200); assert.ok(removed.body.inspection.content.moderatedAt);
  const resolved = await f.admin.ok(`/api/moderation/reports/${complaint.id}/resolve`, 'POST', { resolution: 'resolved', notes: 'Removed the violating post.' });
  assert.equal(resolved.status, 'resolved');
  const hidden = await inspect(f, 'post', post.id);
  assert.equal(hidden.reviewStatus, 'rejected'); assert.ok(hidden.content.moderatedAt);
  assert.equal((await decision(f, hidden, 'restore')).status, 400);
  const restored = await decision(f, hidden, 'restore', { imagesReviewed: true });
  assert.equal(restored.status, 200); assert.equal(restored.body.inspection.reviewStatus, 'approved');
  assert.equal(restored.body.inspection.content.moderatedAt, null);
  assert.equal((await f.admin.request(`/api/moderation/reports/${complaint.id}/resolve`, 'POST', { resolution: 'dismissed', notes: 'Already handled.' })).status, 409);
});

test('full video and posters are authenticated, support seeking, and need an explicit watch-and-listen assertion', async t => {
  const f = await fixture(t), post = await f.maker.post();
  const video = Buffer.from('test-video-content-for-range-authorization');
  database(f, db => {
    const media = db.prepare('SELECT m.* FROM social_media m JOIN social_post_media pm ON pm.mediaId=m.id WHERE pm.postId=?').get(post.id);
    writeFileSync(path.join(f.config.mediaDir, 'operator-fixture.mp4'), video);
    db.prepare("UPDATE social_media SET kind='video',filename='operator-fixture.mp4',duration=3,posterFilename=? WHERE id=?").run(media.filename, media.id);
  });
  const item = await inspect(f, 'post', post.id), media = item.media[0];
  assert.equal((await decision(f, item, 'approve', { imagesReviewed: true })).status, 400);
  const headers = { Cookie: f.admin.state.cookie, Range: 'bytes=2-8' };
  const response = await fetch(`${f.base}${media.url}`, { headers });
  assert.equal(response.status, 206); assert.deepEqual(Buffer.from(await response.arrayBuffer()), video.subarray(2, 9));
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await f.admin.request(media.posterUrl)).status, 200);
  assert.equal((await f.outsider.request(media.posterUrl)).status, 403);
  assert.equal((await decision(f, item, 'approve', { videosReviewed: true })).status, 200);
});

test('only operators can suspend/restore with a reason and fresh account version; suspension does not undo decisions', async t => {
  const f = await fixture(t), statusUrl = `/api/moderation/users/${f.author.userId}`;
  const current = await f.admin.ok(statusUrl);
  assert.equal((await f.outsider.request(`${statusUrl}/status`, 'POST', { suspended: true, version: current.version, reason: 'No authority.' })).status, 403);
  assert.equal((await f.admin.request(`${statusUrl}/status`, 'POST', { suspended: true, version: current.version, reason: '' })).status, 400);
  const suspended = await f.admin.ok(`${statusUrl}/status`, 'POST', { suspended: true, version: current.version, reason: 'Repeated harassment requires an account restriction.' });
  assert.equal(suspended.suspended, true);
  assert.equal((await f.admin.request(`${statusUrl}/status`, 'POST', { suspended: false, version: current.version, reason: 'Stale form.' })).status, 409);
  const restored = await f.admin.ok(`${statusUrl}/status`, 'POST', { suspended: false, version: suspended.version, reason: 'Appeal reviewed; restriction lifted.' });
  assert.equal(restored.suspended, false);
  assert.equal((await f.admin.request(`/api/moderation/users/${f.operator.id}/status`, 'POST', { suspended: true, version: 'anything', reason: 'Prevent self lockout.' })).status, 409);
  const history = await f.admin.ok('/api/moderation/history');
  assert.deepEqual(new Set(history.items.map(item => item.action)), new Set(['suspend', 'restore-account']));
});


test('operator session revocation during a slow request body prevents every privileged write', async t => {
  const f = await fixture(t), post = await f.maker.post(), item = await inspect(f, 'post', post.id);
  const db = new DatabaseSync(f.config.dbPath);
  try {
    const context = { user: db.prepare('SELECT * FROM users WHERE id=?').get(f.operator.id), session: db.prepare('SELECT * FROM sessions WHERE userId=?').get(f.operator.id) };
    const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
    const route = createModerationAdmin({ db, mediaDir: f.config.mediaDir, operatorIds: [f.operator.id], fail,
      mutation() {}, send() { throw new Error('Revoked request must not succeed.'); },
      async body() {
        db.prepare('DELETE FROM sessions WHERE userId=?').run(f.operator.id);
        return { action: 'approve', version: item.version, reason: 'Checked.', textReviewed: true, imagesReviewed: true };
      },
    });
    await assert.rejects(route({ method: 'POST' }, { setHeader() {} }, new URL(`http://localhost/api/moderation/content/post/${post.id}/decision`), context), error => error.status === 403);
    assert.equal(db.prepare('SELECT reviewStatus FROM social_posts WHERE id=?').get(post.id).reviewStatus, 'pending');
    assert.equal(db.prepare('SELECT count(*) count FROM social_moderation_audit').get().count, 0);
  } finally { db.close(); }
});

test('a refused automatic retry reports a conflict and leaves no successful retry audit', async t => {
  const f = await fixture(t), post = await f.maker.post(), item = await inspect(f, 'post', post.id);
  const db = new DatabaseSync(f.config.dbPath);
  try {
    const context = { user: db.prepare('SELECT * FROM users WHERE id=?').get(f.operator.id), session: db.prepare('SELECT * FROM sessions WHERE userId=?').get(f.operator.id) };
    const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
    const route = createModerationAdmin({ db, mediaDir: f.config.mediaDir, operatorIds: [f.operator.id], fail,
      mutation() {}, send() { throw new Error('A refused retry must not succeed.'); },
      body: async () => ({ version: item.version, reason: 'Service recovered.' }), retryScreening: () => false,
    });
    await assert.rejects(route({ method: 'POST' }, { setHeader() {} }, new URL(`http://localhost/api/moderation/content/post/${post.id}/retry`), context), error => error.status === 409);
    assert.equal(db.prepare('SELECT count(*) count FROM social_moderation_audit').get().count, 0);
  } finally { db.close(); }
});


test('screening context matches the inspected content version and in-flight work cannot be retried', async t => {
  const f = await fixture(t), post = await f.maker.post();
  const db = new DatabaseSync(f.config.dbPath);
  try {
    const current = inspectContent(db, 'post', post.id, f.config.mediaDir);
    const insertEvent = db.prepare('INSERT INTO social_screening_events(id,targetType,targetId,version,decision,provider,codes,createdAt) VALUES(?,?,?,?,?,?,?,?)');
    insertEvent.run('current-event', 'post', post.id, current.version, 'review', 'sightengine', JSON.stringify(['provider-unavailable']), '2025-01-01T00:00:00.000Z');
    insertEvent.run('stale-event', 'post', post.id, '0'.repeat(64), 'review', 'sightengine', JSON.stringify(['old-content-flag']), '2026-01-01T00:00:00.000Z');
    const context = { user: db.prepare('SELECT * FROM users WHERE id=?').get(f.operator.id), session: db.prepare('SELECT * FROM sessions WHERE userId=?').get(f.operator.id) };
    const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
    let response, payload, enqueued = 0;
    const handler = createModerationAdmin({ db, mediaDir: f.config.mediaDir, operatorIds: [f.operator.id], fail,
      mutation() {}, send(_res, _status, data) { response = data; }, body: async () => payload,
      retryScreening() { enqueued += 1; return true; },
    });
    const res = { setHeader() {} }, base = `http://localhost/api/moderation/content/post/${post.id}`;
    await handler({ method: 'GET' }, res, new URL(base), context);
    assert.deepEqual(response.screening.codes, ['provider-unavailable'], 'newer events for a different version are ignored');
    for (const stage of ['queued', 'checking']) {
      db.prepare('UPDATE social_posts SET reviewStage=? WHERE id=?').run(stage, post.id);
      await handler({ method: 'GET' }, res, new URL(base), context);
      assert.equal(response.retryAvailable, false, stage);
      payload = { version: response.version, reason: 'Try again.' };
      await assert.rejects(handler({ method: 'POST' }, res, new URL(`${base}/retry`), context), error => error.status === 409 && /already queued/.test(error.message));
    }
    assert.equal(enqueued, 0);
    db.prepare("UPDATE social_posts SET body='Edited public text',reviewStage='held' WHERE id=?").run(post.id);
    await handler({ method: 'GET' }, res, new URL(base), context);
    assert.equal(response.screening, null, 'an edited submission must not inherit the previous version’s screening result');
    assert.equal(response.retryAvailable, true);
    assert.equal(db.prepare('SELECT count(*) count FROM social_moderation_audit').get().count, 0);
  } finally { db.close(); }
});
