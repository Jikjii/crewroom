#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentReviewQueue, inspectContent, decideContent, reviewPacketHTML } from "./content-review.mjs";

// Local operator tool only. There is deliberately no client-accessible admin endpoint.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let dbPath = process.env.DB_PATH || path.join(process.env.DATA_DIR || path.join(root, ".data"), "crewroom.sqlite");
const dbFlag = args.findIndex(
  (value) => value === "--db" || value.startsWith("--db="),
);
if (dbFlag >= 0) {
  const flag = args[dbFlag];
  if (flag === "--db") {
    dbPath = args[dbFlag + 1];
    args.splice(dbFlag, 2);
  } else {
    dbPath = flag.slice(5);
    args.splice(dbFlag, 1);
  }
}
const [command, target, status] = args;
function option(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const help = `Crewroom local moderation
  node server/moderate.mjs queue
  node server/moderate.mjs inspect [profile|post|comment] ID [--html /private/path/review.html]
  node server/moderate.mjs approve [profile|post|comment] ID --version HASH [--images-reviewed]
  node server/moderate.mjs reject [profile|post|comment] ID --version HASH --reason "Helpful explanation"
  node server/moderate.mjs list [all]
  node server/moderate.mjs review REPORT_ID [reviewed|dismissed]
  node server/moderate.mjs hide-post POST_ID
  node server/moderate.mjs restore-post POST_ID
  node server/moderate.mjs suspend-profile USER_ID_OR_HANDLE
  node server/moderate.mjs restore-profile USER_ID_OR_HANDLE
  Add --db PATH to use a different database.

list shows pending reports by default. review without a status displays the report
and target; supplying a status records that review. Hiding a post or suspending a
public profile does not delete private crews or account data. Changes affect new
API requests immediately. Public profiles, posts, and comments remain private to
their author until manually approved. Inspect all text and image paths first;
approval must include the matching fingerprint and an explicit assertion that
every image was reviewed. An edit invalidates the fingerprint. Review reasons
are shown only to the content author. Use MEDIA_DIR to override the image folder
(default: media alongside the database). Reports and submissions are handled
manually; no automated review or response time is promised.`;
if (!command || command === "--help" || command === "help") {
  console.log(help);
  process.exit(0);
}
if (!dbPath || !existsSync(dbPath)) {
  console.error(
    "Database not found. Start Crewroom first, or specify --db PATH.",
  );
  process.exit(1);
}
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
try {
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='social_reports'",
      )
      .get()
  )
    throw new Error(
      "Social schema is not initialized. Start the updated API first.",
    );
  if (["queue", "inspect", "approve", "reject"].includes(command)) {
    if (!db.prepare("PRAGMA table_info(social_profiles)").all().some((row) => row.name === "reviewStatus"))
      throw new Error("Review schema is not initialized. Start the updated API first.");
    const mediaDir = process.env.MEDIA_DIR || path.join(path.dirname(path.resolve(dbPath)), "media");
    const result = command === "queue" ? contentReviewQueue(db)
      : command === "inspect" ? inspectContent(db, target, status, mediaDir)
      : decideContent(db, { type: target, id: status, version: option("--version"),
        decision: command === "approve" ? "approved" : "rejected", reason: option("--reason") || "",
        imagesReviewed: args.includes("--images-reviewed"), mediaDir });
    if (command === "inspect" && option("--html")) {
      const output = path.resolve(option("--html"));
      const publicRoots = [path.join(root, "dist"), process.env.STATIC_DIR, mediaDir].filter(Boolean).map(p => path.resolve(p));
      if (publicRoots.some(p => output === p || output.startsWith(p + path.sep))) throw new Error("Review packets must stay outside public web/media folders.");
      writeFileSync(output, reviewPacketHTML(result), { mode: 0o600, flag: 'wx' });
      console.log(JSON.stringify({ type: result.type, id: result.id, version: result.version, privatePacket: output }));
    } else console.log(JSON.stringify(result, null, 2));
  } else if (command === "list") {
    const rows = db
      .prepare(
        `SELECT id,targetType,targetId,reason,details,status,createdAt,reviewedAt FROM social_reports ${target === "all" ? "" : "WHERE status='pending'"} ORDER BY createdAt,id`,
      )
      .all();
    console.log(JSON.stringify(rows, null, 2));
  } else if (command === "review") {
    const report = db
      .prepare("SELECT * FROM social_reports WHERE id=?")
      .get(target || "");
    if (!report) throw new Error("Report not found.");
    if (status && !["reviewed", "dismissed"].includes(status))
      throw new Error("Review status must be reviewed or dismissed.");
    if (status)
      db.prepare(
        "UPDATE social_reports SET status=?,reviewedAt=? WHERE id=?",
      ).run(status, new Date().toISOString(), report.id);
    const table = {
      post: "social_posts",
      profile: "social_profiles",
      comment: "social_comments",
    }[report.targetType];
    const content = table
      ? db
          .prepare(
            `SELECT * FROM ${table} WHERE ${report.targetType === "profile" ? "userId" : "id"}=?`,
          )
          .get(report.targetId)
      : null;
    console.log(
      JSON.stringify(
        {
          report: db
            .prepare("SELECT * FROM social_reports WHERE id=?")
            .get(report.id),
          content: content || null,
        },
        null,
        2,
      ),
    );
  } else if (["hide-post", "restore-post"].includes(command)) {
    const result = db
      .prepare(
        "UPDATE social_posts SET moderatedAt=?,updatedAt=? WHERE id=? AND deletedAt IS NULL",
      )
      .run(
        command === "hide-post" ? new Date().toISOString() : null,
        new Date().toISOString(),
        target || "",
      );
    if (!result.changes) throw new Error("Post not found.");
    console.log(
      JSON.stringify({
        ok: true,
        postId: target,
        hidden: command === "hide-post",
      }),
    );
  } else if (["suspend-profile", "restore-profile"].includes(command)) {
    const profile = db
      .prepare("SELECT userId FROM social_profiles WHERE userId=? OR handle=?")
      .get(target || "", (target || "").toLowerCase());
    if (!profile) throw new Error("Profile not found.");
    db.prepare(
      "UPDATE social_profiles SET suspendedAt=?,updatedAt=? WHERE userId=?",
    ).run(
      command === "suspend-profile" ? new Date().toISOString() : null,
      new Date().toISOString(),
      profile.userId,
    );
    console.log(
      JSON.stringify({
        ok: true,
        userId: profile.userId,
        suspended: command === "suspend-profile",
      }),
    );
  } else throw new Error(`Unknown command.\n${help}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
