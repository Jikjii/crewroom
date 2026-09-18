import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './social-fixture.mjs';
import { contentReviewQueue, decideContent, reviewPacketHTML } from '../server/content-review.mjs';

function decide(f, type, id, extra) {
  const db = new DatabaseSync(f.config.dbPath);
  try { return decideContent(db, { type, id, version: f.inspect(type, id).version, decision: 'approved', mediaDir: f.config.mediaDir, ...extra }); }
  finally { db.close(); }
}

test('public text and images stay hidden until both profile and post are reviewed; private drafts bypass the queue', async t => {
  const f = await fixture(t), owner = f.client(), stranger = f.client();
  const profile = await owner.publicProfile('QueuedMaker');
  assert.equal(profile.reviewStatus, 'pending');
  const media = await owner.upload();
  const post = await owner.post({ mediaIds: [media.id], reviewStatus: 'approved' });
  assert.equal(post.reviewStatus, 'pending', 'client cannot grant approval');
  assert.equal((await stranger.request(`/api/social/profiles/${profile.handle}`)).status, 404);
  assert.equal((await stranger.request(`/api/social/posts/${post.id}`)).status, 404);
  assert.equal((await stranger.request(media.url)).status, 404);
  assert.equal((await owner.request(media.url)).status, 200);
  const inspected = f.inspect('post', post.id);
  const packet = reviewPacketHTML({ ...inspected, content: { title: '<script>alert(1)</script>' } });
  assert.ok(packet.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!packet.includes('<script>'));
  assert.ok(packet.includes("default-src 'none'"));
  assert.ok(packet.includes('data:image/jpeg;base64,'));
  assert.throws(() => decide(f, 'post', post.id), /every image/);
  f.approve('post', post.id);
  assert.equal((await stranger.request(`/api/social/posts/${post.id}`)).status, 404, 'profile still pending');
  f.approve('profile', profile.userId);
  assert.equal((await stranger.request(`/api/social/profiles/${profile.handle}`)).status, 200);
  assert.equal((await stranger.request(`/api/social/posts/${post.id}`)).status, 200);
  assert.equal((await stranger.request(media.url)).status, 200);
  const draft = await owner.post({ visibility: 'private' });
  const db = new DatabaseSync(f.config.dbPath);
  try { assert.equal(contentReviewQueue(db).some(item => item.id === draft.id), false); }
  finally { db.close(); }
  assert.equal((await stranger.request(`/api/social/posts/${draft.id}`)).status, 404);
});

test('upgrading a pre-review database queues existing public work while preserving private data and images', async t => {
  const f = await fixture(t), owner = f.client(), anon = f.client();
  const profile = await owner.publicProfile('LegacyMaker'); f.approve('profile', profile.userId);
  const media = await owner.upload();
  const post = await owner.post({ mediaIds: [media.id] }); f.approve('post', post.id);
  const draft = await owner.post({ visibility: 'private' });
  await f.stop();
  const db = new DatabaseSync(f.config.dbPath);
  try {
    for (const table of ['social_profiles', 'social_posts', 'social_comments']) {
      for (const column of ['reviewStatus', 'reviewReason', 'reviewedAt']) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
    db.exec('DROP TABLE social_content_reviews; ALTER TABLE social_notifications DROP COLUMN commentId');
  } finally { db.close(); }
  await f.start();
  assert.equal((await owner.ok('/api/social/me')).reviewStatus, 'pending');
  assert.equal((await owner.ok(`/api/social/posts/${post.id}`)).post.reviewStatus, 'pending');
  assert.equal((await anon.request(`/api/social/posts/${post.id}`)).status, 404);
  assert.equal((await owner.request(media.url)).status, 200);
  assert.equal((await owner.ok(`/api/social/posts/${draft.id}`)).post.visibility, 'private');
  const upgraded = new DatabaseSync(f.config.dbPath);
  try {
    assert.equal(upgraded.prepare("SELECT count(*) AS n FROM social_posts WHERE isExample=1 AND reviewStatus='approved'").get().n, 3);
    assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { upgraded.close(); }
});

test('edits revoke visibility and stale approval; rejection reasons remain owner-only and resubmission clears them', async t => {
  const f = await fixture(t), owner = f.client(), stranger = f.client();
  const profile = await owner.publicProfile('RevisedMaker'); f.approve('profile', profile.userId);
  const post = await owner.post(); const oldVersion = f.inspect('post', post.id).version;
  f.approve('post', post.id);
  await owner.ok(`/api/social/posts/${post.id}`, 'PATCH', { title: 'New caption awaiting review' });
  assert.equal((await stranger.request(`/api/social/posts/${post.id}`)).status, 404);
  assert.throws(() => decide(f, 'post', post.id, { version: oldVersion, imagesReviewed: true }), /changed since inspection/);
  decide(f, 'post', post.id, { decision: 'rejected', reason: 'Remove the visible private address.' });
  const own = await owner.ok(`/api/social/posts/${post.id}`);
  assert.equal(own.post.reviewStatus, 'rejected');
  assert.match(own.post.reviewReason, /private address/);
  assert.equal((await stranger.request(`/api/social/posts/${post.id}`)).status, 404);
  const resubmitted = await owner.ok(`/api/social/posts/${post.id}`, 'PATCH', { title: 'Address removed' });
  assert.equal(resubmitted.reviewStatus, 'pending');
  assert.equal(resubmitted.reviewReason, undefined);
  f.approve('post', post.id);
  await owner.ok('/api/social/me', 'PATCH', { displayName: 'New name under review' });
  assert.equal((await stranger.request(`/api/social/posts/${post.id}`)).status, 404);
  await f.stop(); await f.start();
  assert.equal((await owner.ok('/api/social/me')).reviewStatus, 'pending');
  assert.equal((await stranger.request(`/api/social/posts/${post.id}`)).status, 404);
});

test('pending comments do not leak through counts or notifications and approved comments retain deletion safety', async t => {
  const f = await fixture(t), author = f.client(), commenter = f.client();
  const a = await author.publicProfile('CommentHost'), b = await commenter.publicProfile('CommentGuest');
  f.approve('profile', a.userId); f.approve('profile', b.userId);
  const post = await author.post(); f.approve('post', post.id);
  const comment = await commenter.ok(`/api/social/posts/${post.id}/comments`, 'POST', { body: 'This needs human review first.' });
  assert.equal(comment.reviewStatus, 'pending');
  let hostView = await author.ok(`/api/social/posts/${post.id}`);
  assert.equal(hostView.comments.length, 0); assert.equal(hostView.post.commentCount, 0);
  assert.equal((await author.ok('/api/social/notifications')).length, 0);
  assert.equal((await commenter.ok(`/api/social/posts/${post.id}`)).comments[0].reviewStatus, 'pending');
  f.approve('comment', comment.id);
  hostView = await author.ok(`/api/social/posts/${post.id}`);
  assert.equal(hostView.comments.length, 1);
  assert.equal((await author.ok('/api/social/notifications')).filter(n => n.type === 'comment').length, 1);
  await commenter.ok(`/api/social/comments/${comment.id}`, 'DELETE');
  assert.equal((await author.ok('/api/social/notifications')).filter(n => n.type === 'comment').length, 0);
});
