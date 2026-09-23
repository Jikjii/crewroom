import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, password } from './social-fixture.mjs';
import { decideContent, inspectContent, reviewPacketHTML } from '../server/content-review.mjs';
import { createBackup } from '../scripts/backup.mjs';

function database(f, run) {
  const db = new DatabaseSync(f.config.dbPath);
  try { return run(db); } finally { db.close(); }
}
async function eventually(check) {
  const until = Date.now() + 4000;
  do { if (await check()) return; await delay(15); } while (Date.now() < until);
  assert.fail('Expected asynchronous moderation result');
}
const pass = () => ({ decision: 'pass', codes: [], provider: 'sightengine' });

test('profile photos add, replace and remove; old clients preserve photos and detached bytes are reclaimed', async t => {
  const f = await fixture(t), owner = f.client(), anon = f.client();
  const user = await owner.signup('PhotoMaker');
  assert.equal((await owner.ok('/api/social/me')).avatar, null);
  const first = await owner.upload();
  const file = database(f, db => db.prepare('SELECT filename FROM social_media WHERE id=?').get(first.id).filename);
  let profile = await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: first.id });
  assert.equal(profile.avatar.id, first.id);
  assert.equal((await owner.request(first.url)).status, 200);
  assert.equal((await anon.request(first.url)).status, 404, 'Private profile photo is never public');
  profile = await owner.ok('/api/social/me', 'PATCH', { bio: 'An older client edit without an avatar field.' });
  assert.equal(profile.avatar.id, first.id);
  assert.equal((await owner.ok('/api/social/export')).profile.avatar.id, first.id);
  await f.stop(); await f.start();
  assert.equal((await owner.ok('/api/social/me')).avatar.id, first.id, 'Photo survives app/server restart');
  const second = await owner.upload();
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: second.id });
  assert.equal((await owner.request(first.url)).status, 404);
  assert.equal(existsSync(path.join(f.config.mediaDir, file)), false);
  assert.equal(database(f, db => db.prepare('SELECT avatarMediaId FROM social_profiles WHERE userId=?').get(user.id).avatarMediaId), second.id);
  assert.equal((await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: null })).avatar, null);
  assert.equal((await owner.request(second.url)).status, 404);
  assert.equal(database(f, db => db.prepare('SELECT count(*) n FROM social_file_deletions').get().n), 0);
});

test('profile photo ownership, image type and staged-media deletion enforce authorization and references', async t => {
  const f = await fixture(t), owner = f.client(), stranger = f.client(), anon = f.client();
  await owner.signup('PhotoOwner'); await stranger.signup('PhotoStranger');
  const first = await owner.upload(), video = await owner.upload();
  database(f, db => db.prepare("UPDATE social_media SET kind='video' WHERE id=?").run(video.id));
  for (const value of [first.id, video.id]) assert.equal((await stranger.request('/api/social/me', 'PATCH', { avatarMediaId: value })).status, 400);
  for (const value of [video.id, '', false, {}, 'example_media_sky']) assert.equal((await owner.request('/api/social/me', 'PATCH', { avatarMediaId: value })).status, 400);
  assert.equal((await anon.request(first.url, 'DELETE')).status, 401);
  assert.equal((await stranger.request(first.url, 'DELETE')).status, 404);
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: first.id });
  assert.equal((await owner.request(first.url, 'DELETE')).status, 409);
  const post = await owner.post({ visibility: 'private', mediaIds: [first.id] });
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: null });
  assert.equal((await owner.request(first.url)).status, 200, 'Removing an avatar preserves its photo in a post');
  assert.equal((await owner.request(first.url, 'DELETE')).status, 409);
  assert.equal((await owner.ok(`/api/social/posts/${post.id}`)).post.media[0].id, first.id);
  const abandoned = await owner.upload();
  assert.deepEqual(await owner.ok(abandoned.url, 'DELETE'), { ok: true });
  assert.equal((await owner.request(abandoned.url)).status, 404);
  const webOwner = f.client('web');
  await webOwner.signup('CookiePhoto');
  const staged = await webOwner.upload();
  assert.equal((await webOwner.request(staged.url, 'DELETE', undefined, { csrf: false })).status, 403);
  assert.equal((await webOwner.request(staged.url, 'DELETE')).status, 200);
});

