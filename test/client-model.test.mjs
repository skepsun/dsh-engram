/**
 * dsh-engram: unit tests for the shared client ESR model (lib/esrModel.mjs,
 * compiled from client/src/esrModel.ts by `npm run build:client`).
 *
 * This is the regression net for the client-side logic that used to live
 * inside the React views untested — 0.3.4's board-stale-tasks bug was exactly
 * such untested view logic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTasksMarkdown, blockedBy, fmtDateShort, shortAgent, shortId, taskGaps, POLL_MS } from "../lib/esrModel.mjs";

function task(over = {}) {
  return {
    id: over.id ?? "tsk_abc",
    workspace: "/w",
    name: "n",
    description: "",
    state: "active",
    artifact: null,
    evaluation: null,
    memoryRefs: [],
    createdAt: 1000,
    updatedAt: 1000,
    deps: [],
    assignee: null,
    claimedAt: null,
    summary: null,
    snapshot: null,
    ...over,
  };
}

test("esr-model: POLL_MS is the single shared refresh interval", () => {
  assert.equal(POLL_MS, 20000);
});

test("esr-model: taskGaps reports the three evidence gates", () => {
  assert.deepEqual(taskGaps(task()), ["artifact", "evaluation", "memory_ref"]);
  assert.deepEqual(taskGaps(task({ artifact: "a.md" })), ["evaluation", "memory_ref"]);
  assert.deepEqual(taskGaps(task({ artifact: "a.md", evaluation: "ok" })), ["memory_ref"]);
  assert.deepEqual(taskGaps(task({ artifact: "a.md", evaluation: "ok", memoryRefs: ["#1"] })), []);
  // empty-but-present memoryRefs still counts as a gap
  assert.deepEqual(taskGaps(task({ memoryRefs: [] })), ["artifact", "evaluation", "memory_ref"]);
  // stable tasks carry evidence through, so no gaps
  assert.deepEqual(taskGaps(task({ state: "stable", artifact: "x", evaluation: "y", memoryRefs: ["#1"] })), []);
});

test("esr-model: shortId truncates long ids and keeps short ones", () => {
  assert.equal(shortId("abc"), "abc");
  assert.equal(shortId("tsk_0123456789abcdef"), "tsk_01…cdef");
});

test("esr-model: blockedBy counts open blocks/parent-of deps only", () => {
  const open = task({ id: "open" });
  const stableTarget = task({ id: "stableDep", state: "stable" });
  const t = task({
    id: "t",
    deps: [
      { id: "open", kind: "blocks" },
      { id: "open", kind: "parent-of" },
      { id: "stableDep", kind: "blocks" },
      { id: "open", kind: "relates-to" },
    ],
  });
  assert.equal(blockedBy(t, [open, stableTarget]), 2);
  assert.equal(blockedBy(task({ state: "stable" }), [open]), 0);
  assert.equal(blockedBy(task({ id: "solo" }), [open]), 0);
});

test("esr-model: shortAgent normalises session/agent ids", () => {
  assert.equal(shortAgent(null), "");
  assert.equal(shortAgent("session-c2380e5a"), "c2380e5a");
  assert.equal(shortAgent("agent-9f3a-1"), "9f3a-1");
  // …@suffix keeps only the segment after the last separator
  assert.equal(shortAgent("session-c2380e5a@web"), "web");
  assert.equal(shortAgent("plain"), "plain");
});

test("esr-model: fmtDateShort renders a readable date or en-dash", () => {
  assert.equal(fmtDateShort(0), "–");
  assert.match(fmtDateShort(Date.UTC(2026, 7, 26)), /月|Aug|8月/);
});

test("esr-model: buildTasksMarkdown exports sorted rows with escaped pipes", () => {
  const md = buildTasksMarkdown([
    task({ id: "active1", name: "a|b", state: "active", createdAt: 2000 }),
    task({ id: "draft1", name: "draft task", state: "draft", createdAt: 1000 }),
    task({ id: "stable1", name: "stable task", state: "stable", artifact: "p", evaluation: "ok", memoryRefs: ["#1"], createdAt: 1500 }),
  ]);
  assert.match(md, /^# ESR 任务导出/);
  assert.match(md, /\| 状态 \| 任务 \| 工作区 \| 证据缺口 \| 证据 \| 创建 \|/);
  // state sort is localeCompare order: active < draft < stable
  const activeAt = md.indexOf("a\\|b");
  const draftAt = md.indexOf("draft task");
  const stableAt = md.indexOf("stable task");
  assert.ok(activeAt !== -1 && draftAt !== -1 && stableAt !== -1);
  assert.ok(activeAt < draftAt && draftAt < stableAt, "rows sorted by state (localeCompare)");
  // pipe in the name is escaped
  assert.match(md, /a\\\|b/);
  // stable row shows all three evidence ticks
  assert.match(md, /artifact✓ · eval✓ · ref✓/);

  assert.match(buildTasksMarkdown([]), /\(无任务\)/);
});
