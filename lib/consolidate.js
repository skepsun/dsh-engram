/**
 * dsh-engram offline memory consolidation (opt-in, never on the hot path).
 *
 * As a workspace grows past 1,000+ memories, two kinds of entropy accumulate:
 *   1. Near-duplicate active memories (same kind + entity, high token overlap)
 *      that differ only in phrasing — they inflate the store and dilute BM25.
 *   2. Recurring operational patterns scattered across short-lived `episode`
 *      digests (14-day TTL) that evaporate before becoming evergreen knowledge.
 *
 * Design invariants:
 *   - Offline & opt-in only (`npx dsh-engram consolidate` or `POST /consolidate`).
 *   - Dry-run by default: `planConsolidation()` is pure and read-only.
 *   - Archive/supersede-only: never hard-deletes; working-set memories pinned
 *     by active task `memoryRefs` are strictly protected.
 *   - Zero-LLM by default (deterministic token Jaccard + canonical winner);
 *     accepts an optional async `summarizeCluster(cluster)` seam when a caller
 *     wants LLM-synthesized wording off the hot path.
 *
 * @module dsh-engram/consolidate
 */

import { tokenize } from "./util.js";

export const DEFAULT_MIN_SIMILARITY = 0.65;
export const DEFAULT_MIN_EPISODE_REPEAT = 3;

const GENERIC_EPISODE_TAGS = new Set(["episode", "auto-captured", "consolidated", "episode-rollup"]);

function tokenSet(text) {
  return new Set(tokenize(String(text ?? "")));
}

