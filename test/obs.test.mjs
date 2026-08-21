/**
 * Observation VIEW tests — evidence-grounded beliefs, DERIVED not persisted
 * (assessment P2): a memory with hits>=2 IS an observation; proof = hits;
 * span = created→updated; trend from recency. Nothing is written anywhere.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OBSERVATION_MIN_PROOF,
  computeTrend,
  deriveObservations,
} from "../lib/obs.js";
import { openEngramDomain } from "../lib/store.js";

const CONFIG = {
  maxMemoryChars: 1600,
  maxMemoriesPerWorkspace: 2000,
  expireDays: 180,
  promoteHits: 3,
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

const mem = (over = {}) => ({
  id: "mem_1",
  workspace: "/w",
  kind: "error",
  text: "deploy pipeline broke",
  tags: ["fail"],
  entity: null,
  hits: 2,
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

test("deriveObservations: hits>=2 memories ARE beliefs, proof = hits", () => {
  const out = deriveObservations([
    mem({ id: "a", hits: 3, kind: "error" }),
    mem({ id: "b", hits: 1, kind: "error" }),
    mem({ id: "c", hits: 2, kind: "decision" }),
    mem({ id: "d", hits: 0, kind: "fact" }),
  ]);
  assert.equal(out.length, 2, "b and d (hits<2) are not observations");
  const ids = out.map((o) => o.id);
  assert.deepEqual(ids, ["a", "c"], "best-proof first");
  assert.equal(out[0].proof.count, 3);
  assert.equal(out[1].proof.count, 2);
  assert.equal(out[0].kind, "pattern", "error → pattern");
  assert.equal(out[1].kind, "belief", "non-error → belief");
});

test("deriveObservations: stable consumer shape (id/proof/negations/updated_at)", () => {
  const out = deriveObservations([mem({ id: "x", hits: 4, createdAt: 500, updatedAt: 2000 })], { now: 10000 });
  assert.equal(out.length, 1);
  const o = out[0];
  assert.equal(o.id, "x");
  assert.equal(o.proof.count, 4);
  assert.deepEqual(o.proof.sources, ["x"]);
  assert.equal(o.negations, 0, "derived view has no negation channel");
  assert.equal(o.updated_at, 2000, "dirty-hash key stays stable");
  assert.equal(o.span.first_seen_at, 500);
  assert.equal(o.span.last_seen_at, 2000);
  assert.equal(o.trend, "new", "both edges within 30d");
});

test("computeTrend windows (new/stale/weakening/strengthening)", () => {
  const DAY = 86400000;
  const now = 1000 * DAY;
  const at = (daysAgo) => now - daysAgo * DAY;
  const span = (first, last) => ({ first_seen_at: first, last_seen_at: last });
  assert.equal(computeTrend(span(at(5), at(1)), now), "new", "all recent");
  assert.equal(computeTrend(span(at(100), at(40)), now), "weakening", "history + no recent evidence");
  assert.equal(computeTrend(span(at(200), at(150)), now), "stale", "all old");
  assert.equal(computeTrend(span(at(60), at(5)), now), "strengthening", "30<first<=90, last recent");
  assert.equal(computeTrend(null, now), "new", "no span");
});

test("store integration: no observations on create; revive-twice surfaces one", async () => {
  const d = await openEngramDomain(fakeFacility());
  const store = (text, seq) => d.storeMemory({ workspace: "/w", kind: "error", text, tags: [], sessionId: "s", seq }, CONFIG);
  const first = await store("deploy pipeline broke", 1);
  assert.equal(d.listObservations("/w").length, 0, "single write is not evidence");
  const revived = await store("deploy pipeline broke again", 2);
  assert.equal(revived.revived, true);
  assert.equal(d.listObservations("/w").length, 0, "first revival → hits=1, still under the bar");
  await store("deploy pipeline down now", 3);
  const obs = d.listObservations("/w");
  assert.equal(obs.length, 1, "revived twice → hits=2 → one belief");
  assert.equal(obs[0].id, first.id, "belief reuses the memory id");
  assert.equal(obs[0].proof.count, 2);
  assert.equal(obs[0].text, "deploy pipeline broke", "row text unchanged by revival");
  await d.close();
});

test("summarize counts observations from the derived projection", async () => {
  const d = await openEngramDomain(fakeFacility());
  const store = (text, seq) => d.storeMemory({ workspace: "/w", kind: "error", text, tags: [], sessionId: "s", seq }, CONFIG);
  await store("tsc exploded on build", 1);
  await store("tsc exploded on build again", 2);
  await store("tsc exploded during npm build", 3);
  const sum = d.summarize();
  assert.equal(sum.totals.observations, 1);
  assert.equal(sum.workspaces["/w"].observations, 1);
  await d.close();
});
