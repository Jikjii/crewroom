import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { fixture as socialFixture, password, image, rejected } from "./social-fixture.mjs";
const fixture = (t, options = {}) => socialFixture(t, { ...options, approvePublic: true });

test("public identity is opt-in; private profiles, drafts and their images stay inaccessible", async (t) => {
  const f = await fixture(t),
    owner = f.client(),
    other = f.client(),
    anon = f.client();
  await owner.signup("PrivateMaker");
  await other.signup("AnotherMaker");
  const profile = await owner.ok("/api/social/me");
  assert.equal(profile.visibility, "private");
  const crew = await owner.crew(),
    plan = await owner.project(crew.id);
  const asset = await owner.upload();
  const draft = await owner.ok("/api/social/posts", "POST", {
    title: "Unannounced build",
    stage: "wip",
    mediaIds: [asset.id],
  });
  assert.equal(draft.visibility, "private");
  for (const viewer of [other, anon]) {
    assert.equal(
      (await viewer.request(`/api/social/profiles/${profile.handle}`)).status,
      404,
    );
    assert.equal(
      (await viewer.request(`/api/social/posts/${draft.id}`)).status,
      404,
    );
    assert.equal((await viewer.request(asset.url)).status, 404);
    assert.equal(
      (await viewer.ok("/api/social/feed")).items.some(
        (post) => post.id === draft.id,
      ),
      false,
    );
  }
  assert.equal(
    (await owner.ok(`/api/social/posts/${draft.id}`)).post.id,
    draft.id,
  );
  rejected(
    await owner.request(`/api/social/posts/${draft.id}`, "PATCH", {
      visibility: "public",
    }),
  );
  const foreign = await other.upload();
  rejected(
    await owner.request(`/api/social/posts/${draft.id}`, "PATCH", {
      visibility: "public",
      publishProfile: true,
      mediaIds: [foreign.id],
    }),
  );
  assert.equal(
    (await owner.ok("/api/social/me")).visibility,
    "private",
    "Failed publish must not partially expose identity",
  );
  await owner.ok(`/api/social/posts/${draft.id}`, "PATCH", {
    visibility: "public",
    publishProfile: true,
  });
  const publicResult = await anon.ok(`/api/social/posts/${draft.id}`);
  assert.equal(publicResult.post.author.visibility, "public");
  assert.equal((await anon.request(asset.url)).status, 200);
  for (const privateValue of [
    "privatemaker@example.test",
    crew.id,
    plan.id,
    plan.location,
  ]) {
    assert.equal(
      JSON.stringify(publicResult).includes(privateValue),
      false,
      `Public response must omit ${privateValue}`,
    );
  }
  await owner.ok("/api/social/me", "PATCH", { visibility: "private" });
  assert.equal(
    (await anon.request(`/api/social/posts/${draft.id}`)).status,
    404,
  );
  assert.equal((await other.request(asset.url)).status, 404);
  assert.equal((await owner.request(asset.url)).status, 200);
  await owner.ok("/api/social/me", "PATCH", { visibility: "public" });
  assert.equal(
    (await anon.request(`/api/social/posts/${draft.id}`)).status,
    200,
  );
});

test("uploads are sanitized, owned, and inaccessible before publication or after deletion", async (t) => {
  const f = await fixture(t),
    owner = f.client(),
    intruder = f.client(),
    anon = f.client();
  await owner.publicProfile("MediaMaker");
  await intruder.publicProfile("MediaVisitor");
  rejected(
    await anon.request("/api/social/media", "POST", {
      base64: image.toString("base64"),
      mimeType: "image/jpeg",
    }),
    [401],
  );
  const source = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: "#ac82cf" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  assert.ok((await sharp(source).metadata()).exif);
  const asset = await owner.upload(source);
  const encoded = await owner.request(asset.url);
  assert.equal(encoded.status, 200);
  assert.match(encoded.headers.get("content-type"), /image\/jpeg/);
  const metadata = await sharp(encoded.body).metadata();
  assert.equal(metadata.exif, undefined);
  assert.ok(metadata.width <= 1600 && metadata.height <= 1600);
  assert.equal((await anon.request(asset.url)).status, 404);
  assert.equal((await intruder.request(asset.url)).status, 404);
  rejected(
    await owner.request("/api/social/media", "POST", {
      base64: Buffer.from("this is not an image").toString("base64"),
      mimeType: "image/png",
    }),
  );
  rejected(
    await owner.request("/api/social/media", "POST", {
      base64: image.toString("base64"),
      mimeType: "image/svg+xml",
    }),
  );
  rejected(
    await intruder.request("/api/social/posts", "POST", {
      title: "Stolen attachment",
      stage: "wip",
      visibility: "public",
      mediaIds: [asset.id],
    }),
  );
  const post = await owner.post({
    mediaIds: [asset.id],
    mediaAlts: ["Purple fabric sample"],
  });
  assert.equal(post.media[0].alt, "Purple fabric sample");
  rejected(
    await intruder.request(`/api/social/posts/${post.id}`, "PATCH", {
      title: "Hijacked",
    }),
  );
  rejected(await intruder.request(`/api/social/posts/${post.id}`, "DELETE"));
  rejected(
    await owner.request(`/api/social/posts/${post.id}`, "PATCH", {
      mediaIds: [],
    }),
  );
  await intruder.ok(`/api/social/posts/${post.id}/save`, "POST", {
    saved: true,
  });
  await owner.ok(`/api/social/posts/${post.id}`, "DELETE");
  for (const viewer of [intruder, anon]) {
    assert.equal(
      (await viewer.request(`/api/social/posts/${post.id}`)).status,
      404,
    );
    assert.equal((await viewer.request(asset.url)).status, 404);
  }
  assert.equal(
    (await intruder.ok("/api/social/feed?mode=saved")).items.some(
      (item) => item.id === post.id,
    ),
    false,
  );
});

