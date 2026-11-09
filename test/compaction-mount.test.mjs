/**
 * Compaction mount: the engine must be started by the LOADER, never `new`ed.
 *
 * WHY (issues #12 / #13): `BasicCompactionEngine` declares
 * `static inject = ["llm", "tokenMeter", "sessions"]` and reads all three
 * straight off `this.ctx` (`compactPressure()` starts with
 * `const meter = this.ctx.tokenMeter`). `static inject` is only honored when
 * cordis LOADS the class as a plugin — a manual `new Engine(ctx)` creates no
 * fiber, so nothing is provisioned and the first read throws
 * `cannot get property "tokenMeter" without inject` from the context proxy.
 * Optional chaining does not rescue it: the proxy throws on the property get.
 *
 * dsh-engram mounted the engine that way from the host plane (a fiber that
 * injects only `tools`), so on the backend that prepends an `agent/request`
 * listener every model switch in a long-enough session was rejected; on the
 * backend that reads the meter inside `agent/pre-step`, automatic compaction
 * silently warned and did nothing.
 *
 * These tests run against REAL cordis + the real backend (both are peer
 * dependencies), because the bug is a loader/injection bug that a hand-rolled
 * fake ctx cannot reproduce: the fake has no service guard.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { mountCompactionEngine, loadContextGcEngine } from "../lib/context-gc.js";

let Context;
let Basic;
try {
  ({ Context } = await import("@deepseek-ai/cordis"));
  ({ BasicCompactionEngine: Basic } = await import("@deepseek-ai/dsh-compaction-basic"));
} catch {
  // Peer deps are optional at install time; without them there is no loader to
  // test. `npm install` in this repo provides both.
}
const noPeers = Context === void 0 || Basic === void 0
  ? "needs @deepseek-ai/cordis and @deepseek-ai/dsh-compaction-basic (peer deps)"
  : false;

const llm = { resolveModelInfo: async () => ({ context: { contextWindow: 200_000 }, defaultMaxTokens: 8192 }) };
const meterCalls = [];
const tokenMeter = {
  measure(session) {
    meterCalls.push(session?.id);
    return { totalTokens: 0 };
  },
};
const sessions = { flush: async () => {} };

/** A session with a routed request — the shape `compactIfNeeded` measures. */
const routedAgent = (id = "sess-pressure") => ({
  session: {
    id,
    header: { cwd: "/w" },
    messages: [],
    events: [],
    requestHeader: () => ({ config: { provider: "deepseek", model: "deepseek-v4" } }),
  },
  options: {},
});

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

/** A service provider plugin (what `dsh-token-meter` and friends look like). */
const provider = (name, value) => ({
  name: `provider:${name}`,
  apply(ctx) {
    ctx.provide(name, value);
  },
});

/** Root context with the backend's deps provided, like a booted DSH host. */
async function bootRoot({ withMeter = true, withSessions = true, withLlm = true } = {}) {
  const root = new Context();
  if (withLlm) root.plugin(provider("llm", llm));
  if (withMeter) root.plugin(provider("tokenMeter", tokenMeter));
  if (withSessions) root.plugin(provider("sessions", sessions));
  root.plugin(provider("tools", { registered: true }));
  await tick();
  return root;
}

/** Run `mountCompactionEngine` the way the host plane does: from a tools-only fiber. */
async function mountFromHostPlane(root, config = {}) {
  const mounted = { class: undefined };
  root.plugin({
    name: "engram-host-plane",
    inject: ["tools"],
    async apply(ctx) {
      mounted.class = await mountCompactionEngine(ctx, { gcReplacesCompaction: true, ...config }, { readWorkspace: async () => null });
    },
  });
  await tick(60);
  return mounted;
}

test("the mounted engine can read its three declared services (issues #12/#13)", { skip: noPeers }, async () => {
  const root = await bootRoot();
  const mounted = await mountFromHostPlane(root);
  assert.ok(mounted.class, "the engine mounts from a tools-only fiber");

  const engine = root.get("compaction");
  assert.ok(engine, "the `compaction` service is registered");
  // The whole bug in one assertion: these three reads used to throw
  // `cannot get property "<name>" without inject`.
  assert.equal(engine.ctx.tokenMeter, tokenMeter, "tokenMeter is provisioned on the engine's own ctx");
  assert.equal(engine.ctx.sessions, sessions, "sessions is provisioned");
  assert.equal(engine.ctx.llm, llm, "llm is provisioned");
});

test("the pressure path measures through the injected meter, not a missing one", { skip: noPeers }, async () => {
  // End-to-end at the seam the issue reports: `compactIfNeeded()` starts with
  // `this.ctx.tokenMeter.measure(session)`. Before the fix that read threw, so
  // the pre-step handler logged "step compaction failed ... continuing the
  // turn" (silent no-op) or the request waterfall rejected the model switch.
  const root = await bootRoot();
  await mountFromHostPlane(root);
  const engine = root.get("compaction");
  meterCalls.length = 0;

  const result = await engine.compactIfNeeded(routedAgent(), "pressure", new AbortController().signal);
  assert.equal(result, null, "nothing to compact in an empty session");
  assert.deepEqual(meterCalls, ["sess-pressure"], "the meter the engine reads is the injected service");
});

