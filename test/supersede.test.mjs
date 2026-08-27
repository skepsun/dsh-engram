/**
 * dsh-engram supersede/contradict tests — memory-to-memory stale-truth
 * semantics: validation, recall demotion, output markers, and [ENGRAM] index
 * exclusion. Deterministic, rule-based, zero LLM.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";
import { selectIndexMemories } from "../lib/index-block.js";
import { registerTools } from "../lib/tools.js";

const CONFIG = {
  autoCapture: true,
  autoCapturePerSession: 40,
  autoCaptureGlobalCap: 500,
  sessionSearch: true,
  maxRecallPerSession: 3,
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.55,
  promoteHits: 3,
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  maxTasksPerWorkspace: 40,
};

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

async function seed(domain) {
  const old = await domain.storeMemory(
    { workspace: "/ws", kind: "fact", text: "the build pipeline uses webpack", entity: null, sessionId: "s", seq: 1, signal: 0.7 },
    CONFIG,
  );
  const newer = await domain.storeMemory(
    { workspace: "/ws", kind: "fact", text: "the build pipeline uses vite now", entity: null, sessionId: "s", seq: 2, signal: 0.7, supersedes: old.id },
    CONFIG,
  );
  const rival = await domain.storeMemory(
    { workspace: "/ws", kind: "fact", text: "the build pipeline is fine", entity: null, sessionId: "s", seq: 3, signal: 0.7, contradicts: old.id },
    CONFIG,
  );
  return { old: old.id, newer: newer.id, rival: rival.id };
}

test("memoryRelations maps supersedes and contradicts targets", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const { old, newer, rival } = await seed(domain);
  const rel = domain.memoryRelations("/ws");
  assert.equal(rel.supersededBy.get(old).id, newer);
  assert.deepEqual(rel.contradictedBy.get(old).map((m) => m.id), [rival]);
  await domain.close();
});

test("invalid supersedes/contradicts target fails loud", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/ws", kind: "fact", text: "a", sessionId: "s", seq: 1, signal: 0.6 }, CONFIG);
  await assert.rejects(
    domain.storeMemory({ workspace: "/ws", kind: "fact", text: "b", sessionId: "s", seq: 2, signal: 0.6, supersedes: "tsk_nope" }, CONFIG),
    (err) => err.code === "ENGRAM_INVALID_ARGS" && /tsk_nope/.test(err.message),
  );
  await assert.rejects(
    domain.storeMemory({ workspace: "/ws", kind: "fact", text: "c", sessionId: "s", seq: 3, signal: 0.6, contradicts: "tsk_also_nope" }, CONFIG),
    (err) => err.code === "ENGRAM_INVALID_ARGS",
  );
  await domain.close();
});

test("recall demotes a superseded memory to the tail instead of letting it win", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const { old } = await seed(domain);
  const ranked = domain.recall("/ws", "build pipeline", 10);
  // The stale webpack line is demoted to the very end — never first.
  assert.equal(ranked[ranked.length - 1].id, old);
  assert.notEqual(ranked[0].id, old);
  await domain.close();
});

test("selectIndexMemories excludes superseded memories from the [ENGRAM] block", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const { old, newer, rival } = await seed(domain);
  const selected = selectIndexMemories(domain, "/ws", CONFIG);
  const ids = new Set(selected.map((m) => m.id));
  assert.ok(ids.has(newer), "current statement earns an index line");
  assert.ok(ids.has(rival), "contradicting statement keeps its line");
  assert.ok(!ids.has(old), "superseded stale truth is excluded from the index");
  await domain.close();
});

test("engram_recall output flags superseded and contradicted memories", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await seed(domain);
  const service = { config: CONFIG, getDomain: () => Promise.resolve(domain), openedDomain: () => domain, log: { warn: () => {} } };
  const tools = new Map();
  const ctx = { effect: (fn) => fn(), tools: { register: (tool) => { tools.set(tool.name, tool); return () => {}; } } };
  registerTools(ctx, service);

  const agent = { session: { id: "s1", header: { cwd: "/ws" }, events: { length: 5 } } };
  const out = await tools.get("engram_recall").execute({ query: "build pipeline" }, { agent, signal: undefined });

  // The superseded line carries the pointer to the current statement; the
  // contradicted line carries the pointer to the rival claim.
  assert.match(out, /superseded by/);
  assert.match(out, /contradicted by/);
  // And the current statement is ranked ahead of the stale one (demotion).
  const lines = out.split("\n").filter((l) => l.startsWith("- "));
  const viteAt = lines.findIndex((l) => l.includes("vite"));
  const webpackAt = lines.findIndex((l) => l.includes("webpack"));
  assert.ok(viteAt !== -1 && webpackAt !== -1);
  assert.ok(viteAt < webpackAt, "current statement ranks above the stale one");
  await domain.close();
});