test("private identities cannot follow, comment, or request until they deliberately publish a profile", async (t) => {
  const f = await fixture(t),
    maker = f.client(),
    privateUser = f.client();
  const profile = await maker.publicProfile("PublishedMaker");
  const post = await maker.post();
  await privateUser.signup("HiddenVisitor");
  await privateUser.ok(`/api/social/posts/${post.id}/save`, "POST", {
    saved: true,
  });
  rejected(
    await privateUser.request(
      `/api/social/profiles/${profile.userId}/follow`,
      "POST",
      { following: true },
    ),
  );
  rejected(
    await privateUser.request(`/api/social/posts/${post.id}/comments`, "POST", {
      body: "Not ready to be public",
    }),
  );
  rejected(
    await privateUser.request("/api/social/requests", "POST", {
      recipientId: profile.userId,
      title: "Shoot",
      role: "Maker",
      message: "Hello",
    }),
  );
  assert.equal((await maker.ok("/api/social/notifications")).length, 0);
  assert.equal(
    (await maker.ok(`/api/social/posts/${post.id}`)).comments.length,
    0,
  );
  assert.equal((await maker.ok("/api/social/requests")).incoming.length, 0);
  await privateUser.ok("/api/social/me", "PATCH", { visibility: "public" });
  await privateUser.ok(
    `/api/social/profiles/${profile.userId}/follow`,
    "POST",
    { following: true },
  );
  await privateUser.ok(`/api/social/posts/${post.id}/comments`, "POST", {
    body: "I chose to share my identity",
  });
  await privateUser.collaboration(profile, post);
  assert.deepEqual(
    new Set(
      (await maker.ok("/api/social/notifications")).map((item) => item.type),
    ),
    new Set(["follow", "comment", "request"]),
  );
});

