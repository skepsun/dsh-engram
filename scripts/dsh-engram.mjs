#!/usr/bin/env node
/**
 * dsh-engram CLI — the from-scratch user's window into Context GC.
 *
 *   npx dsh-engram status    # what is Context GC doing right now (host + web)
 *   npx dsh-engram doctor    # status + ranked next steps for the gaps it finds
 *   npx dsh-engram enable    # re-run the boot-time web auto-wiring (usually a no-op)
 *   npx dsh-engram revert    # restore the stock compaction rows everywhere —
 *                            #   run BEFORE uninstalling dsh-engram
 *   npx dsh-engram skill export [--workspace <dir>] [--dir <skills>] [--dry-run]
 *                            # export evidence-backed procedures as DSH Skills
 *                            #   (default: <workspace>/.dsh/skills)
 *
 * `status`/`doctor` read the durable snapshot the plugin writes at boot
 * (`$DSH_HOME/engram/context-gc.status.json`) and cross-check the live preset
 * files — both preset generations: legacy compositions
 * (`<root>/<id>/agent.cordis.yml`, DSH ≤ 0.1.x) and the declarative shipped
 * presets (`@deepseek-ai/dsh-web-app/presets/<id>.patch.yml`, DSH ≥ 0.2.0).
 * `enable`/`revert` act on the discovered presets (or a single file via
 * `--file <path>`; `--presets-dir <path>` overrides discovery).
 */
import { readFile, readdir, access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, basename, resolve, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  compactionWireStatus,
  discoverPresetsDir,
  provisionWebCompaction,
  revertWebCompaction,
} from "../lib/web-provision.js";
import { contextGcStatusPath, readContextGcStatus, readPruneAttempts } from "../lib/status.js";
import { readLedger } from "../lib/ledger.js";
import { defaultSkillDir, exportSkills } from "../lib/skill-export.js";
import { workspaceKey } from "../lib/util.js";
import { ENGRAM_PRUNE_ROW_NAME } from "../lib/web-provision.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function log(line) {
  process.stdout.write(`${line}\n`);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const COMPOSITION_NAMES = ["agent.cordis.yml", "agent.json"];

async function compositionIn(dir) {
  for (const name of COMPOSITION_NAMES) {
    const candidate = join(dir, name);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

/** Well-known LEGACY preset roots (DSH ≤ 0.1.x: one directory per preset). */
function legacyPresetRoots() {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return [
    resolve(REPO_ROOT, "..", "deepseek-harness/apps/cli/config/agent-presets"),
    join(dshHome, ".agent-presets"),
  ];
}

/** The `dsh` bin on PATH — anchors declarative preset discovery. */
function dshBinAnchor() {
  try {
    const found = execFileSync("which", ["dsh"], { encoding: "utf8" }).trim();
    return found.length > 0 ? found : undefined;
  } catch {
    return undefined;
  }
}

/** Preset id from a composition file path (both generations). */
function presetIdFromPath(path) {
  const base = basename(path);
  if (base.endsWith(".patch.yml")) return base.slice(0, -".patch.yml".length);
  return basename(dirname(path));
}

/**
 * Discover preset compositions across BOTH generations, first match per id
 * wins (the roster shadows duplicates the same way):
 * 1. paths recorded by the last boot (authoritative for real installs);
 * 2. legacy roots (`<root>/<id>/agent.cordis.yml` or `agent.json`);
 * 3. declarative shipped presets (`<presetsDir>/<id>.patch.yml`).
 */
async function discoverPresets(status, presetsDirFlag) {
  const presets = [];
  const seenId = new Set();
  const seenPath = new Set();
  const push = (id, path) => {
    if (typeof path !== "string" || path.length === 0) return;
    if (seenId.has(id) || seenPath.has(path)) return;
    seenId.add(id);
    seenPath.add(path);
    presets.push({ id, path });
  };

  // 1. Recorded by the last boot.
  for (const entry of status?.web?.presets ?? []) {
    if (typeof entry?.path !== "string") continue;
    if (!(await exists(entry.path))) continue;
    const id = typeof entry.presetId === "string" ? entry.presetId : presetIdFromPath(entry.path);
    push(id, entry.path);
  }

  // 2. Legacy roots.
  for (const root of legacyPresetRoots()) {
    let entries = [];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = await compositionIn(join(root, entry.name));
      if (file === undefined) continue;
      push(entry.name, file);
    }
  }

  // 3. Declarative shipped presets.
  const presetsDir = discoverPresetsDir({
    presetsDir: presetsDirFlag,
    anchors: [dshBinAnchor()].filter((anchor) => typeof anchor === "string"),
  });
  if (presetsDir !== undefined) {
    let entries = [];
    try {
      entries = await readdir(presetsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".patch.yml")) continue;
      push(entry.name.slice(0, -".patch.yml".length), join(presetsDir, entry.name));
    }
  }
  return presets;
}

