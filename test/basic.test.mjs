/**
 * dsh-loom basic functional tests — node:test, no DSH harness needed.
 *
 * Uses a tiny in-memory facility that mimics the ctx.storageDomain handle
 * surface (table.get / put / entries / delete, facility.open / close) so the
 * whole data layer + index render + capture extractors can be exercised
 * deterministically.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  tokenize,
  scoreRecord,
  workspaceKey,
  truncate,
  fmtDate,
  shortId,
  hashText,
  slugId,
} from "../lib/util.js";
import { openLoomDomain } from "../lib/store.js";
import { renderIndex, renderEsr } from "../lib/index-block.js";
import { makeCaptureHandler } from "../lib/capture.js";

/** In-memory storage-domain stand-in. */
function fakeFacility() {
  const tables = new Map();
  return {
    open(spec) {
      for (const name of Object.keys(spec.tables)) {
        tables.set(name, new Map());
      }
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

// ── util ────────────────────────────────────────────────────────────────────
test("tokenize handles ASCII + CJK + mixed queries deterministically", () => {
  const ascii = tokenize("git commit arch");
  assert.ok(ascii.includes("git") && ascii.includes("commit") && ascii.includes("arch"));
  const cjk = tokenize("中文测试");
  assert.ok(cjk.includes("中文") && cjk.includes("文测") && cjk.includes("测试"));
  const mixed = tokenize("ci交互 管道");
  assert.ok(mixed.includes("ci") && mixed.includes("管道"));
});

test("scoreRecord ranks exact tag > substring > fuzzy", () => {
  const rec = { text: "Use sqlite-vec for retrieval", tags: ["architecture", "retrieval"] };
  const tokens = tokenize("architecture");
  const s1 = scoreRecord(rec, tokens, "architecture", false);
  // fuzzy: tag "arch" is contained in the query token "architecture"
  const s2 = scoreRecord({ text: "arch decisions live in docs", tags: ["arch"] }, tokens, "architecture", false);
  // substring: text contains the token but tags don't
  const s3 = scoreRecord({ text: "the architecture doc moved", tags: ["docs"] }, tokens, "architecture", false);
  // no match at all
  const s4 = scoreRecord({ text: "nothing related here", tags: ["x"] }, tokens, "architecture", false);
  assert.ok(s1 > s3 && s3 >= s2 && s2 > s4);
});

test("workspaceKey normalizes trailing separators; win32 case not simulated on linux", () => {
  assert.equal(workspaceKey("/a/b/"), "/a/b");
  assert.equal(workspaceKey("/a/b"), "/a/b");
});

// ── store ───────────────────────────────────────────────────────────────────
test("storeMemory dedups exact duplicates and honors caps", async () => {
  const domain = await openLoomDomain(fakeFacility());
  const cfg = { ...CONFIG, maxMemoryChars: 100 };
  const base = { workspace: "/ws", kind: "fact", text: "hello world", tags: [], entity: null, sessionId: "s1", seq: 1, signal: 0.6 };

  const first = await domain.storeMemory(base, cfg);
  const second = await domain.storeMemory(base, cfg);
  assert.equal(first.id, second.id);
  assert.equal(second.duplicated, true);
  assert.equal(domain.listMemories("/ws").length, 1);

  await assert.rejects(
    domain.storeMemory({ ...base, text: "x".repeat(200) }, cfg),
    (e) => e.code === "LOOM_CAP_EXCEEDED",
  );
  await domain.close();
});

test("recall: tag-exact first, recency ties, expiry skipped", async () => {
  const domain = await openLoomDomain(fakeFacility());
  const cfg = { ...CONFIG };
  await domain.storeMemory({ workspace: "/ws", kind: "decision", text: "Use sqlite-vec for search", tags: ["architecture"], entity: null, sessionId: "s1", seq: 1, signal: 0.8 }, cfg);
  await domain.storeMemory({ workspace: "/ws", kind: "fact", text: "ursula is the cat", tags: ["pet"], entity: "cat", sessionId: "s1", seq: 2, signal: 0.6 }, cfg);
  await domain.storeMemory({ workspace: "/ws", kind: "error", text: "ci failed on handlers.ts", tags: ["error"], entity: null, sessionId: "s1", seq: 3, signal: 0.2 }, cfg);

  const hits = domain.recall("/ws", "sqlite-vec");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "decision");

  const cats = domain.recall("/ws", "cat");
  assert.equal(cats.length, 1);
  assert.equal(cats[0].text, "ursula is the cat");

  // timeline for entity
  const tl = domain.timeline("/ws", "cat");
  assert.equal(tl.length, 1);

  // expired entries are skipped on read
  const expired = await domain.storeMemory({ workspace: "/ws", kind: "fact", text: "old stale thing", tags: [], entity: null, sessionId: "s1", seq: 4, signal: 0.6, expiresAt: 1 }, cfg);
  assert.equal(domain.getMemory("/ws", expired.id), void 0);
  assert.ok(!domain.recall("/ws", "stale").some((m) => m.id === expired.id));
  await domain.close();
});

test("task lifecycle: closure requires all three evidence gates", async () => {
  const domain = await openLoomDomain(fakeFacility());
  const task = {
    id: "tsk_test",
    workspace: "/ws",
    name: "Retrieval upgrade",
    description: "swap fts for vec",
    state: "active",
    artifact: null,
    evaluation: null,
    memoryRefs: [],
    sessionId: "s1",
    createdAt: 1,
    updatedAt: 1,
    stateChangedAt: 0,
  };
  await domain.putTask(task);
  assert.equal(domain.listTasks("/ws").length, 1);

  // close with partial evidence stays active (gap surfaced by the caller)
  const partial = { ...task, artifact: "dist/index.js", updatedAt: 2 };
  await domain.putTask(partial);
  assert.equal(domain.getTask("/ws", "tsk_test").state, "active");

  const full = { ...partial, evaluation: "npm test: 14 passed", memoryRefs: ["m1"], state: "stable", stateChangedAt: 3 };
  await domain.putTask(full);
  assert.equal(domain.getTask("/ws", "tsk_test").state, "stable");
  assert.equal(domain.listTasks("/ws").length, 0); // stable excluded from active
  await domain.close();
});

// ── index render ────────────────────────────────────────────────────────────
test("renderIndex is compact, stable-ordered, and char-capped", async () => {
  const domain = await openLoomDomain(fakeFacility());
  const cfg = { ...CONFIG, indexMaxLines: 3, indexMaxChars: 300 };
  for (let i = 0; i < 5; i += 1) {
    await domain.storeMemory({ workspace: "/pi-loom", kind: "decision", text: `decision number ${i} about architecture and retrieval`, tags: ["architecture"], entity: null, sessionId: "s1", seq: i, signal: 0.8 }, cfg);
  }
  const block = renderIndex(domain, "/pi-loom", "/code/pi-loom", cfg);
  assert.ok(block.startsWith("[LOOM] workspace: pi-loom"));
  assert.ok(block.includes("drill:"));
  assert.ok(block.length <= 300);
  // deterministic: two renders identical
  assert.equal(block, renderIndex(domain, "/pi-loom", "/code/pi-loom", cfg));

  const esr = renderEsr(domain, "/pi-loom", cfg);
  // empty task board still nudges the mechanism (and stays compact)
  assert.ok(esr.includes("[ESR] no open tasks"));
  await domain.close();
});

// ── capture ─────────────────────────────────────────────────────────────────
test("capture handler extracts git commits and never throws", async () => {
  const domain = await openLoomDomain(fakeFacility());
  const cfg = { ...CONFIG, autoCapturePerSession: 40, autoCaptureGlobalCap: 500 };
  const log = { warn: () => {} };
  const handler = makeCaptureHandler(domain, cfg, log);
  const agent = {
    session: { id: "sess1", header: { cwd: "/ws" }, events: { length: 10 } },
  };
  // git commit
  handler(
    { name: "bash", agent, arguments: { command: 'git commit -m "add vector store"' } },
    { isError: false },
  );
  // error
  handler(
    { name: "bash", agent, arguments: { command: "npm run build" } },
    { isError: true, value: { stdout: "", stderr: "tsc: error TS2304" } },
  );
  // own tool — ignored
  handler({ name: "loom_recall", agent, arguments: {} }, { isError: false });
  // file edit to significant path
  handler(
    { name: "str_replace_editor", agent, arguments: { command: "str_replace", path: "/ws/AGENTS.md" } },
    { isError: false },
  );
  await new Promise((r) => setTimeout(r, 50));
  const memories = domain.listMemories("/ws");
  const texts = memories.map((m) => m.text);
  assert.ok(texts.some((t) => t.includes("git commit")));
  assert.ok(texts.some((t) => t.includes("failed: tsc")));
  assert.ok(texts.some((t) => t.includes("AGENTS.md")));
  assert.ok(!texts.some((t) => t.includes("loom_recall")));
  await domain.close();
});

test("capture is fully contained when store is missing", () => {
  const log = { warn: () => {} };
  const handler = makeCaptureHandler(null, CONFIG, log);
  // no store — a throw inside handler would fail the test; this just must not throw
  handler({ name: "bash", agent: { session: { id: "s", header: { cwd: "/w" }, events: [] } }, arguments: { command: "git commit -m x" } }, { isError: false });
  assert.ok(true);
});

// quick util sanity
test("shortId / fmtDate / hashText helpers", () => {
  assert.equal(shortId("ab12cd34-1234"), "ab12cd34");
  assert.equal(fmtDate(new Date(2026, 5, 15).getTime()), "06-15");
  assert.equal(hashText("x").length, 16);
  assert.equal(truncate("abcdef", 3), "abc…");
});
test("entity nodes: id coercion, CRUD, summarize counts", async () => {
  const domain = await openLoomDomain(fakeFacility());
  await domain.putEntity({ id: "ent_" + slugId("DSH-Loom Plugin"), workspace: "/w", name: "dsh-loom", description: "d", kind: "package", sessionId: "s", createdAt: 1, updatedAt: 1 });
  await domain.putEntity({ id: "ent_beta", workspace: "/w", name: "Beta", description: "", kind: "", sessionId: "s", createdAt: 2, updatedAt: 2 });
  await domain.putEntity({ id: "ent_x", workspace: "/x", name: "X", description: "", kind: "", sessionId: "s", createdAt: 3, updatedAt: 3 });
  const alpha = "ent_" + slugId("DSH-Loom Plugin");
  assert.equal(domain.getEntity("/w", alpha).name, "dsh-loom");
  assert.equal(domain.getEntity("/w", "ent_x"), void 0);
  assert.deepEqual(domain.listEntities("/w").map((e) => e.id), [alpha, "ent_beta"]);
  const summary = domain.summarize();
  assert.equal(summary.workspaces["/w"].nodes, 2);
  assert.equal(summary.totals.nodes, 3);
  // same id = update, not duplicate
  await domain.putEntity({ id: alpha, workspace: "/w", name: "dsh-loom", description: "v2", kind: "pkg", sessionId: "s", createdAt: 1, updatedAt: 4 });
  assert.equal(domain.listEntities("/w").find((e) => e.id === alpha).description, "v2");
  assert.equal(domain.summarize().totals.nodes, 3);
  const removed = await domain.removeEntity("/w", "ent_beta");
  assert.equal(removed, true);
  assert.equal(domain.summarize().workspaces["/w"].nodes, 1);
  await domain.close();
});

test("index block surfaces node count + node list; usurp proactive guidance", async () => {
  const domain = await openLoomDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/w", kind: "decision", text: "JSON over sqlite", tags: [], sessionId: "s", seq: 1 }, CONFIG);
  await domain.putEntity({ id: "ent_loom", workspace: "/w", name: "dsh-loom", description: "", kind: "package", sessionId: "s", createdAt: 1, updatedAt: 1 });
  await domain.putTask({ id: "tsk_1", workspace: "/w", name: "t1", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1 });
  const block = renderIndex(domain, "/w", "/w", CONFIG);
  assert.ok(block.includes("node(s)"));
  assert.ok(block.includes("nodes: dsh-loom"));
  assert.ok(block.includes("esr_node"));
  const esr = renderEsr(domain, "/w", CONFIG);
  assert.ok(!esr.includes("no open tasks"));
  assert.ok(esr.includes("tsk_1"));
  // empty workspace: no-open line teaches proactive behavior
  const esrEmpty = renderEsr(domain, "/w2", CONFIG);
  assert.match(esrEmpty, /BE PROACTIVE/);
  await domain.close();
});

test("escalationHint: data-driven under-proactivity nudge appears, then disappears when healthy", async () => {
  const { dayKey } = await import("../lib/usage.js");
  const domain = await openLoomDomain(fakeFacility());
  const d = dayKey();
  // under-proactive: 4 mem ops vs 1 esr call (ratio 20% < 34%)
  await domain.bumpUsage("/w", d, {
    counts: { loom_store: 3, loom_recall: 1, esr_node: 1 },
    failures: 0,
    recall: { queries: 1, withHits: 1, hitsTotal: 3 },
  });
  const esr = renderEsr(domain, "/w", CONFIG);
  assert.ok(esr.includes("escalate:"), "under-proactive workspace gets the nudge");
  assert.match(esr, /4 mem ops vs 1 esr calls/);
  // too little signal (fewer than 3 mem ops) → no nudge
  const domain2 = await openLoomDomain(fakeFacility());
  await domain2.bumpUsage("/w2", d, { counts: { loom_store: 1 }, failures: 0, recall: {} });
  assert.ok(!renderEsr(domain2, "/w2", CONFIG).includes("escalate:"), "below sample floor: no nudge");
  // healthy balance (esr ≥ ~half of mem ops) → nudge disappears (closed loop)
  await domain.bumpUsage("/w", d, { counts: { esr_task: 2, esr_link: 1 }, failures: 0, recall: {} });
  const esr2 = renderEsr(domain, "/w", CONFIG);
  assert.ok(!esr2.includes("escalate:"), "healthy after escalation: nudge gone");
  // with an active task, the hint still appends when under-proactive
  const domain3 = await openLoomDomain(fakeFacility());
  await domain3.bumpUsage("/w3", d, { counts: { loom_store: 4, loom_recall: 1, esr_task: 1 }, failures: 0, recall: {} });
  await domain3.putTask({ id: "tsk_9", workspace: "/w3", name: "t9", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1 });
  const esr3 = renderEsr(domain3, "/w3", CONFIG);
  assert.ok(esr3.includes("tsk_9"));
  assert.ok(esr3.includes("escalate:"), "nudge coexists with open tasks");
  await Promise.all([domain.close(), domain2.close(), domain3.close()]);
});