test("demo work stays isolated on signup; examples can be saved but cannot receive public activity", async (t) => {
  const f = await fixture(t),
    demo = f.client(),
    secondDemo = f.client(),
    real = f.client(),
    anon = f.client();
  const demoUser = (await demo.ok("/api/demo", "POST", {})).user;
  await secondDemo.ok("/api/demo", "POST", {});
  const realProfile = await real.publicProfile("RealCreator");
  const realPost = await real.post();
  const demoProfile = await demo.ok("/api/social/me", "PATCH", {
    visibility: "public",
  });
  const demoPost = await demo.post({ title: "Demo-only unfinished armor" });
  const draft = await demo.post({ title: "Demo draft", visibility: "private" });
  for (const viewer of [real, secondDemo, anon]) {
    assert.equal(
      (await viewer.request(`/api/social/profiles/${demoProfile.handle}`))
        .status,
      404,
    );
    assert.equal(
      (await viewer.request(`/api/social/posts/${demoPost.id}`)).status,
      404,
    );
    assert.equal((await viewer.request(demoPost.media[0].url)).status, 404);
    assert.equal(
      (await viewer.ok("/api/social/feed")).items.some(
        (item) => item.id === demoPost.id,
      ),
      false,
    );
  }
  rejected(
    await demo.request(
      `/api/social/profiles/${realProfile.userId}/follow`,
      "POST",
      { following: true },
    ),
  );
  rejected(
    await demo.request(`/api/social/posts/${realPost.id}/comments`, "POST", {
      body: "Demo cannot contact real creators",
    }),
  );
  rejected(
    await demo.request("/api/social/requests", "POST", {
      recipientId: realProfile.userId,
      title: "Shoot",
      role: "Maker",
      message: "Hello",
    }),
  );
  const upgraded = await demo.signup("SavedDemo");
  assert.equal(upgraded.id, demoUser.id);
  assert.equal(upgraded.isDemo, false);
  const exported = await demo.ok("/api/social/export");
  assert.equal(exported.profile.visibility, "private");
  assert.deepEqual(
    new Set(exported.posts.map((item) => item.id)),
    new Set([demoPost.id, draft.id]),
  );
  assert.ok(exported.posts.every((item) => item.visibility === "private"));
  assert.equal((await anon.request(demoPost.media[0].url)).status, 404);
  await demo.ok(`/api/social/posts/${demoPost.id}`, "PATCH", {
    visibility: "public",
    publishProfile: true,
  });
  assert.equal(
    (await anon.request(`/api/social/posts/${demoPost.id}`)).status,
    200,
  );
  const example = (await anon.ok("/api/social/feed")).items.find(
    (item) => item.isExample,
  );
  assert.ok(example, "Discovery includes clearly marked fictional examples");
  assert.equal(example.author.isExample, true);
  assert.equal(example.author.followerCount, 0);
  assert.equal(example.commentCount, 0);
  await real.ok(`/api/social/posts/${example.id}/save`, "POST", {
    saved: true,
  });
  assert.ok(
    (await real.ok("/api/social/feed?mode=saved")).items.some(
      (item) => item.id === example.id,
    ),
  );
  rejected(
    await real.request(
      `/api/social/profiles/${example.author.userId}/follow`,
      "POST",
      { following: true },
    ),
  );
  rejected(
    await real.request(`/api/social/posts/${example.id}/comments`, "POST", {
      body: "Cannot post fake activity",
    }),
  );
  rejected(
    await real.request("/api/social/requests", "POST", {
      recipientId: example.author.userId,
      title: "Shoot",
      role: "Maker",
      message: "Hello",
    }),
  );
  const unchanged = await anon.ok(`/api/social/posts/${example.id}`);
  assert.equal(unchanged.post.commentCount, 0);
  assert.equal(unchanged.post.author.followerCount, 0);
});

test("follows, private saves, and authored comments persist; ownership controls comment deletion", async (t) => {
  const f = await fixture(t),
    maker = f.client(),
    visitor = f.client(),
    stranger = f.client(),
    anon = f.client();
  const makerProfile = await maker.publicProfile("FollowMaker");
  const visitorProfile = await visitor.publicProfile("FollowVisitor");
  await stranger.publicProfile("FollowStranger");
  const post = await maker.post(),
    unrelated = await stranger.post({ title: "Not followed" });
  for (let n = 0; n < 2; n++)
    await visitor.ok(
      `/api/social/profiles/${makerProfile.userId}/follow`,
      "POST",
      { following: true },
    );
  assert.equal(
    (await anon.ok(`/api/social/profiles/${makerProfile.handle}`)).profile
      .followerCount,
    1,
  );
  const following = await visitor.ok("/api/social/feed?mode=following");
  assert.ok(following.items.some((item) => item.id === post.id));
  assert.equal(
    following.items.some((item) => item.id === unrelated.id),
    false,
  );
  await visitor.ok(`/api/social/posts/${post.id}/save`, "POST", {
    saved: true,
  });
  assert.equal(
    (await visitor.ok(`/api/social/posts/${post.id}`)).post.viewerSaved,
    true,
  );
  assert.equal(
    (await maker.ok(`/api/social/posts/${post.id}`)).post.viewerSaved,
    false,
  );
  const comment = await visitor.ok(
    `/api/social/posts/${post.id}/comments`,
    "POST",
    { body: "How did you finish the foam edges?" },
  );
  assert.equal(comment.author.userId, visitorProfile.userId);
  rejected(
    await stranger.request(`/api/social/comments/${comment.id}`, "DELETE"),
  );
  await f.stop();
  await f.start();
  assert.equal(
    (await visitor.ok(`/api/social/profiles/${makerProfile.handle}`)).profile
      .viewerFollowing,
    true,
  );
  assert.ok(
    (await visitor.ok("/api/social/feed?mode=saved")).items.some(
      (item) => item.id === post.id,
    ),
  );
  assert.equal(
    (await anon.ok(`/api/social/posts/${post.id}`)).comments[0].id,
    comment.id,
  );
  await maker.ok(`/api/social/comments/${comment.id}`, "DELETE");
  const selfComment = await visitor.ok(
    `/api/social/posts/${post.id}/comments`,
    "POST",
    { body: "I can remove my own comment" },
  );
  await visitor.ok(`/api/social/comments/${selfComment.id}`, "DELETE");
  assert.equal(
    (await anon.ok(`/api/social/posts/${post.id}`)).post.commentCount,
    0,
  );
  await visitor.ok(
    `/api/social/profiles/${makerProfile.userId}/follow`,
    "POST",
    { following: false },
  );
  assert.equal(
    (await anon.ok(`/api/social/profiles/${makerProfile.handle}`)).profile
      .followerCount,
    0,
  );
});

