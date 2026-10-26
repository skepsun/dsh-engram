#!/usr/bin/env node
/**
 * G6 round-2 oracle: run a task's PRIVATE test, which never exists in the
 * agent's workspace.
 *
 * Why: round 1 put the tests in the repo, so both arms could read the spec and
 * both scored 100% — a ceiling, not a measurement. Here the spec lives only in
 * the seeded memory, so the arms differ by knowledge instead of by protocol
 * noise. The test is copied in AFTER the agent finished, so it cannot be read.
 *
 *   node eval/g6/check.mjs <task>        # cwd = the run's workspace
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const task = process.argv[2];
if (!task) {
  console.error("usage: check.mjs <task>");
  process.exit(2);
}
const ws = process.cwd();
// `--dir` lets a second corpus keep its oracles in its own folder; both corpora
// call the same helper so "how a run is graded" has exactly one implementation.
const dirIndex = process.argv.indexOf("--dir");
const oracleDir = dirIndex === -1 ? "oracle" : process.argv[dirIndex + 1];
const oracle = path.join(import.meta.dirname, oracleDir, `${task}.test.mjs`);
if (!fs.existsSync(oracle)) {
  console.error(`check: no oracle for "${task}"`);
  process.exit(2);
}
fs.mkdirSync(path.join(ws, "test"), { recursive: true });
fs.copyFileSync(oracle, path.join(ws, "test", `${task}.test.mjs`));
const res = spawnSync("node", ["--test", `test/${task}.test.mjs`], { cwd: ws, encoding: "utf8" });
process.stdout.write(res.stdout ?? "");
process.stderr.write(res.stderr ?? "");
process.exit(res.status ?? 1);
