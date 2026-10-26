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

function run(args) {
  if (!args.out) throw new Error("run needs --out <dir>");
  if (!args.workspace) throw new Error("run needs --workspace <fixture dir>");
  const tasks = loadTasks(args.tasks);
  const arms = args.armIds ?? [];
  if (arms.length !== 2) throw new Error("run needs exactly two arms: --arm on,off");
  fs.mkdirSync(args.out, { recursive: true });

  const home = args.home;
  const env = { ...process.env, DSH_HOME: home };
  const credential = liftCredential(env);
  if (!credential) {
    throw new Error("no DEEPSEEK_API_KEY in env or ~/.dsh/.credentials.yaml — headless runs would fail with MISSING_CREDENTIAL");
  }
  console.log(`credential: ${credential}`);
  const seedMemories = args.seedMemory === undefined ? null : JSON.parse(fs.readFileSync(args.seedMemory, "utf8"));
  const rows = [];
  const startedAt = Date.now();

  for (const task of tasks) {
    for (let seed = 0; seed < args.seeds; seed += 1) {
      for (const arm of arms) {
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
        const res = dsh(["--profile", arm, prompt], { cwd: ws, env, timeoutMs: args.timeoutMs });
        const wallMs = Date.now() - runStarted;
        fs.writeFileSync(path.join(dir, "run.log"), `${res.stdout ?? ""}\n--- stderr ---\n${res.stderr ?? ""}\n`);

        const check = spawnSync("bash", ["-lc", task.check], { cwd: ws, encoding: "utf8", timeout: args.timeoutMs });
        const pass = check.status === 0;
        fs.writeFileSync(path.join(dir, "check.log"), `${check.stdout ?? ""}\n--- stderr ---\n${check.stderr ?? ""}\n`);
        rows.push({ task: task.id, seed, arm, pass, exit: res.status, wallMs });
        console.log(`${pass ? "PASS" : "fail"}  ${task.id} seed=${seed} arm=${arm} ${(wallMs / 1000).toFixed(1)}s`);
      }
    }
  }

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
    for (let seed = 0; seed < args.seeds; seed += 1) {
      const a = rows.find((row) => row.task === task.id && row.seed === seed && row.arm === arms[0]);
      const b = rows.find((row) => row.task === task.id && row.seed === seed && row.arm === arms[1]);
      if (a && b) pairs.push({ task: task.id, seed, a: a.pass, b: b.pass });
    }
  }
  const deltaPp = summary[arms[0]].rate === null || summary[arms[1]].rate === null ? null : (summary[arms[0]].rate - summary[arms[1]].rate) * 100;
  const report = {
    startedAt,
    seedMemory: args.seedMemory ?? null,
    finishedAt: Date.now(),
    seeds: args.seeds,
    tasks: tasks.map((task) => task.id),
    arms,
    summary,
    paired: { pairs: pairs.length, onlyA: pairs.filter((p) => p.a && !p.b).length, onlyB: pairs.filter((p) => !p.a && p.b).length },
    deltaPp,
    gate: {
      id: "G6",
      target: "≤ 2pp",
      minPairs: args.minPairs,
      verdict:
        pairs.length < args.minPairs ? "未测" : Math.abs(deltaPp) <= 2 ? "PASS" : "FAIL",
    },
    rows,
  };
  fs.writeFileSync(path.join(args.out, "runs.json"), `${JSON.stringify(report, null, 2)}\n`);

  const lines = [
    "# G6 · paired quality A/B",
    "",
    `tasks ${report.tasks.length} · seeds ${args.seeds} · paired runs ${pairs.length}`,
    "",
    "| arm | pass | rate | mean wall |",
    "|---|---|---|---|",
    ...arms.map((arm) => `| ${arm} | ${summary[arm].passes}/${summary[arm].runs} | ${(summary[arm].rate * 100).toFixed(1)}% | ${(summary[arm].meanWallMs / 1000).toFixed(1)}s |`),
    "",
    `Δ (${arms[0]} − ${arms[1]}) = ${deltaPp === null ? "未测" : `${deltaPp.toFixed(1)}pp`} · only-${arms[0]} wins ${report.paired.onlyA} · only-${arms[1]} wins ${report.paired.onlyB}`,
    pairs.length < args.minPairs
      ? `_${pairs.length} paired runs is a plumbing check, not a quality measurement._`
      : "",
    "",
    `G6 ${report.gate.verdict} (target ≤ 2pp${pairs.length < args.minPairs ? `; ${pairs.length} paired runs — need ≥ ${args.minPairs}` : ""})`,
    "",
  ];
  fs.writeFileSync(path.join(args.out, "REPORT.md"), lines.join("\n"));
  console.log(`\n${lines.slice(-4).join("\n")}`);
  process.exitCode = report.gate.verdict === "FAIL" ? 1 : 0;
}

const args = parseArgs(process.argv.slice(2));
if (args.cmd === "prepare") prepare(args);
else if (args.cmd === "run") run(args);
else {
  console.error("usage: quality-ab.mjs prepare|run … (see the header comment)");
  process.exitCode = 2;
}