test("private creators can unfollow public or newly private targets without republishing their identity", async (t) => {
  const f = await fixture(t),
    visitor = f.client(),
    publicMaker = f.client(),
    hiddenMaker = f.client(),
    other = f.client(),
    anon = f.client();
  await visitor.publicProfile("UnfollowVisitor");
  const publicProfile = await publicMaker.publicProfile("UnfollowPublic"),
    hiddenProfile = await hiddenMaker.publicProfile("UnfollowHidden");
  await other.publicProfile("UnfollowOther");
  for (const profile of [publicProfile, hiddenProfile]) {
    await visitor.ok(`/api/social/profiles/${profile.userId}/follow`, "POST", {
      following: true,
    });
  }
  await other.ok(
    `/api/social/profiles/${publicProfile.userId}/follow`,
    "POST",
    { following: true },
  );
  await visitor.ok("/api/social/me", "PATCH", { visibility: "private" });
  await hiddenMaker.ok("/api/social/me", "PATCH", { visibility: "private" });
  assert.equal(
    (await visitor.request(`/api/social/profiles/${hiddenProfile.handle}`))
      .status,
    404,
  );
  for (const profile of [publicProfile, hiddenProfile]) {
    const result = await visitor.ok(
      `/api/social/profiles/${profile.userId}/follow`,
      "POST",
      { following: false },
    );
    assert.equal(result.following, false);
  }
  assert.equal((await visitor.ok("/api/social/me")).visibility, "private");
  rejected(
    await visitor.request(
      `/api/social/profiles/${publicProfile.userId}/follow`,
      "POST",
      { following: true },
    ),
    [403],
  );
  rejected(
    await anon.request(
      `/api/social/profiles/${publicProfile.userId}/follow`,
      "POST",
      { following: false },
    ),
    [401],
  );
  await hiddenMaker.ok("/api/social/me", "PATCH", { visibility: "public" });
  await f.stop();
  await f.start();
  for (const profile of [publicProfile, hiddenProfile]) {
    assert.equal(
      (await visitor.ok(`/api/social/profiles/${profile.handle}`)).profile
        .viewerFollowing,
      false,
    );
  }
  const remaining = await other.ok(
    `/api/social/profiles/${publicProfile.handle}`,
  );
  assert.equal(remaining.profile.viewerFollowing, true);
  assert.equal(remaining.profile.followerCount, 1);
  assert.equal((await hiddenMaker.ok("/api/social/me")).followerCount, 0);
});

