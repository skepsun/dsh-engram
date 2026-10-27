#!/usr/bin/env node
/**
 * G6 — Quality Δ: paired A/B runs.
 *
 * G6 is the only gate that cannot be derived from logs: it asks whether the
 * engram prompt surface changes task outcomes. That needs paired runs — same
 * task, same seed, two profiles (engram mounted / not), scored by an oracle the
 * harness can check without an LLM in the loop.
 *
 * This tool does not invent a task corpus. It runs the one you give it, keeps
 * every run's log, and refuses to report a delta from unpaired data.
 *
 *   node eval/quality-ab.mjs prepare --arm on=engram-on,off=engram-off [--home DIR]
 *   node eval/quality-ab.mjs run --tasks tasks.json --workspace ./fixture \
 *        --arm on,off --seeds 3 --out runs/g6
 *
 * tasks.json:
 *   { "tasks": [ { "id": "fix-import", "prompt": "…", "setup": "git checkout .",
 *                  "check": "npm test --silent", "timeoutMs": 600000 } ] }
 *
 * `check` must exit 0 for a pass. `setup` runs in the copied workspace before
 * the agent starts, so one fixture can serve many tasks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildConfinedProfile } from "./g6/sandbox-profile.mjs";

/** Repo root — the directory this harness lives in, i.e. what a blind run must not read. */
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const DSH_BIN = process.env.AB_DSH_BIN || "dsh";
const defaultHome = path.join(os.homedir(), ".dsh", "quality-ab");

function parseArgs(argv) {
  const out = { cmd: argv[0] ?? "", arm: {}, seeds: 1, home: defaultHome, out: null, timeoutMs: 900000, minPairs: 10 };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--tasks") out.tasks = next();
    else if (arg === "--workspace") out.workspace = next();
    else if (arg === "--seeds") out.seeds = Number(next()) || 1;
    else if (arg === "--out") out.out = next();
    else if (arg === "--home") out.home = next();
    else if (arg === "--timeout-ms") out.timeoutMs = Number(next()) || out.timeoutMs;
    else if (arg === "--seed-memory") out.seedMemory = next();
    else if (arg === "--hide-store-for") out.hideStoreFor = next();
    else if (arg === "--control-first") out.controlFirst = true;
    else if (arg === "--exclude") out.exclude = next().split(",").map((x) => x.trim()).filter(Boolean);
    else if (arg === "--log-dir") out.logDir = next();
    else if (arg === "--sandbox") out.sandbox = true;
    // Resume a matrix that died mid-flight (round 4 hit ENOSPC after the whole
    // control half): keep the rows already in <out>/runs.json, run only the
    // missing pairs.
    else if (arg === "--resume") out.resume = true;
    else if (arg === "--only-arm") out.onlyArm = next();
    // One task is not a quality measurement — same discipline as G1's row floor.
    else if (arg === "--min-pairs") out.minPairs = Number(next()) || 10;
    else if (arg === "--arm") {
      // prepare: on=engram-on,off=engram-off · run: on,off (profiles already made)
      const spec = next() ?? "";
      if (out.cmd === "prepare") {
        for (const pair of spec.split(",").filter(Boolean)) {
          const [name, profile] = pair.split("=");
          out.arm[name] = profile;
        }
      } else {
        out.armIds = spec.split(",").filter(Boolean);
      }
    }
  }
  return out;
}

/**
 * Prior run trees on this machine: every `/tmp` entry named `g6*` except the
 * current round's root and log dir. Cheap, and it cannot go stale the way a
 * hand-written list did.
 */
function discoverPriorTrees(ownRoot, ownLogs) {
  const own = new Set([path.basename(ownRoot)]);
  if (ownLogs !== undefined) own.add(path.basename(path.resolve(ownLogs)));
  try {
    return fs
      .readdirSync("/tmp")
      .filter((name) => name.startsWith("g6") && !own.has(name))
      .map((name) => path.join("/tmp", name));
  } catch {
    return ["/tmp/g6"];
  }
}

