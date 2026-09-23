import { randomUUID } from 'node:crypto';
import { inspectContent } from './content-review.mjs';

const TYPES = { profile: ['social_profiles', 'userId'], post: ['social_posts', 'id'], comment: ['social_comments', 'id'] };
const HOLD = 'This submission needs a moderator check before it can be shared. Your private drafts are unaffected.';

/** Durable, version-bound screening. Visibility remains governed by the social access checks. */
export function createModeration({ db, mediaDir, mode = 'manual', provider, now = Date.now, pollMs = 1000 }) {
  if (!['manual', 'hybrid'].includes(mode)) throw new Error('Invalid moderation mode.');
  for (const [table] of Object.values(TYPES)) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'reviewStage'))
      db.exec(`ALTER TABLE ${table} ADD COLUMN reviewStage TEXT`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS social_moderation_jobs (
    id TEXT PRIMARY KEY, targetType TEXT NOT NULL, targetId TEXT NOT NULL,
    authorId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, UNIQUE(targetType,targetId)
  );
  CREATE INDEX IF NOT EXISTS social_moderation_jobs_status ON social_moderation_jobs(status,createdAt);
  CREATE TABLE IF NOT EXISTS social_screening_events (
    id TEXT PRIMARY KEY, targetType TEXT NOT NULL, targetId TEXT NOT NULL,
    version TEXT NOT NULL, decision TEXT NOT NULL, provider TEXT NOT NULL,
    codes TEXT NOT NULL, createdAt TEXT NOT NULL
  );`);
  // A process restart must not strand a leased job or approve anything implicitly.
  db.prepare("UPDATE social_moderation_jobs SET status='queued' WHERE status='checking'").run();
  let closed = false, timer, running = false, controller, activeJob;
  const stamp = () => new Date(now()).toISOString();
  const config = () => ({ mode, automaticScreening: mode === 'hybrid' && provider?.ready === true,
    provider: mode === 'hybrid' && provider?.ready === true ? 'sightengine' : null,
    automaticVideoScreening: mode === 'hybrid' && provider?.ready === true && provider?.videoReady === true });
  function row(type, id) {
    const spec = TYPES[type];
    return spec ? db.prepare(`SELECT * FROM ${spec[0]} WHERE ${spec[1]}=?`).get(id) : null;
  }
  function eligible(type, item) {
    if (!item || item.deletedAt || item.isExample || item.reviewStatus !== 'pending') return false;
    const authorId = type === 'profile' ? item.userId : item.authorId;
    const author = db.prepare('SELECT p.*,u.isDemo FROM social_profiles p JOIN users u ON u.id=p.userId WHERE p.userId=?').get(authorId);
    if (!author || author.isDemo || author.suspendedAt || author.visibility !== 'public') return false;
    if (type === 'comment') {
      const post = db.prepare('SELECT * FROM social_posts WHERE id=?').get(item.postId);
      return !!post && !post.deletedAt && !post.moderatedAt && post.visibility === 'public';
    }
    return item.visibility === 'public' && !item.moderatedAt;
  }
  function cancel({ type, id }) {
    if (activeJob?.targetType === type && activeJob.targetId === id) controller?.abort();
    db.prepare("UPDATE social_moderation_jobs SET status='cancelled',updatedAt=? WHERE targetType=? AND targetId=?").run(stamp(), type, id);
    const spec = TYPES[type];
    if (spec) db.prepare(`UPDATE ${spec[0]} SET reviewStage='held' WHERE ${spec[1]}=? AND reviewStatus='pending' AND reviewStage IN ('queued','checking')`).run(id);
  }
  function cancelAuthor(authorId) {
    if (activeJob?.authorId === authorId) controller?.abort();
    db.prepare("UPDATE social_moderation_jobs SET status='cancelled',updatedAt=? WHERE authorId=? AND status IN ('queued','checking')").run(stamp(), authorId);
    for (const [type, [table]] of Object.entries(TYPES)) db.prepare(`UPDATE ${table} SET reviewStage='held' WHERE ${type === 'profile' ? 'userId' : 'authorId'}=? AND reviewStatus='pending' AND reviewStage IN ('queued','checking')`).run(authorId);
  }
  function enqueue(type, id) {
    cancel({ type, id });
    const item = row(type, id), spec = TYPES[type];
    if (!item || !spec) return false;
    if (!eligible(type, item)) return false;
    if (mode !== 'hybrid' || provider?.ready !== true) {
      db.prepare(`UPDATE ${spec[0]} SET reviewStage='held' WHERE ${spec[1]}=?`).run(id);
      return false;
    }
    const inspection = inspectContent(db, type, id, mediaDir);
    const authorId = type === 'profile' ? item.userId : item.authorId;
    const time = stamp();
    db.prepare(`INSERT INTO social_moderation_jobs(id,targetType,targetId,authorId,version,status,createdAt,updatedAt)
      VALUES(?,?,?,?,?,'queued',?,?) ON CONFLICT(targetType,targetId) DO UPDATE SET
      id=excluded.id,version=excluded.version,status='queued',attempts=0,updatedAt=excluded.updatedAt`).run(
      randomUUID(), type, id, authorId, inspection.version, time, time);
    db.prepare(`UPDATE ${spec[0]} SET reviewStage='queued',reviewReason=NULL WHERE ${spec[1]}=?`).run(id);
    wake();
    return true;
  }
  function input(inspection) {
    const c = inspection.content;
    // Explicit public field allowlist: no account email, crew data, passwords or internal IDs.
    const fields = inspection.type === 'profile'
      ? ['displayName', 'handle', 'bio', 'roles', 'fandoms', 'city', 'websiteUrl', 'instagramUrl']
      : inspection.type === 'post'
        ? ['title', 'character', 'fandom', 'body', 'credits', 'opportunity'] : ['body'];
    const publicValue = f => f === 'credits' ? JSON.stringify(JSON.parse(c.credits || '[]').map(({ name, role }) => ({ name, role }))) : c[f] || '';
    return { type: inspection.type,
      text: fields.map(f => `${f}: ${publicValue(f)}`).join('\n') + inspection.media.map(m => `\nImage description: ${m.alt || ''}`).join(''),
      media: inspection.media.map(m => ({ file: m.file, kind: m.kind || 'image', duration: m.duration, posterFile: m.posterFile })) };
  }
  function sameJob(job) {
    return db.prepare("SELECT 1 FROM social_moderation_jobs WHERE id=? AND version=? AND status='checking'").get(job.id, job.version);
  }
  async function drain() {
    if (closed || running || mode !== 'hybrid' || provider?.ready !== true) return;
    running = true;
    try {
      const job = db.prepare("SELECT * FROM social_moderation_jobs WHERE status='queued' ORDER BY createdAt,id LIMIT 1").get();
      if (!job) return;
      const [table, key] = TYPES[job.targetType];
      let inspection;
      db.exec('BEGIN IMMEDIATE');
      try {
        if (eligible(job.targetType, row(job.targetType, job.targetId))) {
          try { inspection = inspectContent(db, job.targetType, job.targetId, mediaDir); } catch { /* Held for operator. */ }
        }
        if (!inspection || inspection.version !== job.version) {
          cancel({ type: job.targetType, id: job.targetId }); db.exec('COMMIT'); return;
        }
        db.prepare("UPDATE social_moderation_jobs SET status='checking',attempts=attempts+1,updatedAt=? WHERE id=? AND status='queued'").run(stamp(), job.id);
        db.prepare(`UPDATE ${table} SET reviewStage='checking' WHERE ${key}=?`).run(job.targetId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      controller = new AbortController();
      activeJob = job;
      // CLI decisions and deletion from another connection also stop later vendor transfers.
      const eligibilityWatch = setInterval(() => {
        if (closed) return controller?.abort();
        try {
          if (!sameJob(job) || !eligible(job.targetType, row(job.targetType, job.targetId))) controller?.abort();
        } catch { controller?.abort(); }
      }, 250);
      eligibilityWatch.unref?.();
      const timeout = setTimeout(() => controller?.abort(), 180_000);
      timeout.unref?.();
      let result;
      try {
        result = await Promise.race([
          provider.screen(input(inspection), { signal: controller.signal }),
          new Promise(resolve => controller.signal.addEventListener('abort', () => resolve({ decision: 'review', codes: ['screening-interrupted'] }), { once: true })),
        ]);
      } catch { result = { decision: 'review', codes: ['provider-unavailable'] }; }
      finally { clearTimeout(timeout); clearInterval(eligibilityWatch); controller = null; activeJob = null; }
      if (closed) return;
      // Account deletion, unpublishing, editing, reports and operator decisions may occur while awaiting the vendor.
      const pass = result?.decision === 'pass' && result.provider === 'sightengine' && Array.isArray(result.codes) && result.codes.every(c => typeof c === 'string'), time = stamp();
      const codes = Array.isArray(result?.codes) ? result.codes.filter(c => typeof c === 'string').map(c => c.slice(0, 100)).slice(0, 20) : ['invalid-provider-response'];
      db.exec('BEGIN IMMEDIATE');
      try {
        // Revalidate inside the write lock so an external CLI cannot race the decision.
        if (!sameJob(job)) { db.exec('COMMIT'); return; }
        let currentVersion;
        try { currentVersion = inspectContent(db, job.targetType, job.targetId, mediaDir).version; } catch { /* Withdrawn or deleted. */ }
        if (!eligible(job.targetType, row(job.targetType, job.targetId)) || currentVersion !== job.version) {
          cancel({ type: job.targetType, id: job.targetId }); db.exec('COMMIT'); return;
        }
        // A new report during screening means a human should examine this exact submission.
        const reported = db.prepare("SELECT 1 FROM social_reports WHERE targetType=? AND targetId=? AND status='pending'").get(job.targetType, job.targetId);
        const accepted = pass && !reported;
        db.prepare(`UPDATE ${table} SET reviewStatus=?,reviewStage=?,reviewReason=?,reviewedAt=? WHERE ${key}=?`).run(
          accepted ? 'approved' : 'pending', accepted ? 'published' : 'held', accepted ? null : HOLD, time, job.targetId);
        db.prepare('UPDATE social_moderation_jobs SET status=?,updatedAt=? WHERE id=?').run(accepted ? 'passed' : 'held', time, job.id);
        db.prepare('INSERT INTO social_screening_events VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), job.targetType, job.targetId, job.version,
          accepted ? 'pass' : 'review', 'sightengine', JSON.stringify(reported ? [...codes, 'open-report'] : codes), time);
        if (accepted && job.targetType === 'comment') {
          const comment = row('comment', job.targetId), post = db.prepare('SELECT authorId FROM social_posts WHERE id=?').get(comment.postId);
          if (post && post.authorId !== comment.authorId && !db.prepare('SELECT 1 FROM social_notifications WHERE commentId=?').get(comment.id))
            db.prepare(`INSERT INTO social_notifications(id,userId,type,actorId,text,postId,read,createdAt,commentId)
              VALUES(?,?,'comment',?,'A creator commented on your project',?,0,?,?)`).run(`notice_${randomUUID()}`, post.authorId, comment.authorId, comment.postId, time, comment.id);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } finally { running = false; }
  }
  function wake() {
    if (closed || timer || mode !== 'hybrid' || provider?.ready !== true) return;
    timer = setTimeout(async () => {
      timer = null;
      try { await drain(); } catch { /* A persisted pending item remains available to the operator. */ }
      if (!closed) wake();
    }, pollMs);
    timer.unref?.();
  }
  function close() { closed = true; clearTimeout(timer); controller?.abort(); }
  wake();
  return { config, enqueue, cancel, cancelAuthor, close };
}
