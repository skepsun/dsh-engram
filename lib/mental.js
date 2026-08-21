/**
 * Mental models — precomputed standing answers over a workspace.
 *
 * Hindsight lets you define a question once and rewrites the answer in the
 * background as the bank learns; reading one is a DB read, no LLM call, so an
 * agent boots with a page of settled knowledge instead of rediscovering it
 * every session. This is the zero-LLM analogue: `compileSummary` aggregates
 * the workspace's tasks / entity graph / observations / memory kinds into a
 * compact markdown blob, `getModel` serves the cached copy and recomputes only
 * when a write happened (`dirty`), the input set changed (`sources_hash`) or
 * the cache went stale (>10 min, a safety net for missed bumps).
 *
 * Pure + deterministic: `now` injectable, no model calls.
 */

import { hashText } from "./util.js";

const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

/** Escape a name for markdown (pipes/newlines). */
function mdCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim();
}

/**
 * Aggregate the workspace into a standing-answer markdown blob. Purely derives
 * from already-indexed data — safe to run on every read.
 */
export function compileSummary(domain, ws, { now = Date.now() } = {}) {
  const summary = domain.summarize();
  const scope = ws && summary.workspaces[ws] ? { ...summary.workspaces[ws] } : { ...summary.totals };
  const label = ws ? String(ws).replace(/^.*[\\/]/, "") : "全部工作区";

  let tasks = [];
  try {
    tasks = domain.listTasks?.(ws, { includeStable: true }) ?? [];
  } catch {
    tasks = [];
  }
  const active = tasks.filter((t) => t.state === "active" || t.state === "draft");
  let ready = 0;
  const risky = [];
  for (const t of active) {
    let gaps = [];
    try {
      gaps = domain.evidenceGate?.(ws, t, { verifyArtifact: false })?.gaps ?? [];
    } catch {
      gaps = [];
    }
    if (gaps.length === 0) ready += 1;
    else {
      const ageDays = Math.max(0, Math.floor((now - (t.createdAt ?? now)) / 86400000));
      risky.push(`- ${mdCell(t.name)} · ${gaps.join("/")} · ${ageDays}天`);
    }
  }
  const stable = tasks.filter((t) => t.state === "stable").length;

  const obs = domain.listObservations?.(ws) ?? [];
  const obsEvidence = obs.reduce((s, o) => s + (o.proof?.count ?? 0), 0);
  const topObs = obs
    .slice()
    .sort((a, b) => (b.proof?.count ?? 0) - (a.proof?.count ?? 0))
    .slice(0, 3);

  let kindHist = "";
  try {
    const mems = domain.listMemories?.(ws, 1000) ?? [];
    const byKind = {};
    for (const m of mems) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
    const top = Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (top.length > 0) kindHist = top.map(([k, n]) => `${k} ${n}`).join(" · ");
  } catch {
    kindHist = "";
  }

  const lines = [
    `## ${label} · 常驻摘要`,
    `- 任务：${active.length} 进行中（${ready} 就绪）· ${stable} 已闭环`,
    `- 实体图：${scope.nodes ?? 0} 节点 · ${scope.links ?? 0} 链接`,
    `- 观测：${obs.length} 条信念（累计 ${obsEvidence} 证据）`,
    `- 记忆：${scope.memories ?? 0} 条${kindHist ? `（${kindHist}）` : ""}`,
  ];
  if (topObs.length > 0) {
    lines.push("", "重点信念：");
    for (const o of topObs) lines.push(`- ${mdCell(o.text)} — ×${o.proof?.count ?? 0}`);
  }
  if (risky.length > 0) {
    lines.push("", "未闭环风险：");
    lines.push(...risky.slice(0, 5));
  }
  return lines.join("\n");
}

/** Hash of the aggregation inputs — detects changes even when a bump was missed. */
export function computeSourcesHash(domain, ws) {
  const parts = [];
  try {
    const summary = domain.summarize();
    parts.push(JSON.stringify(ws ? summary.workspaces[ws] : summary.totals));
    const tasks = domain.listTasks?.(ws, { includeStable: true }) ?? [];
    parts.push(tasks.map((t) => `${t.id}:${t.state}:${t.updatedAt ?? 0}`).join(","));
    const obs = domain.listObservations?.(ws) ?? [];
    parts.push(obs.map((o) => `${o.id}:${o.proof?.count ?? 0}:${o.negations ?? 0}:${o.updated_at ?? 0}`).join(","));
  } catch {
    parts.push("err");
  }
  return hashText(parts.join("|"));
}

/** Whether the cached model needs a recompute. */
export function modelStale(model, domain, ws, { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  if (model === void 0 || model === null) return true;
  if (model.dirty === true) return true;
  if (typeof model.generated_at === "number" && now - model.generated_at > maxAgeMs) return true;
  if (model.sources_hash !== computeSourcesHash(domain, ws)) return true;
  return false;
}

/**
 * Read the standing answer: cached copy unless stale, then recompute + persist.
 * Pure aggregation — cheap enough to rebuild on a cold cache.
 *
 * @returns {Promise<{ws: string; content: string; generated_at: number; dirty: boolean; sources_hash: string; fresh: boolean}>}
 */
export async function getModel(domain, ws, { now = Date.now(), maxAgeMs, compile = compileSummary, hash = computeSourcesHash } = {}) {
  const current = domain.getModel(ws);
  if (!modelStale(current, domain, ws, { now, maxAgeMs })) {
    return { ...current, fresh: false };
  }
  const ev = { now };
  const content = compile(domain, ws, ev);
  const fresh = {
    ws,
    content,
    generated_at: now,
    dirty: false,
    sources_hash: hash(domain, ws),
  };
  await domain.putModel(ws, fresh);
  return { ...fresh, fresh: true };
}
