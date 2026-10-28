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
import { fenceCommand, toolReadPaths } from "./g6/sandbox-profile.mjs";

/** Repo root — the directory this harness lives in, i.e. what a blind run must not read. */
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** First hit for `name` on PATH, so the fence can bind its install root by path. */
function resolveOnPath(name) {
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : name;
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return name;
}

const DSH_BIN = process.env.AB_DSH_BIN || "dsh";
const DSH_EXEC = resolveOnPath(DSH_BIN);
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
    // Provenance for an artifact written before `run` recorded it (see classify).
    else if (arg === "--target") out.target = next();
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
/**
 * Which model did an arm actually resolve?
 *
 * `--dump-config` prints the composed profile, so this asks the host instead of
 * trusting a doc: the answer includes bundle layers, not just the patch file.
 */
function parseArmTarget(dump) {
  const block = /^- id: agent-default-model[\s\S]*?(?=^- id: |\s*\z)/m.exec(dump);
  const text = block === null ? dump : block[0];
  return {
    provider: /^\s+provider:\s*(\S+)/m.exec(text)?.[1] ?? null,
    model: /^\s+model:\s*(\S+)/m.exec(text)?.[1] ?? null,
  };
}

/**
 * Both arms must resolve the SAME provider/model.
 *
 * A paired run is only a comparison of arms while the serving stack is a
 * constant. Round 6 spent 33 rows on the paid API before the account ran dry and
 * the natural "just finish the last seven rows somewhere else" fix would have
 * produced a 40-row artifact whose Δ was part plugin, part vendor — invisible in
 * every number and in every log. So: ask, compare, refuse.
 */
function assertSameTarget({ dshBin, home, arms, env }) {
  const targets = {};
  for (const arm of arms) {
    const dumped = spawnSync(dshBin, ["--profile", arm, "--dump-config"], { env: { ...env, DSH_HOME: home }, encoding: "utf8", timeout: 120000 });
    targets[arm] = parseArmTarget(`${dumped.stdout ?? ""}${dumped.stderr ?? ""}`);
  }
  const [first, second] = arms.map((arm) => targets[arm]);
  if (first.provider !== null && second.provider !== null && (first.provider !== second.provider || first.model !== second.model)) {
    throw new Error(
      `the two arms resolve different model targets (${arms[0]}: ${first.provider}/${first.model}, ${arms[1]}: ${second.provider}/${second.model}) — Δ would measure the serving stack, not the plugin`,
    );
  }
  return targets;
}

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

/**
 * Remove what the previous run left in the SHARED experiment home.
 *
 * Every arm can read this home (dsh cannot boot without it), so anything the
 * plugin keeps there is common knowledge. Session logs hold solved tasks in
 * plain text; `recall-injections.json` names the arm it last ran in — round 6's
 * controls found `lastWorkspace: /private/tmp/g6-smoke3/arm-a/…` there and read
 * the experiment's arm names and layout straight out of the file. The memory
 * store is not affected: `seedStore` re-seeds it before every treatment run.
 */
function scrubSharedHome(home) {
  fs.rmSync(path.join(home, "sessions"), { recursive: true, force: true });
  // The ledger is keyed by absolute workspace path (`…/ab-engram/csv/seed-0/ws`)
  // and records `injectedChars` — a control that reads it learns both the arm
  // names and that one arm injects memory. It holds no state a run needs.
  for (const stale of ["recall-injections.json", "context-gc.status.json", "ledger.json"]) {
    fs.rmSync(path.join(home, "engram", stale), { force: true });
  }
}

