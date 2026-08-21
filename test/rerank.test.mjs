/**
 * Evidence-aware reranking (Hindsight-inspired proof boost) + bm25Rank
 * integration.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { evidenceBoost, scoreCandidate, sortByEvidence } from "../lib/rerank.js";
import { bm25Rank } from "../lib/util.js";

test("evidenceBoost saturates at cap and is neutral at zero/negative", () => {
  assert.equal(evidenceBoost(0), 1.0);
  assert.equal(evidenceBoost(-3), 1.0);
  assert.equal(evidenceBoost(5), 1.5); // cap 5, alpha 0.1
  assert.equal(evidenceBoost(10), 1.5); // no runaway
  assert.equal(evidenceBoost(3, { alpha: 0.2, cap: 3 }), 1.6);
  assert.equal(evidenceBoost(7, { alpha: 0.1, cap: 5 }), 1.5);
  assert.equal(evidenceBoost(1, { alpha: 0 }), 1.0);
});

test("scoreCandidate multiplies base score by the boost", () => {
  assert.equal(scoreCandidate(2, 5), 3);
  assert.equal(scoreCandidate(0, 5), 0);
  assert.equal(scoreCandidate(2, 0), 2);
});

test("sortByEvidence is stable and uses tiebreak", () => {
  const list = [
    { id: "a", hits: 0 },
    { id: "b", hits: 3 },
    { id: "c", hits: 3 },
    { id: "d", hits: 1 },
  ];
  const out = sortByEvidence(list, { getScore: () => 1 });
  assert.deepEqual(out.map((r) => r.id), ["b", "c", "d", "a"]); // stable b before c
  const out2 = sortByEvidence(list, { getScore: () => 1, getHits: () => 0, tiebreak: (a, b) => String(b.id).localeCompare(String(a.id)) });
  assert.deepEqual(out2.map((r) => r.id), ["d", "c", "b", "a"]); // tiebreak applied, stable
});

test("bm25Rank boosts high-hits memories over lexically equal ones", () => {
  const now = 1_000_000_000_000;
  const base = {
    tags: [],
    entity: null,
    signal: 0.5,
    status: "active",
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    workspace: "/ws/A",
  };
  const mk = (id, hits, text) => ({ ...base, id, hits, text, kind: "fact" });
  const corpus = [
    mk("lo", 0, "deploy pipeline broke on the staging host DNS config check"),
    mk("hi", 7, "deploy pipeline broke on the staging host DNS config check"),
  ];
  const out = bm25Rank(corpus, "deploy pipeline broke", 10, now);
  assert.equal(out[0].id, "hi", "higher hits wins over identical lexical match");
});

test("bm25Rank neutral with no hits, zero-query path unchanged", () => {
  const now = 1_000_000_000_000;
  const mk = (id, hits, updatedAt) => ({ id, hits, text: "rotate api keys", tags: [], entity: null, signal: 0.5, status: "active", expiresAt: null, createdAt: now, updatedAt, workspace: "/ws/A", kind: "fact" });
  const a = mk("a", 0, now);
  const b = mk("b", 9, now - 1000);
  // No query: pure recency order, hits irrelevant.
  const noQuery = bm25Rank([a, b], "", 10, now);
  assert.deepEqual(noQuery.map((r) => r.id), ["a", "b"]);
  // Same lexical score but a memory with hits still edges ahead.
  const q = bm25Rank([a, b], "rotate api keys", 10, now);
  assert.equal(q[0].id, "b");
});
