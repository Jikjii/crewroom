import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(new URL("../app.config.js", import.meta.url));
const configure = require("./app.config.js");
const baseConfig = require("./app.json").expo;
const easConfig = require("./eas.json");
const dependencies = require("./package.json").dependencies;

const publicEnv = {
  CREWROOM_APP_ID: "studio.acme.crewroom",
  EAS_PROJECT_ID: "4c1f99d0-b9d2-4bc7-a7e9-f66a4eca571b",
  EXPO_PUBLIC_API_URL: "https://api.acme.studio",
  EXPO_PUBLIC_WEB_URL: "https://crewroom.acme.studio",
};
const environmentKeys = ["EAS_BUILD_PROFILE", ...Object.keys(publicEnv)];

function withEnvironment(values, run) {
  const keys = new Set([...environmentKeys, ...Object.keys(values)]);
  const previous = new Map([...keys].map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function release(profile, overrides = {}, config = structuredClone(baseConfig)) {
  return withEnvironment({ ...publicEnv, EAS_BUILD_PROFILE: profile, ...overrides },
    () => configure({ config }));
}

test("development remains usable without hosted URLs or native release identifiers", () => {
  for (const profile of [undefined, "development"]) {
    const input = structuredClone(baseConfig);
    const result = withEnvironment({ EAS_BUILD_PROFILE: profile }, () => configure({ config: input }));
    assert.equal(result.name, "Crewroom");
    assert.equal(result.ios.bundleIdentifier, undefined);
    assert.equal(result.android.package, undefined);
    assert.equal(result.extra?.eas?.projectId, undefined);
    assert.deepEqual(input, baseConfig, "configuration must not mutate app.json input");
  }
});

test("both signed profiles require a final shared iOS and Android app identifier", () => {
  for (const profile of ["preview", "production"]) {
    for (const appId of [undefined, "", "crewroom", "studio.crewroom", "com.example.crewroom", "studio.acme.crew_room", "studio.acme.crew-room", "studio.acme.7crewroom", "studio..crewroom", "studio.acme.crewroom "]) {
      assert.throws(() => release(profile, { CREWROOM_APP_ID: appId }), /CREWROOM_APP_ID/,
        `${profile} should reject app identifier ${String(appId)}`);
    }
  }
});

test("both signed profiles require a syntactically valid linked Expo project UUID", () => {
  for (const profile of ["preview", "production"]) {
    for (const projectId of [undefined, "", "your-project-id", "crewroom", "4c1f99d0-b9d2-4bc7-a7e9-f66a4eca571", "4c1f99d0-b9d2-4bc7-a7e9-f66a4eca571z"]) {
      assert.throws(() => release(profile, { EAS_PROJECT_ID: projectId }), /project UUID/,
        `${profile} should reject project UUID ${String(projectId)}`);
    }
  }
});

test("signed API and web origins reject missing, insecure, local, and placeholder values", () => {
  const invalidOrigins = [
    undefined, "", "not a URL", "http://crewroom.acme.studio", "https://localhost",
    "https://localhost.", "https://app.localhost", "https://127.0.0.1", "https://192.168.1.170",
    "https://10.0.0.2", "https://[::1]", "https://[2001:db8::1]", "https://2130706433",
    "https://0x7f000001", "https://example.com", "https://example.com.",
    "https://api.example.org", "https://app.example.net", "https://crewroom.example",
    "https://crewroom.test", "https://crewroom.invalid", "https://crewroom.local",
    "https://crewroom.localdomain", "https://crewroom.internal", "https://crewroom.lan",
    "https://crewroom.home.arpa", "https://crewroom", "https://crew_room.acme.studio",
  ];
  for (const profile of ["preview", "production"]) {
    for (const name of ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_WEB_URL"]) {
      for (const origin of invalidOrigins) {
        assert.throws(() => release(profile, { [name]: origin }), new RegExp(name),
          `${profile} ${name} should reject ${String(origin)}`);
      }
    }
  }
});

test("signed origins reject credentials and URL path, query, or fragment configuration", () => {
  for (const profile of ["preview", "production"]) {
    for (const name of ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_WEB_URL"]) {
      for (const origin of ["https://user:password@crewroom.acme.studio", "https://user@crewroom.acme.studio", "https://crewroom.acme.studio/api", "https://crewroom.acme.studio/?preview=1", "https://crewroom.acme.studio/#preview"]) {
        assert.throws(() => release(profile, { [name]: origin }), new RegExp(name));
      }
    }
  }
});

test("valid release configuration resolves both platform IDs without exposing server environment", () => {
  const serverEnvironment = {
    RESEND_API_KEY: "server-secret-mail-key-for-test",
    MAIL_FROM: "Crewroom <support@acme.studio>",
    DATA_DIR: "/private/server-data-for-test",
    APP_ORIGIN: "https://server-only.acme.studio",
    DATABASE_URL: "database-secret-for-test",
    SESSION_SECRET: "session-secret-for-test",
  };
  for (const profile of ["preview", "production"]) {
    const input = { ...structuredClone(baseConfig), extra: { publicLabel: "Crewroom" } };
    const before = structuredClone(input);
    const result = release(profile, serverEnvironment, input);
    assert.equal(result.ios.bundleIdentifier, publicEnv.CREWROOM_APP_ID);
    assert.equal(result.android.package, publicEnv.CREWROOM_APP_ID);
    assert.equal(result.ios.infoPlist.ITSAppUsesNonExemptEncryption, false);
    assert.deepEqual(result.extra, { publicLabel: "Crewroom", eas: { projectId: publicEnv.EAS_PROJECT_ID } });
    assert.deepEqual(input, before);
    const serialized = JSON.stringify(result);
    for (const [key, value] of Object.entries(serverEnvironment)) {
      assert.ok(!serialized.includes(key), `server key ${key} must not appear in public app config`);
      assert.ok(!serialized.includes(value), `server value for ${key} must not appear in public app config`);
    }
  }
});

test("an existing eas init project UUID is accepted and an explicit project UUID takes precedence", () => {
  const existing = "8d2f66ca-b5ef-47c6-9188-5db4934326dd";
  const config = { ...structuredClone(baseConfig), extra: { eas: { projectId: existing } } };
  assert.equal(release("preview", { EAS_PROJECT_ID: undefined }, config).extra.eas.projectId, existing);
  assert.equal(release("production", {}, config).extra.eas.projectId, publicEnv.EAS_PROJECT_ID);
  const result = release("preview", { EXPO_PUBLIC_API_URL: `${publicEnv.EXPO_PUBLIC_API_URL}/`, EXPO_PUBLIC_WEB_URL: `${publicEnv.EXPO_PUBLIC_WEB_URL}/` });
  assert.equal(result.name, "Crewroom");
});

test("both EAS distributions use guarded profiles and native appearance is enabled", () => {
  assert.equal(easConfig.build.preview.environment, "preview");
  assert.equal(easConfig.build.production.environment, "production");
  assert.equal(easConfig.build.preview.distribution, "internal");
  assert.equal(easConfig.build.preview.android.buildType, "apk");
  assert.equal(easConfig.build.production.android.buildType, "app-bundle");
  assert.equal(baseConfig.userInterfaceStyle, "automatic");
  assert.ok(dependencies["expo-system-ui"]);
});
