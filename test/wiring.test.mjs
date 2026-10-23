/**
 * Wiring harness — `apply()` against a fake cordis ctx.
 *
 * WHY: every feature of this plugin is wired in `apply()`, and nothing tested
 * it. The two worst failures so far (the `session-*.jsonl` rename and DSH
 * 0.2.x dropping `session.events`) both lived exactly in that layer: the
 * modules were correct, the wiring read a host API that had changed, and the
 * result was a silent zero. Module tests mock the shape they expect; this test
 * mocks the HOST and asserts the things that must exist after `apply`, plus one
 * end-to-end render through a session that has no `.events` at all.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// THE HARNESS RUNS THE REAL `apply()`, WHICH WRITES REAL FILES. Point DSH_HOME
// at a throwaway directory before the first apply: without this, `npm test`
// clobbers the developer's live `~/.dsh/engram/context-gc.status.json` with a
// factory-default snapshot ("host unavailable / L1 not armed") and the CLI then
// reports a healthy server as broken.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "engram-wiring-home-"));

import { apply } from "../lib/index.js";
import { openEngramDomain } from "../lib/store.js";
import { CONTEXT_GC_FOOTER, CONTEXT_GC_HEADING } from "../lib/context-gc.js";

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

/** In-memory storage facility; tables survive re-open (like the json backend). */
function makeFacility() {
  const tables = new Map();
  return {
    open(spec) {
      for (const name of Object.keys(spec.tables)) if (!tables.has(name)) tables.set(name, new Map());
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

const noopLogger = () => ({ info() {}, warn() {}, debug() {}, error() {} });

/** Minimal cordis ctx. Services are looked up by name; `inject` is sync when
 *  everything is already provided (that is what the real loader does too). */
function fakeCtx({ facility, sessionQuery }) {
  const sections = [];
  const tools = new Map();
  const listeners = new Map();
  const services = new Map();
  const provided = new Map();
  const disposers = [];

  const ctx = {
    logger: noopLogger,
    get(name) {
      return services.get(name);
    },
    inject(keys, callback) {
      if (!keys.every((key) => services.has(key))) return () => {};
      const scoped = {
        get: (name) => services.get(name),
        logger: noopLogger,
        on: ctx.on,
        effect: ctx.effect,
        provide: ctx.provide,
      };
      return callback(scoped);
    },
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
      return () => {};
    },
    effect(fn) {
      const dispose = fn();
      disposers.push(dispose);
      return typeof dispose === "function" ? dispose : () => {};
    },
    provide(name, impl) {
      provided.set(name, impl);
      services.set(name, impl);
    },
    tools: {
      register(tool) {
        tools.set(tool.name, tool);
        return () => tools.delete(tool.name);
      },
    },
  };

  services.set("storageDomain", facility);
  if (sessionQuery !== void 0) services.set("sessionQuery", sessionQuery);
  services.set("systemPrompt", {
    section(spec) {
      sections.push(spec);
      return () => {};
    },
  });

  /** Tear the mount down — otherwise the GC interval keeps the test runner alive. */
  async function dispose() {
    for (const disposer of disposers.splice(0)) {
      try {
        await disposer?.();
      } catch {
        // best-effort: a teardown failure must not mask an assertion
      }
    }
  }

  return { ctx, sections, tools, listeners, provided, dispose };
}

function emptySessionQuery() {
  return { live: () => ({ events: [], [Symbol.dispose]() {} }) };
}

test("apply() wires the four sections, the toolset, the listeners and the ledger service", async (t) => {
  const facility = makeFacility();
  const harness = fakeCtx({ facility, sessionQuery: emptySessionQuery() });
  t.after(() => harness.dispose());
  apply(harness.ctx, {});
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(
    harness.sections.map((section) => section.name).sort(),
    ["engram:esr", "engram:esr-method", "engram:index", "engram:jit"],
    "every prompt section is mounted",
  );
  assert.ok(harness.tools.size >= 14, `all tools register (got ${harness.tools.size})`);
  for (const name of ["engram_store", "engram_recall", "engram_detail", "esr_task", "esr_close", "esr_model"]) {
    assert.ok(harness.tools.has(name), `${name} registered`);
  }
  assert.equal(harness.listeners.get("tools/result")?.length >= 2, true, "capture + JIT read tool results");
  assert.equal(harness.listeners.get("session/event")?.length >= 2, true, "ledger tick + JIT read session events");
  assert.equal(harness.listeners.get("session/disposed")?.length >= 3, true, "ledger/episode/todo-sink settle on dispose");
  assert.ok(harness.provided.has("engramLedger"), "the ledger is exposed to other rows");
});

test("apply() with enabled:false registers nothing", async (t) => {
  const facility = makeFacility();
  const harness = fakeCtx({ facility, sessionQuery: emptySessionQuery() });
  t.after(() => harness.dispose());
  apply(harness.ctx, { enabled: false });
  assert.equal(harness.sections.length, 0);
  assert.equal(harness.tools.size, 0);
  assert.equal(harness.listeners.size, 0);
});

test("index section renders [ENGRAM] + [RECALL] on a 0.2.x session (no `.events`)", async (t) => {
  const facility = makeFacility();
  const workspace = "/ws/wiring";
  const query = "wiring harness seed memory";

  // Seed one memory through the real domain, then let apply() open its own.
  const seeding = await openEngramDomain(facility);
  await seeding.storeMemory({ workspace, kind: "fact", text: "wiring harness seed memory for recall", source: "manual" }, CONFIG);
  await seeding.close?.();

  // A 0.2.x-shaped session: id + header + seq, and NO `.events` getter.
  const events = [{ type: "user/message", data: { content: [{ type: "text", text: query }] } }];
  const sessionQuery = { live: () => ({ events, [Symbol.dispose]() {} }) };
  const harness = fakeCtx({ facility, sessionQuery });
  t.after(() => harness.dispose());
  apply(harness.ctx, {});
  await new Promise((resolve) => setTimeout(resolve, 50)); // let the domain open

  const index = harness.sections.find((section) => section.name === "engram:index");
  assert.ok(index, "index section mounted");
  const session = { id: "session-wiring", header: { cwd: workspace }, seq: events.length };
  const text = index.text({ agent: { session } });

  assert.match(text, /\[ENGRAM\]/, "index block renders without session.events");
  assert.match(text, /\[RECALL\]/, "session-start recall fires off the sessionQuery lease");
  assert.match(text, /seed memory/, "the seeded memory is what got recalled");
});

test("compaction credit comes from the committed summary, not from summarize()", async (t) => {
  // A summary that engram did NOT author (the host's own default summarizer, or
  // one the harness substituted after rejecting our checkpoint) must credit
  // nothing: the ledger's whole value is that it only counts savings that
  // actually landed in the session.
  const facility = makeFacility();
  const harness = fakeCtx({ facility, sessionQuery: emptySessionQuery() });
  t.after(() => harness.dispose());
  apply(harness.ctx, {});
  await new Promise((resolve) => setTimeout(resolve, 20));

  const ledger = harness.provided.get("engramLedger");
  assert.ok(ledger, "ledger service is reachable");
  const emit = (event) => {
    for (const handler of harness.listeners.get("session/event") ?? []) {
      handler({ id: "sess-c", header: { cwd: "/repo/compaction" } }, event);
    }
  };

  emit({
    type: "compaction/summary",
    summary: [{ type: "text", text: "## Primary Request and Intent\n- someone else's summary" }],
    shadowedTokenCount: 50000,
  });
  const row = () => (ledger.summary().sessions ?? []).find((s) => s.workspace === "/repo/compaction");
  assert.equal(row()?.compactedChars ?? 0, 0, "foreign summary credits nothing");

  emit({
    type: "compaction/summary",
    summary: [{ type: "text", text: CONTEXT_GC_HEADING + "\npointer summary\n" + CONTEXT_GC_FOOTER }],
    shadowedTokenCount: 50000,
  });
  assert.equal(
    row()?.compactedChars,
    200000 - (CONTEXT_GC_HEADING + "\npointer summary\n" + CONTEXT_GC_FOOTER).length,
    "credited span − summary",
  );
});
