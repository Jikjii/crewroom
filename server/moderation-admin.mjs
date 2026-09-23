import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { inspectContent, decideContent } from './content-review.mjs';
import { streamVideo } from './video.mjs';

const DAY = 86_400_000;
const TYPES = new Set(['profile', 'post', 'comment']);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const severeReasons = new Set(['child-safety', 'sexual-content', 'violence', 'threats', 'self-harm', 'hate', 'illegal-content']);

/** Static shell contains no account data. Every data and media request authorizes anew. */
export function serveModerationPage(req, res, pathname) {
  const files = {
    '/moderation': ['index.html', 'text/html; charset=utf-8'],
    '/moderation/': ['index.html', 'text/html; charset=utf-8'],
    '/moderation/assets/moderation.js': ['moderation.js', 'text/javascript; charset=utf-8'],
    '/moderation/assets/moderation.css': ['moderation.css', 'text/css; charset=utf-8'],
  };
  if (!['GET', 'HEAD'].includes(req.method) || !Object.hasOwn(files, pathname)) return false;
  res.writeHead(200, {
    'Content-Type': files[pathname][1], 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  });
  res.end(req.method === 'HEAD' ? undefined : readFileSync(new URL(`./moderation/${files[pathname][0]}`, import.meta.url)));
  return true;
}

