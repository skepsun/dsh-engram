/**
 * dsh-engram basic functional tests — node:test, no DSH harness needed.
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
  bm25Rank,
} from "../lib/util.js";
import { openEngramDomain } from "../lib/store.js";
import { renderIndex, renderEsr } from "../lib/index-block.js";
import { makeCaptureHandler } from "../lib/capture.js";
import { registerTools } from "../lib/tools.js";

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
  const domain = await openEngramDomain(fakeFacility());
  const cfg = { ...CONFIG, maxMemoryChars: 100 };
  const base = { workspace: "/ws", kind: "fact", text: "hello world", tags: [], entity: null, sessionId: "s1", seq: 1, signal: 0.6 };

  const first = await domain.storeMemory(base, cfg);
  const second = await domain.storeMemory(base, cfg);
  assert.equal(first.id, second.id);
  assert.equal(second.duplicated, true);
  assert.equal(domain.listMemories("/ws").length, 1);

  await assert.rejects(
    domain.storeMemory({ ...base, text: "x".repeat(200) }, cfg),
    (e) => e.code === "ENGRAM_CAP_EXCEEDED",
  );
  await domain.close();
});

test("recall: tag-exact first, recency ties, expiry skipped", async () => {
  const domain = await openEngramDomain(fakeFacility());
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
  const domain = await openEngramDomain(fakeFacility());
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
  const domain = await openEngramDomain(fakeFacility());
  const cfg = { ...CONFIG, indexMaxLines: 3, indexMaxChars: 300 };
  for (let i = 0; i < 5; i += 1) {
    await domain.storeMemory({ workspace: "/symbolic-index", kind: "decision", text: `decision number ${i} about architecture and retrieval`, tags: ["architecture"], entity: null, sessionId: "s1", seq: i, signal: 0.8 }, cfg);
  }
  const block = renderIndex(domain, "/symbolic-index", "/code/symbolic-index", cfg);
  assert.ok(block.startsWith("[ENGRAM] workspace: symbolic-index"));
  assert.ok(block.includes("drill:"));
  assert.ok(block.length <= 300);
  // deterministic: two renders identical
  assert.equal(block, renderIndex(domain, "/symbolic-index", "/code/symbolic-index", cfg));

  const esr = renderEsr(domain, "/symbolic-index", cfg);
  // empty task board still nudges the mechanism (and stays compact)
  assert.ok(esr.includes("[ESR] no open tasks"));
  await domain.close();
});

// ── capture ─────────────────────────────────────────────────────────────────
test("capture handler extracts git commits and never throws", async () => {
  const domain = await openEngramDomain(fakeFacility());
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
  handler({ name: "engram_recall", agent, arguments: {} }, { isError: false });
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
  assert.ok(!texts.some((t) => t.includes("engram_recall")));
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
  const domain = await openEngramDomain(fakeFacility());
  await domain.putEntity({ id: "ent_" + slugId("DSH-Engram Plugin"), workspace: "/w", name: "dsh-engram", description: "d", kind: "package", sessionId: "s", createdAt: 1, updatedAt: 1 });
  await domain.putEntity({ id: "ent_beta", workspace: "/w", name: "Beta", description: "", kind: "", sessionId: "s", createdAt: 2, updatedAt: 2 });
  await domain.putEntity({ id: "ent_x", workspace: "/x", name: "X", description: "", kind: "", sessionId: "s", createdAt: 3, updatedAt: 3 });
  const alpha = "ent_" + slugId("DSH-Engram Plugin");
  assert.equal(domain.getEntity("/w", alpha).name, "dsh-engram");
  assert.equal(domain.getEntity("/w", "ent_x"), void 0);
  assert.deepEqual(domain.listEntities("/w").map((e) => e.id), [alpha, "ent_beta"]);
  const summary = domain.summarize();
  assert.equal(summary.workspaces["/w"].nodes, 2);
  assert.equal(summary.totals.nodes, 3);
  // same id = update, not duplicate
  await domain.putEntity({ id: alpha, workspace: "/w", name: "dsh-engram", description: "v2", kind: "pkg", sessionId: "s", createdAt: 1, updatedAt: 4 });
  assert.equal(domain.listEntities("/w").find((e) => e.id === alpha).description, "v2");
  assert.equal(domain.summarize().totals.nodes, 3);
  const removed = await domain.removeEntity("/w", "ent_beta");
  assert.equal(removed, true);
  assert.equal(domain.summarize().workspaces["/w"].nodes, 1);
  await domain.close();
});

test("index block surfaces node count + node list; usurp proactive guidance", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/w", kind: "decision", text: "JSON over sqlite", tags: [], sessionId: "s", seq: 1 }, CONFIG);
  await domain.putEntity({ id: "ent_engram", workspace: "/w", name: "dsh-engram", description: "", kind: "package", sessionId: "s", createdAt: 1, updatedAt: 1 });
  await domain.putTask({ id: "tsk_1", workspace: "/w", name: "t1", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1 });
  const block = renderIndex(domain, "/w", "/w", CONFIG);
  assert.ok(block.includes("node(s)"));
  assert.ok(block.includes("nodes: dsh-engram"));
  assert.ok(block.includes("esr_node"));
  const esr = renderEsr(domain, "/w", CONFIG);
  assert.ok(!esr.includes("no open tasks"));
  assert.ok(esr.includes("tsk_1"));
  // empty workspace: no-open line teaches proactive behavior
  const esrEmpty = renderEsr(domain, "/w2", CONFIG);
  assert.match(esrEmpty, /BE PROACTIVE/);
  await domain.close();
});

test("escalationHint: live-balance nudge appears on the pull path, then disappears when healthy", async () => {
  const { makeTriggerRecorder } = await import("../lib/trigger.js");
  const { esrHintLines } = await import("../lib/index-block.js");
  const domain = await openEngramDomain(fakeFacility());
  const rec = makeTriggerRecorder();
  const feed = (name) => rec.handle({ name, agent: { session: { id: "s1", header: { cwd: "/w" } } }, arguments: {} }, {});
  const pull = () => esrHintLines(domain, "/w", CONFIG, { recorder: rec, sessionId: "s1" }).filter((h) => h.kind === "escalate").map((h) => h.line);
  // under-proactive: 4 mem ops vs 1 esr call (ratio 20% < 34%)
  for (let i = 0; i < 4; i++) feed("engram_store");
  feed("esr_node");
  const escalated = pull();
  assert.ok(escalated.some((l) => l.includes("escalate:")), "under-proactive workspace gets the nudge on pull");
  assert.ok(escalated.some((l) => /4 mem ops vs 1 esr calls/.test(l)));
  // the frozen block never carries the nudge
  assert.ok(!renderEsr(domain, "/w", CONFIG).includes("escalate:"), "frozen [ESR] block is hint-free");
  // too little signal (fewer than 3 mem ops) → no nudge
  const rec2 = makeTriggerRecorder();
  const feed2 = (name) => rec2.handle({ name, agent: { session: { id: "s1", header: { cwd: "/w2" } } }, arguments: {} }, {});
  feed2("engram_store");
  assert.deepEqual(esrHintLines(domain, "/w2", CONFIG, { recorder: rec2, sessionId: "s1" }).filter((h) => h.kind === "escalate"), [], "below sample floor: no nudge");
  // healthy balance (esr ≥ ~half of mem ops) → nudge disappears (closed loop)
  feed("esr_task");
  feed("esr_task");
  feed("esr_link");
  assert.deepEqual(pull(), [], "healthy after escalation: nudge gone");
  // with an active task, the snapshot lists it; the nudge still appears on pull when under-proactive
  await domain.putTask({ id: "tsk_9", workspace: "/w", name: "t9", state: "active", artifact: null, evaluation: null, memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1 });
  const rec3 = makeTriggerRecorder();
  const feed3 = (name) => rec3.handle({ name, agent: { session: { id: "s1", header: { cwd: "/w" } } }, arguments: {} }, {});
  for (let i = 0; i < 4; i++) feed3("engram_store");
  feed3("esr_node");
  const esr3 = renderEsr(domain, "/w", CONFIG);
  assert.ok(esr3.includes("tsk_9"));
  assert.ok(esrHintLines(domain, "/w", CONFIG, { recorder: rec3, sessionId: "s1" }).some((h) => h.kind === "escalate"), "nudge coexists with open tasks on pull");
  await domain.close();
});

test("bm25Rank: recency factor is gentle — relevance still wins, ties go fresh", async () => {
  const now = Date.now();
  // Old doc has both rare query terms (high BM25); fresh doc has only one.
  // Recency must NOT override strong lexical relevance.
  const ranked = bm25Rank(
    [
      { id: "fresh", text: "session", tags: [], updatedAt: now - 3600e3 },
      { id: "old_rich", text: "the harness session index reuse", tags: [], updatedAt: now - 60 * 86400e3 },
    ],
    "session index",
    5,
    now,
  );
  assert.equal(ranked[0].id, "old_rich", "relevance wins over age");

  // Identical text, unequal age → the fresh copy ranks first (decay lifts ties).
  const equal = bm25Rank(
    [
      { id: "old", text: "alpha beta gamma", tags: [], updatedAt: now - 90 * 86400e3 },
      { id: "fresh2", text: "alpha beta gamma", tags: [], updatedAt: now },
    ],
    "alpha",
    5,
    now,
  );
  assert.equal(equal[0].id, "fresh2", "fresh tie wins under a pinned clock");

  // Recency never discards a hit: old match still returned.
  assert.ok(bm25Rank([{ id: "stale", text: "pear", tags: [], updatedAt: 1 }], "pear", 5, now).length === 1);
});

test("engram_recall: entity neighborhood appended from the ESR relation table", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const service = { config: CONFIG, getDomain: () => Promise.resolve(domain), openedDomain: () => domain, log: { warn: () => {} } };
  await domain.putEntity({ id: "ent_a", workspace: "/ws", name: "dsh-engram", description: "", kind: "package", sessionId: "s", createdAt: 1, updatedAt: 1 });
  await domain.putEntity({ id: "ent_b", workspace: "/ws", name: "agent", description: "", kind: "concept", sessionId: "s", createdAt: 2, updatedAt: 2 });
  await domain.putEntity({ id: "ent_c", workspace: "/ws", name: "other", description: "", kind: "", sessionId: "s", createdAt: 3, updatedAt: 3 });
  await domain.addLink({ id: "lk1", workspace: "/ws", source: "ent_a", relation: "depends_on", target: "ent_b", confidence: 0.9, sessionId: "s", createdAt: 1 });
  await domain.addLink({ id: "lk2", workspace: "/ws", source: "ent_c", relation: "implements", target: "ent_a", confidence: 0.5, sessionId: "s", createdAt: 2 });
  await domain.storeMemory({ workspace: "/ws", kind: "fact", text: "dsh-engram reuses the harness session index", tags: [], entity: "ent_a", sessionId: "s", seq: 1, signal: 0.6 }, CONFIG);

  const tools = new Map();
  const ctx = {
    effect: (fn) => fn(),
    tools: { register: (tool) => { tools.set(tool.name, tool); return () => {}; } },
  };
  registerTools(ctx, service);

  const agent = { session: { id: "s1", header: { cwd: "/ws" }, events: { length: 5 } } };
  const recall = tools.get("engram_recall");
  const out = await recall.execute({ query: "session index" }, { agent, signal: undefined });
  assert.ok(out.includes("# recall:"), "recall section present");
  assert.ok(out.includes("entity neighborhood"), "neighborhood section present for entity-anchored hit");
  assert.match(out, /dsh-engram --depends_on--> agent \(90%\)/);
  assert.match(out, /other --implements--> dsh-engram \(50%\)/);

  // A hit without an entity anchor gets no neighborhood section.
  const domain2 = await openEngramDomain(fakeFacility());
  const service2 = { config: CONFIG, getDomain: () => Promise.resolve(domain2), openedDomain: () => domain2, log: { warn: () => {} } };
  await domain2.storeMemory({ workspace: "/ws", kind: "fact", text: "plain memory about sqlite", tags: [], entity: null, sessionId: "s", seq: 1, signal: 0.6 }, CONFIG);
  const tools2 = new Map();
  const ctx2 = { effect: (fn) => fn(), tools: { register: (tool) => { tools2.set(tool.name, tool); return () => {}; } } };
  registerTools(ctx2, service2);
  const out2 = await tools2.get("engram_recall").execute({ query: "sqlite" }, { agent, signal: undefined });
  assert.ok(!out2.includes("entity neighborhood"), "no neighborhood for non-entity hits");

  await Promise.all([domain.close(), domain2.close()]);
});

test("error revival: recurring failures re-warm one entry and resurface in [ENGRAM]", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const cfg = { ...CONFIG, promoteHits: 3 };

  const first = await domain.storeMemory(
    { workspace: "/ws", kind: "error", text: "npm run build failed: tsc: error TS2304", tags: ["error"], sessionId: "s", seq: 1, signal: 0.25 },
    cfg,
  );
  assert.equal(first.duplicated, false);
  const id = first.id;

  // Near-repeat of the same failure → revived (same row, hit bumped, no new row).
  const r2 = await domain.storeMemory(
    { workspace: "/ws", kind: "error", text: "npm run build failed: tsc: error TS2305", tags: ["error"], sessionId: "s", seq: 2, signal: 0.25 },
    cfg,
  );
  assert.equal(r2.revived, true);
  assert.equal(r2.id, id);
  assert.equal(domain.listMemories("/ws").length, 1);
  assert.equal(domain.getMemory("/ws", id).hits, 1);

  // Unrelated error stays its own entry.
  await domain.storeMemory(
    { workspace: "/ws", kind: "error", text: "git push rejected: host key verification failed", tags: ["error"], sessionId: "s", seq: 3, signal: 0.25 },
    cfg,
  );
  assert.equal(domain.listMemories("/ws").length, 2);

  // Two more revives push hits to promoteHits → the low-signal failure now
  // earns an [ENGRAM] line (resurfaces) even though signal < minIndexSignal.
  for (const code of ["TS2322", "TS2312"]) {
    await domain.storeMemory(
      { workspace: "/ws", kind: "error", text: `npm run build failed: tsc: error ${code}`, tags: ["error"], sessionId: "s", seq: 4, signal: 0.25 },
      cfg,
    );
  }
  const block = renderIndex(domain, "/ws", "/code/ws", cfg);
  assert.ok(block.includes("failed"), "revived failure resurfaces in [ENGRAM]");

  // Facts do NOT cluster by overlap — only error memories do.
  const f1 = await domain.storeMemory({ workspace: "/ws", kind: "fact", text: "engine uses sqlite for storage", tags: [], sessionId: "s", seq: 6, signal: 0.6 }, cfg);
  const f2 = await domain.storeMemory({ workspace: "/ws", kind: "fact", text: "engine uses sqlite for the persistence layer", tags: [], sessionId: "s", seq: 7, signal: 0.6 }, cfg);
  assert.equal(f2.duplicated, false);
  assert.notEqual(f2.id, f1.id);

  await domain.close();
});

test("index block: proven procedures get a P✓ marker and rank first", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const cfg = { ...CONFIG, indexMaxLines: 12, promoteHits: 3 };

  await domain.storeMemory({ workspace: "/ws", kind: "decision", text: "decide on vector search", tags: [], sessionId: "s", seq: 1, signal: 0.8 }, cfg);
  const proc = await domain.storeMemory({ workspace: "/ws", kind: "procedure", text: "rollback plan: checkout + npm ci + re-run tests", tags: ["procedure"], sessionId: "s", seq: 2, signal: 0.6 }, cfg);
  for (let i = 0; i < 3; i += 1) await domain.touchMemory("/ws", proc.id);
  await domain.storeMemory({ workspace: "/ws", kind: "procedure", text: "draft checklist template", tags: ["procedure"], sessionId: "s", seq: 3, signal: 0.6 }, cfg);

  const block = renderIndex(domain, "/ws", "/code/ws", cfg);
  const proven = block.indexOf("[P✓]");
  const plain = block.indexOf("[P] ");
  const dec = block.indexOf("[D] ");
  assert.ok(proven !== -1, "proven procedure carries the P✓ marker");
  assert.ok(plain !== -1, "unproven procedure still renders as [P] (no ✓)");
  assert.ok(proven < plain, "proven procedure ranks before the unproven one");
  assert.ok(proven < dec, "proven procedure ranks before other memories");

  // boundary: promoteHits-1 hits is NOT proven yet
  const domain2 = await openEngramDomain(fakeFacility());
  const p2 = await domain2.storeMemory({ workspace: "/ws2", kind: "procedure", text: "rebuild steps", tags: [], sessionId: "s", seq: 1, signal: 0.6 }, CONFIG);
  await domain2.touchMemory("/ws2", p2.id);
  await domain2.touchMemory("/ws2", p2.id);
  const block2 = renderIndex(domain2, "/ws2", "/code/ws2", CONFIG);
  assert.ok(!block2.includes("P✓"), "hits below promoteHits stay plainly [P]");

  // deterministic: two renders identical
  assert.equal(block, renderIndex(domain, "/ws", "/code/ws", cfg));
  await Promise.all([domain.close(), domain2.close()]);
});
