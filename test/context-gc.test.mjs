/**
 * dsh-engram Context GC tests — the auto-GC that replaces DSH's built-in
 * LLM-summary compaction (NOT the memory-panel GC):
 *   - provenance scan over DSH message blocks (tool-call / tool-result)
 *   - turn grouping with tool-result splices absorbed
 *   - pointer-context resolution against the store (known vs unknown ids)
 *   - pointer summary with explicit re-fetch calls + working-set restatement
 *   - un-provenanced narrative: enabled / disabled / LLM / verbatim fallback
 *   - the ContextGcEngine binding: summarize() replaces the summary body,
 *     errors fall back to default compaction, gcReplacesCompaction=false never loads
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  scanMessages,
  groupTurns,
  collectPointerContext,
  buildPointerSummary,
  buildContextGcSummary,
  serializeMessages,
  summarizeUnprovenanced,
  loadContextGcEngine,
  loadCompactionEngine,
} from "../lib/context-gc.js";
import { openEngramDomain } from "../lib/store.js";
import {
  name as compactionEntryName,
  inject as compactionEntryInject,
  apply as compactionEntryApply,
} from "../lib/compaction.js";

/** In-memory storage-domain stand-in (mirrors the other suites). */
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

const CONFIG = { promoteHits: 3, maxMemoriesPerWorkspace: 2000, maxMemoryChars: 1600, expireDays: 180 };

function assistantWithToolCall(name, args, id = "call_1") {
  return {
    role: "assistant",
    content: [{ type: "tool-call", id, name, arguments: JSON.stringify(args) }],
  };
}
function toolResult(toolCallId, text, toolName) {
  return {
    role: "user",
    content: [{ type: "tool-result", toolCallId, toolName, content: [{ type: "text", text }] }],
  };
}
function userText(text) {
  return { role: "user", content: [{ type: "text", text }] };
}

// ── provenance scanning ────────────────────────────────────────────────

test("scan: engram_store echoes its memory id; store call anchors the turn", () => {
  const message = assistantWithToolCall("engram_store", { text: "the decision", kind: "decision" }, "c1");
  const result = toolResult("c1", "stored memory 8f7a2c4e-9b1d-4e0a-8f3c-2b1a0d4e6f8a [decision] — cited to session s1#3");
  const report = scanMessages([userText("do it"), message, result]);

  assert.ok(report.engramUsed);
  assert.ok(report.memoryIds.has("8f7a2c4e-9b1d-4e0a-8f3c-2b1a0d4e6f8a"), "full uuid captured");
  assert.ok(report.memoryMarkers.has("#8f7a2c4e"), "short marker captured");
  assert.deepEqual([...report.anchoredMessageIndices], [1], "the tool-call message is anchored; its result text adds no NEW ids");
});

test("scan: engram_recall query is a re-run pointer; result ids captured", () => {
  const message = assistantWithToolCall("engram_recall", { query: "git push error" }, "c2");
  const result = toolResult("c2", "# recall: \"git push error\" (2)\n- ab12cd34 [error] 08-21 retry backoff …");
  const report = scanMessages([message, result]);

  assert.deepEqual(report.recallQueries, ["git push error"]);
  assert.ok(report.memoryMarkers.has("#ab12cd34"), "bare 8-hex short id also captured as marker");
});

test("scan: engram_detail id argument is an exact fetch pointer", () => {
  const report = scanMessages([assistantWithToolCall("engram_detail", { id: "ab12cd34" }, "c3")]);
  assert.ok(report.memoryIds.has("ab12cd34"), "detail arg treated as memory id");
  assert.ok(report.engramUsed);
});

