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

/**
 * Standing-answer copy. The language is a RENDER parameter, not a cache key:
 * the cached row and the `esr_model` tool keep their default (zh) copy, while
 * the GUI asks the route for its active language. Russian is the language this
 * client currently ships.
 */
const COPY = {
  zh: {
    allWorkspaces: "全部工作区",
    heading: "常驻摘要",
    tasks: (active, ready, stable) => `- 任务：${active} 进行中（${ready} 就绪）· ${stable} 已闭环`,
    graph: (nodes, links) => `- 实体图：${nodes} 节点 · ${links} 链接`,
    observation: (n, evidence) => `- 观测：${n} 条信念（累计 ${evidence} 证据）`,
    memories: (n, kindHist) => `- 记忆：${n} 条${kindHist ? `（${kindHist}）` : ""}`,
    topBeliefs: "重点信念：",
    risks: "未闭环风险：",
    riskLine: (name, gaps, ageDays) => `- ${name} · ${gaps} · ${ageDays}天`,
  },
  ru: {
    allWorkspaces: "Все пространства",
    heading: "постоянная сводка",
    tasks: (active, ready, stable) => `- Задачи: ${active} в работе (${ready} готовы) · закрыто: ${stable}`,
    graph: (nodes, links) => `- Граф сущностей: узлов ${nodes} · связей ${links}`,
    observation: (n, evidence) => `- Наблюдения: ${n} · доказательств всего: ${evidence}`,
    memories: (n, kindHist) => `- Память: ${n}${kindHist ? ` (${kindHist})` : ""}`,
    topBeliefs: "Ключевые убеждения:",
    risks: "Незакрытые риски:",
    riskLine: (name, gaps, ageDays) => `- ${name} · ${gaps} · ${ageDays} дн.`,
  },
};

/** Copy table for a render language; unknown languages fall back to the source language. */
function copyFor(lang) {
  return COPY[lang] ?? COPY.zh;
}

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
export function compileSummary(domain, ws, { now = Date.now(), lang = "zh" } = {}) {
  const L = copyFor(lang);
  const summary = domain.summarize();
  const scope = ws && summary.workspaces[ws] ? { ...summary.workspaces[ws] } : { ...summary.totals };
  const label = ws ? String(ws).replace(/^.*[\\/]/, "") : L.allWorkspaces;

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
      risky.push(L.riskLine(mdCell(t.name), gaps.join("/"), ageDays));
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
    `## ${label} · ${L.heading}`,
    L.tasks(active.length, ready, stable),
    L.graph(scope.nodes ?? 0, scope.links ?? 0),
    L.observation(obs.length, obsEvidence),
    L.memories(scope.memories ?? 0, kindHist),
  ];
  if (topObs.length > 0) {
    lines.push("", L.topBeliefs);
    for (const o of topObs) lines.push(`- ${mdCell(o.text)} — ×${o.proof?.count ?? 0}`);
  }
  if (risky.length > 0) {
    lines.push("", L.risks);
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
/**
 * Prime-style brief mode: fold the standing answer's headline rows into a
 * one-liner (~50-token reminder). Derived from the full content — same source
 * of truth, so the brief can never drift from what the full model says.
 */
export function briefify(fullContent) {
  const bits = [];
  for (const prefix of ["- 任务：", "- 实体图：", "- 观测："]) {
    for (const line of fullContent.split("\n")) {
      if (line.startsWith(prefix)) { bits.push(line.slice(2)); break; }
    }
  }
  let risks = 0;
  const lines = fullContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("未闭环风险")) {
      for (let j = i + 1; j < lines.length && lines[j].startsWith("- "); j++) risks++;
    }
  }
  bits.push(risks > 0 ? `风险 ${risks}` : "无未闭环风险");
  return bits.join(" · ").slice(0, 240);
}

export async function getModel(domain, ws, { now = Date.now(), maxAgeMs, compile = compileSummary, hash = computeSourcesHash, mode = "full" } = {}) {
  const current = domain.getModel(ws);
  if (!modelStale(current, domain, ws, { now, maxAgeMs })) {
    const hit = { ...current, fresh: false };
    if (mode === "brief") hit.content = briefify(hit.content);
    return hit;
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
  if (mode === "brief") fresh.content = briefify(fresh.content);
  return { ...fresh, fresh: true };
}