test("negative control: the same path rejects when the engine is `new`ed on a tools-only ctx", { skip: noPeers }, async () => {
  const root = new Context();
  root.plugin(provider("llm", llm));
  root.plugin(provider("tokenMeter", tokenMeter));
  root.plugin(provider("sessions", sessions));
  root.plugin(provider("tools", {}));
  await tick();
  let engine;
  root.plugin({
    name: "manual-construction",
    inject: ["tools"],
    apply(ctx) {
      class Bare extends Basic {
        constructor() {
          super(ctx, { auto: false });
        }
      }
      engine = new Bare();
    },
  });
  await tick();
  await assert.rejects(
    () => engine.compactIfNeeded(routedAgent(), "pressure", new AbortController().signal),
    /without inject/,
  );
});

test("a sibling plugin injects `compaction` and gets the engram engine", { skip: noPeers }, async () => {
  const root = await bootRoot();
  await mountFromHostPlane(root);

  let seen;
  root.plugin({
    name: "agent-loop",
    inject: ["compaction"],
    apply(ctx) {
      seen = ctx.compaction;
    },
  });
  await tick(60);
  assert.ok(seen, "a consumer mounted AFTER the engine resolves it");
  assert.equal(typeof seen.summarize, "function");
  assert.equal(typeof seen.compactIfNeeded, "function", "it is the real backend, not a placeholder");
});

test("negative control: `new Engine(ctxWithoutInjects)` cannot read tokenMeter", { skip: noPeers }, async () => {
  // The exact shape engram shipped before this fix — kept as the failing half of
  // the regression, so nobody "fixes" a future failure by reverting to `new`.
  const root = new Context();
  root.plugin(provider("llm", llm));
  root.plugin(provider("tokenMeter", tokenMeter));
  root.plugin(provider("sessions", sessions));
  root.plugin(provider("tools", {}));
  await tick();

  let bare;
  root.plugin({
    name: "manual-construction",
    inject: ["tools"],
    apply(ctx) {
      class Bare extends Basic {
        constructor() {
          super(ctx, { auto: false });
        }
      }
      bare = new Bare();
    },
  });
  await tick();
  assert.ok(bare, "the direct construction succeeds (the service registers)");
  assert.throws(() => bare.ctx.tokenMeter, /without inject/, "and then the first read throws — the reported failure");
  assert.throws(() => bare.ctx.sessions, /without inject/);
});

test("a duplicate mount is refused and keeps the first engine", { skip: noPeers }, async () => {
  const root = await bootRoot();
  const first = await mountFromHostPlane(root);
  assert.ok(first.class);

  const second = await mountFromHostPlane(root);
  assert.equal(second.class, null, "the second registration is refused, not thrown");
  assert.equal(typeof root.get("compaction")?.summarize, "function", "the first engine is still there");
});

test("gcReplacesCompaction:false mounts the default summarizer with the same injects", { skip: noPeers }, async () => {
  const root = await bootRoot();
  const mounted = await mountFromHostPlane(root, { gcReplacesCompaction: false });
  assert.ok(mounted.class);
  const engine = root.get("compaction");
  assert.equal(engine._contextGc, undefined, "default mode carries no Context GC override");
  assert.equal(engine.ctx.tokenMeter, tokenMeter, "the default-mode class is provisioned too");
});

test("a host without the services leaves the mount pending instead of throwing", { skip: noPeers }, async () => {
  // Contract the status writer depends on: `mountCompactionEngine` neither
  // resolves nor rejects when an inject never arrives — index.js bounds the
  // wait for its status snapshot, because "pending" is the honest answer.
  const root = await bootRoot({ withMeter: false });
  const outcome = await Promise.race([
    mountFromHostPlane(root).then((r) => (r.class === undefined ? "still-pending" : r.class === null ? "null" : "mounted")),
    tick(150).then(() => "still-pending"),
  ]);
  assert.equal(outcome, "still-pending");
});

test("loadContextGcEngine keeps `new Engine()` working without a loader", { skip: noPeers }, async () => {
  // Unit-test fakes and vendored hosts have no `ctx.plugin`; the class must
  // still construct against the captured ctx (the fake-ctx contract).
  const fakeCtx = { logger: { info() {}, warn() {} }, get: () => undefined, on: () => () => {}, reflect: { provide() {} } };
  const Engine = await loadContextGcEngine(fakeCtx, { auto: false }, { narrativeEnabled: false });
  assert.ok(Engine);
  assert.deepEqual(Engine.inject, ["llm", "tokenMeter", "sessions"], "the class declares what its backend reads");
  assert.ok(new Engine(), "constructs without a loader");
});
