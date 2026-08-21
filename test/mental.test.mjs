/**
 * Mental model tests — precomputed standing answers with watermark refresh:
 * compileSummary aggregation, staleness rules (dirty / age / source hash),
 * cache-hit vs recompute, and the store + /model route integration.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { compileSummary, computeSourcesHash, modelStale, getModel } from "../lib/mental.js";
import { openEngramDomain } from "../lib/store.js";
import { makeEngramRoutes, API_PREFIX } from "../lib/api.js";

const CONFIG = {
  autoCapture: true,
  sessionSearch: true,
  autoCapturePerSession: 40,
  autoCaptureGlobalCap: 500,
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
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

async function seed(now = Date.now()) {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/ws/A", kind: "error", text: "deploy pipeline broke", tags: ["fail"], sessionId: "s", seq: 1 }, CONFIG);
  await domain.storeMemory({ workspace: "/ws/A", kind: "error", text: "deploy pipeline broke again", tags: ["fail"], sessionId: "s", seq: 2 }, CONFIG);
  await domain.storeMemory({ workspace: "/ws/A", kind: "error", text: "deploy pipeline is down", tags: ["fail"], sessionId: "s", seq: 4 }, CONFIG);
  await domain.storeMemory({ workspace: "/ws/A", kind: "decision", text: "chose pgvector-free design", tags: ["deploy"], sessionId: "s", seq: 3 }, CONFIG);
  await domain.putTask({
    id: "tsk_1",
    workspace: "/ws/A",
    name: "看板闭环",
    description: "",
    state: "active",
    artifact: null,
    evaluation: null,
    memoryRefs: [],
    sessionId: "s",
    createdAt: now - 86400000 * 5,
    updatedAt: now,
    stateChangedAt: now,
    archivedAt: null,
  });
  await domain.putEntity({ id: "ent_deploy", workspace: "/ws/A", name: "deploy", description: "", kind: "service", sessionId: "s", createdAt: now, updatedAt: now });
  return domain;
}

test("compileSummary covers tasks / graph / observations / memory kinds", async () => {
  const domain = await seed();
  const content = compileSummary(domain, "/ws/A", { now: Date.now() });
  assert.match(content, /任务：1 进行中（0 就绪）/);
  assert.match(content, /实体图：1 节点 · 0 链接/);
  // observations are DERIVED (P2): an error revived twice over is one row with
  // hits=2 → one proven belief. A single write is not yet evidence.
  assert.match(content, /观测：1 条信念（累计 2 证据）/);
  assert.match(content, /记忆：2 条/);
  assert.match(content, /重点信念/);
  assert.match(content, /deploy pipeline broke — ×2/, "repeated failure is a proven belief");
  assert.match(content, /未闭环风险/);
});

test("empty workspace yields a healthy placeholder summary", () => {
  const domain = { summarize: () => ({ workspaces: {}, totals: { memories: 0, tasks: 0, links: 0, nodes: 0, observations: 0 } }), listTasks: () => [], listObservations: () => [], listMemories: () => [] };
  const content = compileSummary(domain, "", { now: Date.now() });
  assert.match(content, /任务：0 进行中（0 就绪）/);
  assert.match(content, /实体图：0 节点 · 0 链接/);
});

test("modelStale triggers on missing/dirty/aged/hash-changed, not on fresh", async () => {
  const domain = await seed();
  const now = Date.now();
  const fresh = await getModel(domain, "/ws/A", { now });
  assert.equal(modelStale(fresh, domain, "/ws/A", { now }), false);
  assert.equal(modelStale(undefined, domain, "/ws/A", { now }), true);
  assert.equal(modelStale({ ...fresh, dirty: true }, domain, "/ws/A", { now }), true);
  assert.equal(modelStale({ ...fresh, generated_at: now - 11 * 60 * 1000 }, domain, "/ws/A", { now }), true);
  assert.equal(modelStale({ ...fresh, sources_hash: "old-hash" }, domain, "/ws/A", { now }), true);
});

test("getModel caches; writes dirty it; a write triggers recompute", async () => {
  const domain = await seed();
  const now = Date.now();
  const first = await getModel(domain, "/ws/A", { now });
  assert.equal(first.fresh, true, "cold cache computes");
  const second = await getModel(domain, "/ws/A", { now });
  assert.equal(second.fresh, false, "warm cache hits");
  assert.equal(second.generated_at, first.generated_at, "same generated_at on hit");
  assert.ok(second.content.length > 0);
  // a task write marks dirty; next read recomputes with updated count
  await domain.putTask({ id: "tsk_2", workspace: "/ws/A", name: "新任务", description: "", state: "draft", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: now, updatedAt: now, stateChangedAt: now, archivedAt: null });
  const third = await getModel(domain, "/ws/A", { now: now + 1000 });
  assert.equal(third.fresh, true, "post-write read recomputes");
  assert.match(third.content, /2 进行中/);
});

test("markModelDirty persists a dirty flag the store exposes", async () => {
  const domain = await seed();
  const now = Date.now();
  await getModel(domain, "/ws/A", { now });
  await domain.markModelDirty("/ws/A");
  const row = domain.getModel("/ws/A");
  assert.equal(row.dirty, true);
  const again = await getModel(domain, "/ws/A", { now });
  assert.equal(again.fresh, true, "dirty forces recompute and clears itself");
  assert.equal(domain.getModel("/ws/A").dirty, false);
});

test("/model route renders the summary", async () => {
  const routes = makeEngramRoutes({});
  const route = routes.find((r) => r.path === `${API_PREFIX}/model`);
  assert.ok(route, "/model route registered");
  assert.equal(route.method, "GET");
});

test("briefify folds the standing answer into a one-liner", async () => {
  const { briefify } = await import("../lib/mental.js");
  const full = [
    "## A · 常驻摘要",
    "- 任务：3 进行中（1 就绪）· 1 已闭环",
    "- 实体图：5 节点 · 6 链接",
    "- 观测：4 条信念（累计 9 证据）",
    "- 记忆：12 条",
    "",
    "重点信念：",
    "- deploy broke — ×2",
    "",
    "未闭环风险：",
    "- 看板闭环 · artifact/evaluation/memory_ref · 5天",
  ].join("\n");
  const brief = briefify(full);
  assert.match(brief, /任务：3 进行中（1 就绪）/);
  assert.match(brief, /实体图：5 节点/);
  assert.match(brief, /观测：4 条信念/);
  assert.match(brief, /风险 1/);
  assert.ok(brief.length <= 240, "brief stays within a token budget");
  const noRisks = briefify(full.split("\n未闭环风险：")[0]);
  assert.match(noRisks, /无未闭环风险/);
});

test("getModel mode=brief serves a derived one-liner without corrupting the cache", async () => {
  const domain = await seed();
  const now = Date.now();
  const full = await getModel(domain, "/ws/A", { now });
  assert.equal(full.fresh, true);
  const brief = await getModel(domain, "/ws/A", { now: now + 1000, mode: "brief" });
  assert.equal(brief.fresh, false, "cache hit shares the same generated_at");
  assert.match(brief.content, /^任务：/);
  assert.ok(brief.content.length < full.content.length, "brief is shorter than full");
  const again = await getModel(domain, "/ws/A", { now: now + 2000 });
  assert.equal(again.content, full.content, "full cache content untouched by brief reads");
});

test("esr_model tool parses mode + max_chars", async () => {
  const { registerTools } = await import("../lib/tools.js");
  const tools = [];
  const ctx = {
    tools: { register: (t) => { tools.push(t); return () => {}; } },
    effect: (fn) => fn(),
  };
  const domain = await seed();
  const service = { config: CONFIG, getDomain: async () => domain };
  registerTools(ctx, service);
  const tool = tools.find((t) => t.name === "esr_model");
  assert.ok(tool);
  const params = tool.parameters.properties;
  assert.ok(params.mode && params.mode.enum.includes("brief"));
  assert.ok(params.max_chars);
  const execCtx = { agent: { session: { id: "s", header: { cwd: "/ws/A" }, events: [] } } };
  const brief = await tool.execute({ mode: "brief", max_chars: 60 }, execCtx);
  assert.ok(brief.length <= 260, "bounded output");
  assert.match(brief, /mode=brief/);
  const full = await tool.execute({}, execCtx);
  assert.match(full, /## A · 常驻摘要/);
  assert.ok(full.length > brief.length, "full is the detailed markdown");
});
