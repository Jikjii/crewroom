import path from 'node:path';
import { unlink } from 'node:fs/promises';

const GENERIC_RESET = { ok: true, message: 'If an eligible account uses that email, a password reset link will be sent.' };
const POLICY_DEFAULT = 'beta-1';

function validOrigin(value, httpsOnly = false) {
  try { const url = new URL(value); return url.origin === value && (httpsOnly ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol)); } catch { return false; }
}
function httpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}

/** Constructing this adapter never sends mail. Delivery happens only when called. */
export function createResendSender({ apiKey, from, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey || !from) return undefined;
  if (typeof apiKey !== 'string' || typeof from !== 'string' || /[\r\n]/.test(from)) throw new Error('Invalid mail configuration.');
  return async ({ to, subject, text, html }) => {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Mail delivery failed.');
  };
}

/** Deployment tooling may fail closed on this result without exposing credentials. */
export function releaseReadiness({ production = false, appOrigin, secureCookies = false, mailSender, operatorName = '', supportEmail = '', minimumAge = 18, privacyPolicyUrl = appOrigin ? `${appOrigin}/privacy` : '', termsUrl = appOrigin ? `${appOrigin}/terms` : '', policyVersion = POLICY_DEFAULT, requirePolicyAcceptance = production, policiesApproved = false } = {}) {
  const resetAvailable = typeof mailSender === 'function' && validOrigin(appOrigin, production);
  const issues = [];
  const warnings = [];
  if (production) {
    if (!validOrigin(appOrigin, true)) issues.push('APP_ORIGIN must be an exact HTTPS origin.');
    if (!secureCookies) issues.push('Production session cookies must be Secure.');
    if (!operatorName.trim()) issues.push('An operator name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) issues.push('A valid support email is required.');
    if (!httpsUrl(privacyPolicyUrl) || !httpsUrl(termsUrl)) issues.push('HTTPS privacy and terms URLs are required.');
    if (!Number.isInteger(minimumAge) || minimumAge < 13 || minimumAge > 99) issues.push('MINIMUM_AGE must be an integer between 13 and 99.');
    if (!requirePolicyAcceptance || !policyVersion.trim()) issues.push('Versioned signup policy acceptance is required.');
    if (!policiesApproved) issues.push('The operator must approve the published policies before production.');
    if (!resetAvailable) warnings.push('Password reset is disabled until mail delivery is configured.');
  }
  return { ready: issues.length === 0, issues, warnings, resetAvailable };
}

export function createAccounts({ db, get, all, run, insert, transaction, id, stamp, now, fail, string, send, body, mutation, limited, cookie,
  derive, digest, secret, timingSafeEqual, mediaDir, appOrigin, logger = console,
  production = false, secureCookies = false, mailSender, operatorName = '', supportEmail = '', minimumAge = 18,
  privacyPolicyUrl = '', termsUrl = '', policyVersion = POLICY_DEFAULT, requirePolicyAcceptance = production,
  policiesApproved = false,
  resetTokenTtlMs = 30 * 60_000,
  onAccountDeleted,
}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_password_resets (
      tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, usedAt INTEGER
    );
    CREATE INDEX IF NOT EXISTS account_resets_user ON account_password_resets(userId);
    CREATE TABLE IF NOT EXISTS account_reset_limits (emailHash TEXT PRIMARY KEY, windowStart INTEGER NOT NULL, count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_policy_acceptances (
      userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, policyVersion TEXT NOT NULL, minimumAge INTEGER NOT NULL, acceptedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_file_deletions (filename TEXT PRIMARY KEY, createdAt TEXT NOT NULL);
  `);
  const { resetAvailable } = releaseReadiness({ production, appOrigin, secureCookies, mailSender, operatorName, supportEmail, minimumAge, privacyPolicyUrl, termsUrl, policyVersion, requirePolicyAcceptance, policiesApproved });
  const publicConfig = { resetAvailable, operator: operatorName, supportEmail, minimumAge, privacyPolicyUrl, termsUrl, requirePolicyAcceptance, policyVersion };

  function requirePassword(value) {
    if (typeof value !== 'string' || value.length < 10 || value.length > 1024) fail(400, 'Password must contain 10–1024 characters.');
    return value;
  }
  function validatePolicy(data) {
    if (requirePolicyAcceptance && (data.policyAccepted !== true || data.ageConfirmed !== true || data.policyVersion !== policyVersion))
      fail(400, `Confirm you are at least ${minimumAge} and accept the current privacy policy and terms.`);
  }
  function recordPolicy(userId, data) {
    if (data.policyAccepted === true && data.ageConfirmed === true && data.policyVersion === policyVersion)
      run('INSERT INTO account_policy_acceptances(userId,policyVersion,minimumAge,acceptedAt) VALUES(?,?,?,?) ON CONFLICT(userId) DO UPDATE SET policyVersion=excluded.policyVersion,minimumAge=excluded.minimumAge,acceptedAt=excluded.acceptedAt', userId, policyVersion, minimumAge, stamp());
  }
  function deletionPreview(user) {
    const ownedCrews = all('SELECT id,name FROM crews WHERE ownerId=? ORDER BY createdAt,id', user.id).map(crew => {
      const successor = get(`SELECT m.userId,u.name FROM members m JOIN users u ON u.id=m.userId
        LEFT JOIN social_profiles p ON p.userId=u.id
        WHERE m.crewId=? AND m.userId<>? AND u.isDemo=0 AND COALESCE(p.isExample,0)=0
        ORDER BY CASE WHEN m.joinedAt IS NULL THEN 0 ELSE 1 END,m.joinedAt,m.rowid LIMIT 1`, crew.id, user.id);
      return { id: crew.id, name: crew.name, action: successor ? 'transfer' : 'delete', successor: successor ? { userId: successor.userId, name: successor.name } : null };
    });
    const solo = new Set(ownedCrews.filter(crew => crew.action === 'delete').map(crew => crew.id));
    const preview = {
      ownedCrews,
      counts: {
        posts: get('SELECT COUNT(*) AS n FROM social_posts WHERE authorId=?', user.id).n,
        comments: get('SELECT COUNT(*) AS n FROM social_comments WHERE authorId=?', user.id).n,
        media: get('SELECT COUNT(*) AS n FROM social_media WHERE ownerId=? AND exampleFilename IS NULL', user.id).n,
      },
      sharedCrewsPreserved: all('SELECT crewId FROM members WHERE userId=?', user.id).filter(member => !solo.has(member.crewId)).length,
      successorSelection: 'Oldest recorded real membership; existing legacy memberships use their stored membership order.',
    };
    const memberships = all(`SELECT m.id,m.crewId,m.userId,m.joinedAt,c.ownerId FROM members m JOIN crews c ON c.id=m.crewId
      WHERE m.crewId IN (SELECT crewId FROM members WHERE userId=?) ORDER BY m.crewId,m.rowid`, user.id);
    const plans = all('SELECT id,crewId FROM projects WHERE crewId IN (SELECT crewId FROM members WHERE userId=?) ORDER BY crewId,id', user.id);
    return { ...preview, confirmationToken: digest(JSON.stringify({ userId: user.id, preview, memberships, plans })) };
  }
  async function cleanupFiles() {
    for (const file of all('SELECT filename FROM account_file_deletions')) {
      if (!/^media_[a-f0-9-]+(?:-poster)?\.(?:jpg|mp4)$/i.test(file.filename)) { logger.warn?.('Account media cleanup skipped an invalid stored filename.'); continue; }
      try { await unlink(path.join(mediaDir, file.filename)); run('DELETE FROM account_file_deletions WHERE filename=?', file.filename); }
      catch (error) {
        if (error.code === 'ENOENT') run('DELETE FROM account_file_deletions WHERE filename=?', file.filename);
        else logger.warn?.('Account media cleanup is pending.');
      }
    }
  }
  async function removeAccount(req, res, user, data) {
    limited(req, `delete-account:${user.id}`, 5);
    if (typeof data.confirmationToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.confirmationToken)) fail(400, 'Review account deletion before confirming.');
    const account = get('SELECT * FROM users WHERE id=?', user.id);
    if (!account) fail(401, 'Sign in to continue.');
    if (!account.isDemo) {
      if (typeof data.password !== 'string' || data.password.length > 1024) fail(400, 'Confirm your current password to delete your account.');
      const key = await derive(data.password, account.salt, 64);
      if (!timingSafeEqual(key, Buffer.from(account.passwordHash, 'hex'))) fail(403, 'Your password is incorrect.');
    }
    transaction(() => {
      // Password/reset state is rechecked after asynchronous hashing, before any deletion.
      const current = get('SELECT * FROM users WHERE id=?', user.id);
      if (!current || current.passwordHash !== account.passwordHash || current.isDemo !== account.isDemo) fail(409, 'Your account changed. Sign in and review deletion again.');
      const preview = deletionPreview(current);
      if (data.confirmationToken !== preview.confirmationToken) fail(409, 'Crew membership changed. Review deletion again.');
      const ownPosts = 'SELECT id FROM social_posts WHERE authorId=?';
      const ownComments = 'SELECT id FROM social_comments WHERE authorId=? OR postId IN (SELECT id FROM social_posts WHERE authorId=?)';
      const relatedRequests = 'SELECT id FROM social_requests WHERE senderId=? OR recipientId=? OR postId IN (SELECT id FROM social_posts WHERE authorId=?)';
      const aliases = [current.name, get('SELECT displayName FROM social_profiles WHERE userId=?', user.id)?.displayName].filter(Boolean);

      // Preserve other people's content; remove identity-linked attribution instead of deleting their post.
      for (const post of all('SELECT id,credits FROM social_posts WHERE authorId<>?', user.id)) {
        const credits = JSON.parse(post.credits), changed = credits.some(credit => credit.profileId === user.id);
        if (changed) run('UPDATE social_posts SET credits=? WHERE id=?', JSON.stringify(credits.map(credit => credit.profileId === user.id ? { name: 'Deleted creator', role: credit.role } : credit)), post.id);
      }
      run(`DELETE FROM social_notifications WHERE userId=? OR actorId=? OR postId IN (${ownPosts}) OR requestId IN (${relatedRequests})`, user.id, user.id, user.id, user.id, user.id, user.id);
      run(`DELETE FROM social_requests WHERE id IN (${relatedRequests})`, user.id, user.id, user.id);
      // Remove new moderation records before their polymorphic targets/reports disappear.
      if (get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='social_moderation_audit'")) {
        run(`DELETE FROM social_moderation_audit WHERE actorId=? OR (targetType IN ('profile','user') AND targetId=?)
          OR (targetType='post' AND targetId IN (${ownPosts})) OR (targetType='comment' AND targetId IN (${ownComments}))
          OR (targetType='report' AND targetId IN (SELECT id FROM social_reports WHERE reporterId=? OR (targetType='profile' AND targetId=?)
          OR (targetType='post' AND targetId IN (${ownPosts})) OR (targetType='comment' AND targetId IN (${ownComments}))))`,
          user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id);
        run('UPDATE social_reports SET reviewedBy=NULL WHERE reviewedBy=?', user.id);
      }
      if (get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='social_screening_events'"))
        run(`DELETE FROM social_screening_events WHERE (targetType='profile' AND targetId=?) OR (targetType='post' AND targetId IN (${ownPosts})) OR (targetType='comment' AND targetId IN (${ownComments}))`, user.id, user.id, user.id, user.id);
      run(`DELETE FROM social_reports WHERE reporterId=? OR (targetType='profile' AND targetId=?) OR (targetType='post' AND targetId IN (${ownPosts})) OR (targetType='comment' AND targetId IN (${ownComments}))`, user.id, user.id, user.id, user.id, user.id);
      run(`DELETE FROM social_content_reviews WHERE (targetType='profile' AND targetId=?) OR (targetType='post' AND targetId IN (${ownPosts})) OR (targetType='comment' AND targetId IN (${ownComments}))`, user.id, user.id, user.id, user.id);
      run('DELETE FROM social_comments WHERE authorId=?', user.id);
      run('DELETE FROM social_posts WHERE authorId=?', user.id);
      run('DELETE FROM social_post_media WHERE mediaId IN (SELECT id FROM social_media WHERE ownerId=?)', user.id);
      for (const file of all('SELECT filename,posterFilename FROM social_media WHERE ownerId=? AND exampleFilename IS NULL', user.id))
        for (const filename of [file.filename, file.posterFilename].filter(Boolean))
          run('INSERT OR IGNORE INTO account_file_deletions(filename,createdAt) VALUES(?,?)', filename, stamp());
      run('DELETE FROM social_media WHERE ownerId=?', user.id);

      // Invalidate issued invitations; anonymize consumed invitations without making them reusable.
      run('DELETE FROM invites WHERE inviterId=?', user.id);
      run('UPDATE invites SET usedBy=NULL,revokedAt=? WHERE usedBy=?', now(), user.id);
      run("UPDATE activity SET actorName='Deleted member',actorUserId=NULL WHERE actorUserId=?", user.id);
      for (const alias of new Set(aliases)) {
        // Legacy rows lacked an actor ID. Only anonymize an unambiguous matching crew member.
        run(`UPDATE activity SET actorName='Deleted member' WHERE actorUserId IS NULL AND actorName=?
          AND crewId IN (SELECT crewId FROM members WHERE userId=?)
          AND NOT EXISTS (SELECT 1 FROM members other WHERE other.crewId=activity.crewId AND other.userId IS NOT NULL AND other.userId<>? AND other.name=?)`, alias, user.id, user.id, alias);
        run("UPDATE activity SET text='removed a deleted member from the crew' WHERE text=?", `removed ${alias} from the crew`);
      }
      for (const crew of preview.ownedCrews) {
        if (crew.action === 'transfer') {
          run('UPDATE crews SET ownerId=? WHERE id=?', crew.successor.userId, crew.id);
          run("UPDATE members SET role='Captain' WHERE crewId=? AND userId=?", crew.id, crew.successor.userId);
        } else {
          run('UPDATE social_requests SET crewId=NULL,projectId=NULL WHERE crewId=? OR projectId IN (SELECT id FROM projects WHERE crewId=?)', crew.id, crew.id);
          run('DELETE FROM crews WHERE id=?', crew.id);
        }
      }
      run('DELETE FROM members WHERE userId=?', user.id);
      // Remaining profile, session, follow, save, block, and reset rows cascade safely.
      run('DELETE FROM users WHERE id=?', user.id);
    });
    onAccountDeleted?.(user.id);
    cookie(req, res, '', true);
    await cleanupFiles();
    return { ok: true, mediaCleanupPending: Boolean(get('SELECT 1 FROM account_file_deletions LIMIT 1')) };
  }

  const route = async (req, res, url, context) => {
    const { pathname } = url, { user } = context;
    const respond = (status, payload) => { send(res, status, payload); return true; };
    if (pathname === '/api/public-config' && req.method === 'GET') return respond(200, publicConfig);
    if (pathname === '/api/auth/password-reset/request' && req.method === 'POST') {
      if (!resetAvailable) fail(503, 'Password reset is not configured. Contact the operator for help.');
      limited(req, 'password-reset-request', 6);
      const data = await body(req), email = string(data.email, 'email', { required: true, max: 254 }).toLowerCase();
      const emailHash = digest(email), current = now();
      run('DELETE FROM account_reset_limits WHERE windowStart<?', current - 86_400_000);
      const limit = get('SELECT * FROM account_reset_limits WHERE emailHash=?', emailHash);
      if (limit && limit.windowStart > current - 30 * 60_000 && limit.count >= 3) return respond(200, GENERIC_RESET);
      run('INSERT INTO account_reset_limits(emailHash,windowStart,count) VALUES(?,?,1) ON CONFLICT(emailHash) DO UPDATE SET count=CASE WHEN windowStart>? THEN count+1 ELSE 1 END,windowStart=CASE WHEN windowStart>? THEN windowStart ELSE excluded.windowStart END', emailHash, current, current - 30 * 60_000, current - 30 * 60_000);
      // Generate the same token material for existing and nonexistent addresses.
      const token = secret(), tokenHash = digest(token);
      const account = get('SELECT * FROM users WHERE email=? AND isDemo=0 AND passwordHash IS NOT NULL', email);
      if (account) {
        transaction(() => {
          run('DELETE FROM account_password_resets WHERE userId=? OR expiresAt<=?', account.id, current);
          insert('account_password_resets', { tokenHash, userId: account.id, createdAt: current, expiresAt: current + resetTokenTtlMs, usedAt: null });
        });
        const resetUrl = `${appOrigin}/reset-password?token=${encodeURIComponent(token)}`;
        // Do not await provider latency or vary the public response when delivery fails.
        Promise.resolve().then(() => mailSender({ to: email, subject: 'Reset your Crewroom password',
          text: `A password reset was requested for your Crewroom account.\n\nOpen this link within ${Math.ceil(resetTokenTtlMs / 60_000)} minutes:\n${resetUrl}\n\nIf you did not request this, ignore this message. Your password has not changed.`,
          html: `<p>A password reset was requested for your Crewroom account.</p><p><a href="${resetUrl}">Reset your password</a> within ${Math.ceil(resetTokenTtlMs / 60_000)} minutes.</p><p>If you did not request this, ignore this message. Your password has not changed.</p>`,
        })).catch(() => logger.warn?.('Password reset delivery failed. Check mail configuration.'));
      }
      return respond(200, GENERIC_RESET);
    }
    if (pathname === '/api/auth/password-reset/confirm' && req.method === 'POST') {
      if (!resetAvailable) fail(503, 'Password reset is not configured. Contact the operator for help.');
      limited(req, 'password-reset-confirm', 10);
      const data = await body(req), token = string(data.token, 'token', { required: true, max: 100 });
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(400, 'This reset link is invalid or expired.');
      requirePassword(data.password);
      const tokenHash = digest(token), reset = get('SELECT * FROM account_password_resets WHERE tokenHash=? AND usedAt IS NULL AND expiresAt>?', tokenHash, now());
      if (!reset) fail(400, 'This reset link is invalid or expired.');
      const salt = secret(), passwordHash = (await derive(data.password, salt, 64)).toString('hex');
      transaction(() => {
        const changed = run('UPDATE account_password_resets SET usedAt=? WHERE tokenHash=? AND usedAt IS NULL AND expiresAt>?', now(), tokenHash, now());
        if (!changed.changes) fail(400, 'This reset link is invalid or expired.');
        run('UPDATE users SET passwordHash=?,salt=? WHERE id=?', passwordHash, salt, reset.userId);
        run('DELETE FROM sessions WHERE userId=?', reset.userId);
        run('DELETE FROM account_password_resets WHERE userId=? AND tokenHash<>?', reset.userId, tokenHash);
      });
      cookie(req, res, '', true);
      return respond(200, { ok: true });
    }
    if (pathname === '/api/account/deletion-preview' && req.method === 'GET') {
      if (!user) fail(401, 'Sign in to continue.');
      return respond(200, deletionPreview(user));
    }
    if ((pathname === '/api/account' && req.method === 'DELETE') || (pathname === '/api/account/delete' && req.method === 'POST')) {
      mutation(req, context);
      return respond(200, await removeAccount(req, res, user, await body(req)));
    }
    return false;
  };
  route.validatePolicy = validatePolicy;
  route.recordPolicy = recordPolicy;
  route.cleanupFiles = cleanupFiles;
  return route;
}
