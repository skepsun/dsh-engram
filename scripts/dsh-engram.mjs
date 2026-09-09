#!/usr/bin/env node
/**
 * dsh-engram CLI — the from-scratch user's window into Context GC.
 *
 *   npx dsh-engram status    # what is Context GC doing right now (host + web)
 *   npx dsh-engram doctor    # status + ranked next steps for the gaps it finds
 *   npx dsh-engram enable    # re-run the boot-time web auto-wiring (usually a no-op)
 *   npx dsh-engram revert    # restore the stock compaction rows everywhere —
 *                            #   run BEFORE uninstalling dsh-engram
 *
 * `status`/`doctor` read the durable snapshot the plugin writes at boot
 * (`$DSH_HOME/engram/context-gc.status.json`) and cross-check the live preset
 * files. `enable`/`revert` act on preset compositions found under the shipped
 * and user preset roots (or a single file via `--file <path>`).
 */
import { readFile, readdir, access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, basename, resolve, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  compactionWireStatus,
  provisionWebCompaction,
  revertWebCompaction,
} from "../lib/web-provision.js";
import { contextGcStatusPath, readContextGcStatus } from "../lib/status.js";

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

/** Preset roots this CLI can act on: last-boot facts + the two well-known ones. */
async function discoverRoots(status) {
  const roots = [];
  const seen = new Set();
  const push = (root) => {
    const abs = resolve(root);
    if (seen.has(abs)) return;
    seen.add(abs);
    roots.push(abs);
  };
  // Recorded directly from the last boot (authoritative for real installs).
  for (const entry of status?.web?.presets ?? []) {
    if (typeof entry?.path === "string") push(dirname(entry.path));
  }
  // Well-known roots: shipped harness + the user root.
  push(resolve(REPO_ROOT, "..", "deepseek-harness/apps/cli/config/agent-presets"));
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  push(join(dshHome, ".agent-presets"));
  return roots;
}

/** Discover preset compositions, shadowing duplicate ids like the roster does. */
async function discoverPresets(status) {
  const seen = new Set();
  const presets = [];
  for (const root of await discoverRoots(status)) {
    let entries = [];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (seen.has(entry.name)) continue;
      const file = await compositionIn(join(root, entry.name));
      if (file === undefined) continue;
      seen.add(entry.name);
      presets.push({ id: entry.name, path: file });
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

async function printStatus() {
  const status = await readContextGcStatus();
  const presets = await discoverPresets(status);

  log("── dsh-engram Context GC 状态 ──────────────────────────────");
  if (status === undefined) {
    log("  尚无状态文件（插件还没写过，或本机没跑过 dsh web）。");
  } else {
    log(`  状态快照：${new Date(status.writtenAt ?? 0).toLocaleString()}（插件上次启动时写入）`);
    log(`  host 平面：${hostLine(status.host)}`);
    log(`  web 平面：${status.web?.action === "pending" ? "启动中（agentPresets 尚未就绪）" : `上次装配 ${status.web?.action ?? "?"}，${(status.web?.presets ?? []).length} 个预设`}`);
    log(`  配置：autoWebCompaction=${status.configSource?.autoWebCompaction ?? "?"} · gcReplacesCompaction=${status.configSource?.gcReplacesCompaction ?? "?"} · gcNarrative=${status.configSource?.gcNarrative ?? "?"}`);
  }

  log("");
  if (presets.length === 0) {
    log("  未发现任何 web 代理预设（shipped 根与用户根都找不到）。");
  } else {
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
      const note = cs === "wired"
        ? "已接管（dsh-engram/compaction 行）"
        : cs === "stock"
          ? "出厂布局，重启 dsh web 后自动接管"
          : "自定义/无 compaction，插件不碰";
      log(`  ${preset.id}: ${cs} — ${note}`);
    }
  }
  return status;
}

async function printDoctor() {
  const status = await printStatus();
  log("");
  log("── 建议（doctor）──────────────────────────────────────────");
  const prev = status?.web?.presets ?? [];
  const presets = await discoverPresets(status);
  const issues = [];

  if (status === undefined) {
    issues.push("尚无状态快照：把 dsh-engram 装进 profile 并启动一次（dsh web / dsh headless），插件会在启动时写入状态与自动装配。");
  } else if (status.host !== "context-gc") {
    issues.push(
      `host 平面 ${status.host}：${status.host === "unavailable"
        ? "引擎不可用——确认 @deepseek-ai/dsh-compaction-basic 依赖已安装（见启动日志 dsh-compaction-basic unavailable）。"
        : "当前是 DSH 默认 LLM 摘要——要在 host 平面启用 Context GC，把 gcReplacesCompaction 设为 true。"}`,
    );
  }

  const stockLeft = presets.filter((p) => {
    try {
      return compactionWireStatus(readFileSyncSafe(p.path)) === "stock";
    } catch {
      return false;
    }
  });
  if (stockLeft.length > 0) {
    issues.push(`web 平面还有 ${stockLeft.length} 个出厂布局预设未接管（${stockLeft.map((p) => p.id).join("、")}）：重启 dsh web 让自动装配跑一次，或 npx dsh-engram enable。`);
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
  if (presets.some((p) => compactionWireStatus(readFileSyncSafe(p.path)) === "wired")) {
    issues.push("有预设已被接管：卸载 dsh-engram 前先 npx dsh-engram revert，避免预设留下悬空引用。");
  }
  if (issues.length === 0) {
    log("  一切正常：host 平面 + 全部 stock 预设都已接管 Context GC。");
    return;
  }
  issues.forEach((line, index) => log(`  ${index + 1}. ${line}`));
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

async function runEnableRevert(command, fileFlag) {
  const status = await readContextGcStatus();
  let presets;
  if (fileFlag !== undefined) {
    const abs = resolve(fileFlag);
    if (!(await exists(abs))) throw new Error(`file not found: ${abs}`);
    presets = [{ id: basename(dirname(abs)), path: abs }];
  } else {
    presets = await discoverPresets(status);
  }
  if (presets.length === 0) {
    log("未发现可操作预设。用 --file <path> 明确指定一个预设组合文件。");
    return;
  }

  log(`dsh-engram: ${command} — ${presets.length} 个预设`);
  let changed = 0;
  for (const preset of presets) {
    const service = toService(preset);
    const report = command === "enable"
      ? await provisionWebCompaction(service, { log })
      : await revertWebCompaction(service, { log });
    const entry = report.presets[0];
    log(`  ${preset.id}: ${entry?.action ?? report.action}${entry?.reason ? ` (${entry.reason})` : ""}`);
    if (entry?.action === "swapped" || entry?.action === "reverted") changed += 1;
  }
  if (command === "enable" && changed > 0) log("  下一步：重启 dsh web 让会话生效。");
  if (command === "revert" && changed > 0) log("  已全部还原为出厂 compaction 行——可以安全卸载 dsh-engram。");
}

async function main() {
  const [, , rawCommand, ...rest] = process.argv;
  const command = rawCommand ?? "status";
  const fileFlagIndex = rest.indexOf("--file");
  const fileFlag = fileFlagIndex >= 0 ? rest[fileFlagIndex + 1] : undefined;
  if (command === "status") {
    await printStatus();
  } else if (command === "doctor") {
    await printDoctor();
  } else if (command === "enable" || command === "revert") {
    await runEnableRevert(command, fileFlag);
  } else {
    throw new Error(`未知命令 "${command}"（用 status | doctor | enable | revert）`);
  }
}

await main().catch((error) => {
  process.stderr.write(`dsh-engram: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
});
