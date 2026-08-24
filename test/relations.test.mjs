/**
 * dsh-engram relation-hygiene tests (fix A + B):
 *   - store.addLinkOnce: idempotent edge writes
 *   - wireTaskEntity: esr_task(entity=…) auto-creates the node + edge
 *   - esr_task tool: one call produces task + node + link, no duplicates
 *   - esr_dep tool: dependency is written BOTH to task.deps and the links
 *     table, so it shows up in the graph (the "only nodes, no relations" fix)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";
import { registerTools, wireTaskEntity, esrModelingHint } from "../lib/tools.js";

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
  maxTasksPerWorkspace: 40,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  expireDays: 180,
  verifyArtifact: false,
};

function registeredTools(domain) {
  const tools = new Map();
  const service = {
    config: CONFIG,
    getDomain: () => Promise.resolve(domain),
    openedDomain: () => domain,
    log: { warn: () => {} },
  };
  const ctx = { effect: (fn) => fn(), tools: { register: (tool) => { tools.set(tool.name, tool); return () => {}; } } };
  registerTools(ctx, service);
  return tools;
}

const execOf = (sid = "s1") => ({ agent: { session: { id: sid, header: { cwd: "/ws" }, events: { length: 1 } } } });

// ── store.addLinkOnce ────────────────────────────────────────────────────────
test("addLinkOnce is idempotent per (source, relation, target)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const link = { id: "l1", workspace: "/ws", source: "a", relation: "depends_on", target: "b", confidence: 1, sessionId: "s", createdAt: 1 };
  assert.equal(await domain.addLinkOnce(link), true, "first add writes");
  assert.equal(await domain.addLinkOnce({ ...link, id: "l2" }), false, "same edge is skipped");
  assert.equal(await domain.addLinkOnce({ ...link, id: "l3", relation: "refines" }), true, "different relation is a new edge");
  assert.equal(domain.allLinks("/ws").length, 2);
  await domain.close();
});

// ── wireTaskEntity ───────────────────────────────────────────────────────────
test("wireTaskEntity creates node (ent_<slug>, kind concept) + edge; idempotent", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const now = Date.now();
  const report = await wireTaskEntity(domain, "/ws", "tsk_1", "dsh-engram", "s1", now);
  assert.match(report, /wired: tsk_1 --relates_to--> ent_dsh-engram \(node created\)/);
  const node = domain.getEntity("/ws", "ent_dsh-engram");
  assert.ok(node, "node exists");
  assert.equal(node.kind, "concept");
  assert.equal(node.name, "dsh-engram");
  assert.equal(domain.allLinks("/ws").length, 1);

  const again = await wireTaskEntity(domain, "/ws", "tsk_1", "dsh-engram", "s1", now + 1);
  assert.match(again, /edge already exists/);
  assert.equal(domain.allLinks("/ws").length, 1, "edge not duplicated");
  assert.equal(domain.listEntities("/ws").length, 1, "node not duplicated");

  assert.equal(await wireTaskEntity(domain, "/ws", "tsk_2", "   ", "s1"), "", "blank entity → no-op");
  await domain.close();
});

// ── esr_task(entity=…) ───────────────────────────────────────────────────────
test("esr_task(entity=…) one call → task + node + edge, wired report", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const tools = registeredTools(domain);
  const out = await tools.get("esr_task").execute({ name: "fix boot", entity: "bootloader" }, execOf());
  assert.match(out, /task tsk_/);
  assert.match(out, /wired: tsk_[\s\S]* --relates_to--> ent_bootloader \(node created\)/);
  assert.ok(domain.listTasks("/ws", { includeStable: true }).length === 1);
  assert.equal(domain.listEntities("/ws")[0]?.id, "ent_bootloader");
  assert.equal(domain.allLinks("/ws")[0]?.relation, "relates_to");

  // updating the same task with the same entity must not duplicate edge/node
  const beforeLinks = domain.allLinks("/ws").length;
  const out2 = await tools.get("esr_task").execute({ name: "fix boot v2", id: domain.listTasks("/ws", { includeStable: true })[0].id, entity: "bootloader" }, execOf());
  assert.match(out2, /edge already exists/);
  assert.equal(domain.allLinks("/ws").length, beforeLinks);
  await domain.close();
});

test("esr_task without entity → isolated task, modeling hint still teaches the one-call wire", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const tools = registeredTools(domain);
  const out = await tools.get("esr_task").execute({ name: "plain task" }, execOf());
  assert.ok(!out.includes("wired:"), "no wiring, no entity");
  assert.match(out, /no entity graph/);
  assert.equal(domain.allLinks("/ws").length, 0);
  await domain.close();
});

// ── esr_dep double-write (fix A) ─────────────────────────────────────────────
test("esr_dep writes BOTH task.deps and the links table (graphed)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const tools = registeredTools(domain);
  const create = (name) => tools.get("esr_task").execute({ name }, execOf());
  const t1 = await create("task A");
  const t2 = await create("task B");
  const id1 = domain.listTasks("/ws", { includeStable: true }).find((t) => t.name === "task A").id;
  const id2 = domain.listTasks("/ws", { includeStable: true }).find((t) => t.name === "task B").id;

  const out = await tools.get("esr_dep").execute({ task_id: id1, dep_id: id2, kind: "blocks" }, execOf());
  assert.match(out, /now graphed/);
  const a = domain.listTasks("/ws", { includeStable: true }).find((t) => t.id === id1);
  assert.equal(a.deps.length, 1, "deps written for blocker logic");
  assert.ok(domain.allLinks("/ws").some((l) => l.source === id1 && l.target === id2 && l.relation === "blocks"), "edge visible in links table");

  // same dependency again → neither deps nor links duplicate
  await tools.get("esr_dep").execute({ task_id: id1, dep_id: id2, kind: "blocks" }, execOf());
  const a2 = domain.listTasks("/ws", { includeStable: true }).find((t) => t.id === id1);
  assert.equal(a2.deps.length, 1);
  assert.equal(domain.allLinks("/ws").filter((l) => l.source === id1 && l.target === id2).length, 1);
  await domain.close();
});

// ── modeling hint evolution ──────────────────────────────────────────────────
test("modeling hint flips once a node exists (esr_task(entity=…) creates it)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const tools = registeredTools(domain);
  const empty = await tools.get("esr_task").execute({ name: "t" }, execOf());
  assert.match(empty, /no entity graph/);
  await tools.get("esr_task").execute({ name: "t2", entity: "svc" }, execOf());
  const withGraph = esrModelingHint(domain, "/ws");
  assert.match(withGraph, /entities svc \/ links 1/);
  assert.match(withGraph, /esr_task\(entity=…\) hangs new work onto a node/);
  await domain.close();
});