function hostLine(host) {
  if (host === "context-gc") return "Context GC（机械驱逐 + 重取指针）";
  if (host === "default") return "DSH 默认 LLM 摘要（gcReplacesCompaction:false）";
  if (host === "unavailable") return "未接管（引擎不可用）";
  return "未知（尚未记录）";
}

function webLine(entry) {
  const action = entry?.action ?? "?";
  switch (entry?.action) {
    case "swapped": return `已接管（${entry.path}）`;
    case "already": return `已接管 · 配置一致（${entry.path}）`;
    case "skipped": return `未接管 · ${entry.reason === "custom" ? "自定义/无 compaction 布局，不碰" : entry.reason ?? "跳过"}（${entry.path}）`;
    case "failed": return `失败 · ${entry.reason ?? "?"}（${entry.path}）`;
    default: return `${action} · ${entry?.path ?? "?"}`;
  }
}

/** One-line label for the web PLANE (distinct from a single preset report). */
function webPlaneLine(web) {
  const action = web?.action ?? "?";
  const count = (web?.presets ?? []).length;
  switch (action) {
    case "pending": return "启动中（agentPresets 尚未就绪）";
    case "disabled": return "未启用（autoWebCompaction=false；或用 npx dsh-engram enable 手动接管）";
    case "no-default": return "未发现可用预设";
    case "failed": return `失败 · ${web?.error ?? "?"}`;
    default: return `上次装配 ${action}，${count} 个预设`;
  }
}

/**
 * The snapshot's web plane, normalized against the recorded opt-in: a `pending`
 * plane while `autoWebCompaction=false` is impossible under the current plugin
 * (that state is `disabled`); old snapshots written before v0.7.1 can carry it.
 */
function effectiveWebPlane(status) {
  const web = status.web;
  if (status.configSource?.autoWebCompaction === false && (web === undefined || web.action === undefined || web.action === "pending")) {
    return { action: "disabled", presets: web?.presets ?? [] };
  }
  return web;
}

