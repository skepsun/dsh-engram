import { test } from "node:test";
import assert from "node:assert/strict";
import { fileDrift } from "../lib/index-block.js";

/**
 * `fileDrift` is the cheap half of staleness: anchored memories with a hash get
 * dropped outright by `memoryIsStale`, but a memory that merely NAMES a file
 * (62 of this repo's rows) had no way to say "the file moved on". The reverse
 * G6 experiment is why it matters — an agent followed a stale convention that
 * nothing marked as old.
 */

test("a file edited after the memory was written gets a marker", () => {
  const now = Date.now();
  const marker = fileDrift({ filePath: "/tmp/a.js", createdAt: now - 10_000 }, now, () => ({ mtimeMs: now - 1_000 }));
  assert.equal(marker, "⚠file-changed");
});

test("an untouched file says nothing", () => {
  const now = Date.now();
  assert.equal(fileDrift({ filePath: "/tmp/a.js", createdAt: now - 10_000 }, now, () => ({ mtimeMs: now - 20_000 })), "");
});

test("a deleted file is called out, not silently ignored", () => {
  const now = Date.now();
  const marker = fileDrift({ filePath: "/tmp/gone.js", createdAt: now - 10_000 }, now, () => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
  assert.equal(marker, "⚠file-missing");
});

test("no anchor or no timestamp means no marker (and never a throw)", () => {
  const now = Date.now();
  assert.equal(fileDrift({ createdAt: now - 10_000 }, now), "");
  assert.equal(fileDrift({ filePath: "/tmp/a.js" }, now), "");
  assert.equal(fileDrift(null, now), "");
});