function dsh(args, { cwd, env, timeoutMs } = {}) {
  return spawnSync(DSH_BIN, args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Headless boots without the web Models page, so the provider route resolves its
 * key from the environment. Lift it from the host's credential store into the
 * child env — never printed, never written to the report.
 */
function liftCredential(env) {
  // A local deployment routes through vLLM, so the key that matters is whatever
  // the arm's provider row names in `apiKeyEnv` (LOCAL_VLLM_61_API_KEY here),
  // not necessarily DEEPSEEK_API_KEY. Lift every *_API_KEY in the store: they
  // live in this process's memory only — never printed, never written to the
  // report.
  const lifted = [];
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), ".dsh", ".credentials.yaml"), "utf8");
    for (const line of raw.split("\n")) {
      const match = /^\s+([A-Z][A-Z0-9_]*_API_KEY):\s*(\S.*)$/.exec(line);
      if (match === null) continue;
      const [, key, value] = match;
      if (env[key]) {
        lifted.push(`${key} (env)`);
        continue;
      }
      env[key] = value.trim().replace(/^["']|["']$/g, "");
      lifted.push(`${key} (credentials file)`);
    }
  } catch {
    // fall through: the caller reports what it has
  }
  return lifted.length === 0 ? null : lifted.join(", ");
}

/** Share the host's credential file without copying the secret out of ~/.dsh. */
function linkCredentials(home) {
  const real = path.join(os.homedir(), ".dsh", ".credentials.yaml");
  const link = path.join(home, ".credentials.yaml");
  if (!fs.existsSync(real)) return false;
  if (!fs.existsSync(link)) fs.symlinkSync(real, link);
  return true;
}

function prepare(args) {
  const home = args.home;
  if (args.sandbox) {
    // Prior runs' session logs live here and would be readable by the next run.
    // `--control-first` means only control sessions can exist at this point.
    fs.rmSync(path.join(home, "sessions"), { recursive: true, force: true });
  }
  fs.mkdirSync(home, { recursive: true });
  const profiles = Object.entries(args.arm);
  if (profiles.length !== 2) throw new Error("prepare needs --arm on=<profile>,off=<profile>");

  for (const [name, profile] of profiles) {
    const env = { ...process.env, DSH_HOME: home };
    fs.mkdirSync(path.join(home, "profiles"), { recursive: true });
    // Instantiate the one-shot headless template under this profile name.
    const created = dsh(["--profile", profile, "--from-default-profile", "headless", "--dump-config"], { env });
    if (created.status !== 0) {
      throw new Error(`could not create profile ${profile}: ${(created.stderr || created.stdout || "").trim().slice(0, 400)}`);
    }
    console.log(`profile ${profile} ready (${home}/profiles/${profile}) ${name === "on" ? "" : ""}`.trim());
  }
  const shared = linkCredentials(home);
  console.log(`credentials: ${shared ? "linked from ~/.dsh/.credentials.yaml" : "NOT FOUND — headless runs will fail with MISSING_CREDENTIAL"}`);
  console.log(`next: dsh plugin --profile ${args.arm.on} add ${path.join(os.homedir(), ".dsh", "vendor")}/dsh-engram-<version>.tgz`);
  console.log("      dsh plugin --profile off add (nothing) — the control arm stays bare");
}

function loadTasks(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const tasks = Array.isArray(parsed) ? parsed : parsed.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error(`${file}: no tasks`);
  for (const task of tasks) {
    if (!task.id || !task.prompt) throw new Error(`${file}: every task needs id + prompt`);
    if (!task.check) throw new Error(`${file}: task ${task.id} needs a check command (oracle)`);
  }
  return tasks;
}

/**
 * Seed the on-arm's store for exactly one run directory.
 *
 * Why this exists: a freshly prepared profile has an empty memory store, so the
 * two arms would differ by a protocol block and nothing else — that measures
 * nothing. Seeding makes the arms differ by *knowledge*, including one
 * deliberately stale memory, which is what the gate's second clause ("no
 * failures caused by copying an outdated playbook") is about.
 *
 * The table is replaced, never merged: every run must start from the same
 * memory state or the comparison stops being paired.
 */
function seedStore(home, ws, memories) {
  const dir = path.join(home, "storages");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "dsh_engram.json");
  const now = Date.now();
  const rows = {};
  memories.forEach((memory, index) => {
    const id = `seed-${String(index).padStart(2, "0")}`;
    rows[id] = {
      id,
      workspace: ws,
      kind: memory.kind ?? "fact",
      text: memory.text,
      tags: memory.tags ?? ["seeded"],
      entity: memory.entity ?? null,
      // MemorySchema requires a non-empty session id; this row is a fixture, not
      // a captured observation, so the id says so.
      sessionId: "session-g6-seed",
      seq: index + 1,
      createdAt: now,
      updatedAt: now,
      hits: 0,
      lastAccessAt: null,
      filePath: memory.filePath ?? null,
      anchor: null,
      signal: memory.signal ?? 0.6,
      status: "active",
      expiresAt: now + 180 * 86_400_000,
      supersedes: null,
      contradicts: null,
      source: "seed",
      conditions: memory.conditions ?? null,
    };
  });
  const unit = {
    unit: { name: "dsh_engram", version: 1 },
    global: null,
    tables: { memories: rows },
  };
  fs.writeFileSync(file, `${JSON.stringify(unit)}\n`);
}

