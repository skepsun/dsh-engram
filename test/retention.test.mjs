/**
 * dsh-engram retention/access tests (agentmemory candidate ②, GC-focused).
 *
 * Covers:
 *   1. lastAccessAt lifecycle — null on create, set by touchMemory alongside
 *      hits (updatedAt content-version untouched), pure markAccessed sets
 *      only lastAccessAt.
 *   2. GC over-cap eviction is retention-first: least-recently-accessed
 *      non-protected memory is archived first (not the most recent one).
 *   3. Old-data compatibility: memories with lastAccessAt = null fall back to
 *      the pre-retention order (hits, signal, createdAt).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";

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
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  maxTasksPerWorkspace: 40,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── field lifecycle ────────────────────────────────────────────────────────
test("lastAccessAt: null on create, set by touch, pure via markAccessed", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const ws = "/w";
  const created = await domain.storeMemory(
    { workspace: ws, kind: "fact", text: "retention experiment payload", tags: [], sessionId: "s1", seq: 1 },
    CONFIG,
  );
  const createdRow = domain.getMemory(ws, created.id);
  assert.equal(createdRow.lastAccessAt, null, "fresh memory has no access record");
  assert.equal(createdRow.hits, 0);

  const touched = await domain.touchMemory(ws, created.id);
  assert.equal(touched.hits, 1, "touch bumps the proof count");
  assert.ok(touched.lastAccessAt !== null, "touch records the access time");
  assert.equal(touched.updatedAt, createdRow.updatedAt, "touch must not bump the content version");

  const marked = await domain.markAccessed(ws, created.id, 12345);
  assert.equal(marked.lastAccessAt, 12345, "markAccessed sets the access stamp");
  assert.equal(marked.hits, 1, "markAccessed must NOT change the proof count");

  await domain.close();
});

// ── retention-first eviction ───────────────────────────────────────────────
test("gc: over-cap eviction prefers the least-recently-accessed memory", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const ws = "/w";
  const seedCfg = { ...CONFIG, promoteHits: 10 }; // hits never protect here
  const a = await domain.storeMemory({ workspace: ws, kind: "fact", text: "accessed early candidate a", tags: [], sessionId: "s1", seq: 1 }, seedCfg);
  const b = await domain.storeMemory({ workspace: ws, kind: "fact", text: "accessed later candidate b", tags: [], sessionId: "s1", seq: 2 }, seedCfg);
  await domain.touchMemory(ws, a.id);
  await sleep(10); // strict ordering of the two access stamps
  await domain.touchMemory(ws, b.id);

  const cfg = { ...seedCfg, maxMemoriesPerWorkspace: 1 };
  const report = await domain.gc(ws, cfg, { dryRun: false });
  const evicted = report.archivedMemories.filter((e) => e.reason === "cap").map((e) => e.id);
  assert.deepEqual(evicted, [a.id], "older lastAccess evicted, not the recently-touched one");
  const active = domain.listMemories(ws, 50);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, b.id, "most recently accessed memory survives the cap");
  await domain.close();
});

// ── legacy compatibility: null access falls back to (hits, signal, createdAt)
test("gc: never-accessed memories keep the pre-retention eviction order", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const ws = "/w";
  const now = Date.now();
  const DAY = 86400000;
  const oldM = await domain.storeMemory(
    { workspace: ws, kind: "fact", text: "old never-accessed row", tags: [], sessionId: "s1", seq: 1, createdAt: now - 200 * DAY },
    CONFIG,
  );
  const newM = await domain.storeMemory(
    { workspace: ws, kind: "fact", text: "recent never-accessed row", tags: [], sessionId: "s1", seq: 2, createdAt: now - 1 * DAY },
    CONFIG,
  );
  assert.equal(domain.getMemory(ws, oldM.id).lastAccessAt, null);
  assert.equal(domain.getMemory(ws, newM.id).lastAccessAt, null);

  const cfg = { ...CONFIG, maxMemoriesPerWorkspace: 1 };
  const report = await domain.gc(ws, cfg, { dryRun: false });
  const evicted = report.archivedMemories.filter((e) => e.reason === "cap").map((e) => e.id);
  assert.deepEqual(evicted, [oldM.id], "oldest (fallback createdAt) memory evicted first");
  assert.ok(domain.listMemories(ws, 50).some((m) => m.id === newM.id));
  await domain.close();
});
