/**
 * JIT push tests (lib/jit.js) — deterministic rules, no LLM, no I/O.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createJit } from "../lib/jit.js";

function session(id = "s1", cwd = "/ws") {
  return { id, header: { cwd } };
}

function exec(sess, name, args) {
  return { name, arguments: args, agent: { session: sess } };
}

function memory(overrides = {}) {
  return {
    id: "abc12345",
    kind: "error",
    status: "active",
    text: "npm test failed: 3 assertions",
    tags: ["error", "cmd:npm_test"],
    filePath: null,
    ...overrides,
  };
}

function domain({ memories = [], tasks = [] } = {}) {
  return {
    searchMemories({ tag } = {}) {
      return memories.filter((m) => Array.isArray(m.tags) && m.tags.includes(tag));
    },
    listMemories() {
      return memories;
    },
    listTasks() {
      return tasks;
    },
  };
}

test("error recurrence: pushes only on the second failure, and only with prior knowledge", () => {
  const pushes = [];
  const jit = createJit({ onPush: (p) => pushes.push(p) });
  const sess = session();
  const db = domain({ memories: [memory()] });
  const call = () => jit.observeToolResult(exec(sess, "bash", { command: "npm test -- foo" }), { isError: true }, db);

  call();
  assert.equal(jit.textFor(sess), "", "first failure is silent");
  call();
  const text = jit.textFor(sess);
  assert.match(text, /failed again ×2/);
  assert.match(text, /#abc12345/);
  assert.match(text, /engram_detail abc12345/);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].kind, "error");
  assert.equal(pushes[0].workspace, "/ws");

  call();
  assert.equal(pushes.length, 1, "third failure does not re-push");
});

test("error recurrence: no prior memory → silence", () => {
  const jit = createJit();
  const sess = session();
  const db = domain();
  const call = () => jit.observeToolResult(exec(sess, "bash", { command: "make build" }), { isError: true }, db);
  call();
  call();
  assert.equal(jit.textFor(sess), "");
  assert.equal(jit.stats().pushes, 0);
});

test("error recurrence prefers a fixed: procedure over the raw error", () => {
  const jit = createJit();
  const sess = session();
  const db = domain({
    memories: [
      memory({ id: "err00001", kind: "error", text: "npm test failed" }),
      memory({ id: "fix00001", kind: "procedure", text: "fixed: npm test — 1 earlier failing run now succeed" }),
    ],
  });
  const call = () => jit.observeToolResult(exec(sess, "bash", { command: "npm test" }), { isError: true }, db);
  call();
  call();
  assert.match(jit.textFor(sess), /procedure #fix00001/);
});

test("file focus: pushes on the second consecutive edit of the same path", () => {
  const jit = createJit();
  const sess = session();
  const db = domain({
    memories: [memory({ id: "fact0001", kind: "fact", text: "a.ts uses strict mode", filePath: "/ws/src/a.ts" })],
  });
  const edit = () => jit.observeToolResult(exec(sess, "edit", { path: "/ws/src/a.ts" }), { isError: false }, db);

  edit();
  assert.equal(jit.textFor(sess), "", "one edit is noise");
  edit();
  const text = jit.textFor(sess);
  assert.match(text, /focus a\.ts ×2/);
  assert.match(text, /#fact0001/);
  edit();
  assert.equal(jit.textFor(sess).split("\n").length, 1, "same path does not re-push");
});

test("file focus prefers a preference and falls back to a dir-anchored fact", () => {
  const jit = createJit();
  const sess = session();
  const db = domain({
    memories: [
      memory({ id: "fact0002", kind: "fact", text: "dir fact", filePath: null, tags: ["dir:/ws/src"] }),
      memory({ id: "pref0002", kind: "preference", text: "use pnpm here", filePath: "/ws/src/a.ts" }),
    ],
  });
  const edit = () => jit.observeToolResult(exec(sess, "write", { path: "/ws/src/a.ts" }), {}, db);
  edit();
  edit();
  assert.match(jit.textFor(sess), /preference #pref0002/);
});

test("goal completion: surfaces remaining active tasks once", () => {
  const jit = createJit();
  const sess = session();
  const db = domain({
    tasks: [
      { id: "tsk_1", name: "ship ledger", state: "active" },
      { id: "tsk_2", name: "write docs", state: "active" },
      { id: "tsk_3", name: "old", state: "stable" },
    ],
  });
  const event = { type: "goal/change", data: { operation: "complete", goal: { objective: "x" } } };
  jit.observeEvent(sess, event, db);
  const text = jit.textFor(sess);
  assert.match(text, /goal complete — open: tsk_1 ship ledger; tsk_2 write docs · esr_status/);
  jit.observeEvent(sess, event, db);
  assert.equal(jit.textFor(sess).split("\n").length, 1, "one goal line per session");
});

test("goal completion without active tasks is silent", () => {
  const jit = createJit();
  const sess = session();
  const db = domain({ tasks: [{ id: "tsk_1", name: "done", state: "stable" }] });
  jit.observeEvent(sess, { type: "goal/change", data: { operation: "complete", goal: {} } }, db);
  assert.equal(jit.textFor(sess), "");
});

test("budget: maxLines, maxLineChars and append-only determinism", () => {
  const jit = createJit({ maxLines: 1, maxLineChars: 40 });
  const sess = session();
  const db = domain({ memories: [memory()], tasks: [{ id: "tsk_1", name: "x", state: "active" }] });
  const fail = () => jit.observeToolResult(exec(sess, "bash", { command: "npm test" }), { isError: true }, db);
  fail();
  fail();
  const first = jit.textFor(sess);
  assert.ok(first.length <= 40, `line is clipped (${first.length} <= 40)`);
  jit.observeEvent(sess, { type: "goal/change", data: { operation: "complete", goal: {} } }, db);
  assert.equal(jit.textFor(sess), first, "maxLines=1 blocks the second push and never edits the first");
});

test("dispose forgets the session; malformed inputs never throw", () => {
  const jit = createJit();
  const sess = session();
  const db = domain({ memories: [memory()] });
  const call = () => jit.observeToolResult(exec(sess, "bash", { command: "npm test" }), { isError: true }, db);
  call();
  call();
  assert.ok(jit.textFor(sess).length > 0);
  jit.dispose("s1");
  assert.equal(jit.textFor(sess), "");
  assert.doesNotThrow(() => {
    jit.observeToolResult(null, null, null);
    jit.observeEvent(null, null, null);
    jit.observeEvent(sess, { type: "goal/change", data: { operation: "complete", goal: {} } }, null);
  });
});