test("blocking filters both directions and pending contact, while preserving an existing private crew", async (t) => {
  const f = await fixture(t),
    a = f.client(),
    b = f.client(),
    neutral = f.client();
  const pa = await a.publicProfile("BlockAster"),
    pb = await b.publicProfile("BlockBirch");
  await neutral.publicProfile("BlockNeutral");
  const postA = await a.post(),
    postB = await b.post(),
    commonPost = await neutral.post();
  const crew = await a.crew("Already shared crew");
  const invite = await a.ok(`/api/crews/${crew.id}/invites`, "POST", {});
  await b.ok(`/api/invites/${invite.token}/accept`, "POST", {});
  await a.ok(`/api/social/profiles/${pb.userId}/follow`, "POST", {
    following: true,
  });
  await b.ok(`/api/social/profiles/${pa.userId}/follow`, "POST", {
    following: true,
  });
  const comment = await a.ok(
    `/api/social/posts/${commonPost.id}/comments`,
    "POST",
    { body: "A comment in common space" },
  );
  await b.ok(`/api/social/posts/${postA.id}/comments`, "POST", {
    body: "Before the block",
  });
  const request = await b.collaboration(pa, postA);
  await a.ok("/api/social/blocks", "POST", { userId: pb.userId });
  await f.stop();
  await f.start();
  assert.ok(
    (await a.ok("/api/social/blocks")).some(
      (item) => item.userId === pb.userId,
    ),
  );
  for (const [viewer, hiddenProfile, hiddenPost] of [
    [a, pb, postB],
    [b, pa, postA],
  ]) {
    assert.equal(
      (await viewer.request(`/api/social/profiles/${hiddenProfile.handle}`))
        .status,
      404,
    );
    assert.equal(
      (await viewer.request(`/api/social/posts/${hiddenPost.id}`)).status,
      404,
    );
    assert.equal((await viewer.request(hiddenPost.media[0].url)).status, 404);
    assert.equal(
      (await viewer.ok("/api/social/feed")).items.some(
        (item) => item.author.userId === hiddenProfile.userId,
      ),
      false,
    );
    assert.equal(
      (await viewer.ok("/api/social/profiles")).some(
        (item) => item.userId === hiddenProfile.userId,
      ),
      false,
    );
    assert.equal(
      (await viewer.ok("/api/social/notifications")).some(
        (item) => item.actor?.userId === hiddenProfile.userId,
      ),
      false,
    );
    const inbox = await viewer.ok("/api/social/requests");
    assert.equal(
      [...inbox.incoming, ...inbox.outgoing].some(
        (item) => item.id === request.id,
      ),
      false,
    );
    rejected(
      await viewer.request(
        `/api/social/profiles/${hiddenProfile.userId}/follow`,
        "POST",
        { following: true },
      ),
    );
    rejected(
      await viewer.request(
        `/api/social/posts/${hiddenPost.id}/comments`,
        "POST",
        { body: "Blocked contact" },
      ),
    );
    rejected(
      await viewer.request("/api/social/requests", "POST", {
        recipientId: hiddenProfile.userId,
        title: "Blocked shoot",
        role: "Maker",
        message: "Hello",
      }),
    );
    assert.ok(
      (await viewer.workspace()).crews.some((item) => item.id === crew.id),
    );
  }
  assert.equal(
    (await b.ok(`/api/social/posts/${commonPost.id}`)).comments.some(
      (item) => item.id === comment.id,
    ),
    false,
  );
  await a.ok(`/api/social/blocks/${pb.userId}`, "DELETE");
  assert.equal(
    (await a.ok(`/api/social/profiles/${pb.handle}`)).profile.viewerFollowing,
    false,
  );
  assert.equal(
    (await b.ok(`/api/social/profiles/${pa.handle}`)).profile.viewerFollowing,
    false,
  );
  assert.equal(
    (await a.ok("/api/social/requests")).incoming.find(
      (item) => item.id === request.id,
    ).status,
    "cancelled",
  );
});

test("reporting persists the report and hides the post only from its reporter", async (t) => {
  const f = await fixture(t),
    maker = f.client(),
    reporter = f.client(),
    anon = f.client();
  await maker.publicProfile("ReportedMaker");
  await reporter.publicProfile("ReportReader");
  const post = await maker.post();
  await reporter.ok("/api/social/reports", "POST", {
    targetType: "post",
    targetId: post.id,
    reason: "stolen-work",
    details: "Please review the credited maker.",
  });
  await f.stop();
  await f.start();
  assert.equal(
    (await reporter.ok("/api/social/feed")).items.some(
      (item) => item.id === post.id,
    ),
    false,
  );
  assert.equal(
    (await reporter.request(`/api/social/posts/${post.id}`)).status,
    404,
  );
  assert.equal(
    (await anon.request(`/api/social/posts/${post.id}`)).status,
    200,
  );
  assert.equal(
    (await maker.request(`/api/social/posts/${post.id}`)).status,
    200,
  );
  // Inspect durable storage because moderation is a local operator CLI, not a public API.
  const db = new DatabaseSync(f.config.dbPath, { readOnly: true });
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%report%'",
      )
      .all();
    assert.ok(
      tables.some(({ name }) =>
        db
          .prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
          .all()
          .some(
            (row) =>
              Object.values(row).includes(post.id) &&
              Object.values(row).includes("stolen-work"),
          ),
      ),
      "Report and reason survive a server restart for moderation",
    );
  } finally {
    db.close();
  }
});

