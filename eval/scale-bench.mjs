#!/usr/bin/env node
/**
 * dsh-engram scale benchmark (1,500+ memories in one workspace).
 *
 * Real users (e.g. issue #9) already accumulate 1,400+ memories in a single
 * workspace. `eval/recall-bench.mjs` tests 13 seeded memories — this script
 * verifies that BOTH retrieval quality AND hot-path latency hold up when the
 * workspace is near its default cap (`maxMemoriesPerWorkspace = 2000`):
 *
 *   1. Retrieval accuracy under heavy noise (1,500 distractors + ground-truth
 *      needles across EN, CJK, multi-term, tag-exact, supersede, negatives);
 *   2. G5 budget invariant (`renderIndex` ≤ 700 chars even with 1,500+ rows);
 *   3. Hot-path latency (p50 / p95 / max ms) for `recall`, `renderIndex`,
 *      `renderStartRecall`, and `summarize`.
 *
 * Run: npm run bench:scale   (deterministic, offline, zero-LLM).
 */

import { performance } from "node:perf_hooks";

import { openEngramDomain } from "../lib/store.js";
import { renderIndex, renderStartRecall } from "../lib/index-block.js";
import { workspaceKey } from "../lib/util.js";

const WS = workspaceKey("/home/u/projs/scale-bench");
const DISTRACTORS = 1500;
const DAY = 86_400_000;
const NOW = Date.now();

