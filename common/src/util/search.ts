// Tiny in-memory fuzzy search — enough for client-side product search at this scale.
function norm(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * Score how well `query` matches `text`. 0 = no match; higher = better.
 * Ranks exact > prefix > substring > subsequence (fuzzy "nearest match").
 */
export function matchScore(query: string, text: string): number {
  const q = norm(query);
  const t = norm(text);
  if (!q) return 1;
  if (!t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const idx = t.indexOf(q);
  if (idx >= 0) return 60 - Math.min(idx, 20) * 0.5;
  // subsequence: all query chars appear in order (handles typos/gaps = "nearest match")
  let from = 0;
  let gaps = 0;
  let last = -1;
  for (const ch of q) {
    const found = t.indexOf(ch, from);
    if (found < 0) return 0;
    if (last >= 0) gaps += found - last - 1;
    last = found;
    from = found + 1;
  }
  return Math.max(10, 40 - gaps);
}

/** Filter + rank items by fuzzy match across the strings returned by `keysOf`. */
export function fuzzyFilter<T>(items: T[], query: string, keysOf: (item: T) => string[]): T[] {
  const q = norm(query);
  if (!q) return items;
  return items
    .map((item) => ({ item, score: Math.max(0, ...keysOf(item).map((k) => matchScore(q, k))) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
