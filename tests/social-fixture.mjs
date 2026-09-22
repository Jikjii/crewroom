import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { createApp } from "../server/app.mjs";
import { decideContent, inspectContent } from "../server/content-review.mjs";

export const password = "correct-horse-moonrise";
export const image = await sharp({
  create: { width: 36, height: 24, channels: 3, background: "#375aca" },
})
  .jpeg()
  .toBuffer();

export function rejected(result, statuses = [400, 401, 403, 404, 409, 415]) {
  assert.ok(
    statuses.includes(result.status),
    `Expected rejection, got ${result.status}: ${JSON.stringify(result.body)}`,
  );
}

export async function fixture(t, { approvePublic = false, ...options } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "crewroom-social-"));
  const errors = [];
  const config = {
    dbPath: path.join(directory, "db.sqlite"),
    mediaDir: path.join(directory, "media"),
    staticDir: path.join(directory, "dist"),
    logger: { error: (error) => errors.push(String(error)) },
    ...options,
  };
  let server, base;
  async function start() {
    server = createApp(config);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server?.listening) {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
    assert.deepEqual(errors, [], "No unexpected server errors");
  });
  await start();
  function inspect(type, id) {
    const db = new DatabaseSync(config.dbPath);
    try { return inspectContent(db, type, id, config.mediaDir); }
    finally { db.close(); }
  }
  function approve(type, id, extra = {}) {
    const db = new DatabaseSync(config.dbPath);
    try {
      const inspection = inspectContent(db, type, id, config.mediaDir);
      return decideContent(db, { type, id, version: inspection.version, decision: "approved", imagesReviewed: true, mediaDir: config.mediaDir, ...extra });
    } finally { db.close(); }
  }
  // Existing social/privacy scenarios explicitly use reviewed public fixtures.
  // New review tests leave approvePublic false and exercise the actual queue.
  function approveResponse(value) {
    if (!value || typeof value !== "object") return;
    if (value.author) approveResponse(value.author);
    if (value.reviewStatus === "pending") {
      const type = value.userId ? "profile" : value.postId ? "comment" : "post";
      approve(type, value.userId || value.id);
    }
  }
  function client(mode = "native") {
    const state = { token: null, csrfToken: null, cookie: null };
    return {
      state,
      async request(route, method = "GET", data, options = {}) {
        const headers = {};
        if (mode === "web") {
          headers.Origin = "http://localhost:8081";
          if (state.cookie) headers.Cookie = state.cookie;
          if (state.csrfToken && options.csrf !== false)
            headers["X-CSRF-Token"] = state.csrfToken;
        } else if (state.token) headers.Authorization = `Bearer ${state.token}`;
        if (options.origin !== undefined) headers.Origin = options.origin;
        if (data !== undefined) headers["Content-Type"] = "application/json";
        const response = await fetch(base + route, {
          method,
          headers,
          body: data === undefined ? undefined : JSON.stringify(data),
        });
        const body = response.headers
          .get("content-type")
          ?.includes("application/json")
          ? await response.json()
          : Buffer.from(await response.arrayBuffer());
        if (response.headers.get("set-cookie"))
          state.cookie = response.headers.get("set-cookie").split(";")[0];
        if (body.sessionToken) state.token = body.sessionToken;
        if (Object.hasOwn(body, "csrfToken")) state.csrfToken = body.csrfToken;
        return { status: response.status, body, headers: response.headers };
      },
      async ok(route, method = "GET", data) {
        const result = await this.request(route, method, data);
        assert.ok(
          [200, 201].includes(result.status),
          `${method} ${route}: ${result.status} ${JSON.stringify(result.body)}`,
        );
        if (approvePublic) approveResponse(result.body);
        return result.body;
      },
      async signup(name) {
        return (
          await this.ok("/api/auth/signup", "POST", {
            name,
            email: `${name.toLowerCase()}@example.test`,
            password,
          })
        ).user;
      },
      async publicProfile(name) {
        await this.signup(name);
        return this.ok("/api/social/me", "PATCH", {
          handle: name.toLowerCase(),
          visibility: "public",
          openToCollab: true,
        });
      },
      async upload(buffer = image) {
        return this.ok("/api/social/media", "POST", {
          base64: buffer.toString("base64"),
          mimeType: "image/jpeg",
        });
      },
      async post(input = {}) {
        const mediaIds = input.mediaIds ?? [(await this.upload()).id];
        return this.ok("/api/social/posts", "POST", {
          title: "Handmade sky armor",
          stage: "wip",
          visibility: "public",
          ...input,
          mediaIds,
        });
      },
      async crew(name = "Private crew") {
        return this.ok("/api/crews", "POST", { name });
      },
      async project(crewId, title = "Private shoot") {
        return this.ok("/api/projects", "POST", {
          crewId,
          title,
          date: "2028-03-15",
          time: "14:00",
          location: "142 Secret Lane, studio code 8259",
        });
      },
      async workspace() {
        return this.ok("/api/workspace");
      },
      async collaboration(recipient, post, extra = {}) {
        return this.ok("/api/social/requests", "POST", {
          recipientId: recipient.userId,
          ...(post ? { postId: post.id } : {}),
          title: "Forest portrait shoot",
          role: "Photographer",
          message: "Interested in making this together.",
          ...extra,
        });
      },
    };
  }
  return { client, config, start, stop, directory, approve, inspect, get base() { return base; } };
}