async function printStatus(presetsDirFlag) {
  const status = await readContextGcStatus();
  const presets = await discoverPresets(status, presetsDirFlag);

  log("── dsh-engram Context GC 状态 ──────────────────────────────");
  // The two ledger legs decide whether L1 is worth turning on at all: if the
  // host prunes far more than engram does, enabling it only repeats that work.
  // Printed regardless of the status snapshot (it is ledger data, not plugin
  // startup state).
  try {
    // Honour DSH_HOME like every other read in this CLI: without it the legs
    // line silently reports the real machine's ledger even under a sandbox.
    const ledger = readLedger({ home: join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "engram") });
    const rows = ledger.sessions ?? [];
    if (rows.length > 0) {
      const engram = rows.reduce((sum, row) => sum + (row.prunedChars ?? 0), 0);
      const host = ledger.hostPrunedChars ?? 0;
      const verdict =
        host > 0 && engram === 0
          ? "（宿主全干了，engram 一条没剪 → L1 开着只是重复劳动）"
          : host > engram * 5
            ? "（宿主腿远大于 engram 腿 → 先确认边界源有没有覆盖到你的用法）"
            : "";
      log(`  账本两条腿：engram 剪枝 ${engram} 字符 · 宿主自剪 ${host} 字符${verdict}`);
      log("");
    }
  } catch {}

  if (status === undefined) {
    log("  尚无状态文件（插件还没写过，或本机没跑过 dsh web）。");
  } else {
    log(`  状态快照：${new Date(status.writtenAt ?? 0).toLocaleString()}（插件上次启动时写入）`);
    log(`  host 平面：${hostLine(status.host)}`);
    log(`  web 平面：${webPlaneLine(effectiveWebPlane(status))}`);
    log(`  配置：autoWebCompaction=${status.configSource?.autoWebCompaction ?? "?"} · gcReplacesCompaction=${status.configSource?.gcReplacesCompaction ?? "?"} · gcNarrative=${status.configSource?.gcNarrative ?? "?"}`);
    if (status.boundaryPrune !== undefined) {
      const bp = status.boundaryPrune;
      log(`  L1 边界剪枝：${bp.armed ? "已武装" : "未启用"}${bp.reason ? `（${bp.reason}）` : ""}`);
      if (!bp.armed) {
        const reason = String(bp.reason ?? "");
        if (/boundaryPrune:false|config/i.test(reason)) {
          // Default off since v0.7.11 — not a misconfiguration.
          log("  说明：L1 自 0.7.11 起默认关闭（宿主会自己剪超阈值结果，边界源只在用 todo/goal 的规划型会话里有收益）。");
          log("  需要时在设置卡或 profile 里设 boundaryPrune: true；打开前先看上面那行「账本两条腿」。");
        } else {
          log("  ⚠ L1 未武装（服务缺失/装配问题）：此时账本只有注入支出，没有剪枝入账。");
        }
      }
    }
    const attempts = await readPruneAttempts(20).catch(() => []);
    if (attempts.length === 0) {
      log("  L1 边界尝试：0 次（还没有任何 todo/goal 边界出现过——注意「已武装」不等于「会开火」）");
    } else {
      const byPlane = new Map();
      const fired = attempts.filter((a) => a.kind === "fired" && a.pruned > 0);
      for (const a of attempts) byPlane.set(a.plane ?? "?", (byPlane.get(a.plane ?? "?") ?? 0) + 1);
      const planeLine = [...byPlane].map(([plane, n]) => `${plane} ${n}`).join(" · ");
      const last = attempts[attempts.length - 1];
      log(`  L1 边界尝试：${attempts.length} 次见过的边界（${planeLine}）· 真剪到东西的 ${fired.length} 次`);
      log(`    最近一次：${last.at ?? "?"} · ${last.kind}${last.boundary?.kind ? ` · ${last.boundary.kind}` : ""}${last.pruned !== undefined ? ` · 剪了 ${last.pruned} 条 / ${last.charsRemoved ?? 0} 字符` : ""}`);
    }
    if (status.configSource?.autoWebCompaction === false) {
      log("  ⚠ autoWebCompaction=false：web 平面不会自动接管（设置卡「记忆 GC」里打开后重启 dsh web）");
    }
  }

  log("");
  if (presets.length === 0) {
    log("  未发现任何 web 代理预设（声明式 presets 目录、旧版 shipped 根与用户根都找不到）。");
    log("  提示：声明式预设需要能找到 dsh 安装（PATH 上的 dsh 或在 dsh 进程内运行），也可用 --presets-dir 指定。");
  } else {
    const declarative = presets.filter((preset) => preset.path.endsWith(".patch.yml")).length;
    if (declarative > 0) {
      log(`  预设布局：声明式（dsh-web-app/presets/*.patch.yml，DSH ≥ 0.2.0）`);
    } else {
      log("  预设布局：旧版组合文件（agent.cordis.yml，DSH ≤ 0.1.x）");
    }
    log(`  ── web 预设现场（${presets.length} 个）──`);
    for (const preset of presets) {
      let text;
      try {
        text = await readFile(preset.path, "utf8");
      } catch {
        log(`  ${preset.id}: 无法读取`);
        continue;
      }
      const cs = compactionWireStatus(text);
      const hasPrune = text.includes(ENGRAM_PRUNE_ROW_NAME);
      const note = cs === "wired"
        ? `已接管（dsh-engram/compaction 行${hasPrune ? " + dsh-engram/prune 行" : " · 缺 prune 行：L1 在这个预设里看不见边界，重跑 enable 补齐"}）`
        : cs === "stock"
          ? "出厂布局，重启 dsh web 后自动接管"
          : "自定义/无 compaction，插件不碰";
      log(`  ${preset.id}: ${cs} — ${note}`);
    }
  }
  return status;
}