/** Write both artifacts (machine + human) from one report object. */
function writeArtifacts(out, report, minPairs) {
  fs.writeFileSync(path.join(out, "runs.json"), `${JSON.stringify(report, null, 2)}\n`);
  const { summary, arms, deltaPp, paired, gate, tasks } = report;
  const lines = [
    "# G6 · paired quality A/B",
    "",
    `tasks ${tasks.length} · seeds ${report.seeds} · paired runs ${paired.pairs}`,
    ...(report.excluded?.length ? ["", `excluded (broken oracle, not a data point): ${report.excluded.join(", ")}`] : []),
    "",
    "| arm | pass | rate | mean wall |",
    "|---|---|---|---|",
    ...arms.map((arm) => `| ${arm} | ${summary[arm].passes}/${summary[arm].runs} | ${(summary[arm].rate * 100).toFixed(1)}% | ${(summary[arm].meanWallMs / 1000).toFixed(1)}s |`),
    "",
    `Δ (${arms[0]} − ${arms[1]}) = ${deltaPp === null ? "未测" : `${deltaPp.toFixed(1)}pp`} · only-${arms[0]} wins ${paired.onlyA} · only-${arms[1]} wins ${paired.onlyB}`,
    paired.pairs < minPairs ? `_${paired.pairs} paired runs is a plumbing check, not a quality measurement._` : "",
    "",
    `G6 ${gate.verdict} (target ${gate.target}${paired.pairs < minPairs ? `; ${paired.pairs} paired runs — need ≥ ${minPairs}` : ""}) — ${gate.note}`,
    "",
  ];
  fs.writeFileSync(path.join(out, "REPORT.md"), lines.join("\n"));
}

/**
 * Score rows into summary + paired delta + the gate verdict. Shared by `run`
 * (fresh runs) and `report` (recomputing an existing artifact with an
 * exclusion), so a number is never produced two different ways.
 */
function analyze({ rows, tasks, seeds, arms, minPairs }) {
const summary = {};
for (const arm of arms) {
  const armRows = rows.filter((row) => row.arm === arm);
  const passes = armRows.filter((row) => row.pass).length;
  summary[arm] = {
    runs: armRows.length,
    passes,
    rate: armRows.length === 0 ? null : passes / armRows.length,
    meanWallMs: armRows.length === 0 ? null : Math.round(armRows.reduce((sum, row) => sum + row.wallMs, 0) / armRows.length),
  };
}
// Paired delta: only task×seed pairs where BOTH arms ran count.
const pairs = [];
for (const task of tasks) {
  for (let seed = 0; seed < seeds; seed += 1) {
    const a = rows.find((row) => row.task === task.id && row.seed === seed && row.arm === arms[0]);
    const b = rows.find((row) => row.task === task.id && row.seed === seed && row.arm === arms[1]);
    if (a && b) pairs.push({ task: task.id, seed, a: a.pass, b: b.pass });
  }
}
const deltaPp = summary[arms[0]].rate === null || summary[arms[1]].rate === null ? null : (summary[arms[0]].rate - summary[arms[1]].rate) * 100;
/**
 * Gate semantics (deliberately one-sided).
 *
 * G6 asks a hard question — "does mounting this make tasks worse?" — and a soft
 * one — "does it make them better?". A symmetric |Δ| ≤ 2pp would fail a run
 * where memory carried the answer, which is the mechanism working, not
 * breaking. So: Δ ≥ −2pp passes the hard condition; Δ > +2pp is reported as a
 * measured gain (the proposal's aspiration, not its floor).
 */
const gate =
  pairs.length < minPairs
    ? { id: "G6", target: "Δ ≥ −2pp", minPairs: minPairs, verdict: "未测", note: `${pairs.length} 对配对 — 需要 ≥ ${minPairs}` }
    : deltaPp <= -2.0001
      ? { id: "G6", target: "Δ ≥ −2pp", minPairs: minPairs, verdict: "FAIL", note: `${arms[0]} 比 ${arms[1]} 低 ${Math.abs(deltaPp).toFixed(1)}pp — 挂载让任务变差了` }
      : deltaPp > 2
        ? { id: "G6", target: "Δ ≥ −2pp", minPairs: minPairs, verdict: "PASS", note: `${arms[0]} 高 ${deltaPp.toFixed(1)}pp — 记忆带去了可用的信息` }
        : { id: "G6", target: "Δ ≥ −2pp", minPairs: minPairs, verdict: "PASS", note: "两臂持平（不伤害）" };
  return { summary, pairs, deltaPp, gate };
}