test("scan: esr tools surface task/entity ids; esr_gc is excluded as management", () => {
  const call = assistantWithToolCall("esr_close", { task_id: "tsk_abc123", memory_refs: ["ab12cd34"] }, "c4");
  const res = toolResult("c4", "task tsk_abc123 → STABLE ✓\nclosure memory: 9f1a2b3c-0000-4000-8000-000000000001");
  const gcCall = assistantWithToolCall("esr_gc", { dry_run: true }, "c5");
  const report = scanMessages([call, res, gcCall]);

  assert.ok(report.esrUsed);
  assert.ok(report.entityIds.has("tsk_abc123"));
  assert.ok(report.memoryIds.has("ab12cd34"));
  assert.ok(report.memoryIds.has("9f1a2b3c-0000-4000-8000-000000000001"), "closure memory echoed");
  assert.equal(report.anchoredMessageIndices.size, 1, "only the esr_close call anchors; esr_gc message NOT anchored");
  assert.ok(report.anchoredMessageIndices.has(0), "the esr_close turn is the anchored one");
  assert.ok(!report.anchoredMessageIndices.has(2), "esr_gc (management) never anchors");
});

test("scan: esr_node derives ent_<slug> from its name; file_path is a hint", () => {
  const report = scanMessages([
    assistantWithToolCall("engram_store", { text: "note", file_path: "/repo/src/main.ts" }, "c6"),
    assistantWithToolCall("esr_node", { name: "My Module" }, "c7"),
  ]);
  assert.ok(report.entityIds.has("ent_my-module"));
  assert.ok(report.filePaths.has("/repo/src/main.ts"));
});

test("scan: standalone tool-result (split turn) still contributes anchors", () => {
  const result = toolResult("call_old", "recall: 3e4f5a6b-0000-4000-8000-000000000002 [fact] …", "engram_recall");
  const report = scanMessages([result]);
  assert.ok(report.memoryIds.has("3e4f5a6b-0000-4000-8000-000000000002"));
  assert.equal(report.anchoredMessageIndices.size, 1);
});

// ── turn grouping ──────────────────────────────────────────────────────

test("group: turns open at real user messages; tool-result splices are absorbed", () => {
  const messages = [
    userText("first request"),
    assistantWithToolCall("engram_store", {}, "a"),
    toolResult("a", "uuid"),
    userText("second request"),
    assistantWithToolCall("engram_recall", {}, "b"),
    toolResult("b", "ids"),
  ];
  const report = scanMessages(messages);
  const turns = groupTurns(messages, report.anchoredMessageIndices);

  assert.equal(turns.length, 2, "two genuine user turns");
  assert.deepEqual(turns[0], { start: 0, end: 3, anchored: true });
  assert.deepEqual(turns[1], { start: 3, end: 6, anchored: true });
});

test("group: pure-chat turn is unprovenanced; narrative-only count works", () => {
  const messages = [
    userText("hello, what do you think about X?"),
    { role: "assistant", content: [{ type: "text", text: "thinking…" }] },
  ];
  const report = scanMessages(messages);
  const turns = groupTurns(messages, report.anchoredMessageIndices);
  assert.equal(turns[0].anchored, false);
});

// ── pointer context + summary ──────────────────────────────────────────

async function seededDomain() {
  const domain = await openEngramDomain(fakeFacility());
  const ws = "/w";
  const memory = await domain.storeMemory({ workspace: ws, kind: "decision", text: "the decision", tags: [], sessionId: "s1" }, CONFIG);
  await domain.putTask({
    id: "tsk_act1", workspace: ws, name: "active work", state: "active",
    memoryRefs: [memory.id], sessionId: "s1", createdAt: Date.now(), updatedAt: Date.now(), stateChangedAt: Date.now(),
  });
  await domain.putTask({
    id: "tsk_done", workspace: ws, name: "closed work", state: "stable",
    artifact: "a", evaluation: "e", memoryRefs: [memory.id],
    sessionId: "s1", createdAt: Date.now(), updatedAt: Date.now(), stateChangedAt: Date.now(),
  });
  return { domain, memory, ws };
}

