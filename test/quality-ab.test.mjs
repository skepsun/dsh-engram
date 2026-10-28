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
import { spawn, spawnSync } from "node:child_process";

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

function runHarness(mode, out, minPairs = 2, extra = []) {
  const { workspace, tasks } = fixture();
  return spawnSync(
    process.execPath,
    [HARNESS, "run", "--tasks", tasks, "--workspace", workspace, "--arm", "on,off", "--seeds", "1", "--out", out, "--min-pairs", String(minPairs), ...extra],
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

test("--resume reuses finished rows instead of paying for the matrix twice", () => {
  // Round 4 died to ENOSPC with most of the matrix already paid for. `--resume`
  // is the way back in — and it once did nothing: the block ran above `plan`'s
  // declaration, the TDZ ReferenceError was swallowed by its own catch, and the
  // "no runs.json" line made a full re-run look like a resume.
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  assert.equal(runHarness("gap", out).status, 0);
  const before = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  assert.equal(before.rows.length, 4);
  // Drop one row — what a matrix that died mid-run leaves behind.
  fs.writeFileSync(
    path.join(out, "runs.json"),
    JSON.stringify({ ...before, rows: before.rows.filter((_, i) => i !== 3) }),
  );
  const second = runHarness("gap", out, 2, ["--resume"]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /resume: 3 runs reused from .*, 1 to do/, "three pairs were not re-run");
  const after = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  assert.equal(after.rows.length, 4, "the dropped pair was re-run, not dropped from the artifact");
  assert.equal(after.paired.pairs, 2);
});

test("refuses to start a matrix with no disk left", () => {
  // Round 4 and round 6 both died to ENOSPC with most of the matrix paid for.
  // Failing before the first model call is cheap; failing at 40% is hours.
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  const { workspace, tasks } = fixture();
  const res = spawnSync(
    process.execPath,
    [HARNESS, "run", "--tasks", tasks, "--workspace", workspace, "--arm", "on,off", "--seeds", "1", "--out", out],
    {
      encoding: "utf8",
      env: { ...process.env, AB_DSH_BIN: path.join(stubDir("perfect"), "dsh"), AB_MIN_FREE_MB: "999999999" },
    },
  );
  assert.equal(res.status, 2);
  assert.match(res.stderr, /only \d+ MB free/);
});

test("rows land in runs.json as they finish — a dead matrix still resumes", async () => {
  // `--resume` is only worth fixing if there is something to resume FROM: the
  // artifact used to be written once, after the last run, so a crash at 40%
  // (round 6) left nothing behind.
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ab-ws-rows-"));
  fs.writeFileSync(path.join(ws, "README.md"), "fixture\n");
  const tasks = path.join(ws, "tasks.json");
  fs.writeFileSync(
    tasks,
    JSON.stringify({
      tasks: [
        { id: "t1", prompt: "produce ok.txt", check: "test -f ok.txt" },
        { id: "t2", prompt: "produce ok.txt", check: "test -f ok.txt" },
        // The matrix parks here long enough for the test to read the artifact
        // while the process is still alive — i.e. the "crash" is simulated by
        // looking, then killing.
        { id: "t3", prompt: "produce ok.txt", check: "sleep 30" },
      ],
    }),
  );
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  const child = spawn(
    process.execPath,
    [HARNESS, "run", "--tasks", tasks, "--workspace", ws, "--arm", "on,off", "--seeds", "1", "--out", out, "--min-pairs", "1"],
    { env: { ...process.env, AB_DSH_BIN: path.join(stubDir("perfect"), "dsh") }, stdio: "ignore" },
  );
  const file = path.join(out, "runs.json");
  let seen = null;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      try {
        const report = JSON.parse(fs.readFileSync(file, "utf8"));
        if ((report.rows?.length ?? 0) >= 4) {
          seen = report;
          break;
        }
      } catch {
        // mid-rename: the next poll sees a complete file
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill("SIGKILL");
  assert.ok(seen, "runs.json already held the finished rows while the matrix was still running");
  assert.equal(seen.partial, true, "the in-flight artifact says so");
  assert.equal(seen.rows.length, 4, "task t1 and t2 × both arms, before t3's check parked");
});

test("seeded rows carry the RESOLVED workspace, or the treatment runs blind", () => {
  // macOS resolves `/tmp` to `/private/tmp`: the arm's cwd (getcwd) is the
  // resolved spelling, and the plugin keys memories by path.resolve(cwd). Seeds
  // written with the literal spelling never matched, so the "treatment" ran with
  // an empty index and scored like the control — while the harness reported that
  // it had seeded. Round 6's smoke caught it; this pins the fixed spelling.
  const base = process.platform === "darwin" ? "/tmp" : os.tmpdir();
  const out = fs.mkdtempSync(path.join(base, "ab-out-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-home-"));
  const seedFile = path.join(home, "seed.json");
  fs.writeFileSync(seedFile, JSON.stringify([{ kind: "fact", text: "team convention: x" }]));
  const { workspace, tasks } = fixture();
  const res = spawnSync(
    process.execPath,
    [HARNESS, "run", "--tasks", tasks, "--workspace", workspace, "--arm", "on,off",
      "--seeds", "1", "--out", out, "--home", home, "--seed-memory", seedFile, "--min-pairs", "1"],
    { encoding: "utf8", env: { ...process.env, AB_DSH_BIN: path.join(stubDir("perfect"), "dsh") } },
  );
  assert.equal(res.status, 0, res.stderr);
  const store = JSON.parse(fs.readFileSync(path.join(home, "storages", "dsh_engram.json"), "utf8"));
  const rows = Object.values(store.tables.memories);
  assert.ok(rows.length > 0, "the seed file reached the store");
  for (const row of rows) {
    assert.equal(row.workspace, fs.realpathSync(row.workspace), "workspace key is spelled the way the arm computes it");
    assert.ok(fs.existsSync(row.workspace) && path.basename(row.workspace) === "ws", "key points at a real run workspace");
  }
});