async function printDoctor(presetsDirFlag) {
  const status = await printStatus(presetsDirFlag);
  log("");
  log("── 建议（doctor）──────────────────────────────────────────");
  const presets = await discoverPresets(status, presetsDirFlag);
  const issues = [];
  const notes = [];

  if (status === undefined) {
    issues.push("尚无状态快照：把 dsh-engram 装进 profile 并启动一次（dsh web / dsh headless），插件会在启动时写入状态与自动装配。");
  } else {
    if (status.host !== "context-gc") {
      issues.push(
        `host 平面 ${status.host}：${status.host === "unavailable"
          ? "引擎不可用——确认 @deepseek-ai/dsh-compaction-basic 依赖已安装（见启动日志 dsh-compaction-basic unavailable）。"
          : "当前是 DSH 默认 LLM 摘要——要在 host 平面启用 Context GC，把 gcReplacesCompaction 设为 true。"}`,
      );
    }
    if (status.configSource?.autoWebCompaction === false) {
      issues.push("autoWebCompaction=false：web 平面不会自动接管（即便预设仍是 stock 布局）。在设置卡「记忆 GC」里打开，或改 profile patch 后重启 dsh web。");
    }
  }

  const stockLeft = presets.filter((p) => {
    try {
      return compactionWireStatus(readFileSyncSafe(p.path)) === "stock";
    } catch {
      return false;
    }
  });
  if (stockLeft.length > 0) {
    issues.push(`web 平面还有 ${stockLeft.length} 个出厂布局预设未接管（${stockLeft.map((p) => p.id).join("、")}）：重启 dsh web 让自动装配跑一次（需 autoWebCompaction=true），或 npx dsh-engram enable。`);
  }
  const customLeft = presets.filter((p) => {
    try {
      return compactionWireStatus(readFileSyncSafe(p.path)) === "custom";
    } catch {
      return false;
    }
  });
  if (customLeft.length > 0) {
    issues.push(`${customLeft.length} 个预设是自定义/无 compaction 布局（${customLeft.map((p) => p.id).join("、")}），插件不会碰；需要的话手动把 compaction 组换成 dsh-engram/compaction。`);
  }
  const wired = presets.filter((p) => compactionWireStatus(readFileSyncSafe(p.path)) === "wired");
  if (wired.length > 0) {
    issues.push("有预设已被接管：卸载 dsh-engram 前先 npx dsh-engram revert，避免预设留下悬空引用。");
    if (wired.some((p) => /[\\/]node_modules[\\/]/.test(p.path))) {
      notes.push("已接管的声明式预设在 node_modules 里（npm 更新 dsh 会恢复出厂布局）：保持 autoWebCompaction=true 时下次启动 dsh web 会自动重新接管，否则升级后手动 npx dsh-engram enable。");
    }
  }
  const overrides = await presetOverrides();
  if (overrides.length > 0) {
    notes.push(`profile patch 里有 preset 覆写行（${overrides.join("、")}）：Web 编辑器保存的 config.plugins 优先于 shipped 文件，改 shipped 文件可能不生效——请在编辑器里改，或删掉这些覆写行。`);
  }

  if (issues.length === 0) {
    log("  一切正常：host 平面 + 全部 stock 预设都已接管 Context GC。");
  } else {
    issues.forEach((line, index) => log(`  ${index + 1}. ${line}`));
  }
  notes.forEach((line) => log(`  · ${line}`));
}

