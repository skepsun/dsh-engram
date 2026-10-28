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
# --dump-config: answer the way a real host would, so the same-endpoint check has
# something to read. AB_STUB_MIX=1 makes the two arms disagree (the failure the
# check exists for).
if [ "$3" = "--dump-config" ]; then
  target="local-vllm-61"
  [ "$AB_STUB_MIX" = "1" ] && target="local-vllm-$arm"
  echo "- id: agent-default-model"
  echo "  name: '@deepseek-ai/dsh-agent-default-model'"
  echo "  config:"
  echo "    provider: $target"
  echo "    model: deepseek-v4.1-flash-1017"
  exit 0
fi
case "${mode}" in
  perfect)   [ "$arm" = "on" ] && echo ok > ok.txt; [ "$arm" = "off" ] && echo ok > ok.txt ;;
  gap)       [ "$arm" = "on" ] && echo ok > ok.txt ;;
  hurt)      [ "$arm" = "off" ] && echo ok > ok.txt ;;
  none-ok)   echo nope > no.txt ;;
  quota)     echo 'dsh: QUOTA: Insufficient Balance (request_id: x)' >&2; exit 1 ;;
  quota-on)  if [ "$arm" = "on" ]; then echo 'dsh: QUOTA: Insufficient Balance (request_id: x)' >&2; exit 1; else echo ok > ok.txt; fi ;;
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
    // `--home` is explicit: without it a test run writes into the operator's real
    // experiment home (~/.dsh/quality-ab), which is where round 7 is prepared.
    [HARNESS, "run", "--tasks", tasks, "--workspace", workspace, "--arm", "on,off", "--seeds", "1", "--out", out, "--home", path.join(out, "home"), "--min-pairs", String(minPairs), ...extra],
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
  // The directory is named by a hash of (task, seed, arm) — neither the arm nor
  // the task is spelled out anywhere the arm can read. runs.json carries the
  // mapping, so the log is still findable by a human.
  const report = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  const row = report.rows.find((candidate) => candidate.task === "t1" && candidate.arm === "on");
  const dir = path.join(out, "runs", row.runKey);
  assert.ok(fs.existsSync(path.join(dir, "run.log")), "run.log kept per run");
  assert.ok(fs.existsSync(path.join(dir, "check.log")), "oracle output kept");
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
  // The seeds go into the TREATMENT arm's own home — that separation is the point.
  const store = JSON.parse(fs.readFileSync(path.join(home, "arms", "on", "storages", "dsh_engram.json"), "utf8"));
  const rows = Object.values(store.tables.memories);
  assert.ok(rows.length > 0, "the seed file reached the store");
  assert.ok(
    !fs.existsSync(path.join(home, "arms", "off", "storages", "dsh_engram.json")),
    "and the control's own home has no store to find — no hiding trick required",
  );
  for (const row of rows) {
    assert.equal(row.workspace, fs.realpathSync(row.workspace), "workspace key is spelled the way the arm computes it");
    assert.ok(fs.existsSync(row.workspace) && path.basename(row.workspace) === "ws", "key points at a real run workspace");
  }
});

/** A tasks file of our own, so `check` can be the thing under test. */
function customTask(check, out, extra = []) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ab-ws-"));
  fs.writeFileSync(path.join(ws, "README.md"), "fixture\n");
  const tasks = path.join(ws, "tasks.json");
  fs.writeFileSync(tasks, JSON.stringify({ tasks: [{ id: "t1", prompt: "nothing", check }] }));
  return spawnSync(
    process.execPath,
    [HARNESS, "run", "--tasks", tasks, "--workspace", ws, "--arm", "on,off", "--seeds", "1", "--out", out, "--min-pairs", "1", ...extra],
    { encoding: "utf8", env: { ...process.env, AB_DSH_BIN: path.join(stubDir("perfect"), "dsh") } },
  );
}

test("${REPO} in a check is expanded, so a corpus can move between machines", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  // Passes only if the placeholder became this checkout's absolute path.
  const res = customTask('test -f "${REPO}/eval/quality-ab.mjs"', out);
  assert.equal(res.status, 0, res.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  assert.equal(report.summary.on.rate, 1, "both arms pass when the check can find the oracle");
});

test("a check that names the oracle by absolute path is refused, not scored", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  // The shape of the bug: the corpus spelled the author's checkout, so every arm
  // failed on any other machine and the gate reported a tie as a PASS.
  const res = customTask("node /Users/someone/dsh-loom/eval/g6/check.mjs codec", out);
  assert.notEqual(res.status, 0, "the matrix must refuse to start");
  assert.match(res.stderr, /\$\{REPO\}/, "and say what to write instead");
});

/** Stub that records what the arm was told about its own environment. */
function envStub(dumpDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-stub-"));
  fs.writeFileSync(
    path.join(dir, "dsh"),
    `#!/bin/bash
# args: --profile <arm> <prompt>
arm="$2"
printf 'profile=%s session=%s shell=%s home=%s\\n' "$DSH_PROFILE" "$DSH_SESSION_ID" "$DSH_SHELL" "$DSH_HOME" > "${dumpDir}/$arm.txt"
exit 0
`,
    { mode: 0o755 },
  );
  return dir;
}

