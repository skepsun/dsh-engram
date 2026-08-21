/**
 * Observation layer — evidence-grounded beliefs built up from repeated memory.
 *
 * Hindsight consolidates facts into observations with a proof count, source
 * memory ids and a refined (never overwritten) belief, plus an algorithmic
 * trend computed from evidence timestamps. This module is the zero-LLM,
 * deterministic analogue on top of `dsh_engram`:
 *
 *   - a memory is bucketed against existing observations when it shares an
 *     anchor (entity id or a tag) AND is textually similar (character-bigram
 *     Jaccard ≥ threshold). A hit *merges*: proof count climbs (unique sources
 *     only), the time span widens, the belief text is never silently replaced.
 *   - a same-anchor, opposite-polarity repeat counts as a negation (weakens the
 *     belief) instead of vanishing.
 *   - `computeTrend` maps evidence recency to new/strengthening/stable/
 *     weakening/stale (30/90-day windows), mirroring Hindsight's Trend.
 *
 * All functions are pure over (observations, memory, now); storage reads and
 * writes happen only in `integrateObservation`.
 */

/** Character bigrams (CJK-friendly): "排队重来" -> 排队,队重,重来. */
export function charBigrams(text) {
  const chars = String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .split("");
  const out = [];
  for (let i = 0; i + 1 < chars.length; i += 1) out.push(chars[i] + chars[i + 1]);
  return out;
}

/** Jaccard similarity over character-bigram sets. */
export function jaccardSim(a, b) {
  const A = new Set(charBigrams(a));
  const B = new Set(charBigrams(b));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union > 0 ? inter / union : 0;
}

/** Anchor overlap: same entity, or any shared tag. */
export function sharesAnchor(mem, obs) {
  const me = mem.entity ?? null;
  const oe = obs.entity ?? null;
  if (me !== null && oe !== null && me === oe) return true;
  const mt = new Set(mem.tags ?? []);
  for (const t of obs.tags ?? []) if (mt.has(t)) return true;
  return false;
}

const NEGATIONS = ["not ", "no ", "never", "failed to", "does not", "isn't", "wasn't", "won't", "不", "没", "无", "不再", "失败", "排除", "拒绝", "无法", "未能"];

/** Opposite-polarity heuristic: one text carries a negation the other lacks. */
export function polarityDiffers(a, b) {
  const hasNeg = (s) => NEGATIONS.some((n) => s.includes(n));
  const na = hasNeg(String(a ?? ""));
  const nb = hasNeg(String(b ?? ""));
  return na !== nb;
}

/**
 * Decide how `mem` relates to the candidate observation bucket.
 * Returns a pure decision; the caller persists it.
 *
 * @returns {{ action: "create" } | { action: "merge", obs } | { action: "negate", obs } | { action: "refresh", obs }}
 *   refresh = same source memory re-supporting the belief (span/updatedAt only).
 */
export function bucketDecision(mem, { observations, threshold = 0.45, negateThreshold = 0.28 }) {
  const ws = mem.workspace;
  for (const obs of observations) {
    if (obs.workspace !== ws) continue;
    if (!sharesAnchor(mem, obs)) continue;
    const sim = jaccardSim(mem.text, obs.text);
    if (sim >= negateThreshold && polarityDiffers(mem.text, obs.text)) {
      return { action: "negate", obs };
    }
    if (sim >= threshold) {
      return { action: "merge", obs };
    }
  }
  return { action: "create" };
}

/**
 * Merge a supporting memory into an observation (immutable), preferring unique
 * sources: re-support by the same memory refreshes time, not count.
 */
export function mergeObservation(obs, mem, ev = { now: Date.now() }) {
  const sources = Array.isArray(obs.proof?.sources) ? obs.proof.sources : [];
  const again = sources.includes(mem.id);
  // forceEvidence semantics: the caller is telling us a NEW occurrence happened
  // even though the backing row got reused (failure revival re-warms the same
  // memory id). Treat it as fresh support: climb the count, keep the id.
  const count = again && !ev.forceEvidence ? sources.length : sources.length + 1;
  const nextSources = again && !ev.forceEvidence ? sources : [...sources, mem.id];
  const span = {
    first_seen_at: Math.min(obs.span?.first_seen_at ?? ev.now, mem.createdAt ?? ev.now),
    last_seen_at: Math.max(obs.span?.last_seen_at ?? 0, ev.now),
  };
  return {
    ...obs,
    text: obs.text,
    proof: { count, sources: again ? sources : [...sources, mem.id] },
    span,
    trend: computeTrend(span, ev.now),
    negations: obs.negations ?? 0,
    updated_at: ev.now,
  };
}

