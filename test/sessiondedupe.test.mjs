/**
 * dsh-engram session-diversified recall (agentmemory 候选①) tests.
 *
 * Covers:
 *   1. util.dedupeBySession — pure function: stable order, per-session cap,
 *      defensive on missing sessionId.
 *   2. domain.recall({ maxPerSession }) — one session cannot flood the list;
 *      default (no option) is unchanged.
 *   3. tool engram_recall — max_per_session arg + config default surface in
 *      the output header.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { dedupeBySession } from "../lib/util.js";
import { openEngramDomain } from "../lib/store.js";
import { registerTools } from "../lib/tools.js";

/** In-memory storage-domain stand-in (same shape as basic.test.mjs). */
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
  maxRecallPerSession: 3,
};

// ── util: dedupeBySession ──────────────────────────────────────────────────
test("dedupeBySession caps per session, keeps order, defends missing sessionId", () => {
  const rows = [
    { sessionId: "a", id: "1" },
    { sessionId: "a", id: "2" },
    { sessionId: "b", id: "3" },
    { sessionId: "a", id: "4" },
    { sessionId: "c", id: "5" },
    { sessionId: "a", id: "6" },
    { sessionId: "b", id: "7" },
    // a appears 4×; with cap 2 only the first two survive
  ];
  const out = dedupeBySession(rows, 2);
  assert.deepEqual(out.map((r) => r.id), ["1", "2", "3", "5", "7"]);
  assert.deepEqual(out.map((r) => r.sessionId), ["a", "a", "b", "c", "b"]);

  // cap 1 → one per session, first occurrence wins
  assert.deepEqual(dedupeBySession(rows, 1).map((r) => r.id), ["1", "3", "5"]);

  // missing sessionId → treated as its own bucket (id), never dropped
  const sparse = [
    { sessionId: "a", id: "x1" },
    { id: "y1" },
    { sessionId: null, id: "y2" },
    { sessionId: "a", id: "x2" },
  ];
  assert.deepEqual(dedupeBySession(sparse, 1).map((r) => r.id), ["x1", "y1", "y2"]);

  // defaults to 3, degenerate caps clamp to >=1
  const many = Array.from({ length: 9 }, (_, i) => ({ sessionId: "s", id: String(i) }));
  assert.equal(dedupeBySession(many).length, 3);
  assert.equal(dedupeBySession(rows, 0).length, 6); // clamps to default 3 → s1×3 + b×2 + c×1
  assert.deepEqual(dedupeBySession([], 3), []);
});

// ── store: recall with maxPerSession ───────────────────────────────────────
test("recall: one session cannot flood the ranked list when maxPerSession set", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const cfg = { ...CONFIG };
  const base = { workspace: "/ws", kind: "error", tags: ["error"], entity: null, signal: 0.4 };
  // session s1 dominates with 3 distinct-ish failures; s2/s3 each have one.
  // Texts deliberately diverge (shared tokens <=2) so storeMemory's repeat
  // overlap (inter/min >= 0.6) does NOT merge them into a single entry.
  const longtexts = [
    'ci failed on the handlers module of the build system after a config change',
    'the ci nightly failed again because the store schema migrated without a backfill',
    'ci failed at the api layer when the router replaced the old endpoint prefix',
    'auth service ci failed after swapping the token middleware for a fresh cache',
    'the runner hit a ci failure deep inside the hot path with an unhandled rejection',
  ];
  await domain.storeMemory({ ...base, text: longtexts[0], sessionId: "s1", seq: 1 }, cfg);
  await domain.storeMemory({ ...base, text: longtexts[1], sessionId: "s1", seq: 2 }, cfg);
  await domain.storeMemory({ ...base, text: longtexts[2], sessionId: "s1", seq: 3 }, cfg);
  await domain.storeMemory({ ...base, text: longtexts[3], sessionId: "s2", seq: 1 }, cfg);
  await domain.storeMemory({ ...base, text: longtexts[4], sessionId: "s3", seq: 1 }, cfg);

  // No option → unchanged (all 5, ranked).
  const plain = domain.recall("/ws", "ci failed");
  assert.equal(plain.length, 5);

  // cap 1 → s1 keeps its best 1, s2/s3 keep theirs.
  const capped = domain.recall("/ws", "ci failed", 20, { maxPerSession: 1 });
  assert.equal(capped.length, 3);
  assert.deepEqual(new Set(capped.map((m) => m.sessionId)), new Set(["s1", "s2", "s3"]));

  // cap 2 → s1 contributes 2, total 4.
  const capped2 = domain.recall("/ws", "ci failed", 20, { maxPerSession: 2 });
  assert.equal(capped2.length, 4);
  assert.equal(capped2.filter((m) => m.sessionId === "s1").length, 2);

  // cap never exceeds the underlying limit.
  const cappedLimit = domain.recall("/ws", "ci failed", 2, { maxPerSession: 5 });
  assert.equal(cappedLimit.length, 2);
  await domain.close();
});