export function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const tok of small) {
    if (big.has(tok)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Memory ids referenced by any non-stable task (protected working set). */
function protectedMemoryIds(domain, workspace) {
  const out = new Set();
  const tasks = typeof domain?.listTasks === "function"
    ? domain.listTasks(workspace, { includeStable: false })
    : [];
  for (const t of tasks) {
    for (const ref of t?.memoryRefs ?? []) {
      if (typeof ref === "string" && ref.length > 0) out.add(ref);
    }
  }
  return out;
}

function rankWinner(a, b, protectedIds) {
  const pa = protectedIds.has(a.id) ? 1 : 0;
  const pb = protectedIds.has(b.id) ? 1 : 0;
  if (pa !== pb) return pb - pa;
  const sa = Number(a.signal ?? 0);
  const sb = Number(b.signal ?? 0);
  if (sa !== sb) return sb - sa;
  const ha = Number(a.hits ?? 0);
  const hb = Number(b.hits ?? 0);
  if (ha !== hb) return hb - ha;
  return Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0);
}

/**
 * Extract recurring structured cues from an episode digest line (e.g.
 * `fixed: npm test`, `files: lib/store.js`, or non-generic tags).
 */
function episodeCues(memory) {
  const cues = new Set();
  const text = String(memory?.text ?? "");
  // Match `cmd×N→fixed` or `fixed: ...` tokens
  for (const m of text.matchAll(/([A-Za-z0-9_./:-]{3,40})×\d+→fixed/g)) {
    cues.add(`fix:${m[1]}`);
  }
  // Match relative file paths mentioned in episode digests (e.g. lib/store.js)
  for (const m of text.matchAll(/\b((?:lib|src|client|eval|scripts|test)\/[A-Za-z0-9_.-]+\.[a-z]{1,4})\b/g)) {
    cues.add(`file:${m[1]}`);
  }
  for (const tag of memory?.tags ?? []) {
    const t = String(tag ?? "").trim().toLowerCase();
    if (t.length >= 2 && !GENERIC_EPISODE_TAGS.has(t)) cues.add(`tag:${t}`);
  }
  return cues;
}

/**
 * Plan offline consolidation for one workspace without mutating the store.
 *
 * @param {object} domain opened engram domain
 * @param {string} workspace normalized workspace key
 * @param {{ minSimilarity?: number, minEpisodeRepeat?: number, maxMemories?: number }} [opts]
 */
export function planConsolidation(domain, workspace, opts = {}) {
  const minSimilarity = Number.isFinite(opts.minSimilarity) && opts.minSimilarity > 0 && opts.minSimilarity <= 1
    ? opts.minSimilarity
    : DEFAULT_MIN_SIMILARITY;
  const minEpisodeRepeat = Number.isFinite(opts.minEpisodeRepeat) && opts.minEpisodeRepeat >= 2
    ? Math.trunc(opts.minEpisodeRepeat)
    : DEFAULT_MIN_EPISODE_REPEAT;
  const maxMemories = Number.isFinite(opts.maxMemories) && opts.maxMemories > 0
    ? Math.trunc(opts.maxMemories)
    : 5000;

  const empty = {
    workspace,
    scanned: 0,
    protectedCount: 0,
    merges: [],
    episodeRollups: [],
    summary: { clusters: 0, duplicateCount: 0, rollupCount: 0 },
  };
  if (domain === null || typeof domain !== "object") return empty;
  const all = typeof domain.exportAll === "function"
    ? (domain.exportAll(workspace)?.memories ?? []).slice(0, maxMemories)
    : typeof domain.listMemories === "function"
      ? domain.listMemories(workspace, maxMemories)
      : [];
  const protectedIds = protectedMemoryIds(domain, workspace);
  const supersededIds = new Set(all.map((m) => m?.supersedes).filter(Boolean));
  const active = all.filter((m) => m && m.status === "active" && !supersededIds.has(m.id));

  // ── 1. Near-duplicate clusters (grouped by kind + entity) ─────────────
  const groups = new Map();
  for (const m of active) {
    if (m.kind === "episode") continue;
    const key = `${m.kind}::${m.entity ?? ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ memory: m, tokens: tokenSet(m.text) });
  }

  const merges = [];
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    // Sort best candidates first so each cluster anchors on the strongest memory.
    items.sort((a, b) => rankWinner(a.memory, b.memory, protectedIds));
    const claimed = new Set();
    for (let i = 0; i < items.length; i += 1) {
      const seed = items[i];
      if (claimed.has(seed.memory.id) || seed.tokens.size === 0) continue;
      const dups = [];
      let minSim = 1;
      for (let j = i + 1; j < items.length; j += 1) {
        const cand = items[j];
        if (claimed.has(cand.memory.id) || cand.tokens.size === 0) continue;
        // Working-set memories are never archived as duplicates.
        if (protectedIds.has(cand.memory.id)) continue;
        const sim = jaccard(seed.tokens, cand.tokens);
        if (sim >= minSimilarity) {
          claimed.add(cand.memory.id);
          dups.push({ id: cand.memory.id, text: cand.memory.text, similarity: Number(sim.toFixed(3)) });
          if (sim < minSim) minSim = sim;
        }
      }
      if (dups.length > 0) {
        claimed.add(seed.memory.id);
        const tagSet = new Set([...(seed.memory.tags ?? [])]);
        for (const d of dups) {
          const orig = items.find((x) => x.memory.id === d.id)?.memory;
          for (const t of orig?.tags ?? []) tagSet.add(t);
        }
        merges.push({
          kind: seed.memory.kind,
          entity: seed.memory.entity ?? null,
          winner: { id: seed.memory.id, text: seed.memory.text, signal: seed.memory.signal, hits: seed.memory.hits ?? 0 },
          duplicates: dups,
          mergedTags: [...tagSet],
          minSimilarity: Number(minSim.toFixed(3)),
        });
      }
    }
  }

  // ── 2. Recurring episode rollup ───────────────────────────────────────
  const episodes = active.filter((m) => m.kind === "episode");
  const existingRollupTexts = active
    .filter((m) => Array.isArray(m.tags) && m.tags.includes("episode-rollup"))
    .map((m) => String(m.text ?? "").toLowerCase());

  const cueMap = new Map(); // cue -> episode[]
  for (const ep of episodes) {
    for (const cue of episodeCues(ep)) {
      if (!cueMap.has(cue)) cueMap.set(cue, []);
      cueMap.get(cue).push(ep);
    }
  }

  const episodeRollups = [];
  for (const [cue, eps] of [...cueMap.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    if (eps.length < minEpisodeRepeat) continue;
    const [prefix, value] = [cue.slice(0, cue.indexOf(":")), cue.slice(cue.indexOf(":") + 1)];
    const needle = value.toLowerCase();
    if (existingRollupTexts.some((t) => t.includes(needle))) continue;
    const label = prefix === "fix"
      ? `Recurring fix pattern (${eps.length} episodes): ${value}`
      : prefix === "file"
        ? `Hotspot file across ${eps.length} sessions: ${value}`
        : `Recurring episode theme (${eps.length} sessions): ${value}`;
    episodeRollups.push({
      cue,
      kind: prefix === "fix" ? "procedure" : "insight",
      text: label,
      tags: ["consolidated", "episode-rollup", value.toLowerCase().slice(0, 40)],
      sourceEpisodeIds: eps.map((e) => e.id),
      episodeCount: eps.length,
    });
  }

  const duplicateCount = merges.reduce((sum, c) => sum + c.duplicates.length, 0);
  return {
    workspace,
    scanned: active.length,
    protectedCount: protectedIds.size,
    merges,
    episodeRollups,
    summary: {
      clusters: merges.length,
      duplicateCount,
      rollupCount: episodeRollups.length,
    },
  };
}

/**
 * Execute a consolidation plan. Archive/supersede-only — never hard-deletes.
 *
 * @param {object} domain opened engram domain
 * @param {string} workspace normalized workspace key
 * @param {ReturnType<typeof planConsolidation>} plan
 * @param {{ dryRun?: boolean, config?: object, summarizeCluster?: (cluster: object) => Promise<string|null|undefined> }} [opts]
 */
export async function applyConsolidation(domain, workspace, plan, opts = {}) {
  const result = { applied: false, archivedIds: [], createdIds: [], plan };
  if (opts.dryRun === true) return result;
  if (domain === null || typeof domain !== "object" || !plan) return result;

  for (const cluster of plan.merges ?? []) {
    if (typeof opts.summarizeCluster === "function" && typeof domain.storeMemory === "function") {
      const synthesized = await opts.summarizeCluster(cluster);
      if (typeof synthesized === "string" && synthesized.trim().length > 0) {
        const created = await domain.storeMemory(
          {
            workspace,
            kind: cluster.kind,
            text: synthesized.trim(),
            tags: [...new Set([...(cluster.mergedTags ?? []), "consolidated"])],
            entity: cluster.entity ?? null,
            supersedes: cluster.winner.id,
            sessionId: "consolidate",
            signal: Math.max(0.7, Number(cluster.winner.signal ?? 0.7)),
          },
          opts.config ?? {},
        );
        if (created?.id) result.createdIds.push(created.id);
      }
    }
    for (const dup of cluster.duplicates ?? []) {
      if (typeof domain.archiveMemory === "function") {
        const ok = await domain.archiveMemory(workspace, dup.id);
        if (ok) result.archivedIds.push(dup.id);
      }
    }
  }

  for (const rollup of plan.episodeRollups ?? []) {
    if (typeof domain.storeMemory !== "function") break;
    let text = rollup.text;
    if (typeof opts.summarizeCluster === "function") {
      const synthesized = await opts.summarizeCluster(rollup);
      if (typeof synthesized === "string" && synthesized.trim().length > 0) text = synthesized.trim();
    }
    const created = await domain.storeMemory(
      {
        workspace,
        kind: rollup.kind ?? "insight",
        text,
        tags: rollup.tags ?? ["consolidated", "episode-rollup"],
        sessionId: "consolidate",
        signal: 0.7,
      },
      opts.config ?? {},
    );
    if (created?.id) result.createdIds.push(created.id);
  }

  if (result.archivedIds.length > 0 || result.createdIds.length > 0) {
    await domain.markModelDirty?.(workspace).catch?.(() => null);
  }
  result.applied = true;
  return result;
}

/** Human-readable preview of a consolidation plan (for CLI). */
export function formatConsolidationPlan(plan, { applied = false } = {}) {
  const lines = [
    `dsh-engram consolidate (${applied ? "APPLIED" : "DRY-RUN"}) · workspace: ${plan.workspace}`,
    `  scanned: ${plan.scanned} active memories (working-set protected: ${plan.protectedCount})`,
    `  near-duplicate clusters: ${plan.summary.clusters} (${plan.summary.duplicateCount} redundant memories to archive)`,
    `  episode rollups: ${plan.summary.rollupCount}`,
  ];
  for (const c of plan.merges.slice(0, 10)) {
    lines.push(`  [merge ${c.kind}${c.entity ? ` @${c.entity}` : ""} · sim≥${c.minSimilarity}] keep ${c.winner.id.slice(0, 8)} (${c.winner.text.slice(0, 70)})`);
    for (const d of c.duplicates) {
      lines.push(`    ↳ archive ${d.id.slice(0, 8)} (sim=${d.similarity}): ${d.text.slice(0, 70)}`);
    }
  }
  for (const r of plan.episodeRollups.slice(0, 10)) {
    lines.push(`  [rollup ${r.kind} · ${r.episodeCount} episodes] ${r.text}`);
  }
  if (!applied && (plan.summary.duplicateCount > 0 || plan.summary.rollupCount > 0)) {
    lines.push("  (re-run with --apply to execute; archive-only, never hard-deletes)");
  }
  return lines.join("\n");
}
