/**
 * Evidence-aware reranking signals for deterministic recall.
 *
 * Hindsight's reranking folds proof strength into the relevance score as a
 * multiplicative boost (conservative, ±5% at weight 0.1). Here the analogue
 * of "proof count" is a memory's cumulative recall hits — which our D2
 * failure-revival path already increments on repeat failures, so high-hits
 * memories are exactly the ones we want to stay findable. All functions are
 * pure and dependency-free: `now` and weights are injectable for deterministic
 * tests, matching the injectability of `util.bm25Rank`.
 */

/**
 * Multiplicative evidence strength boost: 1 + alpha·min(max(0, hits), cap).
 * Flat beyond `cap` so one runaway popular memory can't dominate ranking.
 */
export function evidenceBoost(hits, { alpha = 0.1, cap = 5 } = {}) {
  const h = Math.max(0, Number.isFinite(hits) ? hits : 0);
  return 1 + alpha * Math.min(h, cap);
}

/** Combine a base match score with the evidence boost. */
export function scoreCandidate(matchScore, hits, { alpha = 0.1, cap = 5 } = {}) {
  return (Number.isFinite(matchScore) ? matchScore : 0) * evidenceBoost(hits, { alpha, cap });
}

/**
 * Stable sort of candidates by (score desc, tiebreak). Returns a new array;
 * equal scores keep their input order.
 *
 * @param {Array} list
 * @param {object} opts
 * @param {(r:any)=>number} [opts.getScore] base score per candidate (default 0)
 * @param {(r:any)=>number} [opts.getHits] evidence count per candidate
 * @param {number} [opts.alpha] boost weight
 * @param {number} [opts.cap] boost saturation point
 * @param {(a:any,b:any)=>number} [opts.tiebreak] secondary comparator
 */
export function sortByEvidence(list, { getScore = () => 0, getHits = (r) => r.hits ?? 0, alpha = 0.1, cap = 5, tiebreak = null } = {}) {
  const scored = list.map((r, i) => ({ r, i, s: scoreCandidate(getScore(r), getHits(r), { alpha, cap }) }));
  scored.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    if (tiebreak) {
      const t = tiebreak(a.r, b.r);
      if (t !== 0) return t;
    }
    return a.i - b.i; // stable
  });
  return scored.map((e) => e.r);
}
