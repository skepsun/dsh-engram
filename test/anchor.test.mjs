/**
 * Anchor revalidation + layered TTL tests (v0.7-C).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { anchorStatus, collectStaleAnchors, makeFileAnchor, memoryIsStale } from "../lib/anchor.js";
import { openEngramDomain } from "../lib/store.js";
import { renderIndex } from "../lib/index-block.js";
import { buildEntityPage } from "../lib/entity-page.js";

const DAY = 86_400_000;

function tmpFile(body = "alpha\n") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-anchor-"));
  const file = path.join(dir, "a.txt");
  fs.writeFileSync(file, body);
  return { dir, file };
}

function fakeFacility() {
  const tables = new Map();
  return {
    open(spec) {
      for (const name of Object.keys(spec.tables)) tables.set(name, new Map());
      return Promise.resolve({
        table(name) {
          const map = tables.get(name);
          return {
            get: (k) => map.get(k),
            put: (k, v) => Promise.resolve(map.set(k, v)),
            delete: (k) => Promise.resolve(map.delete(k)),
            entries: () => map.entries(),
          };
        },
        close: () => Promise.resolve(),
      });
    },
  };
}

const CONFIG = {
  maxMemoryChars: 1600,
  expireDays: 180,
  episodeTtlDays: 14,
  errorTtlDays: 60,
  maxMemoriesPerWorkspace: 2000,
  maxTasksPerWorkspace: 40,
  minIndexSignal: 0.4,
  promoteHits: 3,
  indexMaxLines: 10,
  indexMaxChars: 700,
  entityCardsEnabled: false,
};

test("makeFileAnchor/anchorStatus: valid → changed → missing", () => {
  const { dir, file } = tmpFile();
  const anchor = makeFileAnchor(file, { now: 1000 });
  assert.equal(anchor.path, file);
  assert.equal(anchor.size, 6);
  assert.equal(typeof anchor.hash, "string");
  assert.equal(anchorStatus(anchor), "valid");

  fs.writeFileSync(file, "beta\n");
  assert.equal(anchorStatus(anchor), "changed", "content change is detected");

  fs.rmSync(file);
  assert.equal(anchorStatus(anchor), "missing");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("makeFileAnchor: relative paths resolve against baseDir; non-files are null", () => {
  const { dir } = tmpFile();
  fs.writeFileSync(path.join(dir, "rel.txt"), "x");
  const anchor = makeFileAnchor("rel.txt", { baseDir: dir });
  assert.equal(anchor.path, path.join(dir, "rel.txt"));
  assert.equal(makeFileAnchor("missing.txt", { baseDir: dir }), null);
  assert.equal(makeFileAnchor(dir, { baseDir: dir }), null, "directories are not anchorable");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("memoryIsStale + collectStaleAnchors report changed/missing only", () => {
  const { dir, file } = tmpFile();
  const missingPath = path.join(dir, "gone.txt");
  fs.writeFileSync(missingPath, "gone");
  const missingAnchor = makeFileAnchor(missingPath);
  fs.rmSync(missingPath);
  const memory = { id: "m1", anchor: makeFileAnchor(path.join(dir, "a.txt")) };
  const memory2 = { id: "m2", anchor: { path: path.join(dir, "a.txt"), mtimeMs: 1, size: 1, hash: null, at: 1 } };
  const memory3 = { id: "m3", anchor: missingAnchor };
  const store = { listMemories: () => [memory, memory2, memory3] };

  fs.writeFileSync(file, "changed\n");
  assert.equal(memoryIsStale(memory), true);
  assert.equal(memoryIsStale({ id: "m4", anchor: null }), false);
  const stale = collectStaleAnchors(store, "/ws");
  assert.deepEqual(stale.map((row) => row.id).sort(), ["m1", "m2", "m3"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("storeMemory: attaches an anchor when a filePath is present", async () => {
  const { dir, file } = tmpFile();
  const domain = await openEngramDomain(fakeFacility());
  const { stored } = await domain.storeMemory(
    { workspace: "/ws", kind: "fact", text: "a.txt says alpha", filePath: file, sessionId: "s1", seq: 0 },
    CONFIG,
  );
  assert.equal(stored.anchor.path, file);
  assert.equal(stored.anchor.size, 6);
  const noFile = await domain.storeMemory({ workspace: "/ws", kind: "fact", text: "no file", sessionId: "s1", seq: 1 }, CONFIG);
  assert.equal(noFile.stored.anchor, null);
  await domain.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("layered TTL: preference/procedure permanent, episode short, error medium, fact long", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const base = Date.now();
  const rows = [];
  for (const [kind, text] of [["preference", "pref"], ["procedure", "proc"], ["episode", "ep"], ["error", "err"], ["fact", "fact"]]) {
    const { stored } = await domain.storeMemory({ workspace: "/ws", kind, text, sessionId: "s1", seq: 0 }, CONFIG);
    rows.push([kind, stored.expiresAt]);
  }
  const byKind = Object.fromEntries(rows);
  assert.equal(byKind.preference, null, "preference never expires");
  assert.equal(byKind.procedure, null, "proven procedure never expires");
  assert.ok(byKind.episode !== null && Math.abs(byKind.episode - (base + 14 * DAY)) < 60_000, "episode TTL ≈ 14d");
  assert.ok(byKind.error !== null && Math.abs(byKind.error - (base + 60 * DAY)) < 60_000, "error TTL ≈ 60d");
  assert.ok(byKind.fact !== null && Math.abs(byKind.fact - (base + 180 * DAY)) < 60_000, "fact TTL ≈ 180d");
  await domain.close();
});

test("stale truth is dropped from the index and entity truth, but stays in the timeline", async () => {
  const { dir, file } = tmpFile();
  const domain = await openEngramDomain(fakeFacility());
  await domain.putEntity({
    id: "ent_a",
    workspace: "/ws",
    name: "a",
    kind: "repo",
    description: "",
    sessionId: "s1",
    createdAt: 1,
    updatedAt: 1,
  });
  const { stored } = await domain.storeMemory(
    { workspace: "/ws", kind: "fact", text: "a.txt holds alpha", filePath: file, entity: "a", signal: 0.9, sessionId: "s1", seq: 0 },
    CONFIG,
  );
  const clean = renderIndex(domain, "/ws", "/ws", { ...CONFIG, entityCardsEnabled: true, entityCardChars: 160, entityCardsMax: 2 });
  assert.match(clean, /m/, "clean index includes the memory/card");

  fs.writeFileSync(file, "changed\n");
  const staleIndex = renderIndex(domain, "/ws", "/ws", { ...CONFIG, entityCardsEnabled: true, entityCardChars: 160, entityCardsMax: 2 });
  assert.ok(!staleIndex.includes(stored.id.slice(0, 8)), "stale memory is not an index line");
  const page = buildEntityPage(domain, "/ws", "a");
  assert.ok(!page.truth.some((m) => m.id === stored.id), "stale memory is not current truth");
  assert.ok(page.timeline.some((m) => m.id === stored.id), "stale memory remains in the timeline");
  await domain.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
