import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";

const password = "correct-horse-moonrise";
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "crewroom-test-"));
  let server, base;
  const config = {
    dbPath: path.join(directory, "db.sqlite"),
    staticDir: path.join(directory, "dist"),
    logger: {
      error: (error) => assert.fail(`Unexpected server error: ${error}`),
    },
    ...options,
  };
  async function start() {
    server = createApp(config);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server?.listening)
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  }
  await start();
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });
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
        if (options.origin !== undefined) {
          if (options.origin === null) delete headers.Origin;
          else headers.Origin = options.origin;
        }
        if (options.token !== undefined)
          headers.Authorization = `Bearer ${options.token}`;
        if (data !== undefined) headers["Content-Type"] = "application/json";
        const response = await fetch(base + route, {
          method,
          headers,
          body: data === undefined ? undefined : JSON.stringify(data),
        });
        const body = await response.json();
        if (response.headers.get("set-cookie"))
          state.cookie = response.headers.get("set-cookie").split(";")[0];
        if (body.sessionToken) state.token = body.sessionToken;
        if (Object.hasOwn(body, "csrfToken")) state.csrfToken = body.csrfToken;
        return { status: response.status, body, headers: response.headers };
      },
      async signup(name = "Aster") {
        const result = await this.request("/api/auth/signup", "POST", {
          name,
          email: `${name.toLowerCase()}@example.test`,
          password,
        });
        assert.equal(result.status, 201);
        return result.body.user;
      },
      async workspace() {
        const result = await this.request("/api/workspace");
        assert.equal(result.status, 200);
        return result.body;
      },
      async crew(name = "Test crew") {
        const result = await this.request("/api/crews", "POST", { name });
        assert.equal(result.status, 201);
        return result.body;
      },
      async project(crewId, title = "Test project") {
        const result = await this.request("/api/projects", "POST", {
          crewId,
          title,
          date: "2028-03-15",
          time: "14:00",
        });
        assert.equal(result.status, 201);
        return result.body;
      },
    };
  }
  return {
    directory,
    config,
    client,
    stop,
    start,
    get base() {
      return base;
    },
  };
}

test("demo accounts are isolated, have honest placeholders and per-project lineup, and upgrade preserves data", async (t) => {
  const f = await fixture(t),
    a = f.client("web"),
    b = f.client("web");
  const first = await a.request("/api/demo", "POST", {}),
    second = await b.request("/api/demo", "POST", {});
  assert.equal(first.status, 201);
  assert.notEqual(first.body.user.id, second.body.user.id);
  assert.equal(first.body.user.isDemo, true);
  const wa = await a.workspace(),
    wb = await b.workspace();
  assert.equal(wa.crews[0].name, "Moonrise Collective");
  assert.notEqual(wa.crews[0].id, wb.crews[0].id);
  assert.equal(wa.projects[0].title, "The skybound crew");
  assert.equal(wa.projects[0].fandom, "Original characters");
  assert.equal(wa.projects[0].eventName, "Afterlight studio shoot");
  assert.ok(wa.tasks.length >= 5);
  assert.ok(wa.agenda.length >= 4);
  assert.equal(wa.lineup.length, 5);
  assert.equal(wa.members.filter((m) => m.isPlaceholder).length, 4);
  assert.equal(Object.hasOwn(wa.members[0], "character"), false);
  assert.ok(wa.tasks.every((task) => typeof task.done === "boolean"));
  assert.equal(
    (
      await b.request(`/api/projects/${wa.projects[0].id}`, "PATCH", {
        title: "Intrusion",
      })
    ).status,
    404,
  );
  const account = await a.signup("Upgrade");
  assert.equal(account.id, first.body.user.id);
  assert.equal(account.isDemo, false);
  assert.equal((await a.workspace()).crews[0].id, wa.crews[0].id);
  const session = await a.request("/api/session");
  assert.equal(Object.hasOwn(session.body, "sessionToken"), false);
  assert.match(
    session.headers.get("set-cookie") || first.headers.get("set-cookie"),
    /HttpOnly/,
  );
});