test("collaboration acceptance atomically creates one new private crew and never admits anyone to existing crews", async (t) => {
  const f = await fixture(t),
    sender = f.client(),
    recipient = f.client(),
    stranger = f.client(),
    anon = f.client();
  const ps = await sender.publicProfile("CollabSender"),
    pr = await recipient.publicProfile("CollabRecipient");
  await stranger.publicProfile("CollabStranger");
  const senderCrew = await sender.crew("Sender's preexisting crew"),
    recipientCrew = await recipient.crew("Recipient's secret crew");
  const senderPlan = await sender.project(senderCrew.id),
    recipientPlan = await recipient.project(recipientCrew.id);
  const post = await recipient.post({
    opportunity: {
      role: "Photographer",
      city: "Boston",
      eventName: "Spring studio day",
      date: "2028-03-15",
    },
  });
  const request = await sender.collaboration(pr, post);
  assert.equal(request.status, "pending");
  assert.equal(request.crewId, null);
  assert.equal((await stranger.ok("/api/social/requests")).incoming.length, 0);
  rejected(
    await stranger.request(`/api/social/requests/${request.id}`, "PATCH", {
      action: "accept",
    }),
  );
  rejected(
    await sender.request(`/api/social/requests/${request.id}`, "PATCH", {
      action: "accept",
    }),
  );
  const attempts = await Promise.all([
    recipient.request(`/api/social/requests/${request.id}`, "PATCH", {
      action: "accept",
      crewId: recipientCrew.id,
    }),
    recipient.request(`/api/social/requests/${request.id}`, "PATCH", {
      action: "accept",
    }),
  ]);
  assert.ok(attempts.some((result) => result.status === 200));
  assert.ok(
    attempts.every((result) => [200, 409].includes(result.status)),
    JSON.stringify(attempts),
  );
  const accepted = attempts.find((result) => result.status === 200).body;
  assert.equal(accepted.status, "accepted");
  assert.ok(accepted.crewId && accepted.projectId);
  assert.notEqual(accepted.crewId, senderCrew.id);
  assert.notEqual(accepted.crewId, recipientCrew.id);
  const again = await recipient.request(
    `/api/social/requests/${request.id}`,
    "PATCH",
    { action: "accept" },
  );
  assert.ok([200, 409].includes(again.status));
  if (again.status === 200) assert.equal(again.body.crewId, accepted.crewId);
  const sw = await sender.workspace(),
    rw = await recipient.workspace();
  assert.equal(sw.crews.length, 2);
  assert.equal(rw.crews.length, 2);
  assert.equal(
    sw.crews.some((item) => item.id === recipientCrew.id),
    false,
  );
  assert.equal(
    rw.crews.some((item) => item.id === senderCrew.id),
    false,
  );
  assert.equal(
    sw.projects.some((item) => item.id === recipientPlan.id),
    false,
  );
  assert.equal(
    rw.projects.some((item) => item.id === senderPlan.id),
    false,
  );
  assert.equal(
    rw.crews.find((item) => item.id === accepted.crewId).ownerId,
    pr.userId,
  );
  assert.deepEqual(
    new Set(
      rw.members
        .filter((item) => item.crewId === accepted.crewId)
        .map((item) => item.userId),
    ),
    new Set([ps.userId, pr.userId]),
  );
  assert.equal(
    rw.projects.find((item) => item.id === accepted.projectId).title,
    request.title,
  );
  assert.equal((await stranger.workspace()).crews.length, 0);
  assert.equal(
    JSON.stringify(await anon.ok(`/api/social/posts/${post.id}`)).includes(
      accepted.crewId,
    ),
    false,
  );
  await f.stop();
  await f.start();
  assert.equal(
    (await sender.ok("/api/social/requests")).outgoing[0].crewId,
    accepted.crewId,
  );
  assert.equal((await sender.workspace()).crews.length, 2);
});

test("requests validate post authorship and transitions; declined or cancelled requests create no private access", async (t) => {
  const f = await fixture(t),
    sender = f.client(),
    recipient = f.client(),
    other = f.client();
  await sender.publicProfile("TransitionSender");
  const pr = await recipient.publicProfile("TransitionRecipient");
  await other.publicProfile("TransitionOther");
  const otherPost = await other.post();
  rejected(
    await sender.request("/api/social/requests", "POST", {
      recipientId: pr.userId,
      postId: otherPost.id,
      title: "Wrong author",
      role: "Maker",
      message: "Hello",
    }),
  );
  const declined = await sender.collaboration(pr);
  rejected(
    await sender.request(`/api/social/requests/${declined.id}`, "PATCH", {
      action: "decline",
    }),
  );
  assert.equal(
    (
      await recipient.ok(`/api/social/requests/${declined.id}`, "PATCH", {
        action: "decline",
      })
    ).status,
    "declined",
  );
  rejected(
    await recipient.request(`/api/social/requests/${declined.id}`, "PATCH", {
      action: "accept",
    }),
    [409],
  );
  const cancelled = await sender.collaboration(pr);
  rejected(
    await recipient.request(`/api/social/requests/${cancelled.id}`, "PATCH", {
      action: "cancel",
    }),
  );
  assert.equal(
    (
      await sender.ok(`/api/social/requests/${cancelled.id}`, "PATCH", {
        action: "cancel",
      })
    ).status,
    "cancelled",
  );
  rejected(
    await recipient.request(`/api/social/requests/${cancelled.id}`, "PATCH", {
      action: "accept",
    }),
    [409],
  );
  assert.equal((await recipient.workspace()).crews.length, 0);
  assert.equal((await sender.workspace()).crews.length, 0);
});

