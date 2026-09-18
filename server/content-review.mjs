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

// Fingerprint the exact content and immutable image bytes. A stale inspect result
// cannot approve a later edit, media/alt replacement, or changed visibility.
export function inspectContent(db, type, id, mediaDir) {
  const row = targetRow(db, type, id);
  if (!reviewable(db, type, row)) throw new Error("Only real, non-deleted public submissions can be reviewed.");
  const { reviewStatus, reviewReason, reviewedAt, ...content } = row;
  const media = type === "post" ? db.prepare(`SELECT m.id,m.filename,m.width,m.height,pm.position,pm.alt
    FROM social_post_media pm JOIN social_media m ON m.id=pm.mediaId WHERE pm.postId=? ORDER BY pm.position`).all(id)
    .map((item) => {
      if (!item.filename || path.basename(item.filename) !== item.filename) throw new Error("Invalid review image path.");
      const file = path.resolve(mediaDir, item.filename);
      return { ...item, file, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") };
    }) : [];
  const version = createHash("sha256").update(JSON.stringify({ type, content,
    media: media.map(({ file, ...item }) => item) })).digest("hex");
  return { type, id, version, reviewStatus, reviewReason, content, media,
    instructions: media.length ? "Inspect all text and open every image file before approving with --images-reviewed." : "Inspect all public text before deciding." };
}

// A private, self-contained packet lets an operator inspect remote image bytes
// after securely downloading it. No user HTML, scripts, or remote assets execute.
export function reviewPacketHTML(inspection) {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const images = inspection.media.map(media => {
    const bytes = readFileSync(media.file);
    if (createHash('sha256').update(bytes).digest('hex') !== media.sha256) throw new Error('Image changed during export. Inspect again.');
    return `<figure><img alt="${escape(media.alt || '')}" src="data:image/jpeg;base64,${bytes.toString('base64')}"><figcaption>${escape(media.alt || '')} — SHA256 ${media.sha256}</figcaption></figure>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Private Crewroom review</title><style>body{font:16px system-ui;max-width:1000px;margin:30px auto;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:100%;height:auto}figure{margin:24px 0}</style></head><body><h1>Private Crewroom review</h1><p>Keep this unpublished content private. Inspect every field and image before deciding.</p><pre>${escape(JSON.stringify(inspection, null, 2))}</pre>${images}</body></html>`;
}

export function decideContent(db, { type, id, version, decision, reason = "", imagesReviewed = false, mediaDir }) {
  if (!["approved", "rejected"].includes(decision)) throw new Error("Decision must be approved or rejected.");
  if (!/^[a-f0-9]{64}$/.test(version || "")) throw new Error("Supply the exact --version fingerprint from inspect.");
  if (typeof reason !== "string" || reason.length > 1000 || (decision === "rejected" && !reason.trim()))
    throw new Error("Rejection needs a helpful reason of at most 1000 characters.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const inspection = inspectContent(db, type, id, mediaDir);
    if (inspection.version !== version) throw new Error("Content changed since inspection. Inspect it again before deciding.");
    if (inspection.reviewStatus !== "pending") throw new Error("Only pending submissions can be decided.");
    if (decision === "approved" && inspection.media.length && imagesReviewed !== true)
      throw new Error("Open and review every image, then explicitly supply --images-reviewed.");
    const [table, key] = TYPES[type], time = new Date().toISOString();
    db.prepare(`UPDATE ${table} SET reviewStatus=?,reviewReason=?,reviewedAt=? WHERE ${key}=?`).run(decision, reason.trim() || null, time, id);
    db.prepare(`INSERT INTO social_content_reviews(id,targetType,targetId,version,decision,reason,imagesReviewed,createdAt)
      VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(), type, id, version, decision, reason.trim(), Number(imagesReviewed === true), time);
    if (type === "comment" && decision === "approved") {
      const comment = inspection.content;
      const post = db.prepare("SELECT authorId FROM social_posts WHERE id=?").get(comment.postId);
      if (post && post.authorId !== comment.authorId)
        db.prepare(`INSERT INTO social_notifications(id,userId,type,actorId,text,postId,requestId,read,createdAt,commentId)
          VALUES(?,?,?,?,?,?,NULL,0,?,?)`).run(`notice_${randomUUID()}`, post.authorId, "comment", comment.authorId,
          "A creator commented on your project", comment.postId, time, id);
    }
    db.exec("COMMIT");
    return { ok: true, type, id, reviewStatus: decision, version };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
