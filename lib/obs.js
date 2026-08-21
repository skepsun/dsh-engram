/**
 * Observation VIEW — evidence-grounded beliefs, derived not persisted.
 *
 * Assessment P2 (2026-08-22): observations were a second persisted
 * representation with write-path side effects (`integrateObservation` ran on
 * every store). Demoted to a pure deterministic projection of memories: a
 * memory with `hits >= OBSERVATION_MIN_PROOF` IS an observation — proof count
 * is its hit count, its span is created→updated, trend is computed from
 * recency. Nothing is written, nothing is stored; the GUI/API/tools keep the
 * exact same shape (`o.proof.count`, `o.negations`, `o.trend`, `o.updated_at`).
 *
 * All functions are pure — zero LLM, zero storage.
 */

/** A memory only counts as a belief once it has been evidenced twice. */
export const OBSERVATION_MIN_PROOF = 2;

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

/**
 * Derive the observations of a workspace from its active memories.
 * Best-first by proof (hits), then newest first. Shape is stable and
 * compatible with the old persisted records so every consumer
 * (tools / mental / api / client) keeps working unchanged.
 */
export function deriveObservations(memories, { now = Date.now() } = {}) {
  return memories
    .filter((m) => (m.hits ?? 0) >= OBSERVATION_MIN_PROOF)
    .map((m) => {
      const createdAt = m.createdAt ?? now;
      const updatedAt = m.updatedAt ?? createdAt;
      const span = { first_seen_at: createdAt, last_seen_at: updatedAt };
      return {
        id: m.id,
        workspace: m.workspace,
        text: m.text,
        kind: m.kind === "error" ? "pattern" : "belief",
        proof: { count: m.hits ?? 0, sources: [m.id] },
        span,
        negations: 0,
        trend: computeTrend(span, now),
        tags: Array.isArray(m.tags) ? m.tags : [],
        entity: m.entity ?? null,
        updated_at: updatedAt,
      };
    })
    .sort(
      (a, b) =>
        (b.proof?.count ?? 0) - (a.proof?.count ?? 0) ||
        (b.updated_at ?? 0) - (a.updated_at ?? 0),
    );
}
