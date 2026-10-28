/**
 * The corpus is only evidence if two things hold: every task's oracle can be
 * satisfied by a correct implementation, and every task is decided by a fact
 * that exists only in the seeded memory.
 *
 * Both halves earn their keep here.
 *
 * - An oracle nobody can satisfy turns every arm into a failure. Two arms at
 *   0/0 is then reported as "两臂持平 — PASS", the silent fake verdict that
 *   §13.2 seam #8 was about; this test refuses to let a corpus get there.
 * - A task whose answer is guessable measures nothing but the model's priors
 *   (round 3: both arms read the same docstring and both scored 100%). So each
 *   task is also run against the naive implementation a competent agent writes
 *   without the memory, and that must FAIL.
 *
 * The reference implementations below are not shipped with the fixture — the
 * workspace the arm gets has only `throw new Error("not implemented")` stubs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FIXTURE = path.join(ROOT, "eval", "fixtures", "ledger-kata-blind");
const CHECK = path.join(ROOT, "eval", "g6", "check.mjs");
const TASKS = path.join(ROOT, "eval", "g6", "tasks-blind.json");
const SEEDS = path.join(ROOT, "eval", "g6", "seed-memory-blind.json");

// What a correct implementation looks like, written from the seeded memory only.
const CORRECT = {
  codec: `const CHARSET = "0123456789abcdefghijklmnopqrstuvwxyz";
export function encodeCheck(input) {
  let sum = 0;
  for (const ch of String(input)) sum += Number(ch) * 3 + 7;
  return \`\${input}-\${CHARSET[sum % 36]}\`;
}`,
  errcode: `export function fail(code, message, details) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) throw new TypeError(\`E_BAD_CODE: \${code}\`);
  const error = new Error(\`E_\${code}: \${message}\`);
  error.code = code;
  error.details = details ?? {};
  throw error;
}`,
  money: `export function toCents(amount) {
  const scaled = Math.abs(amount) * 100;
  return Math.sign(amount) * Math.round(scaled + Number.EPSILON * scaled);
}
export function sumAmounts(amounts) {
  return amounts.reduce((sum, amount) => sum + toCents(amount), 0) / 100;
}`,
  ranking: `export function rankRows(rows) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (a.row.score !== b.row.score) return a.row.score - b.row.score;
      const byLength = String(b.row.id).length - String(a.row.id).length;
      return byLength !== 0 ? byLength : b.index - a.index;
    })
    .map((entry) => entry.row);
}`,
  pad: `export function formatId(n) {
  const body = String(Math.abs(n)).padStart(5, "0");
  return n < 0 ? \`L-\${body}C\` : \`L-\${body}\`;
}`,
  window: `const OFFSET_MIN = 8 * 60;
const CUTOVER_MIN = 4 * 60;
export function billingDate(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new TypeError("E_WINDOW: bad timestamp");
  return new Date(ms + (OFFSET_MIN - CUTOVER_MIN) * 60_000).toISOString().slice(0, 10);
}`,
  dedupe: `export function mergeRows(rows) {
  const order = [];
  const latest = new Map();
  for (const row of rows) {
    if (!latest.has(row.id)) order.push(row.id);
    latest.set(row.id, row);
  }
  return order.map((id) => latest.get(id));
}`,
  quote: `export function formatAmount(cents) {
  const abs = Math.abs(cents);
  const grouped = String(Math.floor(abs / 100)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, "'");
  const body = \`\${grouped}.\${String(abs % 100).padStart(2, "0")}\`;
  return cents < 0 ? \`(\${body})\` : body;
}`,
  retry: `export function shouldRetry(status, code, attempt) {
  if (attempt >= 3) return false;
  if (code === "E_VALIDATION") return false;
  if (code === "E_LEDGER_LOCKED") return true;
  if (status === 429) return true;
  return status >= 500 && status <= 599;
}`,
};

// What a competent agent writes WITHOUT the memory: plausible, and wrong.
const NAIVE = {
  codec: `export function encodeCheck(input) {
  let sum = 0;
  for (const ch of String(input)) sum += Number(ch) * 3 + 7;
  return \`\${input}-\${sum % 10}\`;
}`,
  errcode: `export function fail(code, message) { throw new Error(message); }`,
  money: `export function toCents(amount) { return Math.round(amount * 100); }
export function sumAmounts(amounts) { return amounts.reduce((a, b) => a + b, 0); }`,
  ranking: `export function rankRows(rows) { return [...rows].sort((a, b) => a.score - b.score); }`,
  pad: `export function formatId(n) { return \`L-\${String(n).padStart(5, "0")}\`; }`,
  window: `export function billingDate(iso) { return new Date(iso).toISOString().slice(0, 10); }`,
  dedupe: `export function mergeRows(rows) {
  const seen = new Map();
  for (const row of rows) if (!seen.has(row.id)) seen.set(row.id, row);
  return [...seen.values()];
}`,
  quote: `export function formatAmount(cents) { return (cents / 100).toFixed(2); }`,
  retry: `export function shouldRetry(status, code, attempt) { return attempt < 3 && status >= 500; }`,
};

const loadTasks = () => {
  const parsed = JSON.parse(fs.readFileSync(TASKS, "utf8"));
  return Array.isArray(parsed) ? parsed : parsed.tasks;
};

/** Copy the fixture, drop in one implementation, and grade it with the real oracle. */
const grade = (task, code) => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "g6-corpus-"));
  try {
    fs.cpSync(FIXTURE, ws, { recursive: true });
    fs.writeFileSync(path.join(ws, "src", `${task.id}.js`), code);
    const res = spawnSync(process.execPath, [CHECK, task.id, "--dir", "oracle-blind"], { cwd: ws, encoding: "utf8" });
    return res.status;
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
};

test("every task has an oracle and a seeded fact, and nothing is unaccounted for", () => {
  const tasks = loadTasks();
  const memories = JSON.parse(fs.readFileSync(SEEDS, "utf8"));
  const byTag = new Map();
  for (const memory of memories) {
    for (const tag of memory.tags ?? []) byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
  }
  assert.ok(tasks.length >= 8, `the corpus has ${tasks.length} tasks; §4 asks for 8+`);
  for (const task of tasks) {
    assert.ok(fs.existsSync(path.join(ROOT, "eval", "g6", "oracle-blind", `${task.id}.test.mjs`)), `${task.id}: oracle exists`);
    assert.ok(fs.existsSync(path.join(FIXTURE, "src", `${task.id}.js`)), `${task.id}: fixture stub exists`);
    assert.match(task.check, /\$\{REPO\}/, `${task.id}: check is portable`);
    assert.ok((byTag.get(task.id) ?? 0) > 0, `${task.id}: a seeded memory carries this task's tag`);
  }
  // …and every task-shaped tag belongs to a task: a memory whose task was renamed
  // away silently stops being recalled, and the treatment arm just gets dumber.
  const taskIds = new Set(tasks.map((task) => task.id));
  for (const tag of byTag.keys()) {
    if (tag === "seeded" || tag === "ledger-kata" || tag === "misc") continue;
    assert.ok(taskIds.has(tag), `memory tag "${tag}" matches no task`);
  }
});

test("every oracle is satisfiable and every task needs its memory", () => {
  for (const task of loadTasks()) {
    assert.equal(grade(task, CORRECT[task.id]), 0, `${task.id}: the correct implementation passes its oracle`);
    assert.notEqual(grade(task, NAIVE[task.id]), 0, `${task.id}: the memory-free guess fails, so the task measures knowledge`);
  }
});
