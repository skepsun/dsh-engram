/**
 * dsh-engram session-start auto-recall (方案 B) tests.
 *
 * Covers the two new pure surfaces:
 *   - firstUserMessageText(session): keys the [RECALL] block off the session's
 *     first user message (with a prose fallback for headless/goal starts);
 *   - renderStartRecall(store, workspace, config): deterministic BM25 recall
 *     injected into the prompt at session start — "few and precise"
 *     (autoRecallLimit / autoRecallMaxChars), supersede-aware, zero LLM.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";
import { renderStartRecall, firstUserMessageText } from "../lib/index-block.js";

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
  autoRecallLimit: 3,
  autoRecallMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  maxTasksPerWorkspace: 40,
};

async function seededDomain() {
  const domain = await openEngramDomain(fakeFacility());
  const ws = "/ws/start-recall";
  const store = async (text, kind = "fact", tags = [], signal = 0.6) =>
    (await domain.storeMemory(
      {
        workspace: ws,
        kind,
        text,
        tags,
        entity: null,
        filePath: null,
        supersedes: null,
        contradicts: null,
        sessionId: "s1",
        seq: 1,
        signal,
      },
      CONFIG,
    )).stored;
  await store("Use sqlite-vec for retrieval upgrade", "decision", ["retrieval", "architecture"], 0.8);
  await store("Engram stores long-term memory as a symbolic index", "fact", ["engram", "memory"], 0.7);
  await store("npm test failures are captured as error memories", "error", ["test"], 0.25);
  await store("Redis cache eviction policy tuned for token budget", "decision", ["infra"], 0.5);
  return { domain, ws };
}

// ── firstUserMessageText ───────────────────────────────────────────────────
test("firstUserMessageText pulls the first user/message text block", () => {
  const session = {
    events: [
      { type: "goal/change", data: { status: "active" } },
      { type: "user/message", data: { content: [{ type: "text", text: "帮我看看记忆为什么不会被检索" }, { type: "text", text: "并修复" }] } },
      { type: "user/message", data: { content: [{ type: "text", text: "second question" }] } },
    ],
  };
  assert.equal(firstUserMessageText(session), "帮我看看记忆为什么不会被检索 并修复");
});

test("firstUserMessageText falls back to the first text-bearing event", () => {
  const session = {
    events: [
      { type: "agent/inbox/spliced", data: { content: [{ type: "text", text: "goal: audit recall behavior" }] } },
      { type: "user/message", data: { content: [] } },
    ],
  };
  assert.equal(firstUserMessageText(session), "goal: audit recall behavior");
});

test("firstUserMessageText returns '' for empty or malformed sessions", () => {
  assert.equal(firstUserMessageText(null), "");
  assert.equal(firstUserMessageText({}), "");
  assert.equal(firstUserMessageText({ events: [] }), "");
  assert.equal(firstUserMessageText({ events: [{ type: "turn/start" }] }), "");
  assert.equal(firstUserMessageText({ events: [{ type: "user/message", data: { content: [{ type: "image" }] } }] }), "");
});

// ── renderStartRecall ──────────────────────────────────────────────────────
test("renderStartRecall injects the top BM25 hits for the first-message query", async () => {
  const { domain, ws } = await seededDomain();
  const out = renderStartRecall(domain, ws, CONFIG, { query: "sqlite vec retrieval", allowRecencyFallback: false });
  assert.ok(out.length > 0, "block should not be empty");
  assert.match(out, /\[RECALL\] recall · .*hit\(s\) · first msg:/);
  assert.match(out, /sqlite-vec for retrieval upgrade/);
  // hits carry the #id marker + provenance ×hits suffix, capped by limit
  const idCount = (out.match(/#[0-9a-f]{8}/g) ?? []).length;
  assert.ok(idCount >= 1 && idCount <= CONFIG.autoRecallLimit, `id markers ≤ limit (got ${idCount})`);
  assert.match(out, /engram_detail <id>/);
});

test("renderStartRecall is a pure read: it never bumps hits", async () => {
  const { domain, ws } = await seededDomain();
  const before = domain.listMemories(ws, 100).map((m) => m.hits);
  renderStartRecall(domain, ws, CONFIG, { query: "memory", allowRecencyFallback: false });
  const after = domain.listMemories(ws, 100).map((m) => m.hits);
  assert.deepEqual(after, before);
});

test("renderStartRecall returns '' on an empty workspace or zero hits", async () => {
  const { domain, ws } = await seededDomain();
  assert.equal(renderStartRecall(domain, "/ws/none", CONFIG, { query: "anything" }), "");
  assert.equal(renderStartRecall(domain, ws, CONFIG, { query: "zzzzzz qqqqq wwww", allowRecencyFallback: false }), "");
});

test("renderStartRecall honours autoRecallLimit and autoRecallMaxChars", async () => {
  const { domain, ws } = await seededDomain();
  const tight = renderStartRecall(domain, ws, { ...CONFIG, autoRecallLimit: 1, autoRecallMaxChars: 120 }, { query: "sqlite", allowRecencyFallback: false });
  assert.ok(tight.length <= 120, `char budget respected (${tight.length})`);
  const idCount = (tight.match(/#[0-9a-f]{8}/g) ?? []).length;
  assert.ok(idCount <= 1, `limit respected (${idCount})`);
});

test("renderStartRecall excludes superseded stale truth from the top hits", async () => {
  const { domain, ws } = await seededDomain();
  const all = domain.listMemories(ws, 100);
  const old = all.find((m) => m.text.toLowerCase().includes("redis"));
  const newer = all.find((m) => m.text.toLowerCase().includes("sqlite"));
  // Mark the newer as a replacement of the older (supersedes the redis row).
  await domain.storeMemory(
    {
      workspace: ws,
      kind: "decision",
      text: "Redis no longer used; sqlite-vec owns retrieval",
      tags: ["infra"],
      entity: null,
      filePath: null,
      supersedes: old.id,
      contradicts: null,
      sessionId: "s1",
      seq: 2,
      signal: 0.8,
    },
    CONFIG,
  );
  void newer;
  const out = renderStartRecall(domain, ws, CONFIG, { query: "redis", allowRecencyFallback: false });
  assert.ok(!out.includes("Redis cache eviction policy"), "superseded memory should not win the auto-recall");
});

test("renderStartRecall recency fallback works with query:null for headless starts", async () => {
  const { domain, ws } = await seededDomain();
  const out = renderStartRecall(domain, ws, CONFIG, { query: null, allowRecencyFallback: true });
  assert.ok(out.length > 0);
  assert.match(out, /newest memory/);
});