test('profile-photo approval binds image bytes; public avatars respect review, reports, blocks, privacy and suspension', async t => {
  const f = await fixture(t), owner = f.client(), guest = f.client(), reporter = f.client(), anon = f.client();
  const profile = await owner.publicProfile('PortraitMaker');
  await guest.signup('PortraitGuest'); await reporter.signup('PortraitReporter');
  const photo = await owner.upload();
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: photo.id });
  const inspected = f.inspect('profile', profile.userId);
  assert.equal(inspected.media[0].id, photo.id);
  assert.ok(reviewPacketHTML(inspected).includes('data:image/jpeg;base64,'));
  database(f, db => assert.throws(() => decideContent(db, { type: 'profile', id: profile.userId, version: inspected.version,
    decision: 'approved', mediaDir: f.config.mediaDir }), /every image/));
  assert.equal((await fetch(`${f.base}${photo.url}`, { method: 'HEAD' })).status, 404);
  f.approve('profile', profile.userId);
  const visible = await anon.ok(`/api/social/profiles/${profile.handle}`);
  assert.equal(visible.profile.avatar.id, photo.id);
  const publicImage = await anon.request(photo.url);
  assert.equal(publicImage.status, 200); assert.match(publicImage.headers.get('cache-control'), /no-store/);
  await guest.ok('/api/social/blocks', 'POST', { userId: profile.userId });
  assert.equal((await guest.request(photo.url)).status, 404);
  assert.equal((await guest.ok('/api/social/blocks'))[0].avatar, null);
  await reporter.ok('/api/social/reports', 'POST', { targetType: 'profile', targetId: profile.userId, reason: 'other' });
  assert.equal((await reporter.request(photo.url)).status, 404);
  assert.equal((await anon.request(photo.url)).status, 200, 'Reporting only hides from the reporter until moderator action');
  database(f, db => db.prepare('UPDATE social_profiles SET suspendedAt=? WHERE userId=?').run(new Date().toISOString(), profile.userId));
  assert.equal((await anon.request(photo.url)).status, 404);
  assert.equal((await owner.request(photo.url)).status, 200);
  database(f, db => db.prepare('UPDATE social_profiles SET suspendedAt=NULL WHERE userId=?').run(profile.userId));
  await owner.ok('/api/social/me', 'PATCH', { visibility: 'private' });
  assert.equal((await anon.request(photo.url)).status, 404);
  await owner.ok('/api/social/me', 'PATCH', { visibility: 'public' });
  const beforeBytes = f.inspect('profile', profile.userId);
  writeFileSync(beforeBytes.media[0].file, Buffer.concat([readFileSync(beforeBytes.media[0].file), Buffer.from('changed')]));
  database(f, db => assert.throws(() => decideContent(db, { type: 'profile', id: profile.userId, version: beforeBytes.version,
    decision: 'approved', imagesReviewed: true, mediaDir: f.config.mediaDir }), /changed since inspection/));
});

test('public profile-photo edits revoke public access and stale approvals; shared post references remain safe', async t => {
  const f = await fixture(t), owner = f.client(), anon = f.client();
  const profile = await owner.publicProfile('ChangingPortrait');
  const first = await owner.upload();
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: first.id });
  f.approve('profile', profile.userId);
  const post = await owner.post({ mediaIds: [first.id] }); f.approve('post', post.id);
  const before = f.inspect('profile', profile.userId);
  const second = await owner.upload();
  assert.equal((await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: second.id })).reviewStatus, 'pending');
  assert.equal((await anon.request(first.url)).status, 404, 'Even the shared post requires the newly edited profile to pass');
  assert.equal((await anon.request(second.url)).status, 404);
  database(f, db => assert.throws(() => decideContent(db, { type: 'profile', id: profile.userId, version: before.version,
    decision: 'approved', imagesReviewed: true, mediaDir: f.config.mediaDir }), /changed since inspection/));
  f.approve('profile', profile.userId);
  assert.equal((await anon.request(first.url)).status, 200, 'Previously approved post retains its attached bytes');
  assert.equal((await anon.request(second.url)).status, 200);
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: null });
  assert.equal((await owner.request(second.url)).status, 404);
  f.approve('profile', profile.userId);
  assert.equal((await anon.request(first.url)).status, 200);
});