test("context: known ids resolve to re-fetchable pointers; unknown ids are dropped", async () => {
  const { domain, memory, ws } = await seededDomain();
  const report = scanMessages([
    assistantWithToolCall("engram_detail", { id: memory.id }, "c8"),
    assistantWithToolCall("engram_detail", { id: "totally-unknown" }, "c9"),
    assistantWithToolCall("engram_store", {}, "cA"),
  ]);
  const ctx = collectPointerContext(domain, ws, report);

  assert.equal(ctx.activeTasks.length, 1);
  assert.equal(ctx.activeTasks[0].id, "tsk_act1");
  assert.equal(ctx.stableTaskCount, 1);
  assert.equal(ctx.memoryIndex.size, 1, "full id and its #marker resolve to ONE memory");
  assert.ok(ctx.memoryIndex.get(memory.id), "known id present");
});

test("context: #marker resolves through the store's 8-char prefix", async () => {
  const { domain, memory, ws } = await seededDomain();
  const marker = `#${memory.id.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;
  const report = scanMessages([assistantWithToolCall("engram_detail", { id: marker }, "cB")]);
  const ctx = collectPointerContext(domain, ws, report);
  assert.equal(ctx.memoryIndex.size, 1);
  assert.ok(ctx.memoryIndex.has(marker));
});

test("summary: every evicted category carries an explicit re-fetch call + working set", () => {
  const report = scanMessages([
    assistantWithToolCall("engram_store", { file_path: "/repo/a.ts" }, "cC"),
    assistantWithToolCall("engram_recall", { query: "retry backoff" }, "cD"),
    assistantWithToolCall("esr_close", { task_id: "tsk_act1" }, "cE"),
  ]);
  const context = {
    label: "w",
    activeTasks: [{ id: "tsk_act1", name: "active work" }],
    stableTaskCount: 1,
    memoryIndex: new Map([["8f7a2c4e-9b1d-4e0a-8f3c-2b1a0d4e6f8a", { kind: "decision", text: "the decision" }]]),
  };
  const text = buildPointerSummary(report, context, { turns: [], label: "w" });

  assert.match(text, /engram_detail\(id: "8f7a2c4e-9b1d-4e0a-8f3c-2b1a0d4e6f8a"\)/, "exact memory pointer");
  assert.match(text, /engram_recall\(query: "retry backoff"\)/, "re-run recall pointer");
  assert.match(text, /tsk_act1/, "working set restated");
  assert.match(text, /closed task/, "stable tasks pointer");
  assert.match(text, /`\/repo\/a\.ts`/, "filePath hint");
  assert.match(text, /RE-FETCHABLE/, "header");
});

// ── narrative safety net ───────────────────────────────────────────────

test("narrative: no un-provenanced turns → _None_ (zero LLM)", async () => {
  const out = await summarizeUnprovenanced([], { enabled: true, callLlm: async () => ({ text: "nope" }) });
  assert.equal(out.generated, false);
  assert.match(out.text, /_None/);
});

test("narrative: disabled → truncated verbatim fallback, no LLM call", async () => {
  let called = 0;
  const messages = [userText("pure chat A"), { role: "assistant", content: [{ type: "text", text: "reply B" }] }];
  const out = await summarizeUnprovenanced(messages, {
    enabled: false,
    callLlm: async () => { called += 1; return { text: "x" }; },
  });
  assert.equal(called, 0, "LLM never called when disabled");
  assert.equal(out.generated, false);
  assert.match(out.text, /pure chat A/);
  assert.match(out.text, /reply B/);
});

test("narrative: callLlm success → generated scoped summary", async () => {
  const out = await summarizeUnprovenanced([userText("chat")], {
    enabled: true,
    callLlm: async () => ({ text: "user asked about X", model: "deepseek-v4", llm: { llmStreamCall: true } }),
  });
  assert.equal(out.generated, true);
  assert.equal(out.model, "deepseek-v4");
  assert.ok(out.llm?.llmStreamCall);
});

test("narrative: callLlm failure → verbatim fallback (detail never dropped)", async () => {
  const messages = [userText("chat C")];
  const out = await summarizeUnprovenanced(messages, {
    enabled: true,
    callLlm: async () => { throw new Error("boom"); },
  });
  assert.equal(out.generated, false);
  assert.match(out.text, /chat C/);
});

test("serialize: caps length with a truncation note", () => {
  const text = serializeMessages([userText("a".repeat(100))], { maxChars: 50 });
  assert.ok(text.includes("…[truncated"));
});

// ── ContextGcEngine binding ────────────────────────────────────────────

/** Minimal cordis-like ctx for constructing the engine (auto:false → no listeners). */
function fakeCtx(overrides = {}) {
  return {
    logger: { info() {}, warn() {}, error() {} },
    get(name) { return this[name]; },
    on() { return () => {}; },
    reflect: { provide() {} },
    llm: null,
    ...overrides,
  };
}

function fakeAgent(ws = "/w") {
  return { session: { id: "sess-1", header: { cwd: ws }, requestHeader: () => undefined }, options: {} };
}

test("engine: loadContextGcEngine returns a class when the backend is importable", async () => {
  const Engine = await loadContextGcEngine(fakeCtx(), { auto: false }, {});
  if (Engine === null) {
    // dsh-compaction-basic not linked in this environment — the guarantee we
    // test here is that the plugin falls back silently (never throws).
    return;
  }
  assert.equal(typeof Engine, "function");
  const engine = new Engine();
  assert.ok(engine, "constructs (registers the compaction service)");
});

test("engine: summarize() emits pointer summary + working set, zero LLM when narrative off", async () => {
  const { domain, memory, ws } = await seededDomain();
  const wsPath = "/w";
  const Engine = await loadContextGcEngine(
    fakeCtx(),
    { auto: false },
    {
      narrativeEnabled: false,
      readWorkspace: async (w) => {
        assert.equal(w, wsPath);
        const report = { memoryIds: new Set([memory.id]), memoryMarkers: new Set(), entityIds: new Set(), recallQueries: [], entityQueries: [], filePaths: new Set(), esrUsed: true, engramUsed: true, anchoredMessageIndices: new Set() };
        return collectPointerContext(domain, ws, report);
      },
    },
  );
  assert.ok(Engine, "Context GC engine requires setup-links (dsh-compaction-basic)");

  const engine = new Engine();
  const input = {
    messages: [
      userText("first request"),
      assistantWithToolCall("engram_store", { text: "the decision" }, "cF"),
      toolResult("cF", `stored memory ${memory.id}`),
      userText("second request"),
      { role: "assistant", content: [{ type: "text", text: "pure chat reply" }] },
    ],
  };
  const result = await engine.summarize(input, fakeAgent(wsPath));
  const summaryText = result.summary.map((b) => b.text).join("\n");

  assert.equal(result.llmStreamCall, undefined, "no LLM call in mechanical mode");
  assert.match(summaryText, /Context GC/);
  assert.match(summaryText, /engram_detail/);
  assert.match(summaryText, /tsk_act1/, "working set restated");
  assert.match(summaryText, /pure chat reply/, "un-provenanced turn preserved verbatim");
});

test("engine: narrative via injected narrativeLlm sets llmStreamCall + model", async () => {
  const Engine = await loadContextGcEngine(fakeCtx(), { auto: false }, {
    narrativeEnabled: true,
    narrativeLlm: async (slice) => {
      assert.ok(slice.length > 0);
      return { text: "user asked about X", model: "deepseek-v4", llm: { llmStreamCall: true, provider: "p", model: "deepseek-v4", rawOutput: [] } };
    },
    readWorkspace: async () => null,
  });
  assert.ok(Engine, "Context GC engine requires setup-links (dsh-compaction-basic)");

  const engine = new Engine();
  const input = { messages: [userText("pure chat"), { role: "assistant", content: [{ type: "text", text: "reply" }] }] };
  const result = await engine.summarize(input, fakeAgent());
  const summaryText = result.summary.map((b) => b.text).join("\n");
  assert.equal(result.llmStreamCall, true);
  assert.equal(result.model, "deepseek-v4");
  assert.match(summaryText, /user asked about X/, "narrative landed in the summary");
});

test("engine: any GC error falls back to the injected defaultSummarize (never breaks compaction)", async () => {
  const calls = [];
  const Engine = await loadContextGcEngine(fakeCtx(), { auto: false }, {
    narrativeEnabled: false,
    readWorkspace: async () => { throw new Error("store exploded"); },
    defaultSummarize: async (input, agent) => {
      calls.push(["default", agent.session.id]);
      return { summary: [{ type: "text", text: "default compaction fallback" }] };
    },
  });
  assert.ok(Engine, "Context GC engine requires setup-links (dsh-compaction-basic)");

  const engine = new Engine();
  const result = await engine.summarize(
    { messages: [userText("hi")] },
    fakeAgent("/w"),
  );
  assert.deepEqual(calls, [["default", "sess-1"]]);
  assert.equal(result.summary[0].text, "default compaction fallback");
});

test("engine: without injected fallback, error propagates to super.summarize (default behavior)", async () => {
  // With no deps.readWorkspace and a throwing deps.readWorkspace we exercise the
  // no-default-fallback branch: it must still call the parent (live behavior
  // depends on the real backend — here we only assert the branch runs).
  const Engine = await loadContextGcEngine(fakeCtx(), { auto: false }, {
    narrativeEnabled: false,
    readWorkspace: async () => { throw new Error("boom"); },
  });
  assert.ok(Engine, "Context GC engine requires setup-links (dsh-compaction-basic)");
  const engine = new Engine();
  await assert.rejects(
    () => engine.summarize({ messages: [userText("hi")] }, fakeAgent()),
    /store exploded|no provider\/model available/i,
  );
});

// ── loadCompactionEngine modes + preset-plane entry ────────────────────

test("engine: loadCompactionEngine({mode:'default'}) returns a bare BasicCompactionEngine subclass", async () => {
  const Engine = await loadCompactionEngine(fakeCtx(), { auto: false }, {}, { mode: "default" });
  assert.ok(Engine, "Context GC engine requires setup-links (dsh-compaction-basic)");
  assert.equal(Object.getPrototypeOf(Engine).name, "BasicCompactionEngine");
  const engine = new Engine();
  assert.equal(typeof engine.summarize, "function");
  assert.equal(engine._contextGc, undefined, "default mode must NOT carry the Context GC override");
});

test("compaction entry: preset-plane plugin shape (name/inject/apply)", () => {
  assert.equal(compactionEntryName, "dsh-engram-compaction");
  assert.deepEqual(compactionEntryInject, ["llm", "tokenMeter", "sessions"]);
  assert.equal(typeof compactionEntryApply, "function");
});

function capturingCtx() {
  // object spread materializes getters, so hold the captured engine in a
  // closure and expose a reader method instead.
  const holder = {};
  const ctx = fakeCtx({
    reflect: { provide(name, value) { holder.engine = value; } },
  });
  ctx.engine = () => holder.engine;
  return ctx;
}

test("compaction entry: apply with gcReplacesCompaction:false mounts the default summarizer", async () => {
  const ctx = capturingCtx();
  await compactionEntryApply(ctx, { gcReplacesCompaction: false, gcNarrative: false });
  const engine = ctx.engine();
  assert.ok(engine, "apply must construct + provide a compaction engine");
  assert.equal(engine._contextGc, undefined, "default mode = plain BasicCompactionEngine");
  // instance -> DefaultCompactionEngine -> BasicCompactionEngine
  assert.equal(Object.getPrototypeOf(engine.constructor).name, "BasicCompactionEngine");
});

test("compaction entry: apply in context-gc mode mounts the ContextGcEngine override", async () => {
  const ctx = capturingCtx();
  await compactionEntryApply(ctx, { gcReplacesCompaction: true, gcNarrative: false });
  const engine = ctx.engine();
  assert.ok(engine, "apply must construct + provide a compaction engine");
  assert.equal(typeof engine._contextGc, "function", "context-gc mode carries the mechanical eviction override");
});
