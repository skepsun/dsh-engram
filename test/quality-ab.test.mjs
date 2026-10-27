/**
 * G6 harness tests (eval/quality-ab.mjs) — the paired A/B runner must score
 * runs with the oracle, never guess, and refuse to judge unpaired data.
 *
 * A stub `dsh` stands in for the real one-shot runner so the plumbing (workspace
 * copy, setup, per-arm runs, check command, pairing) is verified without
 * spending tokens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HARNESS = new URL("../eval/quality-ab.mjs", import.meta.url).pathname;

/** Stub runner: the profile name decides whether the task "succeeds". */
function stubDir(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-stub-"));
  fs.writeFileSync(
    path.join(dir, "dsh"),
    `#!/bin/bash
# args: --profile <arm> <prompt>
arm="$2"
case "${mode}" in
  perfect)   [ "$arm" = "on" ] && echo ok > ok.txt; [ "$arm" = "off" ] && echo ok > ok.txt ;;
  gap)       [ "$arm" = "on" ] && echo ok > ok.txt ;;
  hurt)      [ "$arm" = "off" ] && echo ok > ok.txt ;;
  none-ok)   echo nope > no.txt ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  return dir;
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-ws-"));
  fs.writeFileSync(path.join(dir, "README.md"), "fixture\n");
  const tasks = path.join(dir, "tasks.json");
  fs.writeFileSync(
    tasks,
    JSON.stringify({
      tasks: [
        { id: "t1", prompt: "produce ok.txt", check: "test -f ok.txt" },
        { id: "t2", prompt: "produce ok.txt", check: "test -f ok.txt" },
      ],
    }),
  );
  return { workspace: dir, tasks };
}

function runHarness(mode, out, minPairs = 2) {
  const { workspace, tasks } = fixture();
  return spawnSync(
    process.execPath,
    [HARNESS, "run", "--tasks", tasks, "--workspace", workspace, "--arm", "on,off", "--seeds", "1", "--out", out, "--min-pairs", String(minPairs)],
    { encoding: "utf8", env: { ...process.env, AB_DSH_BIN: path.join(stubDir(mode), "dsh") } },
  );
}

test("identical arms score Δ=0pp and PASS the 2pp gate", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  const res = runHarness("perfect", out);
  assert.equal(res.status, 0, res.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  assert.equal(report.paired.pairs, 2, "two task×seed pairs, both arms ran in each");
  assert.equal(report.deltaPp, 0);
  assert.equal(report.gate.verdict, "PASS");
  assert.equal(report.summary.on.rate, 1);
});

test("a positive gap shows up as the paired delta and PASSES (the gate is one-sided)", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  const res = runHarness("gap", out);
  assert.equal(res.status, 0, "memory carrying the answer is a gain, not a gate failure");
  const report = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  assert.equal(report.summary.on.rate, 1);
  assert.equal(report.summary.off.rate, 0);
  assert.equal(report.deltaPp, 100);
  assert.equal(report.paired.onlyA, 2, "both pairs are on-only wins");
  assert.equal(report.gate.verdict, "PASS");
  assert.equal(report.gate.target, "Δ ≥ −2pp");
  assert.match(report.gate.note, /记忆带去了可用的信息/);
});

test("the gate fails only when the mounted arm is WORSE", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  const res = runHarness("hurt", out);
  assert.equal(res.status, 1, "a −100pp delta fails the gate");
  const report = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  assert.equal(report.deltaPp, -100);
  assert.equal(report.paired.onlyB, 2, "both pairs are off-only wins");
  assert.equal(report.gate.verdict, "FAIL");
});

test("when both arms fail everywhere the gate is a tie, not a fake pass on 0/0", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  const res = runHarness("none-ok", out);
  assert.equal(res.status, 0);
  const report = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  assert.equal(report.summary.on.passes, 0);
  assert.equal(report.deltaPp, 0);
  assert.equal(report.gate.verdict, "PASS", "0pp is a tie; a tie does not violate Δ ≥ −2pp");
});

test("the harness writes every run log so a verdict can be audited", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  runHarness("gap", out);
  // Directories are named by a neutral label, never by the arm: a control that
  // could read `ab-bare` in its own cwd went looking for the memory it lacked.
  const log = path.join(out, "arm-a", "t1", "seed-0", "run.log");
  assert.ok(fs.existsSync(log), "run.log kept per label/task/seed");
  assert.ok(fs.existsSync(path.join(out, "arm-a", "t1", "seed-0", "check.log")), "oracle output kept");
  assert.ok(fs.existsSync(path.join(out, "REPORT.md")));
});

test("below the pair floor the gate refuses to judge — a tie on 2 runs is not quality evidence", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  const res = runHarness("perfect", out, 10);
  assert.equal(res.status, 0);
  const report = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  assert.equal(report.paired.pairs, 2);
  assert.equal(report.gate.verdict, "未测");
  assert.match(fs.readFileSync(path.join(out, "REPORT.md"), "utf8"), /not a quality measurement/);
});
