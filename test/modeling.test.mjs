/**
 * dsh-engram entity-modeling guidance tests — the model-facing nudge that
 * keeps esr_node / esr_link in the decision space of agents doing task work.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { esrModelingHint } from "../lib/tools.js";

test("esrModelingHint pushes first-graph guidance when no entities exist", () => {
  const domain = { listEntities: () => [], allLinks: () => [] };
  const hint = esrModelingHint(domain, "/ws/x");
  assert.match(hint, /no entity graph/);
  assert.match(hint, /esr_node/);
  assert.match(hint, /esr_link/);
});

test("esrModelingHint shows existing graph and link invitation", () => {
  const domain = {
    listEntities: () => [{ name: "dsh-engram" }, { name: "esr" }, { name: "pi-loom" }, { name: "Kototoro" }],
    allLinks: () => [{ id: 1 }, { id: 2 }],
  };
  const hint = esrModelingHint(domain, "/ws/x");
  assert.match(hint, /entities dsh-engram, esr, pi-loom \+1/);
  assert.match(hint, /links 2/);
  assert.match(hint, /esr_link/);
});

test("esrModelingHint degrades to empty string when domain methods throw", () => {
  const domain = {
    listEntities: () => { throw new Error("boom"); },
    allLinks: () => [],
  };
  assert.equal(esrModelingHint(domain, "/ws/x"), "");
});

test("esr_task tool response carries the modeling hint (integration)", async () => {
  const { registerTools } = await import("../lib/tools.js");
  const calls = [];
  const tools = [];
  const ctx = {
    tools: { register: (t) => { tools.push(t); return () => calls.push(t); } },
    effect: (fn) => fn(),
  };
  const service = {
    config: { maxTasksPerWorkspace: 40 },
    getDomain: async () => ({
      getTask: () => void 0,
      activeTaskCount: () => 0,
      putTask: async () => {},
      listEntities: () => [],
      allLinks: () => [],
      bumpUsage: async () => {},
    }),
  };
  registerTools(ctx, service);
  const esrTask = tools.find((t) => t.name === "esr_task");
  assert.ok(esrTask, "esr_task registered");
  const out = await esrTask.execute(
    { name: "sample task" },
    { agent: { session: { id: "s", header: { cwd: "/ws/x" }, events: [] } } },
  );
  assert.match(out, /\[active\]/);
  assert.match(out, /modeling: no entity graph/);
});
