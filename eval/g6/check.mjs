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
// `resolve` (not `join`): a corpus generated from a secret lives wherever the
// operator put it, so `--dir` may be absolute or relative to this file.
const oracle = path.resolve(import.meta.dirname, oracleDir, `${task}.test.mjs`);
if (!fs.existsSync(oracle)) {
  console.error(`check: no oracle for "${task}"`);
  process.exit(2);
}
fs.mkdirSync(path.join(ws, "test"), { recursive: true });
const target = path.join(ws, "test", `${task}.test.mjs`);
fs.copyFileSync(oracle, target);
// Grade in a clean child. If the harness itself runs under a test runner, the
// environment carries NODE_TEST_CONTEXT, and a nested `node --test` then starts
// as a test child and runs NOTHING — exiting 0, which would grade every stub as
// a pass. Caught by test/g6-corpus.test.mjs, which grades the naive
// implementation and expects it to fail.
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
delete env.NODE_OPTIONS;
const res = spawnSync("node", ["--test", `test/${task}.test.mjs`], { cwd: ws, encoding: "utf8", env });
// The oracle must not outlive the grading: round 4 leaked it into the NEXT run's
// reach through a previous run's workspace, and a control arm read the expected
// values straight out of the copy. Grading artefacts are for the harness only.
fs.rmSync(target, { force: true });
process.stdout.write(res.stdout ?? "");
process.stderr.write(res.stderr ?? "");
process.exit(res.status ?? 1);