test("web cookie mutations enforce CSRF and trusted Origin; bearer native mutations need neither", async (t) => {
  const f = await fixture(t),
    web = f.client("web");
  await web.signup("Web");
  assert.equal(
    (
      await web.request(
        "/api/crews",
        "POST",
        { name: "No CSRF" },
        { csrf: false },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await web.request(
        "/api/crews",
        "POST",
        { name: "No Origin" },
        { origin: null },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await web.request(
        "/api/crews",
        "POST",
        { name: "Bad Origin" },
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await web.request("/api/crews", "POST", { name: "Allowed" })).status,
    201,
  );
  const native = f.client();
  await native.signup("Native");
  assert.equal(
    (await native.request("/api/crews", "POST", { name: "Native" })).status,
    201,
  );
  assert.equal(
    (
      await native.request(
        "/api/crews",
        "POST",
        { name: "Bad native origin" },
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  const response = await fetch(f.base + "/api/session", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:8081",
      "Access-Control-Request-Headers": "authorization",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "http://localhost:8081",
  );
});

test("membership scopes all data and writes, prevents cross-crew assignments and project moves", async (t) => {
  const f = await fixture(t),
    a = f.client(),
    b = f.client();
  await a.signup("Alice");
  await b.signup("Bob");
  const ca = await a.crew("A"),
    cb = await b.crew("B"),
    pa = await a.project(ca.id),
    pb = await b.project(cb.id);
  const mb = (await b.workspace()).members[0];
  assert.equal(
    (
      await b.request("/api/tasks", "POST", {
        projectId: pa.id,
        title: "Intrusion",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await a.request("/api/tasks", "POST", {
        projectId: pa.id,
        title: "Wrong crew",
        assigneeId: mb.id,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await a.request("/api/lineup", "POST", {
        projectId: pa.id,
        memberId: mb.id,
      })
    ).status,
    400,
  );
  const changed = await a.request(`/api/projects/${pa.id}`, "PATCH", {
    title: "Renamed",
    crewId: cb.id,
  });
  assert.equal(changed.body.crewId, ca.id);
  assert.equal((await b.workspace()).projects[0].id, pb.id);
  assert.equal((await a.workspace()).members.length, 1);
});

test("placeholder invitations preserve assignments, are one-use, and editable role labels cannot grant captain access", async (t) => {
  const f = await fixture(t),
    owner = f.client(),
    joiner = f.client(),
    other = f.client();
  await owner.signup("Owner");
  const joinUser = await joiner.signup("Joiner");
  await other.signup("Other");
  const crew = await owner.crew(),
    project = await owner.project(crew.id);
  const placeholder = (
    await owner.request("/api/members", "POST", {
      crewId: crew.id,
      name: "Planned pal",
    })
  ).body;
  const task = (
    await owner.request("/api/tasks", "POST", {
      projectId: project.id,
      title: "Pack props",
      assigneeId: placeholder.id,
    })
  ).body;
  const lineup = (
    await owner.request("/api/lineup", "POST", {
      projectId: project.id,
      memberId: placeholder.id,
      character: "Navigator",
      status: "making",
    })
  ).body;
  const invite = (
    await owner.request(`/api/crews/${crew.id}/invites`, "POST", {
      memberId: placeholder.id,
    })
  ).body;
  assert.ok(invite.id);
  assert.match(invite.url, /\/join\//);
  const preview = await other.request(`/api/invites/${invite.token}`);
  assert.deepEqual(Object.keys(preview.body).sort(), [
    "crewName",
    "expiresAt",
    "inviterName",
  ]);
  assert.equal(
    (await joiner.request(`/api/invites/${invite.token}/accept`, "POST", {}))
      .status,
    200,
  );
  const ws = await joiner.workspace(),
    claimed = ws.members.find((m) => m.id === placeholder.id);
  assert.equal(claimed.userId, joinUser.id);
  assert.equal(claimed.isPlaceholder, false);
  assert.equal(claimed.name, "Joiner");
  assert.equal(
    ws.tasks.find((item) => item.id === task.id).assigneeId,
    placeholder.id,
  );
  assert.equal(
    ws.lineup.find((item) => item.id === lineup.id).character,
    "Navigator",
  );
  assert.equal(
    (await joiner.request(`/api/invites/${invite.token}/accept`, "POST", {}))
      .status,
    200,
  );
  assert.equal(
    (await other.request(`/api/invites/${invite.token}/accept`, "POST", {}))
      .status,
    409,
  );
  assert.equal((await other.workspace()).crews.length, 0);
  assert.equal(
    (
      await joiner.request(`/api/members/${claimed.id}`, "PATCH", {
        role: "Captain",
      })
    ).status,
    200,
  );
  assert.equal(
    (await joiner.request(`/api/crews/${crew.id}/invites`, "POST", {})).status,
    403,
  );
  assert.equal(
    (
      await joiner.request("/api/members", "POST", {
        crewId: crew.id,
        name: "Unauthorized",
      })
    ).status,
    403,
  );
  assert.equal(
    (await joiner.request(`/api/tasks/${task.id}`, "PATCH", { done: true }))
      .status,
    200,
  );
});

test("revocation, expiry, and demo invitation rejection do not grant membership", async (t) => {
  let clock = Date.now();
  const f = await fixture(t, { now: () => clock });
  const owner = f.client(),
    person = f.client(),
    demo = f.client();
  await owner.signup("InviteOwner");
  await person.signup("Invited");
  await demo.request("/api/demo", "POST", {});
  const crew = await owner.crew();
  const invite = (
    await owner.request(`/api/crews/${crew.id}/invites`, "POST", {})
  ).body;
  assert.equal(
    (await demo.request(`/api/invites/${invite.token}/accept`, "POST", {}))
      .status,
    403,
  );
  assert.equal(
    (await person.request(`/api/invites/${invite.id}`, "DELETE")).status,
    404,
  );
  assert.equal(
    (await owner.request(`/api/invites/${invite.id}`, "DELETE")).status,
    200,
  );
  assert.equal(
    (await person.request(`/api/invites/${invite.token}/accept`, "POST", {}))
      .status,
    404,
  );
  const expiry = (
    await owner.request(`/api/crews/${crew.id}/invites`, "POST", {})
  ).body;
  clock += 8 * 86400000;
  assert.equal(
    (await person.request(`/api/invites/${expiry.token}/accept`, "POST", {}))
      .status,
    404,
  );
  assert.equal((await person.workspace()).crews.length, 0);
});

test("lineup is per-project; leaving clears assignments and lineup but preserves crew work", async (t) => {
  const f = await fixture(t),
    owner = f.client(),
    member = f.client();
  const ownerUser = await owner.signup("Lead");
  const memberUser = await member.signup("Friend");
  const crew = await owner.crew(),
    first = await owner.project(crew.id, "First"),
    second = await owner.project(crew.id, "Second");
  const invite = (
    await owner.request(`/api/crews/${crew.id}/invites`, "POST", {})
  ).body;
  await member.request(`/api/invites/${invite.token}/accept`, "POST", {});
  let ws = await member.workspace();
  const memberId = ws.members.find((m) => m.userId === memberUser.id).id;
  const a = (
    await member.request("/api/lineup", "POST", {
      projectId: first.id,
      memberId,
      character: "Sun",
      status: "ready",
    })
  ).body;
  const b = (
    await member.request("/api/lineup", "POST", {
      projectId: second.id,
      memberId,
      character: "Moon",
      status: "planning",
    })
  ).body;
  await member.request(`/api/lineup/${b.id}`, "PATCH", { status: "making" });
  ws = await member.workspace();
  assert.equal(ws.lineup.find((l) => l.id === a.id).status, "ready");
  const task = (
    await member.request("/api/tasks", "POST", {
      projectId: first.id,
      title: "Craft",
      assigneeId: memberId,
    })
  ).body;
  assert.equal(
    (
      await owner.request(
        `/api/members/${ws.members.find((m) => m.userId === ownerUser.id).id}`,
        "DELETE",
      )
    ).status,
    409,
  );
  assert.equal(
    (await member.request(`/api/members/${memberId}`, "DELETE")).status,
    200,
  );
  assert.equal((await member.workspace()).crews.length, 0);
  const remaining = await owner.workspace();
  assert.equal(remaining.projects.length, 2);
  assert.equal(remaining.lineup.length, 0);
  assert.equal(remaining.tasks.find((x) => x.id === task.id).assigneeId, null);
  assert.equal(
    (await member.request(`/api/invites/${invite.token}/accept`, "POST", {}))
      .status,
    409,
  );
});

test("SQLite persistence retains sessions, project edits, tasks, and agenda across restarts; logout invalidates bearer", async (t) => {
  const f = await fixture(t),
    person = f.client();
  await person.signup("Persist");
  const crew = await person.crew(),
    project = await person.project(crew.id);
  await person.request(`/api/projects/${project.id}`, "PATCH", {
    date: "2028-02-29",
    description: "Stored across restart",
  });
  const task = (
    await person.request("/api/tasks", "POST", {
      projectId: project.id,
      title: "Persist me",
      dueDate: "2028-02-28",
    })
  ).body;
  await person.request(`/api/tasks/${task.id}`, "PATCH", { done: true });
  const agenda = (
    await person.request("/api/agenda", "POST", {
      projectId: project.id,
      time: "09:30",
      title: "Arrive",
    })
  ).body;
  await f.stop();
  await f.start();
  const ws = await person.workspace();
  assert.equal(ws.projects[0].date, "2028-02-29");
  assert.equal(ws.tasks[0].done, true);
  assert.equal(ws.agenda[0].id, agenda.id);
  assert.equal(
    (await person.request(`/api/agenda/${agenda.id}`, "DELETE")).status,
    200,
  );
  assert.equal(
    (await person.request(`/api/tasks/${task.id}`, "DELETE")).status,
    200,
  );
  assert.equal(
    (await person.request("/api/auth/logout", "POST", {})).status,
    200,
  );
  assert.equal((await person.request("/api/workspace")).status, 401);
  assert.equal((await person.request("/api/session")).body.user, null);
  assert.equal(
    (
      await person.request("/api/auth/login", "POST", {
        email: "persist@example.test",
        password: "wrong",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await person.request("/api/auth/login", "POST", {
        email: "persist@example.test",
        password,
      })
    ).status,
    200,
  );
  assert.equal((await person.workspace()).tasks.length, 0);
});

test("payload validation rejects malformed dates, types, passwords, and JSON without modifying data", async (t) => {
  const f = await fixture(t),
    person = f.client();
  assert.equal(
    (
      await person.request("/api/auth/signup", "POST", {
        name: "Bad",
        email: "bad@example.test",
        password: "short",
      })
    ).status,
    400,
  );
  await person.signup("Validate");
  const crew = await person.crew(),
    project = await person.project(crew.id);
  assert.equal(
    (
      await person.request(`/api/projects/${project.id}`, "PATCH", {
        date: "2027-02-29",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await person.request(`/api/projects/${project.id}`, "PATCH", {
        time: "25:10",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await person.request("/api/tasks", "POST", {
        projectId: project.id,
        title: "   ",
      })
    ).status,
    400,
  );
  const task = (
    await person.request("/api/tasks", "POST", {
      projectId: project.id,
      title: "Valid",
    })
  ).body;
  assert.equal(
    (await person.request(`/api/tasks/${task.id}`, "PATCH", { done: "false" }))
      .status,
    400,
  );
  const invalid = await fetch(f.base + "/api/crews", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${person.state.token}`,
      "Content-Type": "application/json",
    },
    body: "{broken",
  });
  assert.equal(invalid.status, 400);
  assert.equal((await person.workspace()).projects[0].date, "2028-03-15");
});

test("static serving supports web routes but refuses symlink escapes and dotfiles", async (t) => {
  const f = await fixture(t);
  await mkdir(f.config.staticDir);
  await writeFile(
    path.join(f.config.staticDir, "index.html"),
    "<!doctype html><title>Crewroom</title>",
  );
  await writeFile(
    path.join(f.config.staticDir, "app.js"),
    "window.crewroom=true",
  );
  await writeFile(path.join(f.directory, "private.txt"), "do not serve");
  await symlink(
    path.join(f.directory, "private.txt"),
    path.join(f.config.staticDir, "escape.txt"),
  );
  await writeFile(path.join(f.config.staticDir, ".secret"), "do not serve");
  const index = await fetch(f.base + "/join/example-token");
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Crewroom/);
  const script = await fetch(f.base + "/app.js");
  assert.match(script.headers.get("content-type"), /javascript/);
  assert.equal((await fetch(f.base + "/escape.txt")).status, 404);
  assert.equal((await fetch(f.base + "/.secret")).status, 404);
  assert.equal((await fetch(f.base + "/missing.js")).status, 404);
  assert.equal((await fetch(f.base + "/%2e%2e%2fprivate.txt")).status, 404);
  assert.equal((await fetch(f.base + "/api/not-a-route")).status, 401);
});

test("authentication/demo rate limiting returns controlled errors", async (t) => {
  const f = await fixture(t, { rateLimit: 2 }),
    person = f.client();
  assert.equal((await person.request("/api/demo", "POST", {})).status, 201);
  assert.equal((await person.request("/api/demo", "POST", {})).status, 201);
  assert.equal((await person.request("/api/demo", "POST", {})).status, 429);
});
