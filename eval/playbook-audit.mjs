#!/usr/bin/env node
/**
 * v0.8-A playbook audit.
 *
 * Two questions, one deterministic and one observational:
 *
 *  1. INJECTION TEST (hermetic): inject 10 procedures that look authoritative
 *     (`fixed:` auto-captures) but are stale or wrong. Do they stay out of the
 *     [ENGRAM] index, and does the first re-failure invalidate each of them?
 *     The proposal asks for "10 stale procedures invalidated within 7 days";
 *     the mechanism invalidates on the FIRST failure, so the test injects the
 *     failures and asserts 10/10 rather than waiting a week.
 *
 *  2. LIVE STATS: what the real store currently holds — how many procedures
 *     exist, how many are promoted, invalidated, or still unproven. This is the
 *     numerator/denominator for the reuse gate; it is reported, not judged,
 *     until there is a population.
 *
 *   node eval/playbook-audit.mjs [--md]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { openEngramDomain } from "../lib/store.js";
import { isProvenProcedure, procedureInvalidated, selectIndexMemories } from "../lib/index-block.js";

const DAY = 24 * 60 * 60 * 1000;

const CONFIG = {
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  procedureMinEvidence: 3,
  procedureMaxAgeDays: 14,
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  maxTasksPerWorkspace: 40,
};

function fakeFacility() {
  const tables = new Map();
  return {
    open(spec) {
      for (const name of Object.keys(spec.tables)) tables.set(name, new Map());
      return Promise.resolve({
        table(name) {
          const map = tables.get(name);
          return {
            get: (k) => map.get(k),
            put: (k, v) => Promise.resolve(map.set(k, v)),
            delete: (k) => Promise.resolve(map.delete(k)),
            entries: () => map.entries(),
          };
        },
        close: () => Promise.resolve(),
      });
    },
  };
}

async function injectionTest(nowMs) {
  const domain = await openEngramDomain(fakeFacility());
  const ids = [];
  for (let i = 0; i < 10; i += 1) {
    const { stored } = await domain.storeMemory(
      {
        workspace: "/ws",
        kind: "procedure",
        text: `fixed: npm run step-${i} — 1 earlier failing run now succeed`,
        tags: ["procedure", "auto-captured", "fix", `cmd:npm_run`],
        signal: 0.45,
        sessionId: "s1",
        seq: i + 1,
        evidenceCount: 3,
        // Stale: verified 30 days ago, well outside the 14-day freshness window.
        lastVerifiedAt: nowMs - 30 * DAY,
      },
      CONFIG,
    );
    ids.push(stored.id);
  }

  const staleConfig = { ...CONFIG, nowMs };
  const indexedStale = selectIndexMemories(domain, "/ws", staleConfig).filter((m) => m.kind === "procedure").length;

  // Freshly re-verified they WOULD be promoted — proves the test is looking at
  // freshness, not at something that can never pass.
  const control = ids.map(async (id) => domain.recordProcedureOutcome("/ws", id, { ok: true, at: nowMs }));
  await Promise.all(control);
  const indexedFresh = selectIndexMemories(domain, "/ws", staleConfig).filter((m) => m.kind === "procedure").length;

  // Now each one breaks: the first re-failure must invalidate it.
  let invalidated = 0;
  for (const id of ids) {
    await domain.recordProcedureOutcome("/ws", id, { ok: false, at: nowMs + 1000, errorId: "err-injected" });
    const row = domain.listMemories("/ws", 200).find((m) => m.id === id);
    if (row !== undefined && procedureInvalidated(row) && row.invalidatedBy === "err-injected") invalidated += 1;
  }
  const indexedAfter = selectIndexMemories(domain, "/ws", { ...CONFIG, nowMs: nowMs + 1000 }).filter((m) => m.kind === "procedure").length;
  await domain.close();

  return {
    injected: 10,
    indexedWhileStale: indexedStale,
    indexedAfterReverify: indexedFresh,
    invalidated,
    indexedAfterFailure: indexedAfter,
    pass: indexedStale === 0 && indexedFresh === 10 && invalidated === 10 && indexedAfter === 0,
  };
}

function liveStats(home) {
  // The domain lives in the DSH storage unit, not in the engram home dir.
  const file = path.join(home, "storages", "dsh_engram.json");
  if (!fs.existsSync(file)) return null;
  let rows;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    // Storage unit shape: { unit, global, tables: { memories, tasks, … } }.
    const table = parsed.tables?.memories ?? parsed.memories ?? {};
    rows = Array.isArray(table) ? table : Object.values(table);
  } catch {
    return null;
  }
  const procedures = rows.filter((m) => m.kind === "procedure" && m.status !== "archived");
  const auto = procedures.filter((m) => (m.tags ?? []).includes("auto-captured"));
  const nowMs = Date.now();
  return {
    total: procedures.length,
    autoCaptured: auto.length,
    promoted: procedures.filter((m) => isProvenProcedure(m, { ...CONFIG, nowMs })).length,
    invalidated: procedures.filter((m) => procedureInvalidated(m)).length,
    unproven: auto.filter((m) => !isProvenProcedure(m, { ...CONFIG, nowMs }) && !procedureInvalidated(m)).length,
  };
}

const args = process.argv.slice(2);
const md = args.includes("--md");
const home = args.includes("--home") ? args[args.indexOf("--home") + 1] : path.join(os.homedir(), ".dsh");
const nowMs = Date.now();

const test = await injectionTest(nowMs);
const live = liveStats(home);

const lines = [
  md ? "# v0.8-A playbook audit\n" : "v0.8-A playbook audit",
  "",
  "## 失效注入测试（10 个过时/错误 procedure）",
  "",
  md ? "| 阶段 | 期望 | 实测 |" : null,
  md ? "|---|---|---|" : null,
  md ? `| 过时（30 天未验证）时在索引里 | 0 | ${test.indexedWhileStale} |` : `stale-in-index ${test.indexedWhileStale} (want 0)`,
  md ? `| 刚重新验证后（对照） | 10 | ${test.indexedAfterReverify} |` : `reverified-in-index ${test.indexedAfterReverify} (want 10)`,
  md ? `| 首次再失败后失效 | 10 | ${test.invalidated} |` : `invalidated ${test.invalidated} (want 10)`,
  md ? `| 失效后仍在索引里 | 0 | ${test.indexedAfterFailure} |` : `indexed-after-failure ${test.indexedAfterFailure} (want 0)`,
].filter((line) => line !== null);

lines.push("", md ? `**注入测试 ${test.pass ? "PASS" : "FAIL"}**` : `injection test: ${test.pass ? "PASS" : "FAIL"}`);

if (live === null) {
  lines.push("", "## 线上账本", "", "no storages/dsh_engram.json under " + home);
} else {
  lines.push(
    "",
    "## 线上账本（报告，不判定）",
    "",
    md ? "| 项 | 值 |" : null,
    md ? "|---|---|" : null,
    md ? `| procedure 总数 | ${live.total} |` : `procedures ${live.total}`,
    md ? `| 其中 auto-captured | ${live.autoCaptured} |` : `auto-captured ${live.autoCaptured}`,
    md ? `| 已晋升（证据足） | ${live.promoted} |` : `promoted ${live.promoted}`,
    md ? `| 已失效 | ${live.invalidated} |` : `invalidated ${live.invalidated}`,
    md ? `| 未证明（不进索引） | ${live.unproven} |` : `unproven ${live.unproven}`,
  );
  lines.push(
    "",
    live.promoted + live.invalidated + live.unproven === 0
      ? "账本里还没有 procedure——复用率与晋升率暂无分母（未测，不猜）。"
      : "复用率需要「被召回后被引用」的遥测，当前只有晋升/失效计数。",
  );
}

console.log(lines.filter((line) => line !== null).join("\n"));
process.exitCode = test.pass ? 0 : 1;
