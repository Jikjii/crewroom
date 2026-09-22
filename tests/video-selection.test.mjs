import assert from "node:assert/strict";
import { test } from "node:test";
import { validateVideoSelection } from "../src/social/videoSelection.ts";

const limits = { maxDuration: 60, maxBytes: 50 * 1024 * 1024 };
const video = { type: "video", duration: 60_000, fileSize: limits.maxBytes };

test("native video selection accepts the exact duration and byte limits", () => {
  assert.doesNotThrow(() => validateVideoSelection(video, limits));
});

test("native video selection rejects oversized clips before upload", () => {
  assert.throws(
    () => validateVideoSelection({ ...video, duration: 60_001 }, limits),
    /60 seconds/,
  );
  assert.throws(
    () =>
      validateVideoSelection(
        { ...video, fileSize: limits.maxBytes + 1 },
        limits,
      ),
    /50 MB/,
  );
});

test("native video selection respects server limits without exceeding app limits", () => {
  assert.throws(
    () => validateVideoSelection(video, { ...limits, maxDuration: 30 }),
    /30 seconds/,
  );
  assert.throws(
    () => validateVideoSelection(video, { ...limits, maxBytes: 1024 * 1024 }),
    /1 MB/,
  );
  assert.throws(
    () =>
      validateVideoSelection(
        { ...video, duration: 60_001 },
        { ...limits, maxDuration: 600 },
      ),
    /60 seconds/,
  );
  assert.throws(
    () =>
      validateVideoSelection(
        { ...video, fileSize: limits.maxBytes + 1 },
        { ...limits, maxBytes: 100 * 1024 * 1024 },
      ),
    /50 MB/,
  );
});

test("native video selection rejects missing or invalid metadata", () => {
  for (const duration of [undefined, null, NaN, Infinity, 0, -1]) {
    assert.throws(
      () => validateVideoSelection({ ...video, duration }, limits),
      /length/,
    );
  }
  for (const fileSize of [undefined, NaN, Infinity, 0, -1]) {
    assert.throws(
      () => validateVideoSelection({ ...video, fileSize }, limits),
      /file/,
    );
  }
  assert.throws(
    () => validateVideoSelection({ ...video, type: "image" }, limits),
    /video file/,
  );
  assert.throws(
    () => validateVideoSelection(video, { ...limits, maxDuration: NaN }),
    /unavailable/,
  );
  assert.throws(
    () => validateVideoSelection(video, { ...limits, maxBytes: -1 }),
    /unavailable/,
  );
});
