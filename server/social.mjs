import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync, createReadStream } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import sharp from "sharp";
import { migrateContentReview } from "./content-review.mjs";

const EXAMPLES = new Set([
  "sky-portrait.png",
  "forest-maker.png",
  "armor-workbench.png",
]);
const EXAMPLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../assets/demo",
);
const PAGE_SIZE = 12;

/** Additive social schema; no private crew fields are copied into public records. */
export function createSocial({
  db,
  get,
  all,
  run,
  insert,
  transaction,
  id,
  stamp,
  now,
  fail,
  string,
  date,
  own,
  send,
  body,
  mutation,
  limited,
  addMember,
  activity,
  mediaDir,
}) {
  mkdirSync(mediaDir, { recursive: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_profiles (
      userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
      displayName TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', roles TEXT NOT NULL DEFAULT '[]', fandoms TEXT NOT NULL DEFAULT '[]',
      city TEXT NOT NULL DEFAULT '', websiteUrl TEXT NOT NULL DEFAULT '', instagramUrl TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'private', openToCollab INTEGER NOT NULL DEFAULT 0, isExample INTEGER NOT NULL DEFAULT 0,
      suspendedAt TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS social_posts (
      id TEXT PRIMARY KEY, authorId TEXT NOT NULL REFERENCES social_profiles(userId) ON DELETE CASCADE,
      title TEXT NOT NULL, character TEXT NOT NULL DEFAULT '', fandom TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'private', credits TEXT NOT NULL DEFAULT '[]', opportunity TEXT,
      isExample INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, deletedAt TEXT, moderatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS social_media (
      id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, filename TEXT NOT NULL,
      width INTEGER NOT NULL, height INTEGER NOT NULL, alt TEXT NOT NULL DEFAULT '', exampleFilename TEXT, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS social_post_media (
      postId TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE, mediaId TEXT NOT NULL REFERENCES social_media(id),
      position INTEGER NOT NULL, alt TEXT NOT NULL DEFAULT '', PRIMARY KEY(postId,mediaId)
    );
    CREATE TABLE IF NOT EXISTS social_comments (
      id TEXT PRIMARY KEY, postId TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
      authorId TEXT NOT NULL REFERENCES social_profiles(userId), body TEXT NOT NULL, createdAt TEXT NOT NULL, deletedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS social_follows (
      followerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, followedId TEXT NOT NULL REFERENCES social_profiles(userId) ON DELETE CASCADE,
      createdAt TEXT NOT NULL, PRIMARY KEY(followerId,followedId)
    );
    CREATE TABLE IF NOT EXISTS social_saves (
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, postId TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL, PRIMARY KEY(userId,postId)
    );
    CREATE TABLE IF NOT EXISTS social_requests (
      id TEXT PRIMARY KEY, senderId TEXT NOT NULL REFERENCES social_profiles(userId), recipientId TEXT NOT NULL REFERENCES social_profiles(userId),
      postId TEXT REFERENCES social_posts(id), title TEXT NOT NULL, role TEXT NOT NULL, message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      crewId TEXT REFERENCES crews(id), projectId TEXT REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS social_notifications (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL,
      actorId TEXT REFERENCES social_profiles(userId), text TEXT NOT NULL, postId TEXT REFERENCES social_posts(id),
      requestId TEXT REFERENCES social_requests(id), read INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS social_blocks (
      blockerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, blockedId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL, PRIMARY KEY(blockerId,blockedId)
    );
    CREATE TABLE IF NOT EXISTS social_reports (
      id TEXT PRIMARY KEY, reporterId TEXT NOT NULL REFERENCES users(id), targetType TEXT NOT NULL, targetId TEXT NOT NULL,
      reason TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', createdAt TEXT NOT NULL, reviewedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS social_posts_author ON social_posts(authorId,createdAt,id);
    CREATE INDEX IF NOT EXISTS social_posts_feed ON social_posts(createdAt DESC,id DESC);
    CREATE INDEX IF NOT EXISTS social_comments_post ON social_comments(postId,createdAt);
    CREATE INDEX IF NOT EXISTS social_media_owner ON social_media(ownerId);
    CREATE INDEX IF NOT EXISTS social_requests_recipient ON social_requests(recipientId,status);
    CREATE INDEX IF NOT EXISTS social_notifications_user ON social_notifications(userId,createdAt);
    CREATE INDEX IF NOT EXISTS social_reports_target ON social_reports(reporterId,targetType,targetId);
  `);
  migrateContentReview(db);

  function profileRow(userId) {
    return get(
      "SELECT p.*,u.isDemo FROM social_profiles p JOIN users u ON u.id=p.userId WHERE p.userId=?",
      userId,
    );
  }
  function ensureProfile(user) {
    let profile = profileRow(user.id);
    if (profile) return profile;
    const stem =
      user.name
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 18) || "creator";
    let handle = `${stem}_${id("h").slice(-8).replace(/-/g, "")}`;
    while (get("SELECT userId FROM social_profiles WHERE handle=?", handle))
      handle = `creator_${id("h").slice(-12)}`;
    insert("social_profiles", {
      userId: user.id,
      handle,
      displayName: user.name,
      bio: "",
      roles: "[]",
      fandoms: "[]",
      city: "",
      websiteUrl: "",
      instagramUrl: "",
      visibility: "private",
      openToCollab: 0,
      isExample: 0,
      suspendedAt: null,
      createdAt: stamp(),
      updatedAt: stamp(),
    });
    return profileRow(user.id);
  }
  const blocked = (a, b) =>
    Boolean(
      a &&
      b &&
      a !== b &&
      get(
        "SELECT 1 FROM social_blocks WHERE (blockerId=? AND blockedId=?) OR (blockerId=? AND blockedId=?)",
        a,
        b,
        b,
        a,
      ),
    );
  function profileVisible(profile, viewer) {
    if (!profile) return false;
    if (viewer?.id === profile.userId) return true;
    return (
      !profile.isDemo &&
      !profile.suspendedAt &&
      profile.visibility === "public" &&
      profile.reviewStatus === "approved" &&
      !blocked(viewer?.id, profile.userId)
    );
  }
  function postVisible(post, viewer, { ignoreReport = false } = {}) {
    if (!post || post.deletedAt) return false;
    if (viewer?.id === post.authorId) return true;
    if (
      post.visibility !== "public" ||
      post.reviewStatus !== "approved" ||
      post.moderatedAt ||
      !profileVisible(profileRow(post.authorId), viewer)
    )
      return false;
    return (
      ignoreReport ||
      !viewer ||
      !get(
        "SELECT 1 FROM social_reports WHERE reporterId=? AND targetType='post' AND targetId=?",
        viewer.id,
        post.id,
      )
    );
  }
  function requirePost(postId, viewer, options) {
    const post = get("SELECT * FROM social_posts WHERE id=?", postId);
    if (!postVisible(post, viewer, options))
      fail(404, "This project is not available.");
    return post;
  }
  function requireProfile(userId, viewer) {
    const profile = profileRow(userId);
    if (!profileVisible(profile, viewer))
      fail(404, "This creator is not available.");
    return profile;
  }
  function realUser(user, publicIdentity = false) {
    if (!user) fail(401, "Sign in to continue.");
    if (user.isDemo)
      fail(
        403,
        "Save your demo as a real account to interact with other creators.",
      );
    const profile = ensureProfile(user);
    if (profile.suspendedAt)
      fail(403, "This profile cannot participate in the public network.");
    if (publicIdentity && profile.visibility !== "public")
      fail(
        403,
        "Make your creator profile public before contacting other creators.",
      );
    if (publicIdentity && profile.reviewStatus !== "approved")
      fail(403, "Your public creator profile needs review before interacting with other creators.");
    return profile;
  }
  function contactTarget(target, viewer) {
    if (target.isExample)
      fail(403, "This is a readonly fictional example, not a real creator.");
    if (
      target.isDemo ||
      target.suspendedAt ||
      blocked(viewer.id, target.userId)
    )
      fail(404, "This creator is not available.");
  }
  function profileJSON(profile, viewer) {
    const followers = profile.isExample
      ? []
      : all(
          "SELECT followerId FROM social_follows WHERE followedId=?",
          profile.userId,
        ).filter((edge) => {
          const actor = profileRow(edge.followerId);
          return (
            actor &&
            !actor.isDemo &&
            !actor.suspendedAt &&
            actor.visibility === "public" &&
            actor.reviewStatus === "approved" &&
            !blocked(viewer?.id, actor.userId) &&
            !blocked(profile.userId, actor.userId)
          );
        });
    const projects = all(
      "SELECT * FROM social_posts WHERE authorId=? AND deletedAt IS NULL",
      profile.userId,
    ).filter((post) => postVisible(post, viewer));
    return {
      userId: profile.userId,
      handle: profile.handle,
      displayName: profile.displayName,
      bio: profile.bio,
      roles: JSON.parse(profile.roles),
      fandoms: JSON.parse(profile.fandoms),
      city: profile.city,
      websiteUrl: profile.websiteUrl,
      instagramUrl: profile.instagramUrl,
      visibility: profile.visibility,
      openToCollab: Boolean(profile.openToCollab),
      isExample: Boolean(profile.isExample),
      viewerFollowing: Boolean(
        viewer &&
        get(
          "SELECT 1 FROM social_follows WHERE followerId=? AND followedId=?",
          viewer.id,
          profile.userId,
        ),
      ),
      followerCount: followers.length,
      projectCount: projects.length,
      ...reviewJSON(profile, viewer, profile.userId),
    };
  }
  function reviewJSON(record, viewer, authorId) {
    if (viewer?.id !== authorId || viewer.isDemo || record.isExample || record.visibility === "private") return {};
    return { reviewStatus: record.reviewStatus,
      ...(record.reviewReason ? { reviewReason: record.reviewReason } : {}) };
  }
  function mediaJSON(media, alt = media.alt) {
    return {
      id: media.id,
      url: media.exampleFilename
        ? `/api/social/examples/${media.exampleFilename}`
        : `/api/social/media/${media.id}`,
      width: media.width,
      height: media.height,
      alt,
    };
  }
  function commentsFor(postId, viewer) {
    return all(
      "SELECT * FROM social_comments WHERE postId=? AND deletedAt IS NULL ORDER BY createdAt,id",
      postId,
    ).filter((comment) => {
      const profile = profileRow(comment.authorId);
      return (
        profile &&
        (comment.reviewStatus === "approved" || viewer?.id === comment.authorId) &&
        profileVisible(profile, viewer) &&
        !profile.suspendedAt &&
        (!profile.isDemo || viewer?.id === profile.userId) &&
        !blocked(viewer?.id, comment.authorId)
      );
    });
  }
  function postJSON(post, viewer) {
    const media = all(
      "SELECT m.*,pm.alt AS postAlt FROM social_post_media pm JOIN social_media m ON m.id=pm.mediaId WHERE pm.postId=? ORDER BY pm.position",
      post.id,
    );
    const credits = JSON.parse(post.credits).map((credit) => {
      if (
        credit.profileId &&
        !profileVisible(profileRow(credit.profileId), viewer)
      ) {
        const { profileId, ...plain } = credit;
        return plain;
      }
      return credit;
    });
    return {
      id: post.id,
      author: profileJSON(profileRow(post.authorId), viewer),
      title: post.title,
      character: post.character,
      fandom: post.fandom,
      stage: post.stage,
      body: post.body,
      visibility: post.visibility,
      media: media.map((item) => mediaJSON(item, item.postAlt)),
      credits,
      opportunity: post.opportunity ? JSON.parse(post.opportunity) : null,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      viewerSaved: Boolean(
        viewer &&
        get(
          "SELECT 1 FROM social_saves WHERE userId=? AND postId=?",
          viewer.id,
          post.id,
        ),
      ),
      commentCount: post.isExample ? 0 : commentsFor(post.id, viewer).length,
      isExample: Boolean(post.isExample),
      ...reviewJSON(post, viewer, post.authorId),
    };
  }
  function commentJSON(comment, viewer) {
    return {
      id: comment.id,
      postId: comment.postId,
      author: profileJSON(profileRow(comment.authorId), viewer),
      body: comment.body,
      createdAt: comment.createdAt,
      ...reviewJSON(comment, viewer, comment.authorId),
    };
  }
  function requestVisible(request, viewer) {
    if (
      !request ||
      !viewer ||
      ![request.senderId, request.recipientId].includes(viewer.id) ||
      blocked(request.senderId, request.recipientId)
    )
      return false;
    const sender = profileRow(request.senderId),
      recipient = profileRow(request.recipientId);
    return (
      sender &&
      recipient &&
      !sender.isDemo &&
      !recipient.isDemo &&
      !sender.suspendedAt &&
      !recipient.suspendedAt
      && profileVisible(sender, viewer) && profileVisible(recipient, viewer)
    );
  }
  function requestJSON(request, viewer) {
    const post = request.postId
      ? get("SELECT * FROM social_posts WHERE id=?", request.postId)
      : null;
    return {
      id: request.id,
      sender: profileJSON(profileRow(request.senderId), viewer),
      recipient: profileJSON(profileRow(request.recipientId), viewer),
      postId: post && postVisible(post, viewer) ? post.id : null,
      title: request.title,
      role: request.role,
      message: request.message,
      status: request.status,
      createdAt: request.createdAt,
      crewId: request.crewId,
      projectId: request.projectId,
    };
  }
  function notify(
    userId,
    type,
    actorId,
    text,
    postId = null,
    requestId = null,
  ) {
    if (userId === actorId || blocked(userId, actorId)) return;
    insert("social_notifications", {
      id: id("notice"),
      userId,
      type,
      actorId,
      text,
      postId,
      requestId,
      read: 0,
      createdAt: stamp(),
    });
  }
  function notificationText(notice) {
    const name = notice.actorId ? profileRow(notice.actorId)?.displayName || "A creator" : "A creator";
    const title = notice.postId ? get("SELECT title FROM social_posts WHERE id=?", notice.postId)?.title : null;
    return {
      follow: `${name} followed you`,
      comment: `${name} commented on ${title || "your project"}`,
      request: `${name} sent a collaboration request`,
      accepted: `${name} accepted your collaboration request`,
      declined: `${name} declined your collaboration request`,
    }[notice.type] || "Network activity";
  }
  function bool(value, field) {
    if (typeof value !== "boolean")
      fail(400, `${field} must be true or false.`);
    return Number(value);
  }
  function enumValue(value, choices, field) {
    if (!choices.includes(value)) fail(400, `Invalid ${field}.`);
    return value;
  }
  function textArray(value, field) {
    if (!Array.isArray(value) || value.length > 12)
      fail(400, `${field} must be a list of at most 12 items.`);
    return JSON.stringify([
      ...new Set(
        value.map((item) => string(item, field, { required: true, max: 60 })),
      ),
    ]);
  }
  function httpsLink(value, field) {
    const clean = string(value, field, { max: 1000 });
    if (!clean) return "";
    try {
      const url = new URL(clean);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error();
      return url.href;
    } catch {
      fail(400, `${field} must be an HTTPS URL or empty.`);
    }
  }
  function patchProfile(user, data) {
    const profile = ensureProfile(user),
      fields = {};
    if (own(data, "handle")) {
      const handle = string(data.handle, "handle", {
        required: true,
        max: 30,
      }).toLowerCase();
      if (!/^[a-z0-9_]{3,30}$/.test(handle))
        fail(400, "Handle must be 3–30 letters, numbers, or underscores.");
      if (
        get(
          "SELECT 1 FROM social_profiles WHERE handle=? AND userId<>?",
          handle,
          user.id,
        )
      )
        fail(409, "That handle is already in use.");
      fields.handle = handle;
    }
    for (const [field, max] of [
      ["displayName", 100],
      ["bio", 2000],
      ["city", 100],
    ])
      if (own(data, field))
        fields[field] = string(data[field], field, {
          required: field === "displayName",
          max,
        });
    for (const field of ["roles", "fandoms"])
      if (own(data, field)) fields[field] = textArray(data[field], field);
    for (const field of ["websiteUrl", "instagramUrl"])
      if (own(data, field)) fields[field] = httpsLink(data[field], field);
    if (own(data, "visibility"))
      fields.visibility = enumValue(
        data.visibility,
        ["public", "private"],
        "visibility",
      );
    if (own(data, "openToCollab"))
      fields.openToCollab = bool(data.openToCollab, "openToCollab");
    if (!Object.keys(fields).length)
      fail(400, "No editable profile fields supplied.");
    fields.reviewStatus = "pending";
    fields.reviewReason = null;
    fields.reviewedAt = null;
    fields.updatedAt = stamp();
    run(
      `UPDATE social_profiles SET ${Object.keys(fields)
        .map((key) => `${key}=?`)
        .join(",")} WHERE userId=?`,
      ...Object.values(fields),
      profile.userId,
    );
    return profileRow(user.id);
  }
  function validateCredits(value, viewer) {
    if (!Array.isArray(value) || value.length > 20)
      fail(400, "credits must contain at most 20 people.");
    return value.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        fail(400, "Each credit must be an object.");
      const credit = {
        name: string(item.name, "credit name", { required: true, max: 100 }),
        role: string(item.role, "credit role", { required: true, max: 100 }),
      };
      if (own(item, "profileId")) {
        const target = string(item.profileId, "profileId", {
          required: true,
          max: 100,
        });
        requireProfile(target, viewer);
        credit.profileId = target;
      }
      return credit;
    });
  }
  function validateOpportunity(value) {
    if (value === null) return null;
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(400, "opportunity must be an object or null.");
    return {
      role: string(value.role, "opportunity role", {
        required: true,
        max: 100,
      }),
      city: string(value.city, "opportunity city", { max: 100 }),
      eventName: string(value.eventName, "eventName", { max: 200 }),
      date: date(value.date, "opportunity date"),
    };
  }
  function editablePost(user, data, previous) {
    const result = {};
    for (const [field, max] of [
      ["title", 200],
      ["character", 200],
      ["fandom", 200],
      ["body", 10000],
    ])
      if (!previous || own(data, field))
        result[field] = string(data[field], field, {
          required: field === "title",
          max,
        });
    if (!previous || own(data, "stage"))
      result.stage = enumValue(
        data.stage,
        ["wip", "finished", "tutorial"],
        "stage",
      );
    if (!previous || own(data, "visibility"))
      result.visibility = enumValue(
        data.visibility ?? "private",
        ["public", "private"],
        "visibility",
      );
    if (!previous || own(data, "credits"))
      result.credits = JSON.stringify(
        validateCredits(data.credits ?? [], user),
      );
    if (!previous || own(data, "opportunity")) {
      const opportunity = validateOpportunity(data.opportunity ?? null);
      result.opportunity = opportunity ? JSON.stringify(opportunity) : null;
    }
    let mediaIds;
    if (!previous || own(data, "mediaIds")) {
      if (!Array.isArray(data.mediaIds) || data.mediaIds.length > 4)
        fail(400, "mediaIds must contain up to four uploaded images.");
      mediaIds = data.mediaIds.map((value) =>
        string(value, "mediaId", { required: true, max: 100 }),
      );
      if (new Set(mediaIds).size !== mediaIds.length)
        fail(400, "Each image may only appear once in a project.");
      for (const mediaId of mediaIds)
        if (
          !get(
            "SELECT id FROM social_media WHERE id=? AND ownerId=? AND exampleFilename IS NULL",
            mediaId,
            user.id,
          )
        )
          fail(400, "Use images uploaded by your own account.");
    } else
      mediaIds = all(
        "SELECT mediaId FROM social_post_media WHERE postId=? ORDER BY position",
        previous.id,
      ).map((item) => item.mediaId);
    let alts;
    if (own(data, "mediaAlts")) {
      if (
        !Array.isArray(data.mediaAlts) ||
        data.mediaAlts.length !== mediaIds.length
      )
        fail(400, "Provide one alt description for each image.");
      alts = data.mediaAlts.map((value) =>
        string(value, "image alt", { max: 500 }),
      );
    } else
      alts = mediaIds.map((mediaId) =>
        previous
          ? get(
              "SELECT alt FROM social_post_media WHERE postId=? AND mediaId=?",
              previous.id,
              mediaId,
            )?.alt || ""
          : "",
      );
    if ((result.visibility ?? previous?.visibility) === "public") {
      if (!mediaIds.length)
        fail(400, "A public project needs at least one image.");
      const profile = ensureProfile(user);
      if (profile.suspendedAt)
        fail(403, "This profile cannot publish to the public network.");
      if (profile.visibility !== "public" && data.publishProfile !== true)
        fail(
          400,
          "Make your profile public before publishing, or explicitly confirm publishProfile.",
        );
    }
    if (own(data, "publishProfile"))
      bool(data.publishProfile, "publishProfile");
    return { fields: result, mediaIds, alts };
  }
  function persistPost(user, data, previous) {
    ensureProfile(user);
    const { fields, mediaIds, alts } = editablePost(user, data, previous);
    return transaction(() => {
      if (data.publishProfile === true)
        run(
          "UPDATE social_profiles SET visibility='public',reviewStatus='pending',reviewReason=NULL,reviewedAt=NULL,updatedAt=? WHERE userId=? AND visibility<>'public'",
          stamp(),
          user.id,
        );
      const postId = previous?.id || id("post");
      fields.reviewStatus = "pending";
      fields.reviewReason = null;
      fields.reviewedAt = null;
      if (previous) {
        fields.updatedAt = stamp();
        run(
          `UPDATE social_posts SET ${Object.keys(fields)
            .map((key) => `${key}=?`)
            .join(",")} WHERE id=?`,
          ...Object.values(fields),
          postId,
        );
      } else
        insert("social_posts", {
          id: postId,
          authorId: user.id,
          ...fields,
          isExample: 0,
          createdAt: stamp(),
          updatedAt: stamp(),
          deletedAt: null,
          moderatedAt: null,
        });
      run("DELETE FROM social_post_media WHERE postId=?", postId);
      mediaIds.forEach((mediaId, position) =>
        insert("social_post_media", {
          postId,
          mediaId,
          position,
          alt: alts[position],
        }),
      );
      return get("SELECT * FROM social_posts WHERE id=?", postId);
    });
  }

  // Stable, isolated example records contain no real identities, memberships, or activity counts.
  transaction(() => {
    const examples = [
      [
        "sky",
        "Aster Vale",
        "aster_example",
        "The skybound captain",
        "The sky captain",
        "finished",
        "sky-portrait.png",
        ["Costume maker", "Cosplayer"],
        "Soft cloud-blue layers, silver details, and a handmade explorer’s cape. A fictional concept project illustrated with AI; no real person or collaboration is represented.",
      ],
      [
        "forest",
        "Fern Studio",
        "fern_example",
        "A keeper of the green",
        "The forest keeper",
        "finished",
        "forest-maker.png",
        ["Cosplayer", "Stylist"],
        "Botanical textures and a woodland silhouette, imagined as an original character. This readonly fictional concept is AI-illustrated.",
      ],
      [
        "armor",
        "Nova Workshop",
        "nova_example",
        "From foam to starlight",
        "The starlight guardian",
        "wip",
        "armor-workbench.png",
        ["Prop maker", "Costume maker"],
        "An imagined workbench study of foam armor, layered paint, and small luminous details. A fictional AI-illustrated example, not a real build tutorial.",
      ],
    ];
    for (const [
      key,
      name,
      handle,
      title,
      character,
      stage,
      filename,
      roles,
      description,
    ] of examples) {
      const userId = `example_${key}`,
        postId = `example_post_${key}`,
        mediaId = `example_media_${key}`;
      if (get("SELECT userId FROM social_profiles WHERE userId=?", userId))
        continue;
      if (!get("SELECT id FROM users WHERE id=?", userId))
        insert("users", {
          id: userId,
          name,
          email: null,
          passwordHash: null,
          salt: null,
          isDemo: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      insert("social_profiles", {
        userId,
        handle,
        displayName: name,
        bio: "Fictional example creator · AI-illustrated concept work. This profile is readonly.",
        roles: JSON.stringify(roles),
        fandoms: '["Original characters"]',
        city: "",
        websiteUrl: "",
        instagramUrl: "",
        visibility: "public",
        openToCollab: 0,
        isExample: 1,
        reviewStatus: "approved",
        suspendedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      insert("social_media", {
        id: mediaId,
        ownerId: userId,
        filename: "",
        width: 1024,
        height: 1536,
        alt: `AI illustration for the fictional project ${title}`,
        exampleFilename: filename,
        createdAt: stamp(),
      });
      insert("social_posts", {
        id: postId,
        authorId: userId,
        title,
        character,
        fandom: "Original characters",
        stage,
        body: description,
        visibility: "public",
        credits:
          '[{"name":"Crewroom example gallery","role":"AI-assisted concept illustration"}]',
        opportunity: null,
        isExample: 1,
        reviewStatus: "approved",
        createdAt: `2026-01-0${examples.findIndex((item) => item[0] === key) + 1}T00:00:00.000Z`,
        updatedAt: stamp(),
        deletedAt: null,
        moderatedAt: null,
      });
      insert("social_post_media", {
        postId,
        mediaId,
        position: 0,
        alt: `AI illustration for the fictional project ${title}`,
      });
    }
  });

  const route = async function socialRoute(req, res, url, context) {
    const pathname = url.pathname,
      user = context.user;
    if (!pathname.startsWith("/api/social/")) return false;
    if (!["GET", "HEAD"].includes(req.method)) {
      mutation(req, context);
      limited(
        req,
        `social:${user.id}:${pathname === "/api/social/media" ? "upload" : "interaction"}`,
        pathname === "/api/social/media" ? 40 : 150,
      );
    }
    const respond = (status, value) => {
      send(res, status, value);
      return true;
    };
    const requireUser = () => {
      if (!user) fail(401, "Sign in to continue.");
      return ensureProfile(user);
    };

    const exampleMatch = pathname.match(/^\/api\/social\/examples\/([^/]+)$/);
    if (exampleMatch && ["GET", "HEAD"].includes(req.method)) {
      if (!EXAMPLES.has(exampleMatch[1])) fail(404, "Image not found.");
      const file = path.join(EXAMPLE_DIR, exampleMatch[1]);
      if (!existsSync(file)) fail(404, "Example image is not available yet.");
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      });
      if (req.method === "HEAD") res.end();
      else {
        const stream = createReadStream(file);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      }
      return true;
    }
    if (pathname === "/api/social/me") {
      const profile = requireUser();
      if (req.method === "GET") return respond(200, profileJSON(profile, user));
      if (req.method === "PATCH")
        return respond(
          200,
          profileJSON(patchProfile(user, await body(req)), user),
        );
    }
    if (pathname === "/api/social/profiles" && req.method === "GET") {
      const q = string(url.searchParams.get("q") ?? "", "search", {
        max: 100,
      }).toLowerCase();
      const role = string(url.searchParams.get("role") ?? "", "role", {
        max: 60,
      }).toLowerCase();
      if (user?.isDemo) ensureProfile(user);
      const profiles = all(
        "SELECT p.*,u.isDemo FROM social_profiles p JOIN users u ON u.id=p.userId ORDER BY p.isExample,p.displayName,p.userId",
      ).filter(
        (profile) =>
          profileVisible(profile, user) &&
          (profile.visibility === "public" ||
            (user?.isDemo && user.id === profile.userId)) &&
          (!q ||
            `${profile.displayName} ${profile.handle} ${profile.bio} ${profile.fandoms} ${profile.city}`
              .toLowerCase()
              .includes(q)) &&
          (!role ||
            JSON.parse(profile.roles).some((item) =>
              item.toLowerCase().includes(role),
            )),
      );
      return respond(
        200,
        profiles.slice(0, 100).map((profile) => profileJSON(profile, user)),
      );
    }
    const profileMatch = pathname.match(/^\/api\/social\/profiles\/([^/]+)$/);
    if (profileMatch && req.method === "GET") {
      let handle;
      try {
        handle = decodeURIComponent(profileMatch[1]).toLowerCase();
      } catch {
        fail(400, "Invalid handle.");
      }
      const raw = get(
          "SELECT userId FROM social_profiles WHERE handle=?",
          handle,
        ),
        profile = raw ? profileRow(raw.userId) : null;
      if (!profileVisible(profile, user))
        fail(404, "This creator is not available.");
      const posts = all(
        "SELECT * FROM social_posts WHERE authorId=? ORDER BY createdAt DESC,id DESC",
        profile.userId,
      )
        .filter((post) => postVisible(post, user))
        .map((post) => postJSON(post, user));
      return respond(200, { profile: profileJSON(profile, user), posts });
    }
    if (pathname === "/api/social/feed" && req.method === "GET") {
      const mode = enumValue(
        url.searchParams.get("mode") || "discover",
        ["discover", "following", "saved"],
        "feed mode",
      );
      if (mode !== "discover") requireUser();
      const stage = url.searchParams.get("stage");
      if (stage) enumValue(stage, ["wip", "finished", "tutorial"], "stage");
      const q = string(url.searchParams.get("q") ?? "", "search", {
        max: 100,
      }).toLowerCase();
      const openRoles = url.searchParams.get("openRoles") === "1";
      let cursor = null;
      if (url.searchParams.get("cursor")) {
        try {
          const text = url.searchParams.get("cursor");
          if (text.length > 500 || !/^[a-zA-Z0-9_-]+$/.test(text))
            throw new Error();
          cursor = JSON.parse(Buffer.from(text, "base64url").toString());
          if (
            !cursor ||
            typeof cursor.createdAt !== "string" ||
            typeof cursor.id !== "string"
          )
            throw new Error();
        } catch {
          fail(400, "Invalid feed cursor.");
        }
      }
      const items = all(
        "SELECT * FROM social_posts ORDER BY createdAt DESC,id DESC",
      ).filter((post) => {
        if (
          !postVisible(post, user) ||
          (stage && stage !== post.stage) ||
          (openRoles && !post.opportunity)
        )
          return false;
        if (
          cursor &&
          !(
            post.createdAt < cursor.createdAt ||
            (post.createdAt === cursor.createdAt && post.id < cursor.id)
          )
        )
          return false;
        if (
          mode === "following" &&
          !get(
            "SELECT 1 FROM social_follows WHERE followerId=? AND followedId=?",
            user.id,
            post.authorId,
          )
        )
          return false;
        if (
          mode === "saved" &&
          !get(
            "SELECT 1 FROM social_saves WHERE userId=? AND postId=?",
            user.id,
            post.id,
          )
        )
          return false;
        const author = profileRow(post.authorId);
        return (
          !q ||
          `${post.title} ${post.character} ${post.fandom} ${post.body} ${author.displayName} ${post.opportunity || ""}`
            .toLowerCase()
            .includes(q)
        );
      });
      const page = items.slice(0, PAGE_SIZE),
        last = page.at(-1);
      return respond(200, {
        items: page.map((post) => postJSON(post, user)),
        nextCursor:
          items.length > PAGE_SIZE
            ? Buffer.from(
                JSON.stringify({ createdAt: last.createdAt, id: last.id }),
              ).toString("base64url")
            : null,
      });
    }
    if (pathname === "/api/social/media" && req.method === "POST") {
      requireUser();
      const data = await body(req, 8 * 1024 * 1024);
      if (!["image/jpeg", "image/png", "image/webp"].includes(data.mimeType))
        fail(400, "Upload a JPEG, PNG, or WebP image.");
      if (
        typeof data.base64 !== "string" ||
        !data.base64.length ||
        data.base64.length > 7 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64) ||
        data.base64.length % 4 !== 0
      )
        fail(400, "Invalid base64 image.");
      const input = Buffer.from(data.base64, "base64");
      if (!input.length || input.length > 5 * 1024 * 1024)
        fail(413, "Images must be at most 5 MB.");
      let encoded;
      try {
        const pipeline = sharp(input, {
          limitInputPixels: 25_000_000,
          failOn: "warning",
          animated: false,
        });
        const metadata = await pipeline.metadata();
        if (
          !["jpeg", "png", "webp"].includes(metadata.format) ||
          `image/${metadata.format}` !== data.mimeType ||
          (metadata.pages || 1) > 1
        )
          fail(
            400,
            "Use a single JPEG, PNG, or WebP image matching its media type.",
          );
        encoded = await pipeline
          .rotate()
          .resize({
            width: 1600,
            height: 1600,
            fit: "inside",
            withoutEnlargement: true,
          })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 86, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
      } catch (error) {
        if (error.status) throw error;
        fail(
          400,
          "The image could not be decoded, or exceeds 25 million pixels.",
        );
      }
      const mediaId = id("media"),
        filename = `${mediaId}.jpg`,
        file = path.join(mediaDir, filename);
      await writeFile(file, encoded.data, { flag: "wx", mode: 0o600 });
      try {
        const media = insert("social_media", {
          id: mediaId,
          ownerId: user.id,
          filename,
          width: encoded.info.width,
          height: encoded.info.height,
          alt: "",
          exampleFilename: null,
          createdAt: stamp(),
        });
        return respond(201, mediaJSON(media));
      } catch (error) {
        await unlink(file).catch(() => {});
        throw error;
      }
    }
    const mediaMatch = pathname.match(/^\/api\/social\/media\/([^/]+)$/);
    if (mediaMatch && ["GET", "HEAD"].includes(req.method)) {
      const media = get(
        "SELECT * FROM social_media WHERE id=? AND exampleFilename IS NULL",
        mediaMatch[1],
      );
      if (!media) fail(404, "Image not found.");
      const attachments = all(
        "SELECT p.* FROM social_posts p JOIN social_post_media pm ON pm.postId=p.id WHERE pm.mediaId=?",
        media.id,
      );
      const visibleAttachment = attachments.some((post) =>
        postVisible(post, user),
      );
      if (
        !visibleAttachment &&
        !(media.ownerId === user?.id && attachments.length === 0)
      )
        fail(404, "Image not found.");
      const file = path.join(mediaDir, media.filename);
      if (!existsSync(file)) fail(404, "Image not found.");
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
      });
      if (req.method === "HEAD") res.end();
      else {
        const stream = createReadStream(file);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      }
      return true;
    }
    if (pathname === "/api/social/posts" && req.method === "POST") {
      requireUser();
      return respond(201, postJSON(persistPost(user, await body(req)), user));
    }
    const postMatch = pathname.match(/^\/api\/social\/posts\/([^/]+)$/);
    if (postMatch) {
      const post = requirePost(postMatch[1], user);
      if (req.method === "GET")
        return respond(200, {
          post: postJSON(post, user),
          comments: commentsFor(post.id, user).map((comment) =>
            commentJSON(comment, user),
          ),
        });
      if (["PATCH", "DELETE"].includes(req.method)) {
        if (post.authorId !== user.id || post.isExample)
          fail(403, "Only the author can change this project.");
        if (req.method === "PATCH")
          return respond(
            200,
            postJSON(persistPost(user, await body(req), post), user),
          );
        run(
          "UPDATE social_posts SET deletedAt=?,updatedAt=? WHERE id=?",
          stamp(),
          stamp(),
          post.id,
        );
        return respond(200, { ok: true });
      }
    }
    const saveMatch = pathname.match(/^\/api\/social\/posts\/([^/]+)\/save$/);
    if (saveMatch && req.method === "POST") {
      requireUser();
      const data = await body(req),
        saved = bool(data.saved, "saved");
      if (saved) {
        const post = requirePost(saveMatch[1], user);
        if (user.isDemo && !post.isExample && post.authorId !== user.id)
          fail(
            403,
            "Save your demo as a real account to interact with other creators.",
          );
        run(
          "INSERT OR IGNORE INTO social_saves(userId,postId,createdAt) VALUES(?,?,?)",
          user.id,
          post.id,
          stamp(),
        );
      } else
        run(
          "DELETE FROM social_saves WHERE userId=? AND postId=?",
          user.id,
          saveMatch[1],
        );
      return respond(200, { saved: Boolean(saved) });
    }
    const followMatch = pathname.match(
      /^\/api\/social\/profiles\/([^/]+)\/follow$/,
    );
    if (followMatch && req.method === "POST") {
      const data = await body(req);
      const following = bool(data.following, "following");
      if (!following) {
        if (user.isDemo)
          fail(403, "Save your demo as a real account to manage follows.");
        run(
          "DELETE FROM social_follows WHERE followerId=? AND followedId=?",
          user.id,
          followMatch[1],
        );
        return respond(200, { following: false });
      }
      const sender = realUser(user, true),
        target = requireProfile(followMatch[1], user);
      contactTarget(target, user);
      if (target.userId === user.id)
        fail(400, "You cannot follow your own profile.");
      transaction(() => {
        const added = run(
          "INSERT OR IGNORE INTO social_follows(followerId,followedId,createdAt) VALUES(?,?,?)",
          user.id,
          target.userId,
          stamp(),
        );
        if (added.changes)
          notify(
            target.userId,
            "follow",
            user.id,
            `${sender.displayName} followed you`,
          );
      });
      return respond(200, { following: Boolean(following) });
    }
    const addComment = pathname.match(
      /^\/api\/social\/posts\/([^/]+)\/comments$/,
    );
    if (addComment && req.method === "POST") {
      const data = await body(req);
      realUser(user, true);
      const post = requirePost(addComment[1], user),
        target = profileRow(post.authorId);
      contactTarget(target, user);
      const text = string(data.body, "comment", { required: true, max: 2000 });
      const comment = transaction(() => {
        return insert("social_comments", {
          id: id("comment"),
          postId: post.id,
          authorId: user.id,
          body: text,
          reviewStatus: "pending",
          createdAt: stamp(),
          deletedAt: null,
        });
      });
      return respond(201, commentJSON(comment, user));
    }
    const deleteComment = pathname.match(/^\/api\/social\/comments\/([^/]+)$/);
    if (deleteComment && req.method === "DELETE") {
      requireUser();
      const comment = get(
        "SELECT * FROM social_comments WHERE id=? AND deletedAt IS NULL",
        deleteComment[1],
      );
      if (!comment) fail(404, "Comment not found.");
      const post = get(
        "SELECT * FROM social_posts WHERE id=? AND deletedAt IS NULL",
        comment.postId,
      );
      if (!post) fail(404, "Comment not found.");
      if (comment.authorId !== user.id && post.authorId !== user.id)
        fail(403, "Only the comment author or project author can remove it.");
      run(
        "UPDATE social_comments SET deletedAt=? WHERE id=?",
        stamp(),
        comment.id,
      );
      return respond(200, { ok: true });
    }
    if (pathname === "/api/social/requests") {
      requireUser();
      if (req.method === "GET") {
        const requests = all(
          "SELECT * FROM social_requests WHERE senderId=? OR recipientId=? ORDER BY createdAt DESC,id DESC",
          user.id,
          user.id,
        ).filter((request) => requestVisible(request, user));
        return respond(200, {
          incoming: requests
            .filter((request) => request.recipientId === user.id)
            .map((request) => requestJSON(request, user)),
          outgoing: requests
            .filter((request) => request.senderId === user.id)
            .map((request) => requestJSON(request, user)),
        });
      }
      if (req.method === "POST") {
        const sender = realUser(user, true),
          data = await body(req),
          recipientId = string(data.recipientId, "recipientId", {
            required: true,
            max: 100,
          }),
          target = requireProfile(recipientId, user);
        contactTarget(target, user);
        if (recipientId === user.id)
          fail(400, "Choose another creator to collaborate with.");
        const postId =
          data.postId === undefined || data.postId === null
            ? null
            : string(data.postId, "postId", { required: true, max: 100 });
        const post = postId ? requirePost(postId, user) : null;
        if (post && (post.authorId !== recipientId || post.isExample))
          fail(400, "Choose a project by the recipient.");
        if (!target.openToCollab && !post?.opportunity)
          fail(403, "This creator is not currently open to collaboration.");
        if (
          get(
            "SELECT id FROM social_requests WHERE senderId=? AND recipientId=? AND COALESCE(postId,'')=COALESCE(?,'') AND status='pending'",
            user.id,
            recipientId,
            postId,
          )
        )
          fail(
            409,
            "You already have a pending request for this collaboration.",
          );
        const request = transaction(() => {
          const row = insert("social_requests", {
            id: id("request"),
            senderId: user.id,
            recipientId,
            postId,
            title: string(data.title, "title", { required: true, max: 200 }),
            role: string(data.role, "role", { required: true, max: 100 }),
            message: string(data.message, "message", {
              required: true,
              max: 3000,
            }),
            status: "pending",
            createdAt: stamp(),
            updatedAt: stamp(),
            crewId: null,
            projectId: null,
          });
          notify(
            recipientId,
            "request",
            user.id,
            `${sender.displayName} sent a collaboration request`,
            postId,
            row.id,
          );
          return row;
        });
        return respond(201, requestJSON(request, user));
      }
    }
    const requestMatch = pathname.match(/^\/api\/social\/requests\/([^/]+)$/);
    if (requestMatch && req.method === "PATCH") {
      const data = await body(req),
        action = enumValue(
          data.action,
          ["accept", "decline", "cancel"],
          "request action",
        );
      const actor = realUser(user, action !== "cancel");
      const request = get(
        "SELECT * FROM social_requests WHERE id=?",
        requestMatch[1],
      );
      if (!request || !requestVisible(request, user))
        fail(404, "Collaboration request not found.");
      if (
        (action === "cancel" ? request.senderId : request.recipientId) !==
        user.id
      )
        fail(403, "You cannot perform that action on this request.");
      if (action === "accept" && request.status === "accepted")
        return respond(200, requestJSON(request, user));
      if (request.status !== "pending")
        fail(409, "This request has already been resolved.");
      const result = transaction(() => {
        if (action === "accept") {
          const sender = get(
              "SELECT * FROM users WHERE id=?",
              request.senderId,
            ),
            recipient = get(
              "SELECT * FROM users WHERE id=?",
              request.recipientId,
            );
          const crewId = id("crew"),
            projectId = id("proj");
          insert("crews", {
            id: crewId,
            name: request.title.slice(0, 120),
            description:
              "A private crew created by mutual collaboration agreement.",
            color: "#86BCE0",
            ownerId: recipient.id,
            createdAt: stamp(),
          });
          addMember(crewId, recipient, { role: "Captain" });
          addMember(crewId, sender, { role: request.role });
          insert("projects", {
            id: projectId,
            crewId,
            title: request.title,
            fandom: "",
            eventName: "",
            date: "",
            time: "",
            location: "",
            description: request.message,
            color: "#86BCE0",
            createdAt: stamp(),
          });
          activity(
            crewId,
            recipient.name,
            "accepted a collaboration and started this private crew",
          );
          run(
            "UPDATE social_requests SET status='accepted',crewId=?,projectId=?,updatedAt=? WHERE id=? AND status='pending'",
            crewId,
            projectId,
            stamp(),
            request.id,
          );
          notify(
            sender.id,
            "accepted",
            user.id,
            `${actor.displayName} accepted your collaboration request`,
            request.postId,
            request.id,
          );
        } else {
          const status = action === "decline" ? "declined" : "cancelled";
          run(
            "UPDATE social_requests SET status=?,updatedAt=? WHERE id=?",
            status,
            stamp(),
            request.id,
          );
          if (action === "decline")
            notify(
              request.senderId,
              "declined",
              user.id,
              `${actor.displayName} declined your collaboration request`,
              request.postId,
              request.id,
            );
        }
        return get("SELECT * FROM social_requests WHERE id=?", request.id);
      });
      return respond(200, requestJSON(result, user));
    }
    if (pathname === "/api/social/notifications" && req.method === "GET") {
      requireUser();
      const notices = all(
        "SELECT * FROM social_notifications WHERE userId=? ORDER BY createdAt DESC,id DESC LIMIT 200",
        user.id,
      )
        .filter((notice) => {
          const actor = notice.actorId ? profileRow(notice.actorId) : null;
          if (
            actor &&
            (!profileVisible(actor, user) ||
              actor.isDemo ||
              actor.suspendedAt ||
              blocked(user.id, actor.userId))
          )
            return false;
          if (
            notice.postId &&
            !postVisible(
              get("SELECT * FROM social_posts WHERE id=?", notice.postId),
              user,
            )
          )
            return false;
          if (
            notice.requestId &&
            !requestVisible(
              get("SELECT * FROM social_requests WHERE id=?", notice.requestId),
              user,
            )
          )
            return false;
          // Old comment notices have no provenance and are hidden. New notices
          // are created only by approval and remain subject to current visibility.
          if (notice.type === "comment" && (!notice.commentId || !commentsFor(notice.postId, user).some(
            (comment) => comment.id === notice.commentId && comment.reviewStatus === "approved"
          ))) return false;
          return true;
        })
        .map((notice) => ({
          id: notice.id,
          type: notice.type,
          actor: notice.actorId
            ? profileJSON(profileRow(notice.actorId), user)
            : null,
          text: notificationText(notice, user),
          postId: notice.postId,
          requestId: notice.requestId,
          read: Boolean(notice.read),
          createdAt: notice.createdAt,
        }));
      return respond(200, notices);
    }
    if (
      pathname === "/api/social/notifications/read" &&
      req.method === "POST"
    ) {
      requireUser();
      const data = await body(req);
      if (data.ids === undefined)
        run("UPDATE social_notifications SET read=1 WHERE userId=?", user.id);
      else {
        if (!Array.isArray(data.ids) || data.ids.length > 200)
          fail(400, "ids must be a list of at most 200 notifications.");
        const ids = data.ids.map((value) =>
          string(value, "notification id", { required: true, max: 100 }),
        );
        transaction(() => {
          for (const noticeId of ids)
            run(
              "UPDATE social_notifications SET read=1 WHERE id=? AND userId=?",
              noticeId,
              user.id,
            );
        });
      }
      return respond(200, { ok: true });
    }
    if (pathname === "/api/social/reports" && req.method === "POST") {
      realUser(user);
      const data = await body(req),
        targetType = enumValue(
          data.targetType,
          ["post", "profile", "comment"],
          "report target",
        ),
        targetId = string(data.targetId, "targetId", {
          required: true,
          max: 100,
        });
      if (targetType === "post")
        requirePost(targetId, user, { ignoreReport: true });
      if (targetType === "profile") requireProfile(targetId, user);
      if (targetType === "comment") {
        const comment = get(
          "SELECT * FROM social_comments WHERE id=? AND deletedAt IS NULL",
          targetId,
        );
        if (!comment || !commentsFor(comment.postId, user).some((row) => row.id === comment.id))
          fail(404, "Comment not found.");
        requirePost(comment.postId, user);
      }
      const reason = enumValue(
        data.reason,
        ["harassment", "stolen-work", "spam", "other"],
        "report reason",
      );
      insert("social_reports", {
        id: id("report"),
        reporterId: user.id,
        targetType,
        targetId,
        reason,
        details: string(data.details, "details", { max: 3000 }),
        status: "pending",
        createdAt: stamp(),
        reviewedAt: null,
      });
      return respond(201, { ok: true });
    }
    if (pathname === "/api/social/blocks") {
      requireUser();
      if (req.method === "GET")
        return respond(
          200,
          all(
            "SELECT blockedId FROM social_blocks WHERE blockerId=? ORDER BY createdAt DESC",
            user.id,
          )
            .map((row) => profileRow(row.blockedId))
            .filter(Boolean)
            .map((profile) => profile.reviewStatus === "approved" && profile.visibility === "public"
              ? profileJSON(profile, user)
              : { userId: profile.userId, handle: "", displayName: "Unavailable creator", bio: "", roles: [], fandoms: [], city: "", websiteUrl: "", instagramUrl: "", visibility: "private", openToCollab: false, isExample: false, viewerFollowing: false, followerCount: 0, projectCount: 0 }),
        );
      if (req.method === "POST") {
        realUser(user);
        const data = await body(req),
          targetId = string(data.userId, "userId", {
            required: true,
            max: 100,
          }),
          target = profileRow(targetId);
        if (!target || target.isDemo || targetId === user.id)
          fail(400, "Choose another real creator.");
        if (!profileVisible(target, user) && !blocked(user.id, targetId))
          fail(404, "This creator is not available.");
        transaction(() => {
          run(
            "INSERT OR IGNORE INTO social_blocks(blockerId,blockedId,createdAt) VALUES(?,?,?)",
            user.id,
            targetId,
            stamp(),
          );
          run(
            "DELETE FROM social_follows WHERE (followerId=? AND followedId=?) OR (followerId=? AND followedId=?)",
            user.id,
            targetId,
            targetId,
            user.id,
          );
          run(
            "UPDATE social_requests SET status='cancelled',updatedAt=? WHERE status='pending' AND ((senderId=? AND recipientId=?) OR (senderId=? AND recipientId=?))",
            stamp(),
            user.id,
            targetId,
            targetId,
            user.id,
          );
        });
        return respond(200, { ok: true });
      }
    }
    const unblockMatch = pathname.match(/^\/api\/social\/blocks\/([^/]+)$/);
    if (unblockMatch && req.method === "DELETE") {
      requireUser();
      run(
        "DELETE FROM social_blocks WHERE blockerId=? AND blockedId=?",
        user.id,
        unblockMatch[1],
      );
      return respond(200, { ok: true });
    }
    if (pathname === "/api/social/export" && req.method === "GET") {
      const profile = requireUser();
      return respond(200, {
        profile: profileJSON(profile, user),
        posts: all(
          "SELECT * FROM social_posts WHERE authorId=? AND deletedAt IS NULL ORDER BY createdAt,id",
          user.id,
        ).map((post) => postJSON(post, user)),
      });
    }
    fail(404, "Social API route not found.");
  };
  route.onUpgradeFromDemo = (userId) => {
    run(
      "UPDATE social_profiles SET visibility='private',updatedAt=? WHERE userId=?",
      stamp(),
      userId,
    );
    run(
      "UPDATE social_posts SET visibility='private',updatedAt=? WHERE authorId=?",
      stamp(),
      userId,
    );
  };
  return route;
}