// ── tool: engram_recall max_per_session ────────────────────────────────────
function makeService(domain, config) {
  return { config, getDomain: () => Promise.resolve(domain), openedDomain: () => domain, log: { warn: () => {} } };
}

test("engram_recall: max_per_session arg & config default appear in header + limit rows", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const cfg = { ...CONFIG };
  const base = { workspace: "/ws", kind: "error", tags: ["error"], entity: null, signal: 0.4 };
  const longtexts = [
    'ci failed on the handlers module of the build system after a config change',
    'the ci nightly failed again because the store schema migrated without a backfill',
    'ci failed at the api layer when the router replaced the old endpoint prefix',
    'auth service ci failed after swapping the token middleware for a fresh cache',
    'the runner hit a ci failure deep inside the hot path with an unhandled rejection',
  ];
  await domain.storeMemory({ ...base, text: longtexts[0], sessionId: "s1", seq: 1 }, cfg);
  await domain.storeMemory({ ...base, text: longtexts[1], sessionId: "s1", seq: 2 }, cfg);
  await domain.storeMemory({ ...base, text: longtexts[2], sessionId: "s1", seq: 3 }, cfg);
  await domain.storeMemory({ ...base, text: longtexts[3], sessionId: "s2", seq: 1 }, cfg);
  await domain.storeMemory({ ...base, text: longtexts[4], sessionId: "s3", seq: 1 }, cfg);

  // config default maxRecallPerSession=3 → no visible cap (5 rows).
  const service = makeService(domain, cfg);
  const agent = { session: { id: "s1", header: { cwd: "/ws" }, events: { length: 5 } } };
  const tools = new Map();
  const ctx = { effect: (fn) => fn(), tools: { register: (tool) => { tools.set(tool.name, tool); return () => {}; } } };
  registerTools(ctx, service);
  const out3 = await tools.get("engram_recall").execute({ query: "ci failed" }, { agent, signal: undefined });
  assert.match(out3, /≤3\/session/);
  assert.match(out3, /ci failed/);

  // config default 1 → capped; header advertises it; only s1.s/2/3 survive as 3 rows.
  const service1 = makeService(domain, { ...cfg, maxRecallPerSession: 1 });
  const tools1 = new Map();
  const ctx1 = { effect: (fn) => fn(), tools: { register: (tool) => { tools1.set(tool.name, tool); return () => {}; } } };
  registerTools(ctx1, service1);
  const out1 = await tools1.get("engram_recall").execute({ query: "ci failed" }, { agent, signal: undefined });
  assert.match(out1, /≤1\/session/);
  assert.equal((out1.match(/^- /gm) ?? []).length, 3);

  // explicit arg overrides config.
  const out2 = await tools1.get("engram_recall").execute({ query: "ci failed", max_per_session: 2 }, { agent, signal: undefined });
  assert.match(out2, /≤2\/session/);
  assert.equal((out2.match(/^- /gm) ?? []).length, 4);

  await domain.close();
});
