#!/usr/bin/env node
/**
 * dsh-engram 开发/本地链接安装依赖脚本（跨平台）。
 *
 * 为什么需要它：
 *   dsh-engram 宿主侧运行期 import：
 *     - zod（registry 唯一外部依赖）
 *     - @deepseek-ai/{dsh-settings,dsh-storage-domain,schemastery}（harness 工作区包）
 *   当插件以 `link:` 方式进 profile 时，Node 从插件的真实路径向上解析 import，
 *   这层 node_modules 不随 git 分发，换机器就会 ERR_MODULE_NOT_FOUND。本脚本
 *   一条命令重建：
 *     - zod            → 复用 harness pnpm store 的 zod@4.x，找不到则 `npm install`
 *     - @deepseek-ai/* → 符号链接到 harness 工作区（同 checkout 即同版本）
 *
 * 用法：
 *   node scripts/setup-links.mjs            # 建立/修复依赖链接
 *   node scripts/setup-links.mjs --check    # 只检查并打印，不写入
 *
 * 环境变量：
 *   DSH_HARNESS_DIR   harness checkout 路径（默认取仓库上一级 ../deepseek-harness）
 */

import { existsSync, mkdirSync, readdirSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NODE_MODULES = join(REPO_ROOT, "node_modules");
const SCOPE = join(NODE_MODULES, "@deepseek-ai");
const CHECK_ONLY = process.argv.includes("--check");
const IS_WIN = process.platform === "win32";

function looksLikeHarness(dir) {
  return (
    existsSync(join(dir, "vendor", "schemastery", "package.json")) &&
    existsSync(join(dir, "packages", "settings", "settings", "package.json"))
  );
}

/** Locate the harness checkout directory. */
function findHarness() {
  if (process.env.DSH_HARNESS_DIR) {
    const p = resolve(process.env.DSH_HARNESS_DIR);
    if (!existsSync(p)) throw new Error(`DSH_HARNESS_DIR 不存在: ${p}`);
    return p;
  }
  // common layouts:
  //   harness/  + repo at harness/../deepseek-harness          (sibling of repo)
  //   E:\deepseek-harness + E:\kototoro_demo\dsh-engram          (sibling of repo's parent)
  for (const candidate of [
    resolve(REPO_ROOT, "..", "deepseek-harness"),       // 与仓库平级
    resolve(REPO_ROOT, "..", "..", "deepseek-harness"), // 与仓库父级平级
  ]) {
    if (looksLikeHarness(candidate)) return candidate;
  }
  let dir = dirname(REPO_ROOT);
  for (let i = 0; i < 5; i++) {
    if (looksLikeHarness(dir)) return dir;
    dir = dirname(dir);
  }
  throw new Error(
    "找不到 deepseek-harness checkout：请设置 DSH_HARNESS_DIR，或把 dsh-engram 放到 " +
      "harness 兄弟目录（../deepseek-harness / ../../deepseek-harness）。",
  );
}

/** Newest zod@4 package dir inside the harness pnpm store, or null. */
function findStoreZod(harness) {
  const store = join(harness, "node_modules", ".pnpm");
  if (!existsSync(store)) return null;
  let best = null;
  let bestMajor = -1;
  for (const name of readdirSync(store)) {
    const m = /^zod@(\d+)\./.exec(name);
    if (!m) continue;
    const major = Number(m[1]);
    const pkgDir = join(store, name, "node_modules", "zod");
    if (existsSync(join(pkgDir, "package.json")) && major > bestMajor) {
      best = pkgDir;
      bestMajor = major;
    }
  }
  return best;
}

/**
 * The dependency plan: label -> mount point -> source inside the harness.
 * zod's source is resolved from the pnpm store (or null → npm install).
 */
function buildPlan(harness) {
  const zodDir = findStoreZod(harness);
  const plan = [
    {
      label: "zod",
      mount: join(NODE_MODULES, "zod"),
      target: zodDir,
      npmInstall: zodDir === null,
    },
    {
      label: "@deepseek-ai/dsh-settings",
      mount: join(SCOPE, "dsh-settings"),
      target: join(harness, "packages", "settings", "settings"),
    },
    {
      label: "@deepseek-ai/dsh-storage-domain",
      mount: join(SCOPE, "dsh-storage-domain"),
      target: join(harness, "packages", "storage", "storage-domain"),
    },
    {
      label: "@deepseek-ai/schemastery",
      mount: join(SCOPE, "schemastery"),
      target: join(harness, "vendor", "schemastery"),
    },
  ];
  return plan;
}

/**
 * A mount is "installed" when it is:
 *   - a symlink/junction pointing at the expected source, or
 *   - a real directory carrying a package.json (e.g. `npm install` output).
 */
function isInstalled(mount, expected) {
  if (existsSync(mount)) {
    try {
      if (resolve(readlinkSync(mount)) === resolve(expected)) return true;
    } catch {
      /* not a symlink — fall through */
    }
    if (existsSync(join(mount, "package.json"))) return true;
  }
  return false;
}

function ensureLink(item) {
  const { label, mount, target, npmInstall } = item;
  if (npmInstall && target === null) {
    if (CHECK_ONLY) {
      console.log(`  ! ${label}: harness store 无 zod，需运行 \`npm install\``);
      return;
    }
    console.log(`  … ${label}: harness store 无 zod，执行 npm install（请稍候）`);
    const npm = IS_WIN ? "npm.cmd" : "npm";
    const r = spawnSync(npm, ["install", "--no-audit", "--no-fund"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: IS_WIN,
    });
    if (r.status !== 0) {
      console.error(`  ! ${label}: npm install 失败（exit ${r.status}）`);
      return;
    }
    console.log(`  + ${label}: npm install 完成`);
    return;
  }
  if (!existsSync(target)) {
    console.log(`  ! ${label}: 源不存在（${target}），请检查 harness checkout`);
    return;
  }
  if (existsSync(mount)) {
    if (isInstalled(mount, target)) {
      console.log(`  ✓ ${label} -> ${target}`);
      return;
    }
    if (CHECK_ONLY) {
      console.log(`  ! ${label}: ${mount} 已存在但状态异常，运行脚本修复`);
      return;
    }
    // 允许替换：符号链接直接 unlink；pnpm 预建的空目录用 rmdir 清掉。
    try {
      unlinkSync(mount);
      console.log(`  ~ ${label}: 替换旧链接`);
      return;
    } catch {
      /* not a symlink */
    }
    try {
      if (readdirSync(mount).length === 0) {
        rmdirSync(mount);
        console.log(`  ~ ${label}: 移除空目录后重建`);
      } else {
        console.log(`  ! ${label}: ${mount} 是含文件的真实目录，无法自动替换，请手动清理后重试`);
        return;
      }
    } catch {
      console.log(`  ! ${label}: ${mount} 无法自动替换，请手动清理后重试`);
      return;
    }
  }
  if (CHECK_ONLY) {
    console.log(`  ! ${label}: 缺失（需创建）`);
    return;
  }
  mkdirSync(dirname(mount), { recursive: true });
  symlinkSync(target, mount, IS_WIN ? "junction" : "dir");
  console.log(`  + ${label} -> ${target}`);
}

try {
  const harness = findHarness();
  console.log(`repo    : ${REPO_ROOT}`);
  console.log(`harness : ${harness}`);
  for (const item of buildPlan(harness)) ensureLink(item);

  // Self-verify: the whole host module graph must resolve now — this is the
  // exact condition `dsh web` needs at boot (no more ERR_MODULE_NOT_FOUND).
  const entry = pathToFileURL(join(REPO_ROOT, "lib", "index.js")).href;
  const check = spawnSync(
    process.execPath,
    ["--input-type=module", "-e",
      `import(${JSON.stringify(entry)}).then(()=>console.log("host imports OK: " + ${JSON.stringify(entry)})).catch((e)=>{console.error("host imports FAIL: "+e.message);process.exit(1)})`],
    { encoding: "utf8" },
  );
  const out = (check.stdout || check.stderr || "").toString().trim();
  console.log(`自检 : ${out || "（无输出，exit " + check.status + "）"}`);
  if (check.status !== 0) {
    console.error("依赖自检未通过，请检查上方输出后重试（或不放心先跑 --check 看看）。");
    process.exit(1);
  }
} catch (error) {
  console.error(`setup-links 失败: ${error.message}`);
  process.exit(1);
}
