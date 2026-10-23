/**
 * The preset-plane BoundaryPrune entry (lib/prune.js).
 *
 * Regression target: on `dsh web`, L1 armed in the HOST plane and never fired —
 * the sessions' events belong to the agent preset's realm, so the host listener
 * never saw a `todo/write`. This entry is the row that lives in that realm; the
 * tests below drive the real listener with a fake session and assert (a) the
 * pruner is called, (b) the ledger credit goes through `engramLedger`, and
 * (c) every boundary attempt lands in the durable diagnostics log.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { apply, PLANE } from "../lib/prune.js";
import { pruneAttemptPath, readPruneAttempts } from "../lib/status.js";

/** The attempt log is written fire-and-forget (diagnostics must never block the
 *  session pipeline), so tests give the append a tick to land. */
const flushLog = () => new Promise((resolve) => setTimeout(resolve, 40));

function fakeCtx({ pruned = 2, charsRemoved = 12000, ledger = null } = {}) {
  const handlers = new Map();
  const pruner = {
    config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
    calls: 0,
    pruneSession() {
      this.calls += 1;
      return { pruned: Array.from({ length: pruned }, (_, i) => ({ seq: i })), charsRemoved };
    },
  };
  const ctx = {
    logger: () => ({ info() {}, warn() {}, debug() {} }),
    get(name) {
      if (name === "toolResultPruner") return pruner;
      if (name === "engramLedger") return ledger;
      return undefined;
    },
    on(name, fn) {
      handlers.set(name, fn);
      return () => handlers.delete(name);
    },
    emit(name, ...args) {
      handlers.get(name)?.(...args);
    },
  };
  return { ctx, pruner, handlers };
}

function fakeSession(cwd = "/tmp/ws-preset") {
  return {
    id: "sess-preset-1",
    header: { cwd },
    surface: { nodes: [] },
    eventAt: () => undefined,
    deriveEventMessage: () => ({ content: [] }),
  };
}

test("prune entry: a todo boundary prunes through the realm's pruner and credits the ledger", async () => {
  const home = await mkdtemp(join(tmpdir(), "engram-prune-entry-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const credits = [];
    const ledger = { notePrune: (...args) => credits.push(args) };
    const { ctx, pruner, handlers } = fakeCtx({ pruned: 3, charsRemoved: 9000, ledger });
    const dispose = apply(ctx, { boundaryPrune: true, boundaryPruneMinRemaining: 0 });
    assert.ok(handlers.has("session/event"), "listener installed");

    const session = fakeSession();
    // One completed todo crosses the boundary (the high-water mark starts at 0).
    handlers.get("session/event")(session, {
      type: "todo/write",
      data: { todos: [{ status: "completed" }, { status: "pending" }] },
    });
    // The fire is deferred out of the session's commit() stack (a prune inside
    // the publishing window is a reentrant append and the host rejects it).
    assert.equal(pruner.calls, 0, "nothing prunes synchronously inside commit()");
    await flushLog();
    assert.equal(pruner.calls, 1, "realm pruner was invoked after commit()");
    assert.equal(credits.length, 1, "ledger credited the prune");
    assert.equal(credits[0][1], "/tmp/ws-preset", "credited under the workspace key");
    assert.equal(credits[0][2].charsRemoved, 9000);

    await flushLog();
    const attempts = await readPruneAttempts();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].plane, PLANE);
    assert.equal(attempts[0].kind, "fired");
    assert.equal(attempts[0].pruned, 3);

    dispose();
    assert.equal(handlers.has("session/event"), false, "disposer removes the listener");
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test("prune entry: a boundary that prunes nothing is still recorded (armed ≠ firing)", async () => {
  const home = await mkdtemp(join(tmpdir(), "engram-prune-empty-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { ctx, handlers } = fakeCtx({ pruned: 0, charsRemoved: 0 });
    apply(ctx, { boundaryPrune: true, boundaryPruneMinRemaining: 0 });
    handlers.get("session/event")(fakeSession(), {
      type: "todo/write",
      data: { todos: [{ status: "completed" }] },
    });
    await flushLog();
    const attempts = await readPruneAttempts();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].kind, "fired");
    assert.equal(attempts[0].pruned, 0);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test("prune entry: the repayment gate holds early boundaries and says so", async () => {
  const home = await mkdtemp(join(tmpdir(), "engram-prune-gate-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { ctx, pruner, handlers } = fakeCtx({ pruned: 1 });
    apply(ctx, { boundaryPrune: true, boundaryPruneMinRemaining: 50 });
    const session = fakeSession();
    // One completed request: the repayment clock now sits just short of the
    // floor, so a boundary here is held instead of fired.
    handlers.get("session/event")(session, { type: "assistant/message", data: {} });
    handlers.get("session/event")(session, {
      type: "todo/write",
      data: { todos: [{ status: "completed" }] },
    });
    assert.equal(pruner.calls, 0, "no prune before the repayment point");
    await flushLog();
    const attempts = await readPruneAttempts();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].kind, "skipped");

    // The harness log must exist where the CLI/overview look for it.
    assert.ok(pruneAttemptPath().endsWith(join("engram", "boundary-attempts.jsonl")));
    assert.ok((await readFile(pruneAttemptPath(), "utf8")).includes('"plane":"preset"'));
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test("prune entry: boundaryPrune:false mounts nothing", () => {
  const { ctx, handlers } = fakeCtx();
  const dispose = apply(ctx, { boundaryPrune: false });
  assert.equal(handlers.has("session/event"), false);
  dispose();
});

test("prune entry: a prune that appends during the publish window is deferred, not lost", async () => {
  // The live failure mode (2026-10-23): DSH publishes `todo/write` with
  // `appending` set, so a synchronous `session.append("compaction/prune")`
  // throws "session append cannot reenter". Swallowed by the listener's safety
  // net, it looked exactly like "fired, pruned nothing": L1 alive and useless.
  const home = await mkdtemp(join(tmpdir(), "engram-prune-reenter-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const handlers = new Map();
    let publishing = false;
    const appends = [];
    const session = {
      id: "sess-reenter",
      header: { cwd: "/tmp/ws-reenter" },
      surface: { nodes: [] },
      eventAt: () => undefined,
      deriveEventMessage: () => ({ content: [] }),
      append(type) {
        if (publishing) throw new Error("session append cannot reenter while another append is being published");
        appends.push(type);
      },
    };
    const pruner = {
      config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
      pruneSession() {
        session.append("compaction/prune"); // what the host pruner really does
        return { pruned: [{ seq: 1 }], charsRemoved: 5000 };
      },
    };
    const ctx = {
      logger: () => ({ info() {}, warn() {}, debug() {} }),
      get: (name) => (name === "toolResultPruner" ? pruner : undefined),
      on: (name, fn) => {
        handlers.set(name, fn);
        return () => handlers.delete(name);
      },
    };
    apply(ctx, { boundaryPrune: true, boundaryPruneMinRemaining: 0 });

    publishing = true; // emulate commit()
    try {
      handlers.get("session/event")(session, {
        type: "todo/write",
        data: { todos: [{ status: "completed" }] },
      });
    } finally {
      publishing = false;
    }
    await flushLog();
    assert.deepEqual(appends, ["compaction/prune"], "the prune landed after the publish window");
    const attempts = await readPruneAttempts();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].kind, "fired");
    assert.equal(attempts[0].pruned, 1);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});