test("an arm inherits DSH_HOME and nothing else about whoever launched the matrix", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  const dump = fs.mkdtempSync(path.join(os.tmpdir(), "ab-dump-"));
  const { workspace, tasks } = fixture();
  const res = spawnSync(
    process.execPath,
    [HARNESS, "run", "--tasks", tasks, "--workspace", workspace, "--arm", "on,off", "--seeds", "1", "--out", out, "--min-pairs", "2", "--home", path.join(out, "home")],
    {
      encoding: "utf8",
      // The harness is normally launched BY a dsh session, so this is the real case:
      // the caller's identity sits in process.env and must not reach the arm.
      env: { ...process.env, DSH_PROFILE: "web", DSH_SESSION_ID: "session-abc", DSH_SHELL: "1", AB_DSH_BIN: path.join(envStub(dump), "dsh") },
    },
  );
  assert.equal(res.status, 0, res.stderr);
  const homes = new Map();
  for (const arm of ["on", "off"]) {
    const line = fs.readFileSync(path.join(dump, `${arm}.txt`), "utf8").trim();
    assert.match(line, /^profile= session= shell= home=\/.*home\/arms\/(on|off)$/, `arm ${arm} saw: ${line}`);
    homes.set(arm, line.slice(line.indexOf("home=") + 5));
  }
  // Two arms, two homes: sharing one was the structural leak that let a control
  // read the treatment's ledger, injections and session logs in the same matrix.
  assert.notEqual(homes.get("on"), homes.get("off"), "each arm boots in its own DSH_HOME");
});

test("--control-first runs every control before any treatment run", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  const { workspace, tasks } = fixture();
  const res = spawnSync(
    process.execPath,
    [HARNESS, "run", "--tasks", tasks, "--workspace", workspace, "--arm", "on,off", "--seeds", "1", "--out", out, "--min-pairs", "2", "--control-first"],
    { encoding: "utf8", env: { ...process.env, AB_DSH_BIN: path.join(stubDir("perfect"), "dsh") } },
  );
  assert.equal(res.status, 0, res.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  const order = report.rows.map((row) => row.arm);
  assert.deepEqual(order, ["off", "off", "on", "on"], "controls first: no treatment session exists while a control runs");
});

test("a run that never reached a model is excluded, not scored as an arm failure", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  const res = runHarness("quota", out);
  assert.equal(res.status, 0, res.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  assert.equal(report.infraRows, 4, "all four runs died without a model");
  assert.equal(report.summary.on.runs, 0, "so neither arm gets a denominator");
  assert.equal(report.deltaPp, null);
  assert.equal(report.gate.verdict, "未测", "an empty matrix is not a tie (and not a PASS)");
  assert.match(report.gate.note, /4 行基础设施失败未计入/);
  assert.equal(report.rows.length, 4, "the rows stay in the artifact for the audit trail");
});

test("--resume retries a row that never got a model, and does not double-count it", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  const first = runHarness("quota-on", out);
  assert.equal(first.status, 0, first.stderr);
  const before = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  assert.equal(before.summary.on.runs, 0, "the treatment never ran");
  assert.equal(before.summary.off.runs, 2, "the control did");

  // Resume with a host that works: only the infra rows should be paid for again,
  // and the retried row must REPLACE its dead self rather than join it.
  const { workspace, tasks } = fixture();
  const second = spawnSync(
    process.execPath,
    [HARNESS, "run", "--tasks", tasks, "--workspace", workspace, "--arm", "on,off", "--seeds", "1", "--out", out, "--min-pairs", "2", "--resume"],
    { encoding: "utf8", env: { ...process.env, AB_DSH_BIN: path.join(stubDir("perfect"), "dsh") } },
  );
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /resume: 2 runs reused/);
  const after = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  assert.equal(after.rows.length, 4, "four keys, four rows — the retry replaced the dead one");
  assert.equal(after.summary.on.runs, 2);
  assert.equal(after.summary.on.passes, 2);
  assert.equal(after.infraRows, 0);
});

test("two arms resolving different model targets are refused, not averaged", () => {
  // The 40-row artifact this prevents: 33 rows on one endpoint, 7 on another,
  // one Δ that blends the plugin with the serving stack.
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  const { workspace, tasks } = fixture();
  const res = spawnSync(
    process.execPath,
    [HARNESS, "run", "--tasks", tasks, "--workspace", workspace, "--arm", "on,off", "--seeds", "1", "--out", out, "--min-pairs", "2"],
    { encoding: "utf8", env: { ...process.env, AB_DSH_BIN: path.join(stubDir("perfect"), "dsh"), AB_STUB_MIX: "1" } },
  );
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /resolve different model targets/);
  assert.match(res.stderr, /serving stack, not the plugin/);
  assert.equal(fs.existsSync(path.join(out, "runs.json")), false, "nothing was measured, so nothing is recorded");
});

test("a run's own path does not name its arm, its task or its seed", () => {
  // §13.5's last residue: `arm-a/codec/seed-3/ws` told an arm which arm it was
  // in, what the task was called, and that a matrix was running. The run root is
  // a hash now; the mapping lives in runs.json.
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ab-out-"));
  const res = runHarness("perfect", out);
  assert.equal(res.status, 0, res.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, "runs.json"), "utf8"));
  const runsDir = path.join(out, "runs");
  const dirs = fs.readdirSync(runsDir);
  assert.equal(dirs.length, 4, "two tasks × two arms");
  for (const dir of dirs) {
    assert.match(dir, /^[0-9a-f]{8}$/, `run root ${dir} is opaque`);
    assert.ok(fs.existsSync(path.join(runsDir, dir, "ws")), "and still holds the workspace");
  }
  for (const row of report.rows) {
    assert.ok(dirs.includes(row.runKey), `row ${row.task}/${row.seed}/${row.arm} names its run dir`);
  }
  for (const forbidden of ["arm-a", "arm-b", "t1", "t2", "seed-0"]) {
    assert.ok(!dirs.includes(forbidden), `${forbidden} must not be a directory name`);
  }
});
