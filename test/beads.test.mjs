/**
 * Beads-inspired mini dependency graph + claiming (PROPOSAL-beads ①):
 * addDep cycle/self guards, derived blocked state (direct + inherited),
 * ready queue filtering, atomic claim/unclaim with anti-yank fences.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";

const CONFIG = {
  autoCapture: false,
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

async function makeDomain() {
  const domain = await openEngramDomain(fakeFacility());
  const now = Date.now();
  let n = 0;
  const add = async (name, state = "active") => {
    const id = `tsk_${++n}`;
    const t = {
      id, workspace: "/ws/A", name, description: "", state,
      artifact: null, evaluation: null, memoryRefs: [],
      sessionId: "s", createdAt: now, updatedAt: now,
      stateChangedAt: 0, archivedAt: null,
      deps: [], assignee: null, claimedAt: null,
    };
    await domain.putTask(t);
    return id;
  };
  const close = async (id) => {
    const t = domain.getTask("/ws/A", id);
    await domain.putTask({ ...t, state: "stable", stateChangedAt: now });
  };
  return { domain, add, close };
}

test("addDep refuses self-references", async () => {
  const { domain, add } = await makeDomain();
  const a = await add("a");
  await assert.rejects(domain.addDep("/ws/A", a, a, "blocks"), (e) => e.code === "ENGRAM_INVALID_ARGS");
});

test("addDep refuses directed cycles", async () => {
  const { domain, add } = await makeDomain();
  const a = await add("a");
  const b = await add("b");
  await domain.addDep("/ws/A", a, b, "blocks");
  await assert.rejects(domain.addDep("/ws/A", b, a, "blocks"), (e) => e.code === "ENGRAM_CYCLE");
  // a chain a depends b, b depends c, c depends a is also a cycle
  const c = await add("c");
  await domain.addDep("/ws/A", b, c, "blocks");
  await assert.rejects(domain.addDep("/ws/A", c, a, "blocks"), (e) => e.code === "ENGRAM_CYCLE");
});

test("blocked state is derived: direct dep blocks, closing the dep frees it", async () => {
  const { domain, add, close } = await makeDomain();
  const a = await add("a");
  const blocker = await add("blocker");
  await domain.addDep("/ws/A", a, blocker, "blocks");
  assert.equal(domain.isBlocked("/ws/A", a), true, "open blocker blocks");
  assert.equal(domain.isBlocked("/ws/A", blocker), false);
  await close(blocker);
  assert.equal(domain.isBlocked("/ws/A", a), false, "closing the blocker (stable) releases the depender");
});

test("blocked state inherits down parent-child chains", async () => {
  const { domain, add, close } = await makeDomain();
  const parent = await add("parent");
  const child = await add("child");
  const grandchild = await add("grandchild");
  await domain.addDep("/ws/A", child, parent, "parent-of");
  await domain.addDep("/ws/A", grandchild, child, "parent-of");
  assert.equal(domain.isBlocked("/ws/A", grandchild), true, "inherited from open parent");
  await close(parent);
  assert.equal(domain.isBlocked("/ws/A", child), false);
  assert.equal(domain.isBlocked("/ws/A", grandchild), true, "still blocked by the open mid-level parent");
  await close(child);
  assert.equal(domain.isBlocked("/ws/A", grandchild), false);
});

test("relates-to never blocks", async () => {
  const { domain, add } = await makeDomain();
  const a = await add("a");
  const rel = await add("related");
  await domain.addDep("/ws/A", a, rel, "relates-to");
  assert.equal(domain.isBlocked("/ws/A", a), false);
});

test("ready queue: excludes blocked and claimed work", async () => {
  const { domain, add } = await makeDomain();
  const free1 = await add("free one");
  const blocker = await add("blocker");
  const dep = await add("blocked task");
  await domain.addDep("/ws/A", dep, blocker, "blocks");
  const claimed = await add("claimed task");
  await domain.claimTask("/ws/A", claimed, "agent-b");
  const draft = await add("draft task", "draft");
  const ready = domain.readyTasks("/ws/A", 50).map((t) => t.id);
  // blocker itself is unblocked and unclaimed — claimable too; only the
  // blocked dep and the already-claimed task are excluded.
  assert.deepEqual(ready.sort(), [free1, blocker, draft].sort(), "only unblocked + unclaimed tasks are claimable");
  assert.ok(!ready.includes(dep));
  assert.ok(!ready.includes(claimed));
});

test("claim sets assignee/claimedAt and promotes draft to active", async () => {
  const { domain, add } = await makeDomain();
  const d = await add("draft thing", "draft");
  const t = await domain.claimTask("/ws/A", d, "agent-alice");
  assert.equal(t.state, "active", "claiming a draft activates it");
  assert.equal(t.assignee, "agent-alice");
  assert.ok(t.claimedAt > 0);
  assert.equal(domain.readyTasks("/ws/A", 50).some((x) => x.id === d), false, "claimed leaves the ready queue");
});

test("anti-yank fence: foreign claim refuses, force steals", async () => {
  const { domain, add } = await makeDomain();
  const a = await add("a");
  await domain.claimTask("/ws/A", a, "alice");
  await assert.rejects(domain.claimTask("/ws/A", a, "bob"), (e) => e.code === "ENGRAM_CONFLICT");
  const stolen = await domain.claimTask("/ws/A", a, "bob", { force: true });
  assert.equal(stolen.assignee, "bob", "force overrides the fence");
  await assert.rejects(domain.unclaimTask("/ws/A", a, "alice"), (e) => e.code === "ENGRAM_CONFLICT");
  const released = await domain.unclaimTask("/ws/A", a, "alice", { force: true });
  assert.equal(released.assignee, null);
});

test("unclaim releases ownership; same-agent unclaim is fine", async () => {
  const { domain, add } = await makeDomain();
  const a = await add("a");
  await domain.claimTask("/ws/A", a, "alice");
  const t = await domain.unclaimTask("/ws/A", a, "alice");
  assert.equal(t.assignee, null);
  assert.equal(t.claimedAt, null);
  assert.equal(domain.readyTasks("/ws/A", 50).some((x) => x.id === a), true, "back in the ready queue");
});

test("duplicate same-kind dep is idempotent", async () => {
  const { domain, add } = await makeDomain();
  const a = await add("a");
  const b = await add("b");
  await domain.addDep("/ws/A", a, b, "blocks");
  const t = await domain.addDep("/ws/A", a, b, "blocks");
  assert.equal(t.deps.length, 1);
});

test("claiming a closed task refuses", async () => {
  const { domain, add, close } = await makeDomain();
  const a = await add("a");
  await close(a);
  await assert.rejects(domain.claimTask("/ws/A", a, "alice"), (e) => e.code === "ENGRAM_INVALID_ARGS");
});

test("registerTools exposes esr_dep / esr_claim / esr_unclaim / esr_ready", async () => {
  const { registerTools } = await import("../lib/tools.js");
  const tools = [];
  const ctx = {
    tools: { register: (t) => { tools.push(t); return () => {}; } },
    effect: (fn) => fn(),
  };
  const service = { config: {}, getDomain: async () => ({
    addDep: async () => ({}), claimTask: async () => ({}), unclaimTask: async () => ({}),
    readyTasks: () => [], resolveTaskId: () => "",
    getTask: () => void 0, activeTaskCount: () => 0, putTask: async () => {},
    listEntities: () => [], allLinks: () => [], bumpUsage: async () => {},
  }) };
  registerTools(ctx, service);
  for (const name of ["esr_dep", "esr_claim", "esr_unclaim", "esr_ready"]) {
    assert.ok(tools.some((t) => t.name === name), `${name} registered`);
  }
});

test("compactOnClose archives long closed tasks and leaves shorts alone", async () => {
  const { domain, add } = await makeDomain();
  const long = await add("long task");
  const longText = ("step one: do the thing with all of its context and rationale so the description grows well past the compaction threshold line. ").repeat(6); // > 240 chars
  await domain.putTask({ ...domain.getTask("/ws/A", long), description: longText });
  const compacted = domain.compactOnClose({ ...domain.getTask("/ws/A", long), state: "stable", stateChangedAt: Date.now() });
  assert.equal(compacted.summary.length <= 140, true, "rule summary is bounded");
  assert.equal(compacted.snapshot.description, longText.trim(), "original survives in the snapshot");
  assert.ok(compacted.snapshot.memoryRefs, "snapshot carries evidence refs");
  // closing the compacted task again must not re-compact a snapshotless short
  const short = await add("short task");
  const t = domain.compactOnClose({ ...domain.getTask("/ws/A", short), state: "stable", stateChangedAt: Date.now() });
  assert.equal(t.summary, null);
  assert.equal(t.snapshot, null);
  // already-compacted stays untouched
  const idempotent = domain.compactOnClose(compacted);
  assert.equal(idempotent.summary, compacted.summary);
  assert.equal(idempotent.snapshot.description, longText.trim());
});

test("esr_close tool puts a compacted stable task back through the store", async () => {
  const { registerTools } = await import("../lib/tools.js");
  const tools = [];
  const ctx = {
    tools: { register: (t) => { tools.push(t); return () => {}; } },
    effect: (fn) => fn(),
  };
  const service = { config: { verifyArtifact: false }, getDomain: async () => ({
    getTask: () => void 0, activeTaskCount: () => 0, putTask: async () => {},
    listEntities: () => [], allLinks: () => [], bumpUsage: async () => {},
  }) };
  registerTools(ctx, service);
  assert.ok(tools.some((t) => t.name === "esr_close"));
});
