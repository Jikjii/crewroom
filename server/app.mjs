import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import {
  mkdirSync,
  existsSync,
  realpathSync,
  statSync,
  createReadStream,
} from "node:fs";
import path from "node:path";
import { createSocial } from "./social.mjs";
import { createAccounts, releaseReadiness } from "./accounts.mjs";

const derive = promisify(scrypt);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const id = (prefix) => `${prefix}_${randomUUID()}`;
const DAY = 86_400_000;
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function string(
  value,
  field,
  { required = false, max = 5000, fallback = "" } = {},
) {
  if (value === undefined) {
    if (required) fail(400, `${field} is required.`);
    return fallback;
  }
  if (typeof value !== "string") fail(400, `${field} must be text.`);
  const clean = value.trim();
  if (clean.length > max || (required && !clean))
    fail(
      400,
      `${field} must contain ${required ? "1" : "0"}–${max} characters.`,
    );
  return clean;
}
function date(value, field = "date", nullable = false) {
  if (nullable && (value === null || value === undefined || value === ""))
    return null;
  const clean = string(value, field, { max: 10 });
  if (!clean) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean))
    fail(400, `${field} must use YYYY-MM-DD.`);
  const parsed = new Date(`${clean}T12:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== clean
  )
    fail(400, `${field} must be a valid calendar date.`);
  return clean;
}
function time(value, required = false) {
  const clean = string(value, "time", { required, max: 5 });
  if (clean && !/^([01]\d|2[0-3]):[0-5]\d$/.test(clean))
    fail(400, "time must use HH:MM (24-hour).");
  return clean;
}
function color(value, fallback = "#7BBBE3") {
  const clean = string(value, "color", { max: 32, fallback });
  if (!/^(#[\da-f]{3}|#[\da-f]{6}|[a-z][a-z0-9-]{0,31})$/i.test(clean))
    fail(400, "color must be a color name or hex color.");
  return clean;
}
const publicUser = (user) =>
  user
    ? {
        id: user.id,
        name: user.name,
        email: user.email,
        isDemo: Boolean(user.isDemo),
      }
    : null;
const memberJSON = (row) => {
  const { character, status, joinedAt, ...member } = row;
  return { ...member, isPlaceholder: Boolean(member.isPlaceholder) };
};
const taskJSON = (row) => ({ ...row, done: Boolean(row.done) });
function originValue(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value
      ? value
      : null;
  } catch {
    return null;
  }
}

/** Creates an HTTP server. Call listen(), then close() to also close its SQLite database. */
export function createApp({
  dbPath = path.resolve(".data/crewroom.sqlite"),
  origins = [],
  appOrigin,
  staticDir = path.resolve("dist"),
  mediaDir,
  secureCookies = false,
  clientIp = (req) => req.socket.remoteAddress || "unknown",
  clientIP,
  production = false,
  mailSender,
  operatorName = "",
  supportEmail = "",
  minimumAge = 18,
  privacyPolicyUrl = appOrigin ? `${appOrigin}/privacy` : "",
  termsUrl = appOrigin ? `${appOrigin}/terms` : "",
  policyVersion = "beta-1",
  requirePolicyAcceptance = production,
  policiesApproved = false,
  resetTokenTtlMs,
  sessionDays = 30,
  rateLimit = 30,
  now = () => Date.now(),
  logger = console,
} = {}) {
  if (production) {
    const readiness = releaseReadiness({ production, appOrigin, secureCookies, mailSender, operatorName, supportEmail, minimumAge, privacyPolicyUrl, termsUrl, policyVersion, requirePolicyAcceptance, policiesApproved });
    if (!readiness.ready) throw new Error(`Unsafe production configuration: ${readiness.issues.join(' ')}`);
  }
  if (dbPath !== ":memory:")
    mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, passwordHash TEXT, salt TEXT, isDemo INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrfToken TEXT NOT NULL, expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS crews (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, color TEXT NOT NULL, ownerId TEXT NOT NULL REFERENCES users(id), createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, crewId TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE, userId TEXT REFERENCES users(id), name TEXT NOT NULL, role TEXT NOT NULL, character TEXT NOT NULL, color TEXT NOT NULL, status TEXT NOT NULL, isPlaceholder INTEGER NOT NULL, UNIQUE(crewId,userId));
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, crewId TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE, title TEXT NOT NULL, fandom TEXT NOT NULL, eventName TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, location TEXT NOT NULL, description TEXT NOT NULL, color TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, assigneeId TEXT REFERENCES members(id) ON DELETE SET NULL, done INTEGER NOT NULL, dueDate TEXT, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agenda (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, time TEXT NOT NULL, title TEXT NOT NULL, location TEXT NOT NULL, notes TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, crewId TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE, actorName TEXT NOT NULL, text TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS invites (tokenHash TEXT PRIMARY KEY, id TEXT UNIQUE, crewId TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE, inviterId TEXT NOT NULL REFERENCES users(id), memberId TEXT REFERENCES members(id) ON DELETE CASCADE, expiresAt INTEGER NOT NULL, usedBy TEXT REFERENCES users(id), usedAt INTEGER, revokedAt INTEGER);
    CREATE TABLE IF NOT EXISTS lineup (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, memberId TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, character TEXT NOT NULL, status TEXT NOT NULL, UNIQUE(projectId,memberId));
    CREATE INDEX IF NOT EXISTS members_user ON members(userId); CREATE INDEX IF NOT EXISTS projects_crew ON projects(crewId); CREATE INDEX IF NOT EXISTS tasks_project ON tasks(projectId); CREATE INDEX IF NOT EXISTS agenda_project ON agenda(projectId); CREATE INDEX IF NOT EXISTS activity_crew ON activity(crewId);`);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  if (!all("PRAGMA table_info(members)").some(column => column.name === "joinedAt"))
    db.exec("ALTER TABLE members ADD COLUMN joinedAt TEXT");
  if (!all("PRAGMA table_info(activity)").some(column => column.name === "actorUserId"))
    db.exec("ALTER TABLE activity ADD COLUMN actorUserId TEXT REFERENCES users(id) ON DELETE SET NULL");
  const inviteColumns = new Set(
    all("PRAGMA table_info(invites)").map((row) => row.name),
  );
  for (const [column, definition] of [
    ["id", "TEXT"],
    ["memberId", "TEXT REFERENCES members(id) ON DELETE CASCADE"],
    ["revokedAt", "INTEGER"],
  ])
    if (!inviteColumns.has(column))
      db.exec(`ALTER TABLE invites ADD COLUMN ${column} ${definition}`);
  for (const row of all("SELECT tokenHash FROM invites WHERE id IS NULL"))
    run(
      "UPDATE invites SET id=? WHERE tokenHash=?",
      id("invite"),
      row.tokenHash,
    );
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS invites_id ON invites(id)");
  const insert = (table, row) => {
    const keys = Object.keys(row);
    run(
      `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      ...Object.values(row),
    );
    return row;
  };
  const stamp = () => new Date(now()).toISOString();
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const allowedOrigins = new Set([
    ...(!production ? ["http://localhost:8081", "http://127.0.0.1:8081", "http://localhost:4310", "http://127.0.0.1:4310"] : []),
    ...origins,
  ]);
  if (appOrigin) allowedOrigins.add(appOrigin);
  for (const origin of allowedOrigins)
    if (!originValue(origin))
      throw new Error(`Invalid configured app origin: ${origin}`);
  const rateBuckets = new Map();
  function limited(req, category, limit = rateLimit) {
    const key = `${(clientIP || clientIp)(req)}:${category}`,
      current = now();
    if (rateBuckets.size > 10000)
      for (const [key, value] of rateBuckets)
        if (value.until <= current) rateBuckets.delete(key);
    const entry = rateBuckets.get(key);
    if (!entry || entry.until <= current) {
      rateBuckets.set(key, { count: 1, until: current + 15 * 60_000 });
      return;
    }
    if (++entry.count > limit)
      fail(429, "Too many attempts. Please try again in 15 minutes.");
  }
  function originAllowed(req, origin) {
    if (allowedOrigins.has(origin)) return true;
    if (production) return false;
    const protocol = req.socket.encrypted ? "https" : "http";
    return [
      `${protocol}://localhost:${req.socket.localPort}`,
      `${protocol}://127.0.0.1:${req.socket.localPort}`,
      `${protocol}://[::1]:${req.socket.localPort}`,
    ].includes(origin);
  }
  function send(res, status, data) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  }
  function cookie(req, res, token, clear = false) {
    res.setHeader(
      "Set-Cookie",
      `crewroom_session=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : sessionDays * 86400}${secureCookies || req.socket.encrypted ? "; Secure" : ""}`,
    );
  }
  function auth(req) {
    const header = req.headers.authorization;
    const bearer =
      typeof header === "string" && /^Bearer [A-Za-z0-9_-]{43}$/.test(header);
    let token = bearer ? header.slice(7) : null;
    if (header && !bearer) fail(401, "Invalid authorization token.");
    if (!token)
      token = (req.headers.cookie || "")
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith("crewroom_session="))
        ?.slice(17);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      return { user: null, session: null, bearer: false };
    const session = get(
      "SELECT * FROM sessions WHERE tokenHash=? AND expiresAt>?",
      digest(token),
      now(),
    );
    const user = session
      ? get("SELECT * FROM users WHERE id=?", session.userId)
      : null;
    return { user, session, bearer: Boolean(bearer) };
  }
  function mutation(req, context) {
    if (!context.user) fail(401, "Sign in to continue.");
    if (context.bearer) return;
    if (!req.headers.origin)
      fail(
        403,
        "An approved Origin is required for cookie-authenticated changes.",
      );
    if (
      typeof req.headers["x-csrf-token"] !== "string" ||
      req.headers["x-csrf-token"] !== context.session.csrfToken
    )
      fail(403, "Invalid CSRF token. Refresh and try again.");
  }
  async function body(req, maxBytes = 65536) {
    let length = 0,
      chunks = [];
    for await (const chunk of req) {
      length += chunk.length;
      if (length > maxBytes) fail(413, "Request is too large.");
      chunks.push(chunk);
    }
    if (!length) return {};
    if (
      !(req.headers["content-type"] || "")
        .toLowerCase()
        .startsWith("application/json")
    )
      fail(415, "Use application/json.");
    try {
      const data = JSON.parse(Buffer.concat(chunks).toString());
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error();
      return data;
    } catch {
      fail(400, "Send a valid JSON object.");
    }
  }
  function startSession(req, res, user, previous) {
    const token = secret(),
      csrfToken = secret();
    transaction(() => {
      if (previous)
        run("DELETE FROM sessions WHERE tokenHash=?", previous.tokenHash);
      run("DELETE FROM sessions WHERE expiresAt<=?", now());
      insert("sessions", {
        tokenHash: digest(token),
        userId: user.id,
        csrfToken,
        expiresAt: now() + sessionDays * DAY,
      });
    });
    cookie(req, res, token);
    return { user: publicUser(user), csrfToken, sessionToken: token };
  }
  function crewFor(crewId, user, captain = false) {
    const crew = get(
      "SELECT c.* FROM crews c JOIN members m ON m.crewId=c.id WHERE c.id=? AND m.userId=?",
      crewId,
      user.id,
    );
    if (!crew) fail(404, "Crew not found.");
    if (captain && crew.ownerId !== user.id)
      fail(403, "Only the crew captain can do that.");
    return crew;
  }
  function projectFor(projectId, user) {
    const project = get("SELECT * FROM projects WHERE id=?", projectId);
    if (!project) fail(404, "Project not found.");
    crewFor(project.crewId, user);
    return project;
  }
  const activity = (crewId, actorName, text) => {
    const matches = all("SELECT userId FROM members WHERE crewId=? AND name=? AND userId IS NOT NULL", crewId, actorName);
    return insert("activity", {
      id: id("act"),
      crewId,
      actorName,
      text,
      createdAt: stamp(),
      actorUserId: matches.length === 1 ? matches[0].userId : null,
    });
  };
  function addMember(crewId, user, values = {}) {
    return insert("members", {
      id: id("mem"),
      crewId,
      userId: user?.id ?? null,
      name: values.name ?? user?.name,
      role: values.role ?? "Crew member",
      character: values.character ?? "",
      color: values.color ?? "#B8A0D9",
      status: "planning",
      isPlaceholder: user ? 0 : 1,
      joinedAt: user ? stamp() : null,
    });
  }
  function addCrew(user, data) {
    const crew = {
      id: id("crew"),
      name: string(data.name, "name", { required: true, max: 120 }),
      description: string(data.description, "description"),
      color: color(data.color),
      ownerId: user.id,
      createdAt: stamp(),
    };
    return transaction(() => {
      insert("crews", crew);
      addMember(crew.id, user, { role: "Captain", color: crew.color });
      activity(crew.id, user.name, "started the crew");
      return crew;
    });
  }
  function projectFields(data, patch = false) {
    const result = {};
    for (const field of [
      "title",
      "fandom",
      "eventName",
      "location",
      "description",
    ])
      if (!patch || own(data, field))
        result[field] = string(data[field], field, {
          required: field === "title",
          max: field === "description" ? 5000 : 200,
        });
    if (!patch || own(data, "date")) result.date = date(data.date);
    if (!patch || own(data, "time")) result.time = time(data.time);
    if (!patch || own(data, "color")) result.color = color(data.color);
    return result;
  }
  function update(table, rowId, values) {
    const keys = Object.keys(values);
    if (!keys.length) fail(400, "No editable fields supplied.");
    run(
      `UPDATE ${table} SET ${keys.map((key) => `${key}=?`).join(",")} WHERE id=?`,
      ...Object.values(values),
      rowId,
    );
    return get(`SELECT * FROM ${table} WHERE id=?`, rowId);
  }
  function assignee(value, crewId) {
    if (value === null || value === undefined || value === "") return null;
    const memberId = string(value, "assigneeId", { required: true, max: 100 });
    if (
      !get("SELECT id FROM members WHERE id=? AND crewId=?", memberId, crewId)
    )
      fail(400, "Assignee must belong to this crew.");
    return memberId;
  }
  function seed(user) {
    const future = (days) => {
      const day = new Date(now());
      day.setDate(day.getDate() + days);
      return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    };
    const crew = addCrew(user, {
      name: "Moonrise Collective",
      description: "Good company. Big ideas. Costumes made together.",
      color: "#86BCE0",
    });
    const captain = get(
      "SELECT * FROM members WHERE crewId=? AND userId=?",
      crew.id,
      user.id,
    );
    const members = [
      {
        name: "Mika Chen",
        role: "Styling & wigs",
        character: "The cloudkeeper",
        color: "#D8B0CA",
      },
      {
        name: "Jordan Reyes",
        role: "Prop maker",
        character: "The navigator",
        color: "#AAC9A0",
      },
      {
        name: "Samira Okafor",
        role: "Photographer",
        character: "Behind the lens",
        color: "#DEB77F",
      },
      {
        name: "Alex Rivera",
        role: "Costume maker",
        character: "The stargazer",
        color: "#BDA9DC",
      },
    ].map((values) => addMember(crew.id, null, values));
    run(
      "UPDATE members SET character=?,status=? WHERE id=?",
      "The sky captain",
      "making",
      captain.id,
    );
    run("UPDATE members SET status=? WHERE id=?", "ready", members[2].id);
    run("UPDATE members SET status=? WHERE id=?", "making", members[0].id);
    const project = insert("projects", {
      id: id("proj"),
      crewId: crew.id,
      title: "The skybound crew",
      fandom: "Original characters",
      eventName: "Afterlight studio shoot",
      date: future(18),
      time: "14:00",
      location: "Afterlight Studio · a fictional demo venue",
      description:
        "An original band of sky explorers. Think soft blue skies, silver details, and a little handmade magic. Bring your costume, a snack, and your best adventure story.",
      color: "#86BCE0",
      createdAt: stamp(),
    });
    for (const member of all("SELECT * FROM members WHERE crewId=?", crew.id))
      insert("lineup", {
        id: id("lineup"),
        projectId: project.id,
        memberId: member.id,
        character: member.character,
        status: member.status,
      });
    insert("projects", {
      id: id("proj"),
      crewId: crew.id,
      title: "Lanterns after dark",
      fandom: "Original characters",
      eventName: "Moonlit portrait walk",
      date: future(42),
      time: "17:30",
      location: "Lantern Garden · fictional demo location",
      description:
        "Warm lanterns, layered costumes, and portraits at golden hour.",
      color: "#BDA9DC",
      createdAt: stamp(),
    });
    for (const [title, member, done, days] of [
      ["Finish the captain’s shoulder cape", captain, 0, 9],
      ["Style and secure the cloudkeeper wig", members[0], 0, 11],
      ["Add the compass details to the prop", members[1], 0, 13],
      ["Share the shoot moodboard", members[2], 1, 4],
      ["Pack a small costume repair kit", members[3], 0, 17],
      ["Confirm the studio lighting plan", members[2], 1, 5],
    ])
      insert("tasks", {
        id: id("task"),
        projectId: project.id,
        title,
        assigneeId: member.id,
        done,
        dueDate: future(days),
        createdAt: stamp(),
      });
    for (const [when, title, location, notes] of [
      [
        "13:30",
        "Arrive & settle in",
        "Studio entrance",
        "Leave time for changing and quick repairs.",
      ],
      [
        "14:00",
        "Final costume checks",
        "Dressing area",
        "Help each other with fastenings and finishing details.",
      ],
      [
        "14:30",
        "The whole crew",
        "Sky backdrop",
        "Group portraits first, then small character moments.",
      ],
      [
        "15:30",
        "Solo portraits & details",
        "Window corner",
        "Make sure everyone gets their moment.",
      ],
      [
        "16:30",
        "Wrap up & snack break",
        "Lounge",
        "Pack props together and agree where photos will be shared.",
      ],
    ])
      insert("agenda", {
        id: id("ag"),
        projectId: project.id,
        time: when,
        title,
        location,
        notes,
      });
    activity(crew.id, user.name, "planned Afterlight studio shoot");
    activity(
      crew.id,
      "Samira Okafor (sample)",
      "added the fictional shoot moodboard",
    );
  }
  function serveStatic(req, res, pathname) {
    if (!["GET", "HEAD"].includes(req.method) || !existsSync(staticDir))
      return false;
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      fail(400, "Invalid URL.");
    }
    if (
      decoded.includes("\0") ||
      decoded.includes("\\") ||
      decoded.split("/").some((part) => part === ".." || part.startsWith("."))
    )
      fail(404, "Not found.");
    const base = realpathSync(staticDir);
    let target = path.resolve(base, `.${decoded}`);
    if (!target.startsWith(base + path.sep) && target !== base)
      fail(404, "Not found.");
    if (!existsSync(target) || !statSync(target).isFile()) {
      if (path.extname(decoded)) return false;
      target = path.join(base, "index.html");
    }
    if (!existsSync(target)) return false;
    target = realpathSync(target);
    if (!target.startsWith(base + path.sep) || !statSync(target).isFile())
      fail(404, "Not found.");
    const mime =
      {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".webp": "image/webp",
        ".map": "application/json",
      }[path.extname(target)] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control":
        path.extname(target) === ".html" ? "no-cache" : "public, max-age=3600",
    });
    if (req.method === "HEAD") res.end();
    else {
      const stream = createReadStream(target);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    }
    return true;
  }
  const resolvedMediaDir = mediaDir || path.join(dbPath === ':memory:' ? path.resolve('.data') : path.dirname(path.resolve(dbPath)), 'media');
  const social = createSocial({ db, get, all, run, insert, transaction, id, stamp, now, fail, string, date, own, send, body, mutation, limited, addMember, activity,
    mediaDir: resolvedMediaDir,
  });
  const accounts = createAccounts({ db, get, all, run, insert, transaction, id, stamp, now, fail, string, send, body, mutation, limited, cookie, derive, digest, secret, timingSafeEqual,
    mediaDir: resolvedMediaDir, appOrigin, logger, production, secureCookies, mailSender, operatorName, supportEmail, minimumAge, privacyPolicyUrl, termsUrl, policyVersion, requirePolicyAcceptance, policiesApproved, resetTokenTtlMs,
  });
  accounts.cleanupFiles().catch(() => logger.warn?.("Account media cleanup remains pending."));
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    try {
      const requestOrigin = req.headers.origin;
      const approved =
        typeof requestOrigin === "string" && originAllowed(req, requestOrigin);
      if (approved) {
        res.setHeader("Access-Control-Allow-Origin", requestOrigin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        if (!approved) fail(403, "Origin is not allowed.");
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, PATCH, DELETE, OPTIONS",
        );
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, X-CSRF-Token, Authorization",
        );
        res.writeHead(204);
        return res.end();
      }
      if (!["GET", "HEAD"].includes(req.method) && requestOrigin && !approved)
        fail(403, "Origin is not allowed.");
      const url = new URL(req.url, "http://localhost"),
        pathname = url.pathname;
      if (!pathname.startsWith("/api/")) {
        if (serveStatic(req, res, pathname)) return;
        fail(404, "Not found.");
      }
      if (pathname === "/api/health" && req.method === "GET")
        return send(res, 200, { ok: true });
      const context = auth(req),
        { user } = context;
      if (await accounts(req, res, url, context)) return;
      if (await social(req, res, url, context)) return;
      if (pathname === "/api/session" && req.method === "GET")
        return send(res, 200, {
          user: publicUser(user),
          csrfToken: context.session?.csrfToken ?? null,
        });
      if (pathname === "/api/demo" && req.method === "POST") {
        limited(req, "demo");
        await body(req);
        const demo = insert("users", {
          id: id("user"),
          name: "You",
          email: null,
          passwordHash: null,
          salt: null,
          isDemo: 1,
          createdAt: stamp(),
        });
        seed(demo);
        return send(res, 201, startSession(req, res, demo, context.session));
      }
      if (pathname === "/api/auth/signup" && req.method === "POST") {
        limited(req, "auth");
        const data = await body(req);
        if (user?.isDemo) mutation(req, context);
        accounts.validatePolicy(data);
        const name = string(data.name, "name", { required: true, max: 120 });
        const email = string(data.email, "email", {
          required: true,
          max: 254,
        }).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          fail(400, "Enter a valid email address.");
        if (
          typeof data.password !== "string" ||
          data.password.length < 10 ||
          data.password.length > 1024
        )
          fail(400, "Password must contain 10–1024 characters.");
        if (get("SELECT id FROM users WHERE email=?", email))
          fail(409, "An account already uses that email.");
        const salt = secret(),
          passwordHash = (await derive(data.password, salt, 64)).toString(
            "hex",
          );
        let account;
        try {
          account = transaction(() => {
            if (user?.isDemo) {
              run(
                "UPDATE users SET name=?,email=?,passwordHash=?,salt=?,isDemo=0 WHERE id=?",
                name,
                email,
                passwordHash,
                salt,
                user.id,
              );
              run("UPDATE members SET name=? WHERE userId=?", name, user.id);
              social.onUpgradeFromDemo(user.id);
              accounts.recordPolicy(user.id, data);
              return get("SELECT * FROM users WHERE id=?", user.id);
            }
            const created = insert("users", {
              id: id("user"),
              name,
              email,
              passwordHash,
              salt,
              isDemo: 0,
              createdAt: stamp(),
            });
            accounts.recordPolicy(created.id, data);
            return created;
          });
        } catch (error) {
          if (String(error.message).includes("UNIQUE"))
            fail(409, "An account already uses that email.");
          throw error;
        }
        return send(res, 201, startSession(req, res, account, context.session));
      }
      if (pathname === "/api/auth/login" && req.method === "POST") {
        limited(req, "auth");
        const data = await body(req);
        const email = string(data.email, "email", {
          required: true,
          max: 254,
        }).toLowerCase();
        if (typeof data.password !== "string" || data.password.length > 1024)
          fail(400, "Enter your password.");
        const account = get(
          "SELECT * FROM users WHERE email=? AND isDemo=0",
          email,
        );
        const key = await derive(
          data.password,
          account?.salt || "crewroom-invalid-account-timing",
          64,
        );
        if (
          !account ||
          !timingSafeEqual(key, Buffer.from(account.passwordHash, "hex"))
        )
          fail(401, "Email or password is incorrect.");
        return send(res, 200, startSession(req, res, account, context.session));
      }
      const inviteMatch = pathname.match(
        /^\/api\/invites\/([A-Za-z0-9_-]{43})(\/accept)?$/,
      );
      if (inviteMatch && req.method === "GET" && !inviteMatch[2]) {
        limited(req, "invite-preview");
        const invite = get(
          "SELECT i.*,c.name AS crewName,u.name AS inviterName FROM invites i JOIN crews c ON c.id=i.crewId JOIN users u ON u.id=i.inviterId WHERE tokenHash=?",
          digest(inviteMatch[1]),
        );
        if (
          !invite ||
          invite.usedBy ||
          invite.revokedAt ||
          invite.expiresAt <= now()
        )
          fail(404, "This invitation is no longer available.");
        return send(res, 200, {
          crewName: invite.crewName,
          inviterName: invite.inviterName,
          expiresAt: new Date(invite.expiresAt).toISOString(),
        });
      }
      if (!user) fail(401, "Sign in to continue.");
      if (!["GET", "HEAD"].includes(req.method)) mutation(req, context);
      if (pathname === "/api/auth/logout" && req.method === "POST") {
        run(
          "DELETE FROM sessions WHERE tokenHash=?",
          context.session.tokenHash,
        );
        cookie(req, res, "", true);
        return send(res, 200, { user: null, csrfToken: null });
      }
      if (pathname === "/api/workspace" && req.method === "GET") {
        const scoped = "SELECT crewId FROM members WHERE userId=?";
        return send(res, 200, {
          crews: all(
            `SELECT * FROM crews WHERE id IN (${scoped}) ORDER BY createdAt,id`,
            user.id,
          ),
          projects: all(
            `SELECT * FROM projects WHERE crewId IN (${scoped}) ORDER BY date,createdAt`,
            user.id,
          ),
          members: all(
            `SELECT * FROM members WHERE crewId IN (${scoped}) ORDER BY isPlaceholder,id`,
            user.id,
          ).map(memberJSON),
          lineup: all(
            `SELECT * FROM lineup WHERE projectId IN (SELECT id FROM projects WHERE crewId IN (${scoped})) ORDER BY id`,
            user.id,
          ),
          tasks: all(
            `SELECT * FROM tasks WHERE projectId IN (SELECT id FROM projects WHERE crewId IN (${scoped})) ORDER BY createdAt,id`,
            user.id,
          ).map(taskJSON),
          agenda: all(
            `SELECT * FROM agenda WHERE projectId IN (SELECT id FROM projects WHERE crewId IN (${scoped})) ORDER BY time,id`,
            user.id,
          ),
          activity: all(
            `SELECT * FROM activity WHERE crewId IN (${scoped}) ORDER BY createdAt DESC,rowid DESC LIMIT 100`,
            user.id,
          ),
        });
      }
      if (pathname === "/api/crews" && req.method === "POST")
        return send(res, 201, addCrew(user, await body(req)));
      if (pathname === "/api/projects" && req.method === "POST") {
        const data = await body(req),
          crew = crewFor(
            string(data.crewId, "crewId", { required: true, max: 100 }),
            user,
          );
        const project = {
          id: id("proj"),
          crewId: crew.id,
          ...projectFields(data),
          createdAt: stamp(),
        };
        transaction(() => {
          insert("projects", project);
          activity(crew.id, user.name, `planned ${project.title}`);
        });
        return send(res, 201, project);
      }
      const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projectMatch && req.method === "PATCH") {
        projectFor(projectMatch[1], user);
        return send(
          res,
          200,
          update(
            "projects",
            projectMatch[1],
            projectFields(await body(req), true),
          ),
        );
      }
      if (pathname === "/api/members" && req.method === "POST") {
        const data = await body(req),
          crew = crewFor(
            string(data.crewId, "crewId", { required: true, max: 100 }),
            user,
            true,
          );
        const member = addMember(crew.id, null, {
          name: string(data.name, "name", { required: true, max: 120 }),
          role: string(data.role, "role", {
            max: 100,
            fallback: "Crew member",
          }),
          color: color(data.color),
        });
        return send(res, 201, memberJSON(member));
      }
      const memberMatch = pathname.match(/^\/api\/members\/([^/]+)$/);
      if (memberMatch && ["PATCH", "DELETE"].includes(req.method)) {
        const member = get("SELECT * FROM members WHERE id=?", memberMatch[1]);
        if (!member) fail(404, "Member not found.");
        const crew = crewFor(member.crewId, user);
        if (crew.ownerId !== user.id && member.userId !== user.id)
          fail(403, "You can only update your own member profile.");
        if (req.method === "DELETE") {
          if (member.userId === crew.ownerId)
            fail(409, "The owner cannot leave their crew.");
          transaction(() => {
            run("DELETE FROM members WHERE id=?", member.id);
            activity(
              crew.id,
              user.name,
              member.userId === user.id
                ? "left the crew"
                : `removed ${member.name} from the crew`,
            );
          });
          return send(res, 200, { ok: true });
        }
        const data = await body(req),
          fields = {};
        if (own(data, "role"))
          fields.role = string(data.role, "role", { max: 200 });
        return send(res, 200, memberJSON(update("members", member.id, fields)));
      }
      if (pathname === "/api/lineup" && req.method === "POST") {
        const data = await body(req),
          project = projectFor(
            string(data.projectId, "projectId", { required: true, max: 100 }),
            user,
          );
        const member = get(
          "SELECT * FROM members WHERE id=? AND crewId=?",
          string(data.memberId, "memberId", { required: true, max: 100 }),
          project.crewId,
        );
        if (!member) fail(400, "Lineup member must belong to this crew.");
        const crew = crewFor(project.crewId, user);
        if (crew.ownerId !== user.id && member.userId !== user.id)
          fail(403, "You can only change your own lineup.");
        const existing = get(
          "SELECT * FROM lineup WHERE projectId=? AND memberId=?",
          project.id,
          member.id,
        );
        const character = own(data, "character")
          ? string(data.character, "character", { max: 200 })
          : existing?.character || "";
        const status = own(data, "status")
          ? data.status
          : existing?.status || "planning";
        if (!["planning", "making", "ready"].includes(status))
          fail(400, "Invalid lineup status.");
        const result = existing
          ? update("lineup", existing.id, { character, status })
          : insert("lineup", {
              id: id("lineup"),
              projectId: project.id,
              memberId: member.id,
              character,
              status,
            });
        return send(res, existing ? 200 : 201, result);
      }
      const lineupMatch = pathname.match(/^\/api\/lineup\/([^/]+)$/);
      if (lineupMatch && req.method === "PATCH") {
        const entry = get("SELECT * FROM lineup WHERE id=?", lineupMatch[1]);
        if (!entry) fail(404, "Lineup entry not found.");
        const project = projectFor(entry.projectId, user),
          crew = crewFor(project.crewId, user),
          member = get("SELECT * FROM members WHERE id=?", entry.memberId);
        if (crew.ownerId !== user.id && member.userId !== user.id)
          fail(403, "You can only change your own lineup.");
        const data = await body(req),
          fields = {};
        if (own(data, "character"))
          fields.character = string(data.character, "character", { max: 200 });
        if (own(data, "status")) {
          if (!["planning", "making", "ready"].includes(data.status))
            fail(400, "Invalid lineup status.");
          fields.status = data.status;
        }
        return send(res, 200, update("lineup", entry.id, fields));
      }
      if (pathname === "/api/tasks" && req.method === "POST") {
        const data = await body(req),
          project = projectFor(
            string(data.projectId, "projectId", { required: true, max: 100 }),
            user,
          );
        const task = insert("tasks", {
          id: id("task"),
          projectId: project.id,
          title: string(data.title, "title", { required: true, max: 500 }),
          assigneeId: assignee(data.assigneeId, project.crewId),
          done: 0,
          dueDate: date(data.dueDate, "dueDate", true),
          createdAt: stamp(),
        });
        return send(res, 201, taskJSON(task));
      }
      const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch && ["PATCH", "DELETE"].includes(req.method)) {
        const task = get("SELECT * FROM tasks WHERE id=?", taskMatch[1]);
        if (!task) fail(404, "Task not found.");
        const project = projectFor(task.projectId, user);
        if (req.method === "DELETE") {
          run("DELETE FROM tasks WHERE id=?", task.id);
          return send(res, 200, { ok: true });
        }
        const data = await body(req),
          fields = {};
        if (own(data, "title"))
          fields.title = string(data.title, "title", {
            required: true,
            max: 500,
          });
        if (own(data, "done")) {
          if (typeof data.done !== "boolean")
            fail(400, "done must be true or false.");
          fields.done = Number(data.done);
        }
        if (own(data, "assigneeId"))
          fields.assigneeId = assignee(data.assigneeId, project.crewId);
        if (own(data, "dueDate"))
          fields.dueDate = date(data.dueDate, "dueDate", true);
        return send(res, 200, taskJSON(update("tasks", task.id, fields)));
      }
      if (pathname === "/api/agenda" && req.method === "POST") {
        const data = await body(req),
          project = projectFor(
            string(data.projectId, "projectId", { required: true, max: 100 }),
            user,
          );
        return send(
          res,
          201,
          insert("agenda", {
            id: id("ag"),
            projectId: project.id,
            time: time(data.time, true),
            title: string(data.title, "title", { required: true, max: 300 }),
            location: string(data.location, "location", { max: 300 }),
            notes: string(data.notes, "notes"),
          }),
        );
      }
      const agendaMatch = pathname.match(/^\/api\/agenda\/([^/]+)$/);
      if (agendaMatch && req.method === "DELETE") {
        const item = get("SELECT * FROM agenda WHERE id=?", agendaMatch[1]);
        if (!item) fail(404, "Agenda item not found.");
        projectFor(item.projectId, user);
        run("DELETE FROM agenda WHERE id=?", item.id);
        return send(res, 200, { ok: true });
      }
      const createInvite = pathname.match(/^\/api\/crews\/([^/]+)\/invites$/);
      if (createInvite && req.method === "POST") {
        const crew = crewFor(createInvite[1], user, true),
          token = secret(),
          expiresAt = now() + 7 * DAY;
        const data = await body(req),
          memberId =
            data.memberId === undefined
              ? null
              : string(data.memberId, "memberId", { required: true, max: 100 });
        if (
          memberId &&
          !get(
            "SELECT id FROM members WHERE id=? AND crewId=? AND userId IS NULL AND isPlaceholder=1",
            memberId,
            crew.id,
          )
        )
          fail(400, "Choose an unclaimed planned member in this crew.");
        const inviteId = id("invite");
        insert("invites", {
          tokenHash: digest(token),
          id: inviteId,
          crewId: crew.id,
          inviterId: user.id,
          memberId,
          expiresAt,
          usedBy: null,
          usedAt: null,
          revokedAt: null,
        });
        const base =
          appOrigin || (approved ? requestOrigin : [...allowedOrigins][0]);
        return send(res, 201, {
          id: inviteId,
          token,
          url: `${base}/join/${token}`,
          expiresAt: new Date(expiresAt).toISOString(),
        });
      }
      const revokeInvite = pathname.match(/^\/api\/invites\/([^/]+)$/);
      if (revokeInvite && req.method === "DELETE") {
        const invite = get("SELECT * FROM invites WHERE id=?", revokeInvite[1]);
        if (!invite) fail(404, "Invitation not found.");
        crewFor(invite.crewId, user, true);
        run("UPDATE invites SET revokedAt=? WHERE id=?", now(), invite.id);
        return send(res, 200, { ok: true });
      }
      if (inviteMatch?.[2] && req.method === "POST") {
        if (user.isDemo)
          fail(403, "Create a real account before joining a crew.");
        const result = transaction(() => {
          const invite = get(
            "SELECT * FROM invites WHERE tokenHash=?",
            digest(inviteMatch[1]),
          );
          if (!invite || invite.revokedAt || invite.expiresAt <= now())
            fail(404, "This invitation is no longer available.");
          const existing = get(
            "SELECT id FROM members WHERE crewId=? AND userId=?",
            invite.crewId,
            user.id,
          );
          if (invite.usedBy) {
            if (invite.usedBy === user.id && existing)
              return { crewId: invite.crewId };
            fail(409, "This invitation has already been used.");
          }
          if (invite.memberId) {
            if (existing) fail(409, "You are already a member of this crew.");
            const changed = run(
              "UPDATE members SET userId=?,name=?,isPlaceholder=0,joinedAt=? WHERE id=? AND crewId=? AND isPlaceholder=1 AND userId IS NULL",
              user.id,
              user.name,
              stamp(),
              invite.memberId,
              invite.crewId,
            );
            if (!changed.changes)
              fail(409, "This planned member has already been claimed.");
          } else if (!existing) addMember(invite.crewId, user);
          run(
            "UPDATE invites SET usedBy=?,usedAt=? WHERE tokenHash=? AND usedBy IS NULL",
            user.id,
            now(),
            digest(inviteMatch[1]),
          );
          activity(invite.crewId, user.name, "joined the crew");
          return { crewId: invite.crewId };
        });
        return send(res, 200, result);
      }
      fail(404, "API route not found.");
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (!(error instanceof HttpError))
        logger.error?.(
          "Crewroom request failed:",
          error.code || error.name || "Error",
        );
      send(res, error.status || 500, {
        error:
          error instanceof HttpError
            ? error.message
            : "Something went wrong. Please try again.",
      });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.on("close", () => db.close());
  return server;
}
