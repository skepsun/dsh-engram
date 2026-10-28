/**
 * Keyed corpus tests (eval/g6/make-round.mjs).
 *
 * The point of compiling a round from a secret is that publishing the generator
 * costs nothing: the code says how a round is built, the secret says what this
 * round is. That only holds if (a) the same secret always yields the same round,
 * (b) a different secret yields a different one, and (c) every task in the round
 * is discriminative — the reference implementation passes it and the natural
 * memory-free guess fails it. (c) is what make-round proves on every run; these
 * tests pin it so a change to a template cannot quietly ship a dead task.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const GENERATOR = path.join(ROOT, "eval/g6/make-round.mjs");
const SHARED = fs.mkdtempSync(path.join(os.tmpdir(), "g6-shared-"));
const SHARED_RESULT = spawnSync(process.execPath, [GENERATOR, "--secret", "shared-secret-5c81de02", "--name", "rr", "--out", SHARED], {
  encoding: "utf8",
  timeout: 300000,
});

function compile(secret, name, out) {
  const res = spawnSync(process.execPath, [GENERATOR, "--secret", secret, "--name", name, "--out", out], { encoding: "utf8", timeout: 300000 });
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

function readKey(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "key.json"), "utf8"));
}

test("the same secret compiles the same round, twice", () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "g6-a-"));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), "g6-b-"));
  const secret = "test-secret-4b19c7de2f8a";
  assert.equal(compile(secret, "rr", a).status, 0);
  assert.equal(compile(secret, "rr", b).status, 0);
  const ka = readKey(a);
  const kb = readKey(b);
  assert.deepEqual(ka.tasks.map((t) => t.params), kb.tasks.map((t) => t.params), "same secret ⇒ same conventions");
  assert.deepEqual(ka.tasks.map((t) => t.id), kb.tasks.map((t) => t.id));
});

test("a different secret compiles a different round", () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "g6-a-"));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), "g6-b-"));
  assert.equal(compile("secret-one-0123456789ab", "rr", a).status, 0);
  assert.equal(compile("secret-two-0123456789ab", "rr", b).status, 0);
  const pa = readKey(a).tasks.map((t) => JSON.stringify(t.params));
  const pb = readKey(b).tasks.map((t) => JSON.stringify(t.params));
  const differing = pa.filter((params, index) => params !== pb[index]).length;
  // Not "at least one": a round is only private if the conventions a reader of
  // the other round could carry over are mostly wrong.
  assert.ok(differing >= 7, `expected most tasks to differ, got ${differing}/9`);
});

test("every compiled task is discriminative: the guess fails, the reference passes", () => {
  const dir = SHARED;
  const res = { status: SHARED_RESULT.status, out: `${SHARED_RESULT.stdout ?? ""}${SHARED_RESULT.stderr ?? ""}` };
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /9\/9 tasks usable/);
  // The generator grades both sides itself, so reaching here means each task has:
  // reference → 0 failures, guess → at least one. Re-verify the artefacts exist,
  // because a round with a missing oracle would grade every arm as a crash.
  for (const task of readKey(dir).tasks) {
    assert.ok(fs.existsSync(path.join(dir, "oracle", `${task.id}.test.mjs`)), `oracle for ${task.id}`);
    assert.ok(fs.existsSync(path.join(dir, "ref", path.basename(task.id) + ".js")) || fs.existsSync(path.join(dir, "ref", `${task.id}.js`)), `reference for ${task.id}`);
  }
});

test("a compiled task's check stays portable: it names the repo, not this machine", () => {
  const dir = SHARED;
  const tasks = JSON.parse(fs.readFileSync(path.join(dir, "tasks.json"), "utf8")).tasks;
  for (const task of tasks) {
    assert.match(task.check, /\$\{REPO\}/, `${task.id} must use \${REPO}`);
    assert.ok(!task.check.includes(ROOT), `${task.id} leaked this checkout's path`);
    // The oracle directory is relative to eval/g6 on purpose: an absolute path
    // makes every arm fail on another machine (round 6, seam #9).
    assert.ok(!/--dir\s*\//.test(task.check), `${task.id} names its oracle by absolute path`);
  }
});

test("an oracle only asserts what the memory and the prompt state", () => {
  // Both guards exist because the first keyed round's smoke failed the TREATMENT
  // arm twice: pad's oracle demanded a TypeError the memory never mentioned, and
  // errcode's oracle demanded a return value for a function the prompt told the
  // arm to throw from. Neither was a model failure.
  const dir = SHARED;
  const key = readKey(dir);
  for (const task of key.tasks) {
    const oracle = fs.readFileSync(path.join(dir, "oracle", `${task.id}.test.mjs`), "utf8");
    if (/TypeError/.test(oracle)) {
      assert.match(task.describe, /TypeError/, `${task.id}: oracle rejects, memory must say so`);
    }
    if (/must throw, not return/.test(oracle)) {
      assert.match(task.describe, /throw/, `${task.id}: oracle expects a throw, memory must say so`);
    }
  }
  const tasks = JSON.parse(fs.readFileSync(path.join(dir, "tasks.json"), "utf8")).tasks;
  for (const task of tasks) {
    const oracle = fs.readFileSync(path.join(dir, "oracle", `${task.id}.test.mjs`), "utf8");
    const fns = new Set([...oracle.matchAll(/mod\.([A-Za-z_$][\w$]*)\(/g)].map((match) => match[1]));
    for (const fn of fns) assert.ok(task.prompt.includes(`${fn}(`), `${task.id}: prompt never names ${fn}()`);
  }
});

test("the round's conventions appear in the memory text, not in the workspace", () => {
  const dir = SHARED;
  const key = readKey(dir);
  const memories = JSON.parse(fs.readFileSync(path.join(dir, "seed-memory.json"), "utf8"));
  assert.ok(Array.isArray(memories), "the seeder walks an array; a wrapper object seeds nothing");
  assert.equal(memories.length, key.tasks.length);
  assert.equal(memories[0].signal, 0.9, "signal is a confidence number, not a tag");
  for (const task of key.tasks) {
    const memory = memories.find((entry) => entry.tags.includes(task.id));
    assert.ok(memory, `no memory for ${task.id}`);
    assert.equal(memory.text, `${task.id} 约定：${task.describe}`, "the memory states the drawn convention verbatim");
    assert.ok(memory.tags.includes("seeded"), "tagged so the seed is recognisable in the store");
  }
});
