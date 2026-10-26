/** Order queue entries by score, highest first. */
export function sortByScore(entries) {
  return entries.sort((a, b) => b.score - a.score);
}