test('hybrid moderation screens only the submitted public avatar and cannot publish a stale photo decision', async t => {
  const received = [], checks = [];
  const f = await fixture(t, { moderationMode: 'hybrid', moderationPollMs: 10, moderationProvider: {
    ready: true, screen: async input => {
      received.push(input);
      if (!input.media.length) return pass();
      return new Promise(resolve => checks.push(resolve));
    },
  } });
  const owner = f.client(), anon = f.client();
  const user = await owner.signup('ScreenedPortrait');
  const privatePhoto = await owner.upload();
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: privatePhoto.id });
  const witness = f.client(); await witness.publicProfile('ScreeningWitness');
  await eventually(async () => (await witness.ok('/api/social/me')).reviewStatus === 'approved');
  assert.ok(received.every(input => input.media.length === 0), 'Private profile photos never reach the provider');
  await owner.ok('/api/social/me', 'PATCH', { visibility: 'public' });
  await eventually(() => checks.length === 1);
  assert.equal(received.at(-1).media[0].kind, 'image');
  assert.equal(received.at(-1).media[0].file, f.inspect('profile', user.id).media[0].file);
  const replacement = await owner.upload();
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: replacement.id });
  checks[0](pass());
  await eventually(() => checks.length === 2);
  assert.equal((await anon.request(replacement.url)).status, 404, 'Passing an obsolete photo does not publish its replacement');
  checks[1]({ decision: 'review', codes: ['needs-human-review'], provider: 'sightengine' });
  await eventually(async () => (await owner.ok('/api/social/me')).reviewStage === 'held');
  assert.equal((await anon.request(replacement.url)).status, 404);
  f.approve('profile', user.id);
  assert.equal((await anon.request(replacement.url)).status, 200);
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: null });
  await eventually(async () => (await owner.ok('/api/social/me')).reviewStatus === 'approved');
  assert.equal((await anon.request(replacement.url)).status, 404);
});

test('hybrid passing profile photos publish automatically and pending removal cancels the former photo check', async t => {
  let held;
  const f = await fixture(t, { moderationMode: 'hybrid', moderationPollMs: 10, moderationProvider: {
    ready: true, screen: async input => held && input.media.length ? held.promise : pass(),
  } });
  const owner = f.client(), anon = f.client();
  await owner.signup('PassingPortrait');
  const first = await owner.upload();
  await owner.ok('/api/social/me', 'PATCH', { visibility: 'public', avatarMediaId: first.id });
  await eventually(async () => (await anon.request(first.url)).status === 200);
  let resolve;
  held = { promise: new Promise(done => { resolve = done; }) };
  const second = await owner.upload();
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: second.id });
  await eventually(async () => (await owner.ok('/api/social/me')).reviewStage === 'checking');
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: null });
  resolve(pass());
  await eventually(async () => (await owner.ok('/api/social/me')).reviewStatus === 'approved');
  assert.equal((await owner.ok('/api/social/me')).avatar, null);
  assert.equal((await anon.request(second.url)).status, 404);
});

test('moderator desk authorizes the current profile image, requires image review, and revokes old/private image URLs', async t => {
  const f = await fixture(t), operator = f.client('web'), owner = f.client(), outsider = f.client();
  const admin = await operator.signup('PortraitOperator');
  const profile = await owner.publicProfile('DeskPortrait');
  await outsider.signup('PortraitOutsider');
  const first = await owner.upload();
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: first.id });
  f.config.moderationOperatorIds = [admin.id]; await f.stop(); await f.start();
  const route = `/api/moderation/content/profile/${profile.userId}`;
  const item = await operator.ok(route), media = item.media[0];
  assert.equal(media.id, first.id); assert.equal(media.file, undefined);
  assert.equal((await operator.request(media.url)).status, 200);
  assert.equal((await outsider.request(media.url)).status, 403);
  assert.equal((await f.client().request(media.url)).status, 401);
  const decision = { version: item.version, action: 'approve', textReviewed: true, reason: 'Profile text and photo meet the rules.' };
  assert.equal((await operator.request(`${route}/decision`, 'POST', decision)).status, 400);
  assert.equal((await operator.request(`${route}/decision`, 'POST', { ...decision, imagesReviewed: true })).status, 200);
  const second = await owner.upload();
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: second.id });
  assert.equal((await operator.request(media.url)).status, 404);
  const replacement = await operator.ok(route);
  await owner.ok('/api/social/me', 'PATCH', { visibility: 'private' });
  assert.equal((await operator.request(replacement.media[0].url)).status, 404, 'Moderators cannot fetch a withdrawn private avatar');
});