test("a failed collaboration acceptance rolls back every access change and can be retried safely", async (t) => {
  const loggedErrors = [];
  const f = await fixture(t, {
    logger: { error: (error) => loggedErrors.push(String(error)) },
  });
  const sender = f.client(),
    recipient = f.client();
  await sender.publicProfile("RollbackSender");
  const profile = await recipient.publicProfile("RollbackRecipient");
  const oldCrew = await recipient.crew("Existing private crew");
  await recipient.project(oldCrew.id);
  const request = await sender.collaboration(profile);
  const senderBefore = await sender.workspace(),
    recipientBefore = await recipient.workspace();
  // Force failure after crew and member insertion, at the real database boundary.
  const db = new DatabaseSync(f.config.dbPath);
  try {
    db.exec(
      "CREATE TRIGGER fail_collaboration_project BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT, 'intentional collaboration atomicity test'); END",
    );
    const failed = await recipient.request(
      `/api/social/requests/${request.id}`,
      "PATCH",
      { action: "accept" },
    );
    assert.equal(failed.status, 500);
    assert.equal(loggedErrors.length, 1);
    assert.deepEqual(
      await sender.workspace(),
      senderBefore,
      "Sender must gain no partial crew access",
    );
    assert.deepEqual(
      await recipient.workspace(),
      recipientBefore,
      "Recipient must retain only their existing crew",
    );
    const pending = (await recipient.ok("/api/social/requests")).incoming.find(
      (item) => item.id === request.id,
    );
    assert.equal(pending.status, "pending");
    assert.equal(pending.crewId, null);
    assert.equal(pending.projectId, null);
    assert.equal(
      (await sender.ok("/api/social/notifications")).some(
        (item) => item.type === "accepted",
      ),
      false,
    );
  } finally {
    db.exec("DROP TRIGGER IF EXISTS fail_collaboration_project");
    db.close();
  }
  const accepted = await recipient.ok(
    `/api/social/requests/${request.id}`,
    "PATCH",
    { action: "accept" },
  );
  assert.equal(accepted.status, "accepted");
  assert.equal((await sender.workspace()).crews.length, 1);
  assert.equal((await recipient.workspace()).crews.length, 2);
});

test("notification reads are scoped to their owner and persist across restart", async (t) => {
  const f = await fixture(t),
    owner = f.client(),
    actor = f.client(),
    stranger = f.client();
  const po = await owner.publicProfile("NotifyOwner");
  await actor.publicProfile("NotifyActor");
  await stranger.publicProfile("NotifyStranger");
  const post = await owner.post();
  await actor.ok(`/api/social/profiles/${po.userId}/follow`, "POST", {
    following: true,
  });
  await actor.ok(`/api/social/posts/${post.id}/comments`, "POST", {
    body: "Beautiful stitching",
  });
  const request = await actor.collaboration(po, post);
  let notifications = await owner.ok("/api/social/notifications");
  assert.deepEqual(
    new Set(notifications.map((item) => item.type)),
    new Set(["follow", "comment", "request"]),
  );
  assert.ok(notifications.every((item) => item.read === false));
  await stranger.request("/api/social/notifications/read", "POST", {
    ids: notifications.map((item) => item.id),
  });
  assert.ok(
    (await owner.ok("/api/social/notifications")).every(
      (item) => item.read === false,
    ),
  );
  await owner.ok("/api/social/notifications/read", "POST", {
    ids: [notifications[0].id],
  });
  assert.equal(
    (await owner.ok("/api/social/notifications")).filter((item) => item.read)
      .length,
    1,
  );
  await owner.ok(`/api/social/requests/${request.id}`, "PATCH", {
    action: "accept",
  });
  assert.ok(
    (await actor.ok("/api/social/notifications")).some(
      (item) => item.type === "accepted" && item.requestId === request.id,
    ),
  );
  await owner.ok("/api/social/notifications/read", "POST", {});
  await f.stop();
  await f.start();
  assert.ok(
    (await owner.ok("/api/social/notifications")).every((item) => item.read),
  );
  assert.ok(
    (await actor.ok("/api/social/notifications")).some(
      (item) => item.type === "accepted" && item.read === false,
    ),
  );
});