export function createModerationAdmin({ db, mediaDir, operatorIds = [], send, body, mutation, fail,
  limited = () => {}, now = Date.now, onDecision = () => {}, retryScreening }) {
  // Copy once: changing a user's email/name or a caller's array can never grant a role.
  const operators = new Set(typeof operatorIds === 'string' ? operatorIds.split(',').map(id => id.trim()).filter(Boolean) : operatorIds);
  db.exec(`CREATE TABLE IF NOT EXISTS social_moderation_audit (
    id TEXT PRIMARY KEY, actorId TEXT NOT NULL, targetType TEXT NOT NULL, targetId TEXT NOT NULL,
    action TEXT NOT NULL, reason TEXT NOT NULL, version TEXT NOT NULL,
    imagesReviewed INTEGER NOT NULL DEFAULT 0, videosReviewed INTEGER NOT NULL DEFAULT 0, textReviewed INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS social_moderation_audit_target ON social_moderation_audit(targetType,targetId,createdAt);`);
  if (!db.prepare('PRAGMA table_info(social_moderation_audit)').all().some(row => row.name === 'textReviewed'))
    db.exec('ALTER TABLE social_moderation_audit ADD COLUMN textReviewed INTEGER NOT NULL DEFAULT 0');
  const reportColumns = new Set(db.prepare('PRAGMA table_info(social_reports)').all().map(row => row.name));
  if (!reportColumns.has('resolutionNotes')) db.exec("ALTER TABLE social_reports ADD COLUMN resolutionNotes TEXT NOT NULL DEFAULT ''");
  if (!reportColumns.has('reviewedBy')) db.exec('ALTER TABLE social_reports ADD COLUMN reviewedBy TEXT');
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function allowed(context) {
    const user = context.user;
    if (!user || !operators.has(user.id) || !context.session?.tokenHash) return false;
    if (!get('SELECT 1 FROM sessions WHERE tokenHash=? AND userId=? AND expiresAt>?', context.session.tokenHash, user.id, now())) return false;
    const row = get('SELECT u.isDemo,p.suspendedAt FROM users u LEFT JOIN social_profiles p ON p.userId=u.id WHERE u.id=?', user.id);
    return Boolean(row && !row.isDemo && !row.suspendedAt);
  }
  function requireOperator(context) {
    if (!context.user) fail(401, 'Sign in to your Crewroom operator account.');
    if (!allowed(context)) fail(403, 'This account does not have operator access.');
  }
  function text(value, field, max = 1000) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
      fail(400, `${field} must contain 1–${max} characters.`);
    return value.trim();
  }
  function audit(actorId, targetType, targetId, action, reason, version, checks = {}) {
    db.prepare(`INSERT INTO social_moderation_audit(id,actorId,targetType,targetId,action,reason,version,imagesReviewed,videosReviewed,textReviewed,createdAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), actorId, targetType, targetId, action, reason, version,
        Number(checks.imagesReviewed === true), Number(checks.videosReviewed === true), Number(checks.textReviewed === true), new Date(now()).toISOString());
  }
  function inspection(type, id) {
    if (!TYPES.has(type)) fail(404, 'Content not found.');
    try { return inspectContent(db, type, id, mediaDir); }
    catch (error) {
      if (/not found|Only real/.test(error.message)) fail(404, 'This public submission is unavailable. Private drafts cannot be reviewed here.');
      fail(409, 'This submission could not be inspected. Its media may be missing or changed.');
    }
  }
  function authorStatus(id) {
    const row = get('SELECT p.userId,p.handle,p.displayName,p.suspendedAt,p.createdAt,p.visibility,p.reviewStatus,u.isDemo FROM social_profiles p JOIN users u ON u.id=p.userId WHERE p.userId=?', id);
    if (!row || row.isDemo) fail(404, 'Creator not found.');
    const version = digest([row.userId, row.createdAt, row.suspendedAt]);
    return { userId: row.userId, handle: row.handle, displayName: row.displayName,
      suspended: Boolean(row.suspendedAt), suspendedAt: row.suspendedAt, visibility: row.visibility, reviewStatus: row.reviewStatus, version, protectedOperator: operators.has(id) };
  }
  function reportRows(type, id) {
    return all('SELECT id,reason,details,status,createdAt,reviewedAt,resolutionNotes FROM social_reports WHERE targetType=? AND targetId=? ORDER BY createdAt,id', type, id);
  }
  function versionOf(item) {
    const authorId = item.type === 'profile' ? item.content.userId : item.content.authorId;
    // New reports or an account suspension invalidate an already-open decision form.
    return digest([item.version, item.reviewStatus, item.reviewReason,
      get('SELECT suspendedAt FROM social_profiles WHERE userId=?', authorId)?.suspendedAt ?? null,
      reportRows(item.type, item.id).map(row => [row.id, row.status, row.reason, row.details])]);
  }
  function stageFor(item) {
    const table = { profile: 'social_profiles', post: 'social_posts', comment: 'social_comments' }[item.type];
    const key = item.type === 'profile' ? 'userId' : 'id';
    return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === 'reviewStage')
      ? get(`SELECT reviewStage FROM ${table} WHERE ${key}=?`, item.id)?.reviewStage : null;
  }
  function decorate(item) {
    const authorId = item.type === 'profile' ? item.content.userId : item.content.authorId;
    const media = item.media.map(({ file, posterFile, filename, posterFilename, ...asset }) => ({ ...asset,
      url: `/api/moderation/media/${item.type}/${encodeURIComponent(item.id)}/${encodeURIComponent(asset.id)}`,
      ...(asset.kind === 'video' ? { posterUrl: `/api/moderation/media/${item.type}/${encodeURIComponent(item.id)}/${encodeURIComponent(asset.id)}/poster` } : {}) }));
    const reports = reportRows(item.type, item.id);
    const screeningRow = get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='social_screening_events'")
      ? get('SELECT decision,provider,codes,createdAt FROM social_screening_events WHERE targetType=? AND targetId=? AND version=? ORDER BY createdAt DESC,id DESC LIMIT 1', item.type, item.id, item.version) : null;
    let screening = null;
    if (screeningRow) {
      let codes = [];
      try { codes = JSON.parse(screeningRow.codes); } catch { /* Never expose raw provider responses. */ }
      screening = { decision: screeningRow.decision, provider: screeningRow.provider, createdAt: screeningRow.createdAt,
        codes: Array.isArray(codes) ? codes.filter(code => typeof code === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(code)) : [] };
    }
    const stage = stageFor(item);
    return { type: item.type, id: item.id, version: versionOf(item), reviewStatus: item.reviewStatus,
      reviewReason: item.reviewReason, reviewStage: stage, screening, content: item.content, media, reports, author: authorStatus(authorId),
      retryAvailable: typeof retryScreening === 'function' && item.reviewStatus === 'pending' && !['queued', 'checking'].includes(stage),
      history: all('SELECT * FROM social_moderation_audit WHERE targetType=? AND targetId=? ORDER BY createdAt DESC,id DESC LIMIT 100', item.type, item.id) };
  }
  function aged(row) {
    const ageHours = Math.max(0, (now() - Date.parse(row.createdAt)) / 3_600_000);
    return { ...row, ageHours: Number(ageHours.toFixed(1)), overdue: ageHours >= 24 };
  }
  function reportSummary(row) {
    return aged({ ...row, priority: severeReasons.has(row.reason) ? 'urgent' : 'normal' });
  }
  function mediaTarget(type, targetId, mediaId) {
    // Check scope without hashing a whole video again for each small seek request.
    const record = type === 'profile' ? get(`SELECT m.*,p.visibility,p.isExample,u.isDemo
      FROM social_media m JOIN social_profiles p ON p.avatarMediaId=m.id AND p.userId=m.ownerId
      JOIN users u ON u.id=p.userId WHERE p.userId=? AND m.id=? AND m.kind='image'`, targetId, mediaId)
      : type === 'post' ? get(`SELECT m.*,p.visibility,p.deletedAt,p.isExample,u.isDemo
      FROM social_media m JOIN social_post_media pm ON pm.mediaId=m.id JOIN social_posts p ON p.id=pm.postId
      JOIN users u ON u.id=p.authorId WHERE p.id=? AND m.id=?`, targetId, mediaId) : null;
    if (!record || record.visibility !== 'public' || record.deletedAt || record.isExample || record.isDemo || record.exampleFilename)
      fail(404, 'Media not found.');
    return record;
  }
  function safeFile(filename) {
    if (!filename || path.basename(filename) !== filename) fail(404, 'Media not found.');
    try {
      const base = realpathSync(mediaDir), file = realpathSync(path.join(base, filename));
      if (!file.startsWith(base + path.sep) || !statSync(file).isFile()) fail(404, 'Media not found.');
      return file;
    } catch { fail(404, 'Media not found.'); }
  }
  return async function moderationRoute(req, res, url, context) {
    if (!url.pathname.startsWith('/api/moderation/')) return false;
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const respond = (status, value) => { send(res, status, value); return true; };
    if (url.pathname === '/api/moderation/me' && req.method === 'GET')
      return respond(200, { allowed: allowed(context), signedIn: Boolean(context.user), userId: context.user?.id ?? null });
    requireOperator(context);
    limited(req, ['GET', 'HEAD'].includes(req.method) ? 'moderation-read' : 'moderation-write', ['GET', 'HEAD'].includes(req.method) ? 600 : 120);
    if (!['GET', 'HEAD'].includes(req.method)) mutation(req, context);
    if (url.pathname === '/api/moderation/queue' && req.method === 'GET') {
      const severe = Array.from(severeReasons).map(reason => `'${reason}'`).join(',');
      const pending = `SELECT 'profile' type,p.userId id,p.userId authorId,p.createdAt,p.displayName title,p.reviewStatus FROM social_profiles p JOIN users u ON u.id=p.userId
        WHERE p.reviewStatus='pending' AND p.visibility='public' AND p.isExample=0 AND u.isDemo=0
        UNION ALL SELECT 'post',p.id,p.authorId,p.createdAt,p.title,p.reviewStatus FROM social_posts p JOIN users u ON u.id=p.authorId
        WHERE p.reviewStatus='pending' AND p.visibility='public' AND p.isExample=0 AND u.isDemo=0 AND p.deletedAt IS NULL
        UNION ALL SELECT 'comment',c.id,c.authorId,c.createdAt,'Comment',c.reviewStatus FROM social_comments c JOIN users u ON u.id=c.authorId JOIN social_posts p ON p.id=c.postId
        WHERE c.reviewStatus='pending' AND c.deletedAt IS NULL AND u.isDemo=0 AND p.deletedAt IS NULL AND p.visibility='public' AND p.isExample=0`;
      const reports = all(`SELECT id,targetType,targetId,reason,details,status,createdAt FROM social_reports WHERE status='pending'
        ORDER BY CASE WHEN reason IN (${severe}) THEN 0 ELSE 1 END,createdAt,id LIMIT 200`).map(reportSummary);
      const items = all(`SELECT q.*,
        (SELECT count(DISTINCT reporterId) FROM social_reports r WHERE r.status='pending' AND r.targetType=q.type AND r.targetId=q.id) reportCount,
        CASE WHEN EXISTS(SELECT 1 FROM social_reports r WHERE r.status='pending' AND r.targetType=q.type AND r.targetId=q.id AND r.reason IN (${severe})) THEN 'urgent' ELSE 'normal' END priority
        FROM (${pending}) q ORDER BY CASE WHEN priority='urgent' THEN 0 ELSE 1 END,q.createdAt,q.id LIMIT 200`).map(aged);
      const totalQueue = get(`SELECT count(*) count FROM (${pending})`).count;
      const totalReports = get("SELECT count(*) count FROM social_reports WHERE status='pending'").count;
      return respond(200, { items, reports, totalQueue, totalReports, limit: 200, internalResponseTargetHours: 24,
        policy: 'Internal operating target: review reports within 24 hours; urgent safety reports first. This is Crewroom policy, not an Apple deadline.' });
    }
    if (url.pathname === '/api/moderation/history' && req.method === 'GET')
      return respond(200, { items: all('SELECT * FROM social_moderation_audit ORDER BY createdAt DESC,id DESC LIMIT 200') });
    const contentMatch = /^\/api\/moderation\/content\/(profile|post|comment)\/([^/]+)(?:\/(decision|retry))?$/.exec(url.pathname);
    if (contentMatch) {
      const [, type, id, operation] = contentMatch;
      if (!operation && req.method === 'GET') return respond(200, decorate(inspection(type, id)));
      if (req.method === 'POST' && operation === 'decision') {
        const data = await body(req); requireOperator(context);
        const item = inspection(type, id), reason = text(data.reason, 'Decision reason');
        if (data.version !== versionOf(item)) fail(409, 'Content, reports, or account status changed. Reload and review again.');
        if (!['approve', 'reject', 'takedown', 'restore'].includes(data.action)) fail(400, 'Choose a moderation action.');
        let result;
        try {
          result = decideContent(db, { type, id, version: item.version, action: data.action, reason,
            textReviewed: data.textReviewed, imagesReviewed: data.imagesReviewed, videosReviewed: data.videosReviewed, mediaDir, now,
            beforeCommit: ({ inspection: locked }) => {
              requireOperator(context);
              if (versionOf(locked) !== data.version) fail(409, 'Content, reports, or account status changed. Reload and review again.');
              audit(context.user.id, type, id, data.action, reason, data.version, data);
            } });
        } catch (error) {
          if (error.status) throw error;
          fail(/changed|Only (pending|approved|rejected)/.test(error.message) ? 409 : 400, error.message);
        }
        onDecision({ type, id });
        return respond(200, { ...result, inspection: decorate(inspection(type, id)) });
      }
      if (req.method === 'POST' && operation === 'retry') {
        const data = await body(req); requireOperator(context);
        const item = inspection(type, id), reason = text(data.reason, 'Retry reason');
        if (['queued', 'checking'].includes(stageFor(item))) fail(409, 'This submission is already queued or being screened. Wait for the current check to finish.');
        if (typeof retryScreening !== 'function') fail(409, 'Automatic screening is not configured.');
        if (item.reviewStatus !== 'pending' || data.version !== versionOf(item)) fail(409, 'Reload this pending submission before retrying.');
        // This callback must enqueue synchronously; credentials and provider responses never reach the browser.
        transaction(() => {
          requireOperator(context);
          const current = inspection(type, id);
          if (current.reviewStatus !== 'pending' || data.version !== versionOf(current)) fail(409, 'Submission changed. Reload it before retrying.');
          if (['queued', 'checking'].includes(stageFor(current))) fail(409, 'This submission is already queued or being screened. Wait for the current check to finish.');
          const result = retryScreening({ type, id });
          if (result?.then) throw new Error('retryScreening must enqueue synchronously.');
          if (result === false) fail(409, 'Automatic screening is unavailable for this submission. Check the service and creator status before retrying.');
          audit(context.user.id, type, id, 'retry-screening', reason, data.version);
        });
        return respond(200, { ok: true });
      }
    }
    const mediaMatch = /^\/api\/moderation\/media\/(profile|post)\/([^/]+)\/([^/]+)(\/poster)?$/.exec(url.pathname);
    if (mediaMatch && ['GET', 'HEAD'].includes(req.method)) {
      const [, type, targetId, mediaId, poster] = mediaMatch, media = mediaTarget(type, targetId, mediaId);
      if (poster && media.kind !== 'video') fail(404, 'Poster not found.');
      const file = safeFile(poster ? media.posterFilename : media.filename);
      if (media.kind === 'video' && !poster) await streamVideo(req, res, file);
      else {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': statSync(file).size,
          'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
        if (req.method === 'HEAD') res.end();
        else { const stream = createReadStream(file); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); }
      }
      return true;
    }
    const userMatch = /^\/api\/moderation\/users\/([^/]+)(\/status)?$/.exec(url.pathname);
    if (userMatch) {
      const [, id, operation] = userMatch;
      if (!operation && req.method === 'GET') return respond(200, authorStatus(id));
      if (operation && req.method === 'POST') {
        const data = await body(req); requireOperator(context);
        const reason = text(data.reason, 'Account decision reason');
        if (typeof data.suspended !== 'boolean') fail(400, 'Choose suspend or restore.');
        if (operators.has(id)) fail(409, 'Operator accounts cannot be suspended or restored here.');
        const result = transaction(() => {
          requireOperator(context);
          const current = authorStatus(id);
          if (current.version !== data.version) fail(409, 'Account status changed. Reload before deciding.');
          if (current.suspended === data.suspended) fail(409, 'This account already has that status.');
          db.prepare('UPDATE social_profiles SET suspendedAt=? WHERE userId=?').run(data.suspended ? new Date(now()).toISOString() : null, id);
          audit(context.user.id, 'user', id, data.suspended ? 'suspend' : 'restore-account', reason, data.version);
          return authorStatus(id);
        });
        return respond(200, result);
      }
    }
    const reportMatch = /^\/api\/moderation\/reports\/([^/]+)\/resolve$/.exec(url.pathname);
    if (reportMatch && req.method === 'POST') {
      const data = await body(req); requireOperator(context);
      const notes = text(data.notes, 'Resolution notes', 3000), id = reportMatch[1];
      if (!['resolved', 'dismissed'].includes(data.resolution)) fail(400, 'Choose resolved or dismissed.');
      const result = transaction(() => {
        requireOperator(context);
        const report = get('SELECT * FROM social_reports WHERE id=?', id);
        if (!report) fail(404, 'Report not found.');
        if (report.status !== 'pending') fail(409, 'This report has already been handled.');
        db.prepare('UPDATE social_reports SET status=?,reviewedAt=?,reviewedBy=?,resolutionNotes=? WHERE id=?')
          .run(data.resolution, new Date(now()).toISOString(), context.user.id, notes, id);
        audit(context.user.id, 'report', id, data.resolution, notes, digest([report.id, report.status, report.targetType, report.targetId, report.reason, report.details]));
        return { ok: true, status: data.resolution };
      });
      // Resolving a report never approves, restores, or otherwise changes its target.
      return respond(200, result);
    }
    fail(404, 'Moderation endpoint not found.');
  };
}
