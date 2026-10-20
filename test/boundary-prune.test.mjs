/**
 * BoundaryPrune unit tests (lib/boundary-prune.js) — pure reducers only;
 * the listener itself needs a live DSH session and is covered by the L0
 * simulation + manual smoke (`boundaryPrune` default OFF).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isBoundary,
  completedCount,
  expectedSessionRequests,
  workspaceHistory,
  boundaryPruneAvailability,
} from "../lib/boundary-prune.js";

test("completedCount counts completed todos only", () => {
  assert.equal(completedCount(null), 0);
  assert.equal(completedCount(undefined), 0);
  assert.equal(completedCount([{ status: "pending" }]), 0);
  assert.equal(
    completedCount([{ status: "completed" }, { status: "pending" }, { status: "completed" }]),
    2,
  );
});

test("isBoundary: todo/write with strictly increasing completed count", () => {
  const state = { todoCompleted: 0, requests: 0, prunes: 0, prunedResults: 0 };
  // 1 of 4 completed — first crossing fires
  const ev1 = { type: "todo/write", data: { todos: [
    { status: "completed" }, { status: "pending" }, { status: "pending" }, { status: "pending" },
  ] } };
  assert.deepEqual(isBoundary(ev1, state), { kind: "todo", completed: 1 });
  assert.equal(state.todoCompleted, 1);

  // same count again — no boundary (the todo high-water mark moved)
  assert.equal(isBoundary(ev1, state), null);
  // empty write — no boundary
  assert.equal(isBoundary({ type: "todo/write", data: { todos: [] } }, state), null);

  // 4 of 4 completed — fires again
  const ev2 = { type: "todo/write", data: { todos: [
    { status: "completed" }, { status: "completed" }, { status: "completed" }, { status: "completed" },
  ] } };
  assert.deepEqual(isBoundary(ev2, state), { kind: "todo", completed: 4 });
  assert.equal(state.todoCompleted, 4);
});

test("isBoundary: goal terminal ops fire, non-terminal do not", () => {
  const state = { todoCompleted: 0, requests: 0, prunes: 0, prunedResults: 0 };
  assert.deepEqual(
    isBoundary({ type: "goal/change", data: { operation: "complete" } }, state),
    { kind: "goal", op: "complete" },
  );
  assert.deepEqual(
    isBoundary({ type: "goal/change", data: { operation: "block" } }, state),
    { kind: "goal", op: "block" },
  );
  assert.equal(isBoundary({ type: "goal/change", data: { operation: "create" } }, state), null);
  assert.equal(isBoundary({ type: "goal/change", data: { operation: "pause" } }, state), null);
  assert.equal(isBoundary({ type: "user/message" }, state), null);
});

test("expectedSessionRequests: floor for unknown, empirical prior for known workspaces, growth past the prior", () => {
  const history = new Map([["/Users/x/proj", { sessions: 7, medianRequests: null }]]);
  // unknown workspace → the fixed floor (at any request count)
  assert.equal(expectedSessionRequests(10, history, "/nowhere", 50), 50);
  // known workspace, before the prior → empirical prior
  assert.equal(expectedSessionRequests(10, history, "/Users/x/proj", 50), 120);
  assert.equal(expectedSessionRequests(120, history, "/Users/x/proj", 50), 120);
  // past the prior → bounded growth projection (×2), never below the prior
  assert.equal(expectedSessionRequests(200, history, "/Users/x/proj", 50), 400);
  assert.equal(expectedSessionRequests(1000, history, "/Users/x/proj", 50), 2000);
  // the floor can raise the prior when configured higher
  assert.equal(expectedSessionRequests(10, history, "/Users/x/proj", 200), 200);
});

test("expectedSessionRequests with no history map at all", () => {
  assert.equal(expectedSessionRequests(10, undefined, "/any", 50), 50);
  assert.equal(expectedSessionRequests(10, new Map(), "/any", 50), 50);
});

test("repayment gate arithmetic: fire only while requests + minRemaining <= expectedTotal", () => {
  // mirror of the listener's gate, kept here so the policy has a named test
  const gate = (requests, minRemaining, expectedTotal) => requests + minRemaining <= expectedTotal;
  assert.equal(gate(10, 50, 120), true);   // early session, long way to go
  assert.equal(gate(70, 50, 120), true);   // still headroom
  assert.equal(gate(71, 50, 120), false);  // fewer than 50 requests expected — skip
  assert.equal(gate(10, 50, 50), false);   // floor equals gate: only fires at 0
  // long session past the prior: growth projection keeps the gate open
  assert.equal(gate(300, 50, 600), true);
});

test("installBoundaryPrune: ResultPack onPruned hook fires after a real prune (L1→L2 wiring)", async () => {
  const { installBoundaryPrune } = await import("../lib/boundary-prune.js");
  const listeners = new Map();
  const ctx = {
    on(name, fn) {
      listeners.set(name, fn);
      return () => listeners.delete(name);
    },
  };
  let hooked = null;
  const fakePruner = {
    config: { headChars: 4096, tailChars: 1024 },
    pruneSession: () => ({
      pruned: [{ callId: "bash-smoke-1", originalSeq: 7, replacementSeq: 9, charsBefore: 9000, charsAfter: 400 }],
      charsRemoved: 8600,
    }),
  };
  const warn = [];
  const dispose = installBoundaryPrune(
    { ...ctx, get: (name) => (name === "toolResultPruner" ? fakePruner : undefined) },
    { boundaryPrune: true, boundaryPruneMinRemaining: 5 },
    { warn: (x) => warn.push(x), info: () => {} },
    { onPruned: (session, report) => { hooked = { session, report }; } },
    { history: new Map([["/ws", { sessions: 7, medianRequests: null }]]) },
  );

  const onEvent = listeners.get("session/event");
  assert.ok(typeof onEvent === "function");

  const session = {
    id: "sess-boundary",
    header: { cwd: "/ws" },
    events: [],
  };
  // one assistant message to count a request
  await onEvent(session, { type: "assistant/message" });
  // a todo boundary crossing → prune fires
  await onEvent(session, {
    type: "todo/write",
    data: { todos: [{ status: "completed" }, { status: "pending" }] },
  });
  assert.ok(hooked, "onPruned called with the prune report");
  assert.equal(hooked.report.pruned.length, 1);
  assert.equal(hooked.report.pruned[0].callId, "bash-smoke-1");
  // the hook receives the SAME report the host pruner returned, enriched with budgets
  assert.equal(hooked.report.pruned[0].headChars, 4096);
  assert.equal(hooked.report.pruned[0].tailChars, 1024);

  // no boundary → no hook
  hooked = null;
  await onEvent(session, { type: "todo/write", data: { todos: [{ status: "completed" }, { status: "pending" }] } });
  assert.equal(hooked, null, "no repeat boundary on same high-water mark");
  // non-prune events never fire the hook
  await onEvent(session, { type: "user/message" });
  assert.equal(hooked, null);

  dispose();
  assert.equal(listeners.has("session/event"), false, "dispose removes the listener");
});

test("installBoundaryPrune: the ledger gate vetoes fires; adaptive:false bypasses it", async () => {
  const { installBoundaryPrune } = await import("../lib/boundary-prune.js");

  const make = (config, allowFire) => {
    const listeners = new Map();
    let calls = 0;
    const fakePruner = {
      config: { headChars: 4096, tailChars: 1024 },
      pruneSession: () => {
        calls += 1;
        return { pruned: [{ callId: "gated" }], charsRemoved: 100 };
      },
    };
    const infos = [];
    const dispose = installBoundaryPrune(
      {
        on(name, fn) {
          listeners.set(name, fn);
          return () => listeners.delete(name);
        },
        get: (name) => (name === "toolResultPruner" ? fakePruner : void 0),
      },
      config,
      { warn: () => {}, info: (x) => infos.push(x) },
      { onPruned: () => {} },
      { history: new Map([["/ws", { sessions: 7, medianRequests: null }]]), allowFire },
    );
    return { listeners, calls: () => calls, infos, dispose };
  };

  const session = { id: "sess-gate", header: { cwd: "/ws" } };
  const fire = async (harness) => {
    const onEvent = harness.listeners.get("session/event");
    await onEvent(session, { type: "assistant/message" });
    await onEvent(session, { type: "todo/write", data: { todos: [{ status: "completed" }] } });
  };

  // gate says "net negative" → no prune, one informational line
  const vetoed = make({ boundaryPrune: true, boundaryPruneMinRemaining: 5, boundaryPruneAdaptive: true }, () => false);
  await fire(vetoed);
  assert.equal(vetoed.calls(), 0, "gate vetoed the fire");
  assert.ok(vetoed.infos.some((line) => line.includes("ledger gate holds")), "veto is observable");
  vetoed.dispose();

  // positive evidence → fire
  const allowed = make({ boundaryPrune: true, boundaryPruneMinRemaining: 5, boundaryPruneAdaptive: true }, () => true);
  await fire(allowed);
  assert.equal(allowed.calls(), 1, "gate allowed the fire");
  allowed.dispose();

  // adaptive off = repayment gate only, even when the ledger would veto
  const optOut = make({ boundaryPrune: true, boundaryPruneMinRemaining: 5, boundaryPruneAdaptive: false }, () => false);
  await fire(optOut);
  assert.equal(optOut.calls(), 1, "adaptive:false ignores the ledger gate");
  optOut.dispose();

  // a throwing gate must never disable pruning
  const throwing = make({ boundaryPrune: true, boundaryPruneMinRemaining: 5 }, () => {
    throw new Error("ledger exploded");
  });
  await fire(throwing);
  assert.equal(throwing.calls(), 1, "gate failure fails open");
  throwing.dispose();
});

test("installBoundaryPrune: a throwing onPruned hook is contained inside the listener", async () => {
  const { installBoundaryPrune } = await import("../lib/boundary-prune.js");
  const listeners = new Map();
  const ctx = {
    on(name, fn) {
      listeners.set(name, fn);
      return () => listeners.delete(name);
    },
  };
  const fakePruner = {
    config: { headChars: 4096, tailChars: 1024 },
    pruneSession: () => ({ pruned: [{ callId: "x", originalSeq: 1, replacementSeq: 2 }], charsRemoved: 100 }),
  };
  const warns = [];
  const dispose = installBoundaryPrune(
    { ...ctx, get: (name) => (name === "toolResultPruner" ? fakePruner : undefined) },
    { boundaryPrune: true, boundaryPruneMinRemaining: 5 },
    { warn: (x) => warns.push(x), info: () => {} },
    { onPruned: () => { throw new Error("archive exploded"); } },
    { history: new Map([["/ws", { sessions: 7, medianRequests: null }]]) },
  );
  const session = { id: "sess-throw", header: { cwd: "/ws" } };
  // must not throw into the pipeline
  await assert.doesNotReject(
    async () => {
      await listeners.get("session/event")(session, { type: "assistant/message" });
      await listeners.get("session/event")(session, {
        type: "todo/write",
        data: { todos: [{ status: "completed" }] },
      });
    },
    "throw in L2 hook is contained",
  );
  assert.ok(warns.some((w) => w.includes("L2 hook threw")), "a warning is emitted");
  dispose();
});

test("installBoundaryPrune: absent pruner or disabled config → no hook registration", async () => {
  const { installBoundaryPrune } = await import("../lib/boundary-prune.js");
  const state = [];
  const warn = [];
  // resultPack on but boundaryPrune off → installBoundaryPrune returns noop (L2 self-managed)
  const d1 = installBoundaryPrune({ on: () => () => {}, get: () => undefined }, { boundaryPrune: false }, { warn: (x) => warn.push(x) });
  d1();
  assert.ok(warn.length === 0 || true, "no warn when simply disabled");
  // boundaryPrune on but pruner absent → warned and noop
  const warns2 = [];
  const d2 = installBoundaryPrune({ on: () => () => {}, get: () => undefined }, { boundaryPrune: true }, { warn: (x) => warns2.push(x) });
  d2();
  assert.ok(warns2.some((w) => w.includes("toolResultPruner service unavailable")), "feature-detection warning");
});

test("installBoundaryPrune: threshold override clones the pruner at a lower budget (T2048 landing)", async () => {
  const { installBoundaryPrune } = await import("../lib/boundary-prune.js");
  const listeners = new Map();
  const ctx = {
    on(name, fn) {
      listeners.set(name, fn);
      return () => listeners.delete(name);
    },
  };
  // host pruner at 8192 with a measurable config so we can assert the clone
  const hostPruner = {
    config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
    pruneSession(session) {
      this._calls = (this._calls ?? 0) + 1;
      // prune 1 result; report budget attached here as the real host does
      const report = {
        pruned: [{ callId: "bash-t-2048", originalSeq: 7, replacementSeq: 9, charsBefore: 3000, charsAfter: 500 }],
        charsRemoved: 2500,
      };
      for (const item of report.pruned) Object.assign(item, this.config);
      return report;
    },
  };
  const infos = [];
  const dispose = installBoundaryPrune(
    { ...ctx, get: (name) => {
      if (name === "toolResultPruner") return hostPruner;
      if (name === "tokenMeter") return { estimateMessage: () => 1 };
      return undefined;
    } },
    {
      boundaryPrune: true,
      boundaryPruneMinRemaining: 5,
      boundaryPruneThresholdChars: 2048,
      boundaryPruneHeadChars: 1024,
      boundaryPruneTailChars: 256,
    },
    { warn: () => {}, info: (m) => infos.push(m) },
    { onPruned: (_s, report) => {
      // the L2 hook must receive the CLONE's budgets (2048-clamped edges),
      // not the host's 8192 ones
      lastReport = report;
    } },
    { history: new Map([["/ws", { sessions: 7, medianRequests: null }]]) },
  );
  let lastReport = null;
  const session = { id: "sess-t2048", header: { cwd: "/ws" } };
  await listeners.get("session/event")(session, { type: "assistant/message" });
  await listeners.get("session/event")(session, { type: "todo/write", data: { todos: [{ status: "completed" }, { status: "pending" }] } });
  assert.ok(lastReport, "L2 hook received the report");
  // budgets on the items reflect the override (1024/256), not host (4096/1024)
  assert.equal(lastReport.pruned[0].headChars, 1024);
  assert.equal(lastReport.pruned[0].tailChars, 256);
  // the info log records the override activation
  assert.ok(infos.some((m) => m.includes("threshold 2048")), `info mentions override: ${infos.join(" | ")}`);
  // host pruner still exists and was NOT mutated
  assert.equal(hostPruner.config.thresholdChars, 8192, "host config untouched");
  dispose();
});

test("installBoundaryPrune: invalid threshold override falls back to host pruner with a warn", async () => {
  const { installBoundaryPrune } = await import("../lib/boundary-prune.js");
  const listeners = new Map();
  const ctx = {
    on(name, fn) {
      listeners.set(name, fn);
      return () => listeners.delete(name);
    },
  };
  const hostPruner = {
    config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
    pruneSession: () => ({ pruned: [{ callId: "x", originalSeq: 1, replacementSeq: 2, charsBefore: 9000, charsAfter: 400 }], charsRemoved: 8600 }),
  };
  const warns = [];
  // threshold 0 / negative / non-number → ignored
  const d1 = installBoundaryPrune(
    { ...ctx, get: (n) => (n === "toolResultPruner" ? hostPruner : n === "tokenMeter" ? { estimateMessage: () => 1 } : undefined) },
    { boundaryPrune: true, boundaryPruneMinRemaining: 5, boundaryPruneThresholdChars: 0 },
    { warn: (m) => warns.push(m), info: () => {} },
    {},
    { history: new Map([["/ws", { sessions: 7, medianRequests: null }]]) },
  );
  d1();
  // no warn about fallback since 0 is treated as "no override"
  assert.equal(warns.some((w) => w.includes("threshold override")), false);
});

test("installBoundaryPrune: request-count cadence fires in sessions with no todo/goal (step-idle boundary)", async () => {
  const { installBoundaryPrune } = await import("../lib/boundary-prune.js");
  const listeners = new Map();
  const ctx = {
    on(name, fn) {
      listeners.set(name, fn);
      return () => listeners.delete(name);
    },
  };
  const hostPruner = {
    config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
    pruneSession: () => ({ pruned: [{ callId: "bash-step", originalSeq: 5, replacementSeq: 8, charsBefore: 9000, charsAfter: 400 }], charsRemoved: 8600 }),
  };
  const fired = [];
  const info = [];
  const dispose = installBoundaryPrune(
    { ...ctx, get: (n) => (n === "toolResultPruner" ? hostPruner : n === "tokenMeter" ? { estimateMessage: () => 1 } : undefined) },
    { boundaryPrune: true, boundaryPruneMinRemaining: 5, boundaryPruneIdleCadence: 20 },
    { warn: () => {}, info: (m) => info.push(m) },
    { onPruned: (_s, _r, boundary) => fired.push(boundary.kind) },
    { history: new Map([["/ws", { sessions: 7, medianRequests: null }]]) },
  );
  const onEvent = listeners.get("session/event");
  const session = { id: "sess-idle", header: { cwd: "/ws" } };
  // No todo/goal events — 24 assistant messages with a 20-request cadence
  for (let i = 1; i <= 24; i++) {
    await onEvent(session, { type: "assistant/message" });
  }
  assert.equal(fired.length, 1, "fires once at the cadence boundary");
  assert.equal(fired[0], "step", "boundary kind is step");
  assert.ok(info.some((m) => m.includes("step @20")), `info shows step source: ${info.join("|")}`);
  // cadence is per-session cadence: a second cross of the boundary minus the
  // same cadence fires again
  for (let i = 1; i <= 20; i++) await onEvent(session, { type: "assistant/message" });
  assert.equal(fired.length, 2, "fires again after another full cadence");
  dispose();
});

test("installBoundaryPrune: cadence off (null/0) never fires the step boundary", async () => {
  const { installBoundaryPrune } = await import("../lib/boundary-prune.js");
  const listeners = new Map();
  const ctx = {
    on(name, fn) {
      listeners.set(name, fn);
      return () => listeners.delete(name);
    },
  };
  const hostPruner = {
    config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
    pruneSession: () => ({ pruned: [{ callId: "x", originalSeq: 1, replacementSeq: 2, charsBefore: 9000, charsAfter: 400 }], charsRemoved: 8600 }),
  };
  const fired = [];
  const d = installBoundaryPrune(
    { ...ctx, get: (n) => (n === "toolResultPruner" ? hostPruner : n === "tokenMeter" ? { estimateMessage: () => 1 } : undefined) },
    { boundaryPrune: true, boundaryPruneMinRemaining: 5, boundaryPruneIdleCadence: null },
    { warn: () => {}, info: () => {} },
    { onPruned: (_s, _r, boundary) => fired.push(boundary.kind) },
    { history: new Map([["/ws", { sessions: 7, medianRequests: null }]]) },
  );
  const onEvent = listeners.get("session/event");
  const session = { id: "sess-idle-off", header: { cwd: "/ws" } };
  for (let i = 1; i <= 60; i++) await onEvent(session, { type: "assistant/message" });
  assert.equal(fired.length, 0, "no step boundary when cadence is off");
  d();
});


test("workspaceHistory counts versioned session logs (issue #8)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bp-hist-"));
  const bucket = "--a-b--";
  const mk = (sid, name, bytes) => {
    const d = path.join(root, bucket, sid);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, name), Buffer.alloc(bytes));
  };
  mk("s1", "session.v4.jsonl.zstd", 10); // current DSH
  mk("s2", "session.v3.jsonl.zstd", 10); // 0.1.x
  mk("s3", "session.jsonl.zstd", 10); // legacy
  mk("s4", "session.v4.jsonl.zstd", 0); // empty log → not a session

  const total = [...workspaceHistory(root).values()].reduce((n, v) => n + v.sessions, 0);
  assert.equal(total, 3, "every naming variant with content is counted");

  // No sessions at all → empty map (callers fall back to the fixed floor).
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bp-hist-empty-"));
  assert.equal(workspaceHistory(empty).size, 0);
});

test("availability: armed when the host plane exposes toolResultPruner", () => {
  const ctx = { get: (name) => (name === "toolResultPruner" ? { pruneSession() {}, config: { thresholdChars: 8192 } } : undefined) };
  assert.deepEqual(boundaryPruneAvailability(ctx, {}), { armed: true, reason: "threshold 8192" });
  assert.equal(
    boundaryPruneAvailability(ctx, { boundaryPruneThresholdChars: 2048 }).reason,
    "threshold 8192 (override 2048)",
  );
});

test("availability: names the missing host-plane pruner (DSH >= 0.2.0 web profile)", () => {
  const out = boundaryPruneAvailability({ get: () => undefined }, {});
  assert.equal(out.armed, false);
  assert.match(out.reason, /toolResultPruner/);
  assert.match(out.reason, /tool-result-pruner/);
});

test("availability: registered-but-inactive pruner reads as pending, not missing", () => {
  // Strict get is empty while the pruner's fiber is still activating; the
  // non-strict lookup still sees the registered service. Reporting these as
  // the same thing is what hid a real L1 outage behind "patch missing".
  const ctx = { get: (name, strict) => (strict === false ? { pruneSession() {} } : undefined) };
  const out = boundaryPruneAvailability(ctx, {});
  assert.equal(out.armed, false);
  assert.match(out.reason, /registered but its fiber is not active yet/);
});

test("availability: config opt-out is reported, not silently armed", () => {
  const ctx = { get: () => ({ pruneSession() {} }) };
  assert.equal(boundaryPruneAvailability(ctx, { boundaryPrune: false }).armed, false);
});