test('avatar migration preserves legacy profiles, backup includes photos, and account deletion removes references and bytes', async t => {
  const f = await fixture(t), owner = f.client(), anon = f.client();
  const profile = await owner.publicProfile('DurablePortrait'); f.approve('profile', profile.userId);
  await f.stop();
  database(f, db => db.exec('DROP INDEX social_profiles_avatar; ALTER TABLE social_profiles DROP COLUMN avatarMediaId'));
  await f.start();
  assert.equal((await owner.ok('/api/social/me')).avatar, null);
  assert.equal((await anon.request(`/api/social/profiles/${profile.handle}`)).status, 200);
  const photo = await owner.upload();
  await owner.ok('/api/social/me', 'PATCH', { avatarMediaId: photo.id });
  f.approve('profile', profile.userId);
  const filename = database(f, db => db.prepare('SELECT filename FROM social_media WHERE id=?').get(photo.id).filename);
  const destination = path.join(f.directory, 'backup');
  const manifest = await createBackup({ dbPath: f.config.dbPath, mediaDir: f.config.mediaDir, destination });
  assert.ok(manifest.media.some(media => media.filename === filename));
  const snapshot = new DatabaseSync(path.join(destination, 'crewroom.sqlite'), { readOnly: true });
  try {
    assert.equal(snapshot.prepare('SELECT avatarMediaId FROM social_profiles WHERE userId=?').get(profile.userId).avatarMediaId, photo.id);
    assert.deepEqual(snapshot.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { snapshot.close(); }
  const preview = await owner.ok('/api/account/deletion-preview');
  await owner.ok('/api/account', 'DELETE', { password, confirmationToken: preview.confirmationToken });
  assert.equal((await anon.request(photo.url)).status, 404);
  assert.equal(existsSync(path.join(f.config.mediaDir, filename)), false);
  database(f, db => assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []));
});

test('avatar migration preserves queued and interrupted legacy profile screening fingerprints', async t => {
  for (const status of ['queued', 'checking']) await t.test(status, async tt => {
    const screened = [];
    const f = await fixture(tt, { moderationMode: 'hybrid', moderationPollMs: 60_000, moderationProvider: {
      ready: true, screen: async input => { screened.push(input); return pass(); },
    } });
    const owner = f.client(), profile = await owner.publicProfile('LegacyPortrait');
    await f.stop();
    const legacyVersion = database(f, db => {
      db.exec('DROP INDEX social_profiles_avatar; ALTER TABLE social_profiles DROP COLUMN avatarMediaId');
      const inspection = inspectContent(db, 'profile', profile.userId, f.config.mediaDir);
      assert.equal(Object.hasOwn(inspection.content, 'avatarMediaId'), false);
      db.prepare('UPDATE social_moderation_jobs SET version=?,status=? WHERE targetType=? AND targetId=?')
        .run(inspection.version, status, 'profile', profile.userId);
      db.prepare('UPDATE social_profiles SET reviewStage=? WHERE userId=?').run(status, profile.userId);
      return inspection.version;
    });
    f.config.moderationPollMs = 10;
    await f.start();
    const migrated = f.inspect('profile', profile.userId);
    assert.equal(migrated.content.avatarMediaId, null, 'Response retains the additive schema field');
    assert.equal(migrated.version, legacyVersion, 'Migration does not change the submitted content');
    await eventually(async () => (await owner.ok('/api/social/me')).reviewStatus === 'approved');
    assert.equal(screened.length, 1, 'The existing job finishes without a user retry');
    assert.deepEqual(screened[0].media, []);
    const completed = database(f, db => db.prepare("SELECT version,status FROM social_moderation_jobs WHERE targetType='profile' AND targetId=?").get(profile.userId));
    assert.equal(completed.version, legacyVersion);
    assert.equal(completed.status, 'passed');
  });
});