/** `preset-*` rows saved in profile patches (Web-editor overrides). */
async function presetOverrides() {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  const profilesDir = join(dshHome, "profiles");
  let dirs = [];
  try {
    dirs = await readdir(profilesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const hits = new Set();
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    let text;
    try {
      text = await readFile(join(profilesDir, dir.name, "cordis.patch.yml"), "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(/^\s*- id: (preset-[\w.-]+)\s*$/gm)) hits.add(match[1]);
  }
  return [...hits].sort();
}

/** Read helper that never throws (used by the sync-style filtering above). */
function readFileSyncSafe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function toService(preset) {
  return {
    async resolve() {
      return { id: preset.id, path: preset.path };
    },
  };
}

async function runEnableRevert(command, fileFlag, presetsDirFlag) {
  const status = await readContextGcStatus();
  let presets;
  if (fileFlag !== undefined) {
    const abs = resolve(fileFlag);
    if (!(await exists(abs))) throw new Error(`file not found: ${abs}`);
    presets = [{ id: presetIdFromPath(abs), path: abs }];
  } else {
    presets = await discoverPresets(status, presetsDirFlag);
  }
  if (presets.length === 0) {
    log("未发现可操作预设。用 --file <path> 明确指定一个预设组合文件，或用 --presets-dir <path> 指定声明式预设目录。");
    return;
  }

  // Mirror the engine config the plugin last recorded, so a manual `enable`
  // does not temporarily flip the toggles away from the settings card.
  const rowConfig = status?.configSource !== undefined
    ? {
      gcReplacesCompaction: status.configSource.gcReplacesCompaction,
      gcNarrative: status.configSource.gcNarrative,
    }
    : undefined;

  log(`dsh-engram: ${command} — ${presets.length} 个预设`);
  let changed = 0;
  for (const preset of presets) {
    const service = toService(preset);
    const report = command === "enable"
      ? await provisionWebCompaction(service, { log, rowConfig })
      : await revertWebCompaction(service, { log });
    const entry = report.presets[0];
    log(`  ${preset.id}: ${entry?.action ?? report.action}${entry?.reason ? ` (${entry.reason})` : ""}`);
    if (entry?.action === "swapped" || entry?.action === "reverted") changed += 1;
  }
  if (command === "enable" && changed > 0) log("  下一步：重启 dsh web 让会话生效。");
  if (command === "revert" && changed > 0) log("  已全部还原为出厂 compaction 行——可以安全卸载 dsh-engram。");
}

/** Evidence gate defaults; mirrors lib/index.js (kept here so the CLI stays DSH-free). */
const SKILL_GATE = { procedureMinEvidence: 3, procedureMaxAgeDays: 14, promoteHits: 3 };

async function runSkillExport({ workspace, dir, home, dryRun }) {
  const storage = join(home, "storages", "dsh_engram.json");
  if (!(await exists(storage))) throw new Error(`找不到记忆库：${storage}（DSH 还没在这个机器上写过记忆？）`);
  const unit = JSON.parse(await readFile(storage, "utf8"));
  const table = unit?.tables?.memories ?? unit?.memories ?? {};
  const all = Array.isArray(table) ? table : Object.values(table);
  const key = workspaceKey(workspace);
  const rows = all.filter((m) => m?.workspace === key);
  const target = dir ?? defaultSkillDir(key);
  const report = exportSkills(rows, { config: SKILL_GATE, dir: target, dryRun });
  log(`skill export · workspace ${key} · ${rows.length} 条记忆 · 目标 ${target}${dryRun ? "（dry-run）" : ""}`);
  if (report.written.length > 0) log(`  写入 ${report.written.length}: ${report.written.join(", ")}`);
  if (report.unchanged.length > 0) log(`  未变 ${report.unchanged.length}: ${report.unchanged.join(", ")}`);
  if (report.removed.length > 0) log(`  移除（证据不再成立）${report.removed.length}: ${report.removed.join(", ")}`);
  for (const skip of report.skipped) log(`  跳过 ${skip}`);
  for (const error of report.errors) log(`  失败 ${error}`);
  if (report.written.length + report.unchanged.length + report.removed.length === 0 && report.skipped.length === 0) {
    log("  没有 procedure 通过证据门（≥3 次验证、14 天内、未失效）——无导出。");
  }
  log("  下一步：DSH 从项目根的 .dsh/skills 发现技能，catalog 里出现名字即生效（新会话无需重启）。");
}

async function main() {
  const [, , rawCommand, ...rest] = process.argv;
  const command = rawCommand ?? "status";
  const fileFlagIndex = rest.indexOf("--file");
  const fileFlag = fileFlagIndex >= 0 ? rest[fileFlagIndex + 1] : undefined;
  const presetsDirIndex = rest.indexOf("--presets-dir");
  const presetsDirFlag = presetsDirIndex >= 0 ? rest[presetsDirIndex + 1] : undefined;
  if (command === "skill") {
    const sub = rest[0];
    if (sub !== "export") throw new Error(`未知子命令 "skill ${sub ?? ""}"（用 skill export）`);
    const flag = (name) => {
      const at = rest.indexOf(name);
      return at >= 0 ? rest[at + 1] : undefined;
    };
    await runSkillExport({
      workspace: flag("--workspace") ?? process.cwd(),
      dir: flag("--dir"),
      home: flag("--home") ?? process.env.DSH_HOME ?? join(homedir(), ".dsh"),
      dryRun: rest.includes("--dry-run"),
    });
  } else if (command === "status") {
    await printStatus(presetsDirFlag);
  } else if (command === "doctor") {
    await printDoctor(presetsDirFlag);
  } else if (command === "enable" || command === "revert") {
    await runEnableRevert(command, fileFlag, presetsDirFlag);
  } else {
    throw new Error(`未知命令 "${command}"（用 status | doctor | enable | revert）`);
  }
}

await main().catch((error) => {
  process.stderr.write(`dsh-engram: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
});