/** Record one negation (polarity conflict) on an observation. */
export function negateObservation(obs, ev = { now: Date.now() }) {
  const span = { ...(obs.span ?? { first_seen_at: ev.now, last_seen_at: ev.now }), last_seen_at: ev.now };
  return {
    ...obs,
    span,
    negations: (obs.negations ?? 0) + 1,
    trend: computeTrend(span, ev.now),
    updated_at: ev.now,
  };
}

/** New empty bucket for a memory. */
export function createObservation(mem, ev = { now: Date.now() }) {
  return {
    id: `obs_${String(ev.now).slice(-6)}_${Math.random().toString(36).slice(2, 6)}`,
    workspace: mem.workspace,
    text: mem.text,
    kind: mem.kind === "error" ? "pattern" : "belief",
    proof: { count: 1, sources: [mem.id] },
    span: { first_seen_at: mem.createdAt ?? ev.now, last_seen_at: ev.now },
    negations: 0,
    trend: "new",
    tags: Array.isArray(mem.tags) ? mem.tags : [],
    entity: mem.entity ?? null,
    updated_at: ev.now,
  };
}

/**
 * Trend from evidence recency (30/90-day windows, mirroring Hindsight):
 *   - no evidence in the old window at all             -> stale
 *   - newest evidence older than recentDays            -> weakening
 *   - every source within recentDays                   -> new
 *   - ≥2 sources, latest recent and history before     -> strengthening
 *   - otherwise                                        -> stable
 */
export function computeTrend(span, now = Date.now(), { recentDays = 30, oldDays = 90 } = {}) {
  const DAY = 86400000;
  const first = span?.first_seen_at ?? null;
  const last = span?.last_seen_at ?? first;
  if (first === null || last === null) return "new";
  const firstAge = Math.max(0, now - first) / DAY;
  const lastAge = Math.max(0, now - last) / DAY;
  if (firstAge > oldDays && lastAge > oldDays) return "stale";
  if (lastAge > recentDays) return "weakening";
  if (firstAge <= recentDays) return "new";
  return "strengthening";
}

/** Enforce a per-workspace observation cap (lowest proof, oldest first evicted). */
export function capObservations(observations, ws, { cap = 50 } = {}) {
  const inWs = observations.filter((o) => o.workspace === ws);
  if (inWs.length <= cap) return observations;
  const evict = inWs
    .slice()
    .sort((a, b) => (a.proof?.count ?? 0) - (b.proof?.count ?? 0) || (a.updated_at ?? 0) - (b.updated_at ?? 0))
    .slice(0, inWs.length - cap)
    .map((o) => o.id);
  const evictSet = new Set(evict);
  return observations.filter((o) => !evictSet.has(o.id));
}

/**
 * Storage-backed integrate step: read the workspace's observations, decide a
 * bucket, persist, and enforce the cap. Pure-and-fast — no model calls.
 *
 * @param {import("./store.js").ObservationTableHandle} table
 * @returns {Promise<{action: string; obs?: any; id?: string}>}
 */
export async function integrateObservation(table, mem, { threshold, cap, now, forceEvidence = false } = {}) {
  const ev = { now: now ?? Date.now(), forceEvidence };
  const current = [...table.entries()].map(([, o]) => o);
  const decision = bucketDecision(mem, { observations: current, threshold });
  if (decision.action === "create") {
    const obs = createObservation(mem, ev);
    await table.put(obs.id, obs);
    return { action: "create", id: obs.id, obs };
  }
  let obs;
  if (decision.action === "negate") obs = negateObservation(decision.obs, ev);
  else obs = mergeObservation(decision.obs, mem, ev);
  await table.put(obs.id, obs);
  // enforce the per-workspace cap regardless of action
  const after = [...table.entries()].map(([, o]) => o);
  const trimmed = capObservations(after, mem.workspace, { cap: cap ?? 50 });
  for (const gone of after) if (!trimmed.some((o) => o.id === gone.id)) await table.delete(gone.id);
  return { action: decision.action, id: obs.id, obs };
}