/**
 * `report --out <dir> [--exclude task,…] [--min-pairs 10]`
 *
 * Recompute an EXISTING artifact after the fact. The only legitimate use is a
 * task whose oracle turned out to be wrong: excluding it is a corpus decision
 * that must be visible in the artifact, not a hand-edit of runs.json.
 */
function republish(args) {
  if (!args.out) throw new Error("report needs --out <dir>");
  const file = path.join(args.out, "runs.json");
  const previous = JSON.parse(fs.readFileSync(file, "utf8"));
  const excluded = new Set(args.exclude ?? []);
  const rows = previous.rows.filter((row) => !excluded.has(row.task));
  const tasks_ = (previous.tasks ?? []).filter((id) => !excluded.has(id)).map((id) => ({ id }));
  const { summary, pairs, deltaPp, gate } = analyze({
    rows,
    tasks: tasks_,
    seeds: previous.seeds,
    arms: previous.arms,
    minPairs: args.minPairs,
  });
  const report = {
    ...previous,
    tasks: tasks_.map((task) => task.id),
    summary,
    paired: { pairs: pairs.length, onlyA: pairs.filter((p) => p.a && !p.b).length, onlyB: pairs.filter((p) => !p.a && p.b).length },
    deltaPp,
    gate,
    excluded: [...excluded],
    recomputedAt: Date.now(),
    rows,
    invalidRows: previous.rows.filter((row) => excluded.has(row.task)),
  };
  writeArtifacts(args.out, report, args.minPairs);
  return report;
}

