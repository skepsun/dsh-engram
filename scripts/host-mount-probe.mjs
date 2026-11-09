#!/usr/bin/env node
/**
 * 宿主面 compaction 挂载的真机探针（issues #12/#13 的回归证据）。
 *
 * 单测的「真 cordis + 真 backend」已经能复现那条缝，但它证明不了「真 dsh 宿主会把
 * llm/tokenMeter/sessions 供给到引擎自己的 fiber 上」。这个脚本把那次一次性验证
 * 固化成一条命令：
 *
 *   1. `npm pack` 本仓库（或 --tgz 指定的 tarball）
 *   2. 在 mkdtemp 出来的 DSH_HOME 里，用 `--from-default-profile web` 造一个一次性
 *      profile，`dsh plugin add` 装上被测 tarball
 *   3. 再装一个只做一件事的探针插件：boot 后 8s 调
 *      `ctx.compaction.compactIfNeeded(agent, "pressure")`，把结果写进 JSON
 *   4. `dsh --profile probe --patch <overlay> --port <n> --no-open` 起真宿主
 *   5. 读 JSON、杀进程、按结果给退出码
 *
 * 用法：
 *   node scripts/host-mount-probe.mjs                 # 本仓库，默认配置
 *   node scripts/host-mount-probe.mjs --gc            # gcReplacesCompaction: true
 *   node scripts/host-mount-probe.mjs --tgz old.tgz   # 对照：装上旧 tarball 应复现报错
 *   node scripts/host-mount-probe.mjs --port 3199 --keep
 *
 * 退出码：0 = pressure 路径跑通；1 = 引擎报了 inject 错；2 = 没拿到读数（boot 失败）。
 * 不联网、不调模型：只 boot 宿主，不跑任何会话。
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DSH_BIN = process.env.PROBE_DSH_BIN || "dsh";

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}
const GC_MODE = process.argv.includes("--gc");
const KEEP = process.argv.includes("--keep");
const PORT = Number(arg("--port", "3199"));
const TGZ = arg("--tgz");
const WAIT_MS = Number(arg("--wait", "60000"));

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function packRepo(dest) {
  mkdirSync(dest, { recursive: true });
  const out = sh("npm", ["pack", "--pack-destination", dest], { cwd: ROOT });
  const name = out.trim().split("\n").at(-1).trim();
  return join(dest, name);
}

/** The probe plugin: no config, no deps, one timer, one write. */
const PROBE_SOURCE = `import fs from "node:fs";
export const name = "engram-host-probe";
export const inject = ["compaction"];
const OUT = process.env.PROBE_OUT;
export function apply(ctx) {
  const timer = setTimeout(async () => {
    const result = { at: new Date().toISOString(), pid: process.pid };
    try {
      const status = JSON.parse(fs.readFileSync(process.env.DSH_HOME + "/engram/context-gc.status.json", "utf8"));
      result.host = status.host;
      result.config = status.config;
    } catch (error) { result.statusError = String(error?.message ?? error); }
    try {
      // Enough of the Session surface for the real token meter to fold an empty
      // log: it walks \`seq\` through \`eventAt()\` and lazily builds projection
      // cells through \`snapshotEvents()\`. Without these it throws before the
      // engine ever reads its own ctx, which would prove nothing.
      const agent = {
        session: {
          id: "probe-session",
          header: { id: "probe-session", cwd: "/tmp" },
          inheritedEventCount: 0,
          seq: 0,
          messages: [],
          events: [],
          eventAt: () => void 0,
          snapshotEvents: () => [],
          requestHeader: () => ({ config: { provider: "deepseek-official", model: "deepseek-flash" } }),
        },
        options: {},
      };
      const out = await ctx.compaction.compactIfNeeded(agent, "pressure", new AbortController().signal);
      result.pressure = { ok: true, result: out ?? null };
    } catch (error) {
      result.pressure = { ok: false, error: String(error?.message ?? error), stack: String(error?.stack ?? "").split("\\n").slice(0, 6) };
    }
    fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  }, 8000);
  ctx.effect(() => () => clearTimeout(timer));
}
`;

const PROBE_PKG = JSON.stringify(
  { name: "dsh-engram-host-probe", version: "1.0.0", private: true, type: "module", main: "index.js", files: ["index.js"] },
  null,
  1,
);

function packProbe(dest) {
  const src = join(dest, "probe-src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "index.js"), PROBE_SOURCE);
  writeFileSync(join(src, "package.json"), PROBE_PKG);
  const out = sh("npm", ["pack", "--pack-destination", dest], { cwd: src });
  return join(dest, out.trim().split("\n").at(-1).trim());
}

function overlay(file, gc) {
  writeFileSync(
    file,
    [
      "# one-off overlay: the probe row, plus the GC-mode config when asked",
      gc ? "- id: engram\n  config:\n    gcReplacesCompaction: true" : "# (default config)",
      "- insert:\n    - id: engram-host-probe\n      name: dsh-engram-host-probe",
      "",
    ].join("\n"),
  );
}

const home = mkdtempSync(join(tmpdir(), "engram-host-probe-"));
const outFile = join(home, "probe.json");
const env = { ...process.env, DSH_HOME: home, PROBE_OUT: outFile };
let child;
let exitCode = 2;

try {
  const tgz = TGZ ? resolve(TGZ) : packRepo(join(home, "pkg"));
  if (!existsSync(tgz)) throw new Error(`tarball not found: ${tgz}`);
  console.log(`plugin: ${tgz}`);

  sh(DSH_BIN, ["--profile", "probe", "--from-default-profile", "web", "--dump-config"], { env });
  sh(DSH_BIN, ["plugin", "--profile", "probe", "add", tgz], { env, stdio: ["ignore", "pipe", "inherit"] });
  sh(DSH_BIN, ["plugin", "--profile", "probe", "add", packProbe(join(home, "probe-tgz"))], {
    env,
    stdio: ["ignore", "pipe", "inherit"],
  });

  const patch = join(home, "probe.patch.yml");
  overlay(patch, GC_MODE);

  console.log(`booting dsh ${GC_MODE ? "(gcReplacesCompaction: true) " : ""}on :${PORT} …`);
  child = spawn(
    DSH_BIN,
    ["--profile", "probe", "--patch", patch, "--port", String(PORT), "--no-open"],
    { env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline && !existsSync(outFile)) {
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!existsSync(outFile)) {
    console.error(`no reading after ${WAIT_MS}ms — host log tail:\n${log.slice(-2000)}`);
  } else {
    const result = JSON.parse(readFileSync(outFile, "utf8"));
    console.log(JSON.stringify(result, null, 1));
    exitCode = result.pressure?.ok === true ? 0 : 1;
  }
} finally {
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  if (!KEEP) rmSync(home, { recursive: true, force: true });
  else console.log(`kept ${home}`);
}

process.exit(exitCode);