const CONFIG = {
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  maxTasksPerWorkspace: 40,
  autoRecallOnStart: true,
  autoRecallMaxItems: 3,
  autoRecallMinScore: 0.35,
  autoRecallMaxChars: 600,
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

const KINDS = ["fact", "decision", "error", "procedure", "insight", "handoff", "preference", "episode"];
const MODULES = [
  "scheduler", "transport", "cache", "parser", "renderer", "auth", "billing",
  "telemetry", "indexer", "worker", "gateway", "storage", "metrics", "router",
];
const VERBS = [
  "retries", "flushes", "batches", "validates", "rotates", "snapshots",
  "throttles", "normalizes", "hydrates", "evicts", "merges", "verifies",
];
const CJK_TOPICS = [
  "配置热重载", "连接池回收", "日志切分", "超时退避", "队列背压",
  "心跳探活", "权限校验", "灰度发布", "指标聚合", "缓存预热",
];

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

function measure(iters, fn) {
  const times = [];
  let last;
  for (let i = 0; i < iters; i += 1) {
    const t0 = performance.now();
    last = fn(i);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {
    p50: percentile(times, 0.5),
    p95: percentile(times, 0.95),
    max: times[times.length - 1],
    last,
  };
}

async function main() {
  const domain = await openEngramDomain(fakeFacility());

  // 1. Seed 1,500 deterministic distractors (mixed EN + CJK, varied kinds/ages).
  const tSeed0 = performance.now();
  for (let i = 0; i < DISTRACTORS; i += 1) {
    const kind = KINDS[i % KINDS.length];
    const mod = MODULES[i % MODULES.length];
    const verb = VERBS[(i * 7) % VERBS.length];
    const topic = CJK_TOPICS[(i * 3) % CJK_TOPICS.length];
    const text = i % 3 === 0
      ? `[${mod}#${i}] ${topic}：第 ${i} 轮压测记录，窗口 ${(i % 60) + 1}s，阈值 ${(i % 16) * 128}KB`
      : `[${mod}#${i}] service ${mod} ${verb} batch-${i} under load tier ${(i % 5) + 1} with shard-${i % 32}`;
    await domain.storeMemory(
      {
        workspace: WS,
        kind,
        text,
        tags: [mod, `shard-${i % 32}`, kind],
        entity: i % 4 === 0 ? `ent_${mod}` : null,
        sessionId: `sess-${i % 60}`,
        signal: kind === "episode" ? 0.35 : 0.45 + (i % 4) * 0.1,
        createdAt: NOW - ((i % 90) + 1) * DAY,
      },
      CONFIG,
    );
  }

  // 2. Seed ground-truth needles buried inside the 1,500-memory workspace.
  const needles = [
    {
      key: "wasmBridge",
      kind: "decision",
      text: "Replaced native neon binding with wasm-bridge-v3 to eliminate ABI rebuilds on Node 24",
      tags: ["wasm-bridge", "abi", "node24"],
      entity: "ent_wasm_bridge",
      signal: 0.85,
      ageDays: 12,
    },
    {
      key: "cjkManual",
      kind: "procedure",
      text: "季度证书轮换手册：先跑 cert-preflight 校验链完整性，再滚动重启边缘网关",
      tags: ["证书轮换", "边缘网关"],
      entity: "ent_cert_ops",
      signal: 0.85,
      ageDays: 8,
    },
    {
      key: "cjkMixed",
      kind: "error",
      text: "Windows 盘符大小写导致 workspaceKey 不一致，渲染层 [ENGRAM] 静默返回空块",
      tags: ["win32", "workspaceKey", "盘符"],
      entity: "ent_workspace_key",
      signal: 0.8,
      ageDays: 5,
    },
    {
      key: "staleOld",
      kind: "decision",
      text: "Legacy replication mode uses single-leader async-mirror-v1 over TCP 7440",
      tags: ["replication", "async-mirror"],
      entity: "ent_replication",
      signal: 0.75,
      ageDays: 30,
    },
  ];

  const ids = {};
  for (const n of needles) {
    const m = await domain.storeMemory(
      {
        workspace: WS,
        kind: n.kind,
        text: n.text,
        tags: n.tags,
        entity: n.entity,
        sessionId: "sess-needle",
        signal: n.signal,
        createdAt: NOW - n.ageDays * DAY,
      },
      CONFIG,
    );
    ids[n.key] = m.id;
  }
  const newerRepl = await domain.storeMemory(
    {
      workspace: WS,
      kind: "decision",
      text: "Current replication mode switched to quorum-raft-v2 over mTLS 7443 (replaces async-mirror-v1)",
      tags: ["replication", "quorum-raft"],
      entity: "ent_replication",
      supersedes: ids.staleOld,
      sessionId: "sess-needle",
      signal: 0.9,
      createdAt: NOW - 2 * DAY,
    },
    CONFIG,
  );
  ids.staleNew = newerRepl.id;
  const seedMs = performance.now() - tSeed0;

  // 3. Retrieval accuracy probes under 1,500-distractor load.
  const probes = [
    { label: "EN multi-term", query: "wasm-bridge-v3 Node 24 ABI", want: ids.wasmBridge },
    { label: "tag-exact", query: "wasm-bridge", want: ids.wasmBridge },
    { label: "CJK exact", query: "季度证书轮换手册 边缘网关", want: ids.cjkManual },
    { label: "CJK mixed", query: "Windows workspaceKey 盘符 空块", want: ids.cjkMixed },
    { label: "supersede winner", query: "replication mode", want: ids.staleNew, below: ids.staleOld },
    { label: "negative (absent)", query: "quantum-entangled-pineapple-zx9", want: null },
  ];

  let hitsAt1 = 0;
  let hitsAt5 = 0;
  let posCount = 0;
  let negClean = true;
  let supersedeClean = true;

  console.log(`== dsh-engram scale benchmark (${DISTRACTORS} distractors + ${needles.length + 1} needles, seeded in ${seedMs.toFixed(1)}ms) ==`);
  console.log("");
  console.log("-- retrieval under 1,500-memory load --");
  for (const p of probes) {
    const res = domain.recall(WS, p.query, 5);
    const rank = p.want === null ? -1 : res.findIndex((m) => m.id === p.want);
    if (p.want === null) {
      if (res.length > 0) negClean = false;
      console.log(`  ${p.label.padEnd(22)} hits=${res.length}  ${res.length === 0 ? "✓ clean" : "✗ false positive"}`);
    } else {
      posCount += 1;
      if (rank === 0) hitsAt1 += 1;
      if (rank >= 0) hitsAt5 += 1;
      if (p.below) {
        const oldRank = res.findIndex((m) => m.id === p.below);
        if (oldRank >= 0 && (rank < 0 || oldRank <= rank)) supersedeClean = false;
      }
      console.log(`  ${p.label.padEnd(22)} rank=${rank >= 0 ? `#${rank + 1}` : "MISS"}  top=${res[0]?.id?.slice(0, 8) ?? "-"}`);
    }
  }

  const hit1Rate = hitsAt1 / posCount;
  const hit5Rate = hitsAt5 / posCount;

  // 4. Hot-path latency & G5 budget invariant at 1,500+ memories.
  const recallTiming = measure(40, (i) => domain.recall(WS, probes[i % 4].query, 5));
  const indexTiming = measure(25, () => renderIndex(domain, WS, WS, CONFIG));
  const startRecallTiming = measure(25, (i) => renderStartRecall(domain, WS, CONFIG, { query: probes[i % 4].query, allowRecencyFallback: false }));
  const summarizeTiming = measure(25, () => domain.summarize());

  const indexChars = indexTiming.last.length;
  const totalActive = summarizeTiming.last.workspaces[WS]?.memories ?? 0;

  console.log("");
  console.log("-- hot-path latency & G5 invariant --");
  console.log(`  active memories in ws : ${totalActive}`);
  console.log(`  [ENGRAM] index size   : ${indexChars}c (G5 budget ≤ 700c)`);
  console.log(`  recall()       (n=40) : p50=${recallTiming.p50.toFixed(2)}ms  p95=${recallTiming.p95.toFixed(2)}ms  max=${recallTiming.max.toFixed(2)}ms`);
  console.log(`  renderIndex()  (n=25) : p50=${indexTiming.p50.toFixed(2)}ms  p95=${indexTiming.p95.toFixed(2)}ms  max=${indexTiming.max.toFixed(2)}ms`);
  console.log(`  startRecall()  (n=25) : p50=${startRecallTiming.p50.toFixed(2)}ms  p95=${startRecallTiming.p95.toFixed(2)}ms  max=${startRecallTiming.max.toFixed(2)}ms`);
  console.log(`  summarize()    (n=25) : p50=${summarizeTiming.p50.toFixed(2)}ms  p95=${summarizeTiming.p95.toFixed(2)}ms  max=${summarizeTiming.max.toFixed(2)}ms`);

  const failures = [];
  if (hit1Rate < 0.8) failures.push(`Hit@1 ${(hit1Rate * 100).toFixed(1)}% < 80%`);
  if (hit5Rate < 1.0) failures.push(`Recall@5 ${(hit5Rate * 100).toFixed(1)}% < 100%`);
  if (!negClean) failures.push("negative probe returned false positive");
  if (!supersedeClean) failures.push("superseded memory outranked current truth");
  if (indexChars === 0 || indexChars > 700) failures.push(`G5 violated: indexChars=${indexChars}`);
  if (recallTiming.p95 >= 50) failures.push(`recall p95 ${recallTiming.p95.toFixed(2)}ms >= 50ms`);
  if (indexTiming.p95 >= 50) failures.push(`renderIndex p95 ${indexTiming.p95.toFixed(2)}ms >= 50ms`);

  await domain.close();
  console.log("");
  if (failures.length > 0) {
    console.error(`SCALE BENCH FAIL: ${failures.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`SCALE BENCH PASS ✓ (Hit@1=${(hit1Rate * 100).toFixed(0)}%, Recall@5=${(hit5Rate * 100).toFixed(0)}%, index=${indexChars}c, recall p95=${recallTiming.p95.toFixed(2)}ms)`);
}

await main();
