/**
 * Observation layer tests — Hindsight-inspired evidence confinement with zero
 * LLM: bucketing (anchor + bigram Jaccard), merge-not-overwrite semantics,
 * negation weakening, algorithmic trend, per-workspace cap, and the store
 * write-path integration.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  charBigrams,
  jaccardSim,
  bucketDecision,
  mergeObservation,
  negateObservation,
  createObservation,
  computeTrend,
  capObservations,
  integrateObservation,
} from "../lib/obs.js";
import { openEngramDomain } from "../lib/store.js";

const CONFIG = {
  maxMemoryChars: 1600,
  maxMemoriesPerWorkspace: 2000,
  expireDays: 180,
};

const DAY = 86400000;

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

const mem = (over = {}) => ({
  id: `mem_${Math.random().toString(36).slice(2, 8)}`,
  workspace: "/ws/A",
  text: "deploy pipeline broke on the staging host",
  kind: "error",
  tags: ["fail"],
  entity: "ent_deploy",
  createdAt: Date.now() - DAY,
  ...over,
});

test("charBigrams is CJK-friendly", () => {
  assert.deepEqual(charBigrams("排队重来"), ["排队", "队重", "重来"]);
  assert.deepEqual(charBigrams("a b"), ["ab"]);
});

test("jaccardSim rises with overlap, 0 on disjoint", () => {
  assert.equal(jaccardSim("abc def", "abc def"), 1);
  assert.ok(jaccardSim("排队重试失败", "排队重试又失败") > 0.5);
  assert.ok(jaccardSim("远程调用超时重试策略", "用户登录界面布局调整") < 0.3, "unrelated CJK topics share few bigrams");
  assert.equal(jaccardSim("", ""), 0);
});

test("bucketDecision: no anchor shared -> create (conservative)", () => {
  const obs = [createObservation(mem({ text: "rotate api keys", tags: ["security"], entity: null }))];
  const d = bucketDecision(mem({ text: "rotate api keys again please", tags: ["ops"], entity: null }), { observations: obs });
  assert.equal(d.action, "create"); // text is similar but no anchor (tag/entity) = new bucket
});

test("bucketDecision: anchor + similar -> merge", () => {
  const obs = [createObservation(mem({ tags: ["fail"], entity: "ent_deploy" }))];
  const d = bucketDecision(mem({ text: "deploy pipeline broke on the staging host again" }), { observations: obs });
  assert.equal(d.action, "merge");
});

test("bucketDecision: anchor + opposite polarity -> negate", () => {
  const obs = [createObservation(mem({ text: "the staging deploy is stable and green" }))];
  const d = bucketDecision(mem({ text: "the staging deploy is not stable, broke again" }), { observations: obs });
  assert.equal(d.action, "negate");
});

test("mergeObservation: unique sources climb the count, re-support only refreshes", () => {
  const now = Date.now();
  const obs = createObservation(mem(), { now });
  const m2 = mem({ text: "deploy pipeline broke on the staging host once more" });
  const merged = mergeObservation(obs, m2, { now });
  assert.equal(merged.proof.count, 2);
  assert.deepEqual(merged.proof.sources, [obs.proof.sources[0], m2.id]);
  const again = mergeObservation(merged, m2, { now });
  assert.equal(again.proof.count, 2, "same source must not inflate the count");
  assert.equal(again.span.last_seen_at, now);
});

test("negateObservation bumps negations and keeps count", () => {
  const obs = createObservation(mem(), { now: Date.now() });
  const n = negateObservation(obs, { now: Date.now() });
  assert.equal(n.negations, 1);
  assert.equal(n.proof.count, 1);
});

test("computeTrend covers the five windows", () => {
  const now = Date.now();
  assert.equal(computeTrend({ first_seen_at: now - DAY * 5, last_seen_at: now - DAY * 5 }, now), "new");
  assert.equal(computeTrend({ first_seen_at: now - DAY * 60, last_seen_at: now - 1e8 }, now), "strengthening");
  assert.equal(computeTrend({ first_seen_at: now - DAY * 80, last_seen_at: now - DAY * 40 }, now), "weakening");
  assert.equal(computeTrend({ first_seen_at: now - DAY * 200, last_seen_at: now - DAY * 150 }, now), "stale");
});

test("capObservations evicts lowest proof, oldest first", () => {
  const now = Date.now();
  const obs = [
    createObservation(mem({ text: "a" }), { now }),
    createObservation(mem({ text: "b" }), { now: now - DAY }),
    createObservation(mem({ text: "c" }), { now: now - DAY * 2 }),
    createObservation(mem({ text: "d" }), { now: now - DAY * 3 }),
  ];
  obs[0].proof.count = 5;
  obs[1].proof.count = 2;
  const kept = capObservations(obs, "/ws/A", { cap: 2 });
  assert.equal(kept.length, 2);
  assert.deepEqual(kept.map((o) => o.text), ["a", "b"], "highest proof kept; lowest & oldest evicted");
});

test("integrateObservation persists create then merge via the table", async () => {
  const store = await openEngramDomain(fakeFacility());
  const table = { entries: () => [], put: async () => {}, delete: async () => {} };
  // harness-style: use the real opened table handle through a wrapped domain write
  const domain = await openEngramDomain(fakeFacility());
  // store integration happens through storeMemory (next test); here just wire the table
  const m = mem();
  await domain.storeMemory(m, CONFIG);
  const list = domain.listObservations("/ws/A");
  assert.equal(list.length, 1, "storing a memory buckets a fresh observation");
  assert.equal(list[0].proof.count, 1);
  await domain.storeMemory(mem({ text: "deploy pipeline broke on the staging host again" }), CONFIG);
  const list2 = domain.listObservations("/ws/A");
  assert.equal(list2.length, 1, "similar repeat merges into the same bucket");
  assert.equal(list2[0].proof.count, 2);
});

test("store write path: exact duplicate refreshes time, not observation count", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const m = mem();
  await domain.storeMemory(m, CONFIG);
  const first = domain.listObservations("/ws/A")[0];
  await domain.storeMemory(m, CONFIG); // exact dup: same backing row, new error-signal hits only
  const list = domain.listObservations("/ws/A");
  assert.equal(list.length, 1);
  assert.equal(list[0].proof.count, 1, "same source must not inflate the observation count");
  assert.ok(list[0].span.last_seen_at >= first.span.last_seen_at, "time span refreshes");
});

test("summarize includes observations", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory(mem(), CONFIG);
  const sum = domain.summarize();
  assert.equal(sum.totals.observations, 1);
  assert.equal(sum.workspaces["/ws/A"].observations, 1);
});