function run(args) {
  if (!args.out) throw new Error("run needs --out <dir>");
  if (!args.workspace) throw new Error("run needs --workspace <fixture dir>");
  // `--exclude <task,…>`: a corpus task whose ORACLE is wrong is not a data
  // point, it is a bug. Excluding it here keeps the exclusion in the tool (and
  // in the artifact's own task list) instead of hand-editing runs.json later.
  const excluded = new Set(args.exclude ?? []);
  const tasks = loadTasks(args.tasks).filter((task) => !excluded.has(task.id));
  if (tasks.length === 0) throw new Error("every task was excluded — nothing to run");
  const arms = args.armIds ?? [];
  args.arms = arms;
  if (arms.length !== 2) throw new Error("run needs exactly two arms: --arm on,off");
  fs.mkdirSync(args.out, { recursive: true });

  const home = args.home;
  if (args.sandbox) {
    // Prior runs' session logs live here and would be readable by the next run.
    // `--control-first` means only control sessions can exist at this point.
    fs.rmSync(path.join(home, "sessions"), { recursive: true, force: true });
  }
  const env = { ...process.env, DSH_HOME: home };
  const credential = liftCredential(env);
  if (!credential) {
    throw new Error("no DEEPSEEK_API_KEY in env or ~/.dsh/.credentials.yaml — headless runs would fail with MISSING_CREDENTIAL");
  }
  console.log(`credential: ${credential}`);
  const seedMemories = args.seedMemory === undefined ? null : JSON.parse(fs.readFileSync(args.seedMemory, "utf8"));
  const rows = [];
  const startedAt = Date.now();
  if (args.sandbox && args.logDir !== undefined) {
    // Check logs quote expected values ("expected 101, actual 100"), so they are
    // only safe if the sandbox denies the whole directory above them. Round 5
    // lost a matrix to exactly this: the log dir was this round's own dir, hence
    // excluded from the deny list, hence readable, hence an answer key.
    const ancestors = discoverPriorTrees(path.resolve(args.out), args.logDir).map((entry) => path.resolve(entry));
    const logDir = path.resolve(args.logDir);
    const covered = ancestors.some((entry) => logDir === entry || logDir.startsWith(`${entry}${path.sep}`));
    if (!covered) {
      throw new Error(
        `--log-dir ${args.logDir} is readable inside the sandbox; put it under a /tmp/g6* directory that is NOT this round's root`,
      );
    }
  }
  let priorRows = [];
  if (args.resume) {
    try {
      const previous = JSON.parse(fs.readFileSync(path.join(args.out, "runs.json"), "utf8"));
      priorRows = previous.rows ?? [];
      const done = new Set(priorRows.map((row) => `${row.task}|${row.seed}|${row.arm}`));
      for (let i = plan.length - 1; i >= 0; i -= 1) {
        if (done.has(`${plan[i].task.id}|${plan[i].seed}|${plan[i].arm}`)) plan.splice(i, 1);
      }
      console.log(`resume: ${priorRows.length} rows kept, ${plan.length} runs to do`);
    } catch {
      console.log(`resume: no runs.json to resume from (${args.out}) — running the whole matrix`);
    }
  }

  // Run ORDER is part of the isolation. A control run that happens after a
  // treatment run can read the treatment's `run.log` (a real control arm did
  // exactly that in round 2: it walked to `ab-engram/<task>/seed-0/run.log` and
  // lifted the convention out of the summary). `--control-first` runs every
  // control first, so no treatment artifact exists yet; `--log-dir` moves logs
  // outside the run tree entirely.
  const plan = [];
  for (const task of tasks) {
    for (let seed = 0; seed < args.seeds; seed += 1) {
      for (const arm of arms) plan.push({ task, seed, arm });
    }
  }
  if (args.onlyArm !== void 0) {
    const keep = new Set([args.onlyArm]);
    for (let i = plan.length - 1; i >= 0; i -= 1) if (!keep.has(plan[i].arm)) plan.splice(i, 1);
  }
  if (args.controlFirst) {
    const control = arms[1];
    plan.sort((a, b) => (a.arm === control ? 0 : 1) - (b.arm === control ? 0 : 1));
  }

  for (const { task, seed, arm } of plan) {
    {
      {
        const dir = path.join(args.out, arm, task.id, `seed-${seed}`);
        const ws = path.join(dir, "ws");
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        fs.cpSync(args.workspace, ws, { recursive: true, dereference: true });

        if (task.setup) spawnSync("bash", ["-lc", task.setup], { cwd: ws, encoding: "utf8", timeout: args.timeoutMs });
        if (seedMemories !== null && arm === arms[0]) seedStore(home, ws, seedMemories);
        // Same seed for both arms: the prompt is the seed-sensitive part, so we
        // pin it verbatim and keep the arm the only difference.
        const prompt = task.prompt;
        const runStarted = Date.now();
        // A control arm must not be able to read what the treatment arm was
        // given. Both arms share one DSH_HOME, so the seeded store is physically
        // moved aside for the control's run (a pilot proved a bare agent will
        // `cat` the store if it is reachable — fair only if we make it
        // unreachable).
        const storeFile = path.join(home, "storages", "dsh_engram.json");
        // Move it OUT of DSH_HOME: renaming inside the same directory is not
        // hiding — a pilot's control arm listed `storages/` and read the file
        // anyway (it was named `dsh_engram.json.g6-hidden`).
        const hiddenFile = path.join(os.tmpdir(), `dsh_engram.json.g6-hidden-${process.pid}`);
        const hideStore = args.hideStoreFor === arm && fs.existsSync(storeFile);
        if (hideStore) fs.renameSync(storeFile, hiddenFile);
        let res;
        // OS-level fence: the arm's shell cannot read the repo, earlier rounds,
        // the host store, its own session logs, or the OTHER arm's profile —
        // whatever it thinks of next. Without this, "Δ is a lower bound" was the
        // honest claim; with it, Δ is a measurement.
        const sandboxFile = args.sandbox
          ? (() => {
              const otherArm = arms.find((candidate) => candidate !== arm) ?? null;
              const file = path.join("/tmp", `g6-sandbox-${process.pid}-${arm}-${task.id}-${seed}.sb`);
              fs.writeFileSync(
                file,
                buildConfinedProfile({
                  home: os.homedir(),
                  nodeDir: path.dirname(path.dirname(process.execPath)),
                  dshHome: path.join(home, "profiles", arm),
                  ws,
                  otherArmProfile: args.sandbox === "norearm" || otherArm === null ? null : path.join(home, "profiles", otherArm),
                  sessionsDir: path.join(home, "sessions"),
                  credentials: path.join(os.homedir(), ".dsh", ".credentials.yaml"),
                }),
              );
              return file;
            })()
          : null;
        try {
          res = sandboxFile === null
            ? dsh(["--profile", arm, prompt], { cwd: ws, env, timeoutMs: args.timeoutMs })
            : spawnSync("/usr/bin/sandbox-exec", ["-f", sandboxFile, DSH_BIN, "--profile", arm, prompt], {
                cwd: ws,
                env,
                encoding: "utf8",
                timeout: args.timeoutMs,
                maxBuffer: 32 * 1024 * 1024,
              });
        } finally {
          if (hideStore) fs.renameSync(hiddenFile, storeFile);
        }
        const wallMs = Date.now() - runStarted;
        const log = `${res.stdout ?? ""}\n--- stderr ---\n${res.stderr ?? ""}\n`;
        // Default location keeps the old layout; --log-dir keeps the workspace
        // tree free of anything another arm could read.
        const logPath = args.logDir === undefined
          ? path.join(dir, "run.log")
          : (fs.mkdirSync(path.join(args.logDir, arm, task.id), { recursive: true }), path.join(args.logDir, arm, task.id, `seed-${seed}.log`));
        fs.writeFileSync(logPath, log);

        const check = spawnSync("bash", ["-lc", task.check], { cwd: ws, encoding: "utf8", timeout: args.timeoutMs });
        const pass = check.status === 0;
        // A check log carries the oracle's assertion messages ("expected 101,
        // actual 100") — i.e. the answer. It leaves the run tree with the logs.
        const checkLog = `${check.stdout ?? ""}\n--- stderr ---\n${check.stderr ?? ""}\n`;
        if (args.logDir === undefined) {
          fs.writeFileSync(path.join(dir, "check.log"), checkLog);
        } else {
          fs.mkdirSync(path.join(args.logDir, "checks", arm, task.id), { recursive: true });
          fs.writeFileSync(path.join(args.logDir, "checks", arm, task.id, `seed-${seed}.log`), checkLog);
        }
        // Contamination flag: a control run that mentions the memory store did
        // not run blind, whatever it scored.
        // A control run that mentions the store, the tool, or a SIBLING arm's
        // artifact did not run blind (round 2 caught one reading the treatment's
        // run.log for the very same task).
        const contaminated = arm !== args.arms?.[0] && /dsh_engram(\.json)?|engram_recall|\[ENGRAM\]|ab-engram[\/]|runs\.json|REPORT\.md/.test(log);
        rows.push({ task: task.id, seed, arm, pass, exit: res.status, wallMs, ...(contaminated ? { contaminated: true } : {}) });
        console.log(`${pass ? "PASS" : "fail"}  ${task.id} seed=${seed} arm=${arm} ${(wallMs / 1000).toFixed(1)}s`);
      }
    }
  }

  const allRows = [...priorRows, ...rows];
  const { summary, pairs, deltaPp, gate } = analyze({ rows: allRows, tasks, seeds: args.seeds, arms, minPairs: args.minPairs });

  const report = {
    startedAt,
    seedMemory: args.seedMemory ?? null,
    finishedAt: Date.now(),
    seeds: args.seeds,
    tasks: tasks.map((task) => task.id),
    arms,
    summary,
    hideStoreFor: args.hideStoreFor ?? null,
    contaminated: allRows.filter((row) => row.contaminated === true).length,
    paired: { pairs: pairs.length, onlyA: pairs.filter((p) => p.a && !p.b).length, onlyB: pairs.filter((p) => !p.a && p.b).length },
    deltaPp,
    gate,
    rows: allRows,
  };
  writeArtifacts(args.out, report, args.minPairs);
  console.log(`\nG6 ${report.gate.verdict} (${report.gate.target}) — ${report.gate.note}`);
  process.exitCode = report.gate.verdict === "FAIL" ? 1 : 0;
}

const args = parseArgs(process.argv.slice(2));
if (args.cmd === "prepare") prepare(args);
else if (args.cmd === "run") run(args);
else if (args.cmd === "report") republish(args);
else {
  console.error("usage: quality-ab.mjs prepare|run|report … (see the header comment)");
  process.exitCode = 2;
}
