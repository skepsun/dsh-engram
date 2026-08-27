/**
 * dsh-engram goal-capture tests — DSH goal-domain integration: pure reducer
 * (goal/change → memory entry), the session/event listener wiring, and the
 * `/goals` API read surface.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { openEngramDomain } from "../lib/store.js";
import { goalChangeToMemory, installGoalCapture } from "../lib/goal-capture.js";
import { makeEngramRoutes, API_PREFIX } from "../lib/api.js";

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
  verifyArtifact: false,
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

test("goalChangeToMemory maps complete → handoff and block → error; others null", () => {
  const complete = goalChangeToMemory({
    kind: "goal/change", version: 1, operation: "complete",
    goal: { id: "g1", revision: 3, objective: "给 dsh-engram 加 CI", phase: "complete", maxGoalRounds: 5 },
    roundsStarted: 4, createdAt: 1, updatedAt: 2,
  });
  assert.equal(complete.kind, "handoff");
  assert.equal(complete.text, "goal complete: 给 dsh-engram 加 CI");
  assert.deepEqual(complete.tags, ["goal", "auto-captured", "complete"]);
  assert.equal(complete.signal, 0.6);

  const blocked = goalChangeToMemory({
    kind: "goal/change", version: 1, operation: "block",
    goal: { id: "g2", revision: 2, objective: "修复 CI", phase: "blocked", maxGoalRounds: 2, blockedReason: "runner 无权限" },
    createdAt: 1, updatedAt: 2,
  });
  assert.equal(blocked.kind, "error");
  assert.equal(blocked.text, "goal blocked: 修复 CI — runner 无权限");
  assert.deepEqual(blocked.tags, ["goal", "auto-captured", "blocked"]);
  assert.equal(blocked.signal, 0.4);

  for (const op of ["create", "edit", "pause", "resume", "clear"]) {
    assert.equal(
      goalChangeToMemory({ kind: "goal/change", operation: op, goal: { objective: "x", maxGoalRounds: 1 } }),
      null,
      `${op} must not sediment`,
    );
  }
  assert.equal(goalChangeToMemory({ kind: "other", operation: "complete" }), null);
  assert.equal(goalChangeToMemory({ kind: "goal/change", operation: "complete", goal: { objective: "  " } }), null);
  assert.equal(goalChangeToMemory(null), null);
  assert.equal(goalChangeToMemory("nope"), null);
});

test("installGoalCapture sediments goal/change events through the store adapter", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const stored = [];
  const adapter = {
    storeMemory(entry) {
      stored.push(entry);
      return domain.storeMemory({ ...entry, workspace: "/ws", sessionId: entry.sessionId, seq: 0 }, CONFIG).then((r) => r);
    },
  };
  const listeners = new Map();
  const ctx = {
    on(name, fn) {
      listeners.set(name, fn);
      return () => listeners.delete(name);
    },
  };
  const log = { warn: () => {} };
  const dispose = installGoalCapture(ctx, adapter, log);

  const session = { id: "sess-goal", header: { cwd: "/ws" } };
  const onEvent = listeners.get("session/event");
  assert.ok(typeof onEvent === "function");

  await onEvent(session, {
    type: "goal/change",
    data: { kind: "goal/change", version: 1, operation: "complete", goal: { id: "g1", revision: 1, objective: "ship engram 0.4", phase: "complete", maxGoalRounds: 3 }, createdAt: 1, updatedAt: 2 },
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].kind, "handoff");
  assert.match(stored[0].text, /ship engram 0.4/);
  assert.equal(domain.listMemories("/ws").length, 1);

  // Non-goal and non-terminal events are ignored.
  await onEvent(session, { type: "user/message", data: {} });
  await onEvent(session, { type: "goal/change", data: { kind: "goal/change", version: 1, operation: "create", goal: { objective: "x", maxGoalRounds: 1 } } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stored.length, 1, "no extra writes for ignored events");

  // A blocked goal sediments an error row.
  await onEvent(session, {
    type: "goal/change",
    data: { kind: "goal/change", version: 1, operation: "block", goal: { id: "g2", revision: 2, objective: "fix ci", phase: "blocked", maxGoalRounds: 2, blockedReason: "runner down" }, createdAt: 1, updatedAt: 2 },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stored.length, 2);
  assert.equal(domain.listMemories("/ws").filter((m) => m.kind === "error").length, 1);

  // A rejected store write must not throw into the session pipeline.
  const throwAdapter = { storeMemory: () => Promise.reject(new Error("domain not open")) };
  const ctx2 = { on: (n, fn) => { listeners.set(n, fn); return () => {}; } };
  installGoalCapture(ctx2, throwAdapter, { warn: () => {} });
  await listeners.get("session/event")(session, {
    type: "goal/change",
    data: { kind: "goal/change", version: 1, operation: "complete", goal: { id: "g3", revision: 1, objective: "x", phase: "complete", maxGoalRounds: 1 }, createdAt: 1, updatedAt: 2 },
  });
  assert.ok(true, "rejected write is contained");

  dispose();
  assert.equal(listeners.has("session/event"), false, "dispose removes the listener");
  await domain.close();
});

test("api: /goals returns goal-tagged sediment memories", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/ws", kind: "handoff", text: "goal complete: ship ci", tags: ["goal", "auto-captured", "complete"], sessionId: "s", seq: 1, signal: 0.6 }, CONFIG);
  await domain.storeMemory({ workspace: "/ws", kind: "error", text: "goal blocked: fix e2e — runner down", tags: ["goal", "auto-captured", "blocked"], sessionId: "s", seq: 2, signal: 0.4 }, CONFIG);
  await domain.storeMemory({ workspace: "/ws", kind: "decision", text: "regular memory", tags: [], sessionId: "s", seq: 3, signal: 0.6 }, CONFIG);

  const service = { config: CONFIG, openedDomain: () => domain, getDomain: () => Promise.resolve(domain) };
  const routes = makeEngramRoutes(service);
  const r = res();
  const target = routes.find((rt) => rt.path === `${API_PREFIX}/goals`);
  await target.handler(req({ url: `${API_PREFIX}/goals?workspace=%2Fws` }), r);
  assert.equal(r._out.status, 200);
  const body = JSON.parse(r._out.body);
  assert.equal(body.items.length, 2);
  assert.ok(body.items.every((m) => /goal (complete|blocked)/.test(m.text)));
  await domain.close();
});

// ── tiny loopback stand-ins (mirror api.test.mjs) ──────────────────────────
function req({ url = "/", method = "GET" } = {}) {
  const stream = new Readable();
  stream._read = () => {};
  stream.method = method;
  stream.url = url;
  stream.socket = { remoteAddress: "127.0.0.1" };
  stream.headers = { host: "127.0.0.1:3080" };
  stream.push(null);
  return stream;
}

function res() {
  const out = { status: null, body: null };
  return {
    _out: out,
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers;
    },
    end(payload) {
      out.body = payload;
    },
  };
}
