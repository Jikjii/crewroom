import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const TYPES = {
  profile: ["social_profiles", "userId"],
  post: ["social_posts", "id"],
  comment: ["social_comments", "id"],
};

// A missing approval always fails closed. This migration runs once per table;
// existing real public content is queued, while private and demo work is retained.
export function migrateContentReview(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [table] of Object.values(TYPES)) {
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
      if (!columns.has("reviewStatus")) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN reviewStatus TEXT NOT NULL DEFAULT 'pending' CHECK(reviewStatus IN ('pending','approved','rejected'))`);
        if (table !== "social_comments")
          db.exec(`UPDATE ${table} SET reviewStatus='approved' WHERE isExample=1`);
      }
      if (!columns.has("reviewReason")) db.exec(`ALTER TABLE ${table} ADD COLUMN reviewReason TEXT`);
      if (!columns.has("reviewedAt")) db.exec(`ALTER TABLE ${table} ADD COLUMN reviewedAt TEXT`);
    }
    if (!db.prepare("PRAGMA table_info(social_notifications)").all().some((row) => row.name === "commentId"))
      db.exec("ALTER TABLE social_notifications ADD COLUMN commentId TEXT REFERENCES social_comments(id)");
    db.exec(`CREATE TABLE IF NOT EXISTS social_content_reviews (
      id TEXT PRIMARY KEY, targetType TEXT NOT NULL, targetId TEXT NOT NULL,
      version TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT NOT NULL,
      imagesReviewed INTEGER NOT NULL, createdAt TEXT NOT NULL
    )`);
    if (!db.prepare("PRAGMA table_info(social_content_reviews)").all().some(row => row.name === "videosReviewed"))
      db.exec("ALTER TABLE social_content_reviews ADD COLUMN videosReviewed INTEGER NOT NULL DEFAULT 0");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function targetRow(db, type, id) {
  const spec = TYPES[type];
  if (!spec) throw new Error("Content type must be profile, post, or comment.");
  const [table, key] = spec;
  const row = db.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(id);
  if (!row) throw new Error("Content not found.");
  return row;
}

function reviewable(db, type, row) {
  const userId = type === "profile" ? row.userId : row.authorId;
  const user = db.prepare("SELECT isDemo FROM users WHERE id=?").get(userId);
  if (!user || user.isDemo || row.isExample || row.deletedAt || (type !== "comment" && row.visibility !== "public"))
    return false;
  if (type === "comment") {
    const post = db.prepare("SELECT visibility,deletedAt,isExample FROM social_posts WHERE id=?").get(row.postId);
    if (!post || post.deletedAt || post.isExample || post.visibility !== "public") return false;
  }
  return true;
}

export function contentReviewQueue(db) {
  return Object.entries(TYPES).flatMap(([type, [table, key]]) =>
    db.prepare(`SELECT * FROM ${table} WHERE reviewStatus='pending' ORDER BY createdAt,${key}`).all()
      .filter((row) => reviewable(db, type, row))
      .map((row) => ({ type, id: row[key], authorId: type === "profile" ? row.userId : row.authorId,
        createdAt: row.createdAt, title: row.title || row.displayName || "Comment",
        reviewStatus: row.reviewStatus })),
  );
}

// Fingerprint the exact content and immutable media bytes (including video posters). A stale inspect result
// cannot approve a later edit, media/alt replacement, or changed visibility.
export function inspectContent(db, type, id, mediaDir) {
  const row = targetRow(db, type, id);
  if (!reviewable(db, type, row)) throw new Error("Only real, non-deleted public submissions can be reviewed.");
  const { reviewStatus, reviewReason, reviewedAt, reviewStage, ...content } = row;
  const media = type === "post" ? db.prepare(`SELECT m.id,m.filename,m.width,m.height,m.kind,m.duration,m.posterFilename,pm.position,pm.alt
    FROM social_post_media pm JOIN social_media m ON m.id=pm.mediaId WHERE pm.postId=? ORDER BY pm.position`).all(id)
    .map((item) => {
      if (!item.filename || path.basename(item.filename) !== item.filename) throw new Error("Invalid review media path.");
      const file = path.resolve(mediaDir, item.filename);
      let poster = {};
      if (item.kind === "video") {
        if (!item.posterFilename || path.basename(item.posterFilename) !== item.posterFilename) throw new Error("Invalid review poster path.");
        const posterFile = path.resolve(mediaDir, item.posterFilename);
        poster = { posterFile, posterSha256: createHash("sha256").update(readFileSync(posterFile)).digest("hex") };
      }
      return { ...item, file, sha256: createHash("sha256").update(readFileSync(file)).digest("hex"), ...poster };
    }) : [];
  const version = createHash("sha256").update(JSON.stringify({ type, content,
    media: media.map(({ file, posterFile, ...item }) => item) })).digest("hex");
  return { type, id, version, reviewStatus, reviewReason, content, media,
    instructions: media.some(item => item.kind === "video")
      ? "Inspect all text, the poster, and watch and listen to every complete video before approving with --videos-reviewed."
      : media.length ? "Inspect all text and open every image file before approving with --images-reviewed." : "Inspect all public text before deciding." };
}

// A private, self-contained packet lets an operator inspect remote image bytes
// after securely downloading it. No user HTML, scripts, or remote assets execute.
export function reviewPacketHTML(inspection) {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const images = inspection.media.map(media => {
    const bytes = readFileSync(media.file);
    if (createHash('sha256').update(bytes).digest('hex') !== media.sha256) throw new Error('Media changed during export. Inspect again.');
    if (media.kind === 'video') {
      const poster = readFileSync(media.posterFile);
      if (createHash('sha256').update(poster).digest('hex') !== media.posterSha256) throw new Error('Poster changed during export. Inspect again.');
      return `<figure><video controls preload="metadata" playsinline poster="data:image/jpeg;base64,${poster.toString('base64')}" src="data:video/mp4;base64,${bytes.toString('base64')}"></video><figcaption>${escape(media.alt || '')} — ${escape(media.duration)} seconds. Watch the entire clip with sound. SHA256 ${media.sha256}</figcaption></figure>`;
    }
    return `<figure><img alt="${escape(media.alt || '')}" src="data:image/jpeg;base64,${bytes.toString('base64')}"><figcaption>${escape(media.alt || '')} — SHA256 ${media.sha256}</figcaption></figure>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Private Crewroom review</title><style>body{font:16px system-ui;max-width:1000px;margin:30px auto;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}img,video{max-width:100%;max-height:80vh;height:auto}figure{margin:24px 0}</style></head><body><h1>Private Crewroom review</h1><p>Keep this unpublished content private. Inspect every field and image; watch and listen to every video in full before deciding.</p><pre>${escape(JSON.stringify(inspection, null, 2))}</pre>${images}</body></html>`;
}

export function decideContent(db, { type, id, version, decision, reason = "", imagesReviewed = false, videosReviewed = false, mediaDir, action, textReviewed = false, beforeCommit, now = Date.now }) {
  if (action !== undefined && !["approve", "reject", "takedown", "restore"].includes(action)) throw new Error("Unknown moderation action.");
  if (action) {
    decision = ["approve", "restore"].includes(action) ? "approved" : "rejected";
    if (textReviewed !== true) throw new Error("Read all public text and explicitly confirm the review.");
    if (typeof reason !== "string" || !reason.trim()) throw new Error("An operator decision requires a reason.");
  }
  if (!["approved", "rejected"].includes(decision)) throw new Error("Decision must be approved or rejected.");
  if (!/^[a-f0-9]{64}$/.test(version || "")) throw new Error("Supply the exact --version fingerprint from inspect.");
  if (typeof reason !== "string" || reason.length > 1000 || (decision === "rejected" && !reason.trim()))
    throw new Error("Rejection needs a helpful reason of at most 1000 characters.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const inspection = inspectContent(db, type, id, mediaDir);
    if (inspection.version !== version) throw new Error("Content changed since inspection. Inspect it again before deciding.");
    if (!action || ["approve", "reject"].includes(action)) {
      if (inspection.reviewStatus !== "pending") throw new Error("Only pending submissions can be decided.");
    } else if (action === "takedown" && inspection.reviewStatus !== "approved") {
      throw new Error("Only approved public content can be taken down.");
    } else if (action === "restore" && inspection.reviewStatus !== "rejected" && !inspection.content.moderatedAt) {
      throw new Error("Only rejected or hidden public content can be restored.");
    }
    if (decision === "approved" && inspection.media.some(item => item.kind !== "video") && imagesReviewed !== true)
      throw new Error("Open and review every image, then explicitly supply --images-reviewed.");
    if (decision === "approved" && inspection.media.some(item => item.kind === "video") && videosReviewed !== true)
      throw new Error("Watch and listen to every complete video and inspect its poster, then explicitly supply --videos-reviewed.");
    const [table, key] = TYPES[type], time = new Date(now()).toISOString();
    db.prepare(`UPDATE ${table} SET reviewStatus=?,reviewReason=?,reviewedAt=? WHERE ${key}=?`).run(decision, reason.trim() || null, time, id);
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    if (columns.has("reviewStage")) db.prepare(`UPDATE ${table} SET reviewStage=? WHERE ${key}=?`).run(decision === "approved" ? "published" : "held", id);
    if (action === "takedown" && type === "post") db.prepare("UPDATE social_posts SET moderatedAt=? WHERE id=?").run(time, id);
    if (action === "restore" && type === "post") db.prepare("UPDATE social_posts SET moderatedAt=NULL WHERE id=?").run(id);
    db.prepare(`INSERT INTO social_content_reviews(id,targetType,targetId,version,decision,reason,imagesReviewed,videosReviewed,createdAt)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(), type, id, version, decision, reason.trim(), Number(imagesReviewed === true), Number(videosReviewed === true), time);
    if (type === "comment" && decision === "approved") {
      const comment = inspection.content;
      const post = db.prepare("SELECT authorId FROM social_posts WHERE id=?").get(comment.postId);
      if (post && post.authorId !== comment.authorId && !db.prepare("SELECT 1 FROM social_notifications WHERE commentId=? AND type='comment'").get(id))
        db.prepare(`INSERT INTO social_notifications(id,userId,type,actorId,text,postId,requestId,read,createdAt,commentId)
          VALUES(?,?,?,?,?,?,NULL,0,?,?)`).run(`notice_${randomUUID()}`, post.authorId, "comment", comment.authorId,
          "A creator commented on your project", comment.postId, time, id);
    }
    const result = { ok: true, type, id, reviewStatus: decision, version };
    if (beforeCommit) beforeCommit({ inspection, result });
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