test("discovery pagination handles equal timestamps without duplicates; handles and links are validated", async (t) => {
  const f = await fixture(t, {
      now: () => Date.UTC(2028, 0, 1),
      rateLimit: 100,
    }),
    maker = f.client(),
    other = f.client(),
    anon = f.client();
  await maker.publicProfile("PaginationMaker");
  await other.publicProfile("PaginationOther");
  for (const input of [
    { handle: "ab" },
    { handle: "has spaces" },
    { websiteUrl: "javascript:alert(1)" },
    { instagramUrl: "http://example.test" },
  ]) {
    rejected(await maker.request("/api/social/me", "PATCH", input));
  }
  rejected(
    await other.request("/api/social/me", "PATCH", {
      handle: "PaginationMaker",
    }),
  );
  const asset = await maker.upload();
  const ids = [];
  for (let n = 0; n < 15; n++) {
    ids.push(
      (
        await maker.post({
          title: `Paginationneedle ${n}`,
          stage: n % 2 ? "finished" : "wip",
          mediaIds: [asset.id],
          opportunity:
            n === 0
              ? {
                  role: "Photographer",
                  city: "Boston",
                  eventName: "",
                  date: "2028-03-15",
                }
              : null,
        })
      ).id,
    );
  }
  await maker.post({
    title: "Paginationneedle hidden draft",
    visibility: "private",
    mediaIds: [asset.id],
  });
  const first = await anon.ok("/api/social/feed?q=Paginationneedle");
  assert.equal(first.items.length, 12);
  assert.ok(first.nextCursor);
  const second = await anon.ok(
    `/api/social/feed?q=Paginationneedle&cursor=${encodeURIComponent(first.nextCursor)}`,
  );
  assert.equal(second.nextCursor, null);
  const combined = [...first.items, ...second.items].map((item) => item.id);
  assert.equal(combined.length, 15);
  assert.equal(new Set(combined).size, 15);
  assert.deepEqual(new Set(combined), new Set(ids));
  const filtered = await anon.ok(
    "/api/social/feed?q=Paginationneedle&stage=finished",
  );
  assert.equal(filtered.items.length, 7);
  assert.ok(filtered.items.every((item) => item.stage === "finished"));
  const open = await anon.ok("/api/social/feed?q=Paginationneedle&openRoles=1");
  assert.deepEqual(
    open.items.map((item) => item.id),
    [ids[0]],
  );
});

test("social initialization is additive to private crew data, and social cookie writes retain CSRF protection", async (t) => {
  const f = await fixture(t),
    person = f.client("web");
  await person.signup("MigrationMaker");
  const crew = await person.crew(),
    project = await person.project(crew.id);
  await person.ok("/api/tasks", "POST", {
    projectId: project.id,
    title: "Finish the seam",
    dueDate: "2028-03-14",
  });
  await person.ok("/api/agenda", "POST", {
    projectId: project.id,
    time: "13:30",
    title: "Meet at the studio",
    location: "Private studio room",
  });
  const before = await person.workspace();
  await f.stop();
  // Reproduce a pre-social SQLite file while retaining real private API data and sessions.
  const db = new DatabaseSync(f.config.dbPath);
  try {
    db.exec("PRAGMA foreign_keys=OFF");
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'social_*'",
      )
      .all();
    assert.ok(
      tables.length > 0,
      "Fixture contains social tables to remove before migration",
    );
    for (const { name } of tables)
      db.exec(`DROP TABLE "${name.replaceAll('"', '""')}"`);
  } finally {
    db.close();
  }
  await f.start();
  assert.deepEqual(await person.workspace(), before);
  assert.equal((await person.ok("/api/social/me")).visibility, "private");
  rejected(
    await person.request(
      "/api/social/me",
      "PATCH",
      { visibility: "public" },
      { csrf: false },
    ),
    [403],
  );
  rejected(
    await person.request(
      "/api/social/me",
      "PATCH",
      { visibility: "public" },
      { origin: "https://evil.example" },
    ),
    [403],
  );
  await person.ok("/api/social/me", "PATCH", { visibility: "public" });
  await person.post();
  assert.deepEqual(
    await person.workspace(),
    before,
    "Publishing social work must not alter private plans",
  );
});