function prepare(args) {
  const home = args.home;
  if (args.sandbox) scrubSharedHome(home);
  fs.mkdirSync(home, { recursive: true });
  const profiles = Object.entries(args.arm);
  if (profiles.length !== 2) throw new Error("prepare needs --arm on=<profile>,off=<profile>");

  for (const [name, profile] of profiles) {
    const env = armEnv(home);
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
    // `${REPO}` keeps the corpus portable. It used to spell the author's checkout
    // (`node /Users/…/eval/g6/check.mjs codec`), so on any other machine every
    // check exits non-zero, BOTH arms score 0, and the gate reports "两臂持平 —
    // PASS": a silent fake verdict, not an error message (round 6, seam #9).
    for (const field of ["check", "setup"]) {
      if (typeof task[field] === "string") task[field] = task[field].replaceAll("${REPO}", ROOT);
    }
    if (!task.check.includes(ROOT) && /check\.mjs|gate-audit/.test(task.check)) {
      throw new Error(
        `${file}: task ${task.id} names a harness file without ${"${REPO}"} — an absolute checkout path makes every arm fail on another machine`,
      );
    }
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
  // The workspace key must be spelled the way the ARM will compute it, or the
  // treatment runs blind while the harness believes it seeded. The plugin keys
  // every memory by `path.resolve(cwd)`, and the host reports cwd from
  // getcwd(2) — on macOS that is the RESOLVED path, so a run started under
  // `/tmp/x` sees `/private/tmp/x`. Round 6's smoke caught this the expensive
  // way: seeds keyed `/tmp/…` never matched, and the "treatment" scored 0.
  let key = ws;
  try {
    key = fs.realpathSync(ws);
  } catch {
    // Not on disk (shouldn't happen after the copy) — the literal spelling is
    // the only thing left to try.
  }
  memories.forEach((memory, index) => {
    const id = `seed-${String(index).padStart(2, "0")}`;
    rows[id] = {
      id,
      workspace: key,
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
function analyze({ rows: rawRows, tasks, seeds, arms, minPairs }) {
  // Excluded first, so an infrastructure death cannot enter a denominator as a
  // failure. They stay in `report.rows` for the audit trail, and the gate note
  // says how many were dropped.
  const infraRows = rawRows.filter((row) => row.infra !== undefined);
  const rows = rawRows.filter((row) => row.infra === undefined);
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
  // Infrastructure rows are excluded from the verdict, never silently: the note
  // says how many, and which, so a reader can see the denominator that was used.
  if (infraRows.length > 0) {
    gate.note += `（另有 ${infraRows.length} 行基础设施失败未计入：${infraRows.map((row) => `${row.task}/${row.seed}/${row.arm}:${row.infra}`).join(" ")}）`;
    gate.infraExcluded = infraRows.length;
  }
  return { summary, pairs, deltaPp, gate, infra: { count: infraRows.length, rows: infraRows.map((row) => ({ task: row.task, seed: row.seed, arm: row.arm, reason: row.infra })) } };
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

/**
 * `classify --out <dir> [--log-dir <dir>]`
 *
 * Re-derive "did this row ever reach a model?" from the logs on disk, for a
 * matrix that was scored before that question existed (round 6 lost its last
 * seven treatment rows to `QUOTA: Insufficient Balance` and the artifact called
 * them task failures). Deliberately a separate, additive pass: it can only move
 * rows into or out of the excluded set, and it rewrites the same artifact.
 */
function reclassify(args) {
  if (!args.out) throw new Error("classify needs --out <dir>");
  const file = path.join(args.out, "runs.json");
  const previous = JSON.parse(fs.readFileSync(file, "utf8"));
  const logDir = args.logDir ?? path.join(args.out, "logs");
  let changed = 0;
  const rows = previous.rows.map((row) => {
    const logPath = path.join(logDir, row.arm, row.task, `seed-${row.seed}.log`);
    if (!fs.existsSync(logPath)) return row;
    const reason = infraReason(fs.readFileSync(logPath, "utf8"), row.wallMs, row.pass);
    const was = row.infra === undefined;
    if ((reason === null) === was) return row;
    changed += 1;
    const next = { ...row };
    if (reason === null) delete next.infra;
    else next.infra = reason;
    return next;
  });
  const { summary, pairs, deltaPp, gate } = analyze({ rows, tasks: previous.tasks.map((id) => ({ id })), seeds: previous.seeds, arms: previous.arms, minPairs: args.minPairs });
  // Provenance for an artifact written before the run recorded it. NOT inferred
  // from the profiles: those get edited (round 6 pointed them at a different
  // endpoint between two matrices), so asking them today would stamp the CURRENT
  // route onto rows produced by an older one — a false fact, which is worse than
  // a missing one. This is an operator statement, verbatim or absent.
  const target = args.target === undefined
    ? previous.target ?? null
    : { provider: args.target.split("/")[0], model: args.target.split("/")[1] ?? null };
  const report = {
    ...previous,
    summary,
    paired: { pairs: pairs.length, onlyA: pairs.filter((p) => p.a && !p.b).length, onlyB: pairs.filter((p) => !p.a && p.b).length },
    deltaPp,
    gate,
    classes: { infra: gate.infraExcluded ?? 0, changed },
    // `partial` belongs to the incremental writes; a finished matrix that is only
    // being re-classified is not partial, and the contamination count must come
    // from the rows rather than from whichever snapshot this file started as.
    partial: undefined,
    contaminated: rows.filter((row) => row.contaminated === true).length,
    infraRows: rows.filter((row) => row.infra !== undefined).length,
    ...(target === null ? {} : { target }),
    recomputedAt: Date.now(),
    rows,
  };
  if (report.partial === undefined) delete report.partial;
  writeArtifacts(args.out, report, args.minPairs);
  console.log(`classify: ${changed} row(s) re-labelled · ${report.infraRows} infrastructure · Δ ${deltaPp === null ? "未测" : `${deltaPp.toFixed(1)}pp`} · G6 ${gate.verdict}`);
  return report;
}

/** Below this the matrix is not worth starting: the rows are cheap next to the
 *  model time, but a disk that fills mid-run throws them all away. Round 4 died
 *  to ENOSPC with ~40% of the matrix paid for; round 6 died the same way at 40%
 *  (16 of 40 rows) and the artifact had never been written. */
const MIN_FREE_MB = Number(process.env.AB_MIN_FREE_MB) > 0 ? Number(process.env.AB_MIN_FREE_MB) : 512;

/**
 * The environment an arm runs in: this machine's real env, minus the caller's
 * identity. The harness is itself launched by a DSH session, so `process.env`
 * carries `DSH_PROFILE_DIR`, `DSH_SESSION_ID`, `DSH_SHELL`… — an arm that dumps
 * `env` would learn it is one of two arms inside someone's `web` profile, and
 * `DSH_SHELL=1`/`DSH_PROFILE_DIR` can change how dsh resolves its own profile and
 * policy. Both arms get exactly DSH_HOME, so the run does not depend on who
 * launched the matrix (round 6, seam #10).
 */
function armEnv(home) {
  const env = { ...process.env };
  for (const key of ["DSH_PROFILE", "DSH_PROFILE_DIR", "DSH_SESSION_ID", "DSH_WEB_URL", "DSH_SHELL", "DSH_ATTACH"]) delete env[key];
  env.DSH_HOME = home;
  return env;
}

/**
 * A run that never reached a model is not a data point about an arm.
 *
 * Round 6's last seven treatment rows died in ~2s each with
 * `QUOTA: Insufficient Balance` and were scored as task failures, which quietly
 * turned "we ran out of credit" into "the arm could not do it" — the wrong
 * direction for a gate that is supposed to protect against exactly this.
 * A real attempt never finishes in seconds, so a fast death with a transport or
 * billing signature is infrastructure, and the row says so.
 */
const INFRA_SIGNATURES = [
  [/QUOTA: Insufficient Balance|Insufficient Balance/, "QUOTA"],
  [/MISSING_CREDENTIAL/, "CREDENTIAL"],
  [/502 Bad Gateway|503 Service Unavailable|504 Gateway Time-?out/, "UPSTREAM"],
  [/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|socket hang up|other side closed/, "NETWORK"],
];
function infraReason(log, wallMs, pass) {
  if (wallMs > 120000) return null;
  // A row that PASSED obviously had a model, whatever a sub-call said on the way
  // (money/seed-2 hit QUOTA on its very last call after 198 lines of real work,
  // with a green check). And a row with a real attempt in it is a data point even
  // if the endpoint died at the end — that is a task outcome, not a billing one.
  if (pass) return null;
  if (log.split("\n").length > 40) return null;
  for (const [pattern, label] of INFRA_SIGNATURES) if (pattern.test(log)) return label;
  return null;
}

function assertFreeSpace(out) {
  try {
    const stat = fs.statfsSync(out);
    const freeMb = Math.round((stat.bavail * stat.bsize) / (1024 * 1024));
    if (freeMb < MIN_FREE_MB) {
      console.error(
        `G6: only ${freeMb} MB free at ${out}, need ≥ ${MIN_FREE_MB} MB — a matrix that runs the disk out loses every row it already paid for. Free space (or set AB_MIN_FREE_MB) and re-run.`,
      );
      process.exitCode = 2;
      return false;
    }
    console.log(`free space: ${freeMb} MB`);
  } catch {
    // statfs is best-effort: a filesystem that cannot answer is not a reason to refuse.
  }
  return true;
}

/**
 * Where the in-flight artifact lives while the matrix runs.
 *
 * Outside the run tree when `--log-dir` is given. A `runs.json` sitting in the
 * round root is *listable* by the arm (ancestor dirs are readable so `getcwd(2)`
 * works), and in round 6 the control arms found it: 10 of 20 mentioned
 * `runs.json` — one wrote "this is harness metadata that might contain the eval's
 * rubric", several went hunting for the experiment around it. They could not
 * read it (the fence denies /tmp), but the NAME alone told them this was an A/B
 * matrix. The log dir is already denied to the arms, so the artifact goes there.
 */
function artifactPath(args) {
  return args.logDir === undefined ? path.join(args.out, "runs.json") : path.join(args.logDir, "runs.json");
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
  if (!assertFreeSpace(args.out)) return;

  const home = args.home;
  if (args.sandbox) scrubSharedHome(home);
  const env = armEnv(home);
  // `AB_DSH_BIN` swaps in a stub host: the unit tests drive the whole run/grade
  // pipeline against one, and a stub never talks to a model. Only a real arm
  // spawn needs a credential, so only that mode fails fast — otherwise CI (no
  // ~/.dsh/.credentials.yaml) cannot run the harness tests at all.
  const stubHost = process.env.AB_DSH_BIN !== undefined;
  const credential = liftCredential(env);
  if (!credential && !stubHost) {
    throw new Error("no DEEPSEEK_API_KEY in env or ~/.dsh/.credentials.yaml — headless runs would fail with MISSING_CREDENTIAL");
  }
  console.log(`credential: ${credential ?? "(none — AB_DSH_BIN stub host, no model calls)"}`);
  // Cost of asking: two `--dump-config` boots. Cost of not asking: a matrix that
  // is not a paired comparison.
  const targets = assertSameTarget({ dshBin: DSH_BIN, home, arms, env });
  const [targetProvider, targetModel] = [targets[arms[0]].provider, targets[arms[0]].model];
  console.log(`model target: ${targetProvider ?? "?"}/${targetModel ?? "?"} (both arms must agree — checked)`);
  const seedMemories = args.seedMemory === undefined ? null : JSON.parse(fs.readFileSync(args.seedMemory, "utf8"));
  const rows = [];
  const startedAt = Date.now();
  // Write the artifact as we go, not at the end. A matrix is hours of model time;
  // holding every row in memory until the last run means one ENOSPC (round 4,
  // round 6) or one Ctrl-C discards the whole thing and `--resume` finds nothing
  // to resume. Each finished row lands in runs.json immediately.
  const snapshotRows = () => {
    const file = artifactPath(args);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const payload = {
      startedAt,
      seedMemory: args.seedMemory ?? null,
      seeds: args.seeds,
      tasks: tasks.map((task) => task.id),
      arms,
      hideStoreFor: args.hideStoreFor ?? null,
      partial: true,
      rows: [...priorRows, ...rows],
      armLabels: { "arm-a": arms[0], "arm-b": arms[1] },
    };
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(payload, null, 1)}\n`);
    fs.renameSync(`${file}.tmp`, file);
  };
  if (args.sandbox && args.logDir !== undefined) {
    // Check logs quote expected values ("expected 101, actual 100"), so they are
    // only safe if the sandbox denies the whole directory above them. Round 5
    // lost a matrix to exactly this: the log dir was this round's own dir, hence
    // excluded from the deny list, hence readable, hence an answer key.
    //
    // Seatbelt only. Linux's fence does not deny paths, it mounts a private empty
    // /tmp and hides the checkout, so EVERY directory outside the arm's own
    // workspace and DSH_HOME is already gone — there is nothing to place "under a
    // /tmp/g6* tree", and on this host /tmp does not even survive a process.
    if (process.platform === "darwin") {
      const ancestors = discoverPriorTrees(path.resolve(args.out), args.logDir).map((entry) => path.resolve(entry));
      const logDir = path.resolve(args.logDir);
      const covered = ancestors.some((entry) => logDir === entry || logDir.startsWith(`${entry}${path.sep}`));
      if (!covered) {
        throw new Error(
          `--log-dir ${args.logDir} is readable inside the sandbox; put it under a /tmp/g6* directory that is NOT this round's root`,
        );
      }
    }
    // Either way the log dir must stay outside the run tree: under bwrap a
    // sibling directory is invisible, but a log dir INSIDE the arm's own path
    // would be created by the workspace bind and readable.
    const logDir = path.resolve(args.logDir);
    const outRoot = path.resolve(args.out);
    if (logDir === outRoot || logDir.startsWith(`${outRoot}${path.sep}`)) {
      throw new Error(`--log-dir ${args.logDir} is inside the run tree (${outRoot}); put it beside it, not in it`);
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
    // An explicit partition, not `sort` with a 0/1 comparator: the ordering IS
    // the isolation (no treatment session exists while a control runs), so it
    // must not depend on how a particular engine implements an ill-formed
    // comparison.
    const ordered = [
      ...plan.filter((run) => run.arm === control),
      ...plan.filter((run) => run.arm !== control),
    ];
    plan.splice(0, plan.length, ...ordered);
  }

  // `--resume` keeps the rows a dead matrix already paid for. It MUST run after
  // `plan` exists: this block used to sit above the declaration, where the TDZ
  // ReferenceError was swallowed by the catch below and printed as the harmless
  // "no runs.json" line — so `--resume` silently re-ran every pair at full cost.
  let priorRows = [];
  if (args.resume) {
    try {
      const live = artifactPath(args);
      // Older artifacts (and stub-host matrices with no --log-dir) live in --out.
      const file = fs.existsSync(live) ? live : path.join(args.out, "runs.json");
      const previous = JSON.parse(fs.readFileSync(file, "utf8"));
      priorRows = previous.rows ?? [];
      // An infra row is NOT a finished row: `--resume` exists to finish a matrix,
      // and a row that never got a model is exactly what is left to do.
      const done = new Set(priorRows.filter((row) => row.infra === undefined).map((row) => `${row.task}|${row.seed}|${row.arm}`));
      const before = plan.length;
      for (let i = plan.length - 1; i >= 0; i -= 1) {
        if (done.has(`${plan[i].task.id}|${plan[i].seed}|${plan[i].arm}`)) plan.splice(i, 1);
      }
      console.log(`resume: ${before - plan.length} runs reused from ${args.out}, ${plan.length} to do`);
    } catch {
      console.log(`resume: no runs.json to resume from (${args.out}) — running the whole matrix`);
    }
  }

  for (const { task, seed, arm } of plan) {
    {
      {
        // Neutral directory names: the arm used to appear in the run's own cwd
        // (`.../ab-bare/...`) and a control read it and started hunting for the
        // "team memory" it had been denied. The mapping lives in runs.json.
        const label = arm === arms[0] ? "arm-a" : "arm-b";
        const dir = path.join(args.out, label, task.id, `seed-${seed}`);
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
        // A renamed file in the same directory is not hiding (a pilot's control
        // arm listed `storages/` and read `dsh_engram.json.g6-hidden`), and
        // moving it to /tmp is not portable: on Linux /tmp is a separate
        // filesystem and the rename dies with EXDEV. So the rename stays inside
        // `storages/` and the FENCE hides that whole directory for this arm.
        const hiddenFile = `${storeFile}.g6-hidden-${process.pid}`;
        const hideStore = args.hideStoreFor === arm && fs.existsSync(storeFile);
        if (hideStore) fs.renameSync(storeFile, hiddenFile);
        let res;
        // OS-level fence: the arm's shell cannot read the repo, earlier rounds,
        // the host store, its own session logs, or the OTHER arm's profile —
        // whatever it thinks of next. Without this, "Δ is a lower bound" was the
        // honest claim; with it, Δ is a measurement.
        //
        // The mechanism is the platform's (seatbelt on macOS, bubblewrap on
        // Linux) but both come out of fenceCommand(), so the profile a run gets
        // is the same one the fence test asserts against.
        const otherArm = arms.find((candidate) => candidate !== arm) ?? null;
        const fence = args.sandbox
          ? fenceCommand({
              home: os.homedir(),
              nodeDir: path.dirname(path.dirname(process.execPath)),
              dshHome: path.join(home, "profiles", arm),
              ws,
              otherArmProfile: args.sandbox === "norearm" || otherArm === null ? null : path.join(home, "profiles", otherArm),
              sessionsDir: path.join(home, "sessions"),
              credentials: path.join(os.homedir(), ".dsh", ".credentials.yaml"),
              repo: ROOT,
              toolPaths: toolReadPaths({ dshBin: DSH_EXEC }),
              hideStore,
              docsToHide: [arm, otherArm]
                .filter((name) => typeof name === "string")
                .map((name) => path.join(home, "profiles", name, "node_modules", "dsh-engram", "docs")),
              cmd: DSH_EXEC,
              argv: ["--profile", arm, prompt],
            })
          : null;
        try {
          res = fence === null
            ? dsh(["--profile", arm, prompt], { cwd: ws, env, timeoutMs: args.timeoutMs })
            : spawnSync(fence.cmd, fence.argv, {
                cwd: ws,
                env,
                encoding: "utf8",
                timeout: args.timeoutMs,
                maxBuffer: 32 * 1024 * 1024,
              });
        } finally {
          try {
            fence?.cleanup();
          } catch {
            // a stale /tmp profile is not worth losing the row over
          }
          if (hideStore) {
            try {
              fs.renameSync(hiddenFile, storeFile);
            } catch (error) {
              // ENOSPC here used to take the whole matrix down with it (round 6).
              // The row is still worth keeping; say where the store went instead.
              console.error(`G6: could not restore the store (${error.code ?? error.message}) — left at ${hiddenFile}`);
            }
          }
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
        const infra = infraReason(log, wallMs, pass);
        rows.push({ task: task.id, seed, arm, pass, exit: res.status, wallMs, ...(contaminated ? { contaminated: true } : {}), ...(infra === null ? {} : { infra }) });
        snapshotRows();
        console.log(`${pass ? "PASS" : "fail"}  ${task.id} seed=${seed} arm=${arm} ${(wallMs / 1000).toFixed(1)}s`);
      }
    }
  }

  // `--resume` re-runs infra rows, so the same key can exist twice; keep the LAST
  // attempt (that is the one with a model in it) or the denominators double.
  const byKey = new Map();
  for (const row of [...priorRows, ...rows]) byKey.set(`${row.task}|${row.seed}|${row.arm}`, row);
  const allRows = [...byKey.values()];
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
    infraRows: allRows.filter((row) => row.infra !== undefined).length,
    paired: { pairs: pairs.length, onlyA: pairs.filter((p) => p.a && !p.b).length, onlyB: pairs.filter((p) => !p.a && p.b).length },
    deltaPp,
    gate,
    rows: allRows,
    armLabels: { "arm-a": arms[0], "arm-b": arms[1] },
    // Provenance: which model produced these numbers. An artifact that does not
    // say cannot be compared to anything later, including to itself.
    target: { provider: targetProvider, model: targetModel },
  };
  writeArtifacts(args.out, report, args.minPairs);
  console.log(`\nG6 ${report.gate.verdict} (${report.gate.target}) — ${report.gate.note}`);
  process.exitCode = report.gate.verdict === "FAIL" ? 1 : 0;
}

const args = parseArgs(process.argv.slice(2));
if (args.cmd === "prepare") prepare(args);
else if (args.cmd === "run") run(args);
else if (args.cmd === "report") republish(args);
else if (args.cmd === "classify") reclassify(args);
else {
  console.error("usage: quality-ab.mjs prepare|run|report|classify … (see the header comment)");
  process.exitCode = 2;
}
