// Tiny in-memory fuzzy search — enough for client-side product search at this
// scale (hundreds of items, re-filtered on every keystroke).
//
// Matching is typo-tolerant: "aapple" finds "Apple", "bananna" finds "Banana".
// Multi-word queries require every term to match somewhere, so "red apple"
// does not match a plain "Apple".

const PUNCT = /[.,/#!$%^&*;:{}=\-_`~()[\]"'?|\\<>+]+/g;

/**
 * Lowercase, strip diacritics and punctuation, collapse whitespace.
 * Deliberately script-agnostic: Tamil/Hindi/Kannada product names survive
 * intact, only Latin accents are folded (é -> e).
 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(normalized: string): string[] {
  return normalized ? normalized.split(' ') : [];
}

/** How many single-character edits to forgive for a term of this length. */
function typoBudget(len: number): number {
  if (len <= 3) return 0; // too short — tolerance would match almost anything
  if (len <= 6) return 1;
  return 2;
}

/**
 * Damerau-Levenshtein distance, abandoned early once it exceeds `max`.
 * Counts insertions, deletions, substitutions and adjacent transpositions, so
 * "aapple"/"apple" (insertion) and "aplpe"/"apple" (swap) both cost 1.
 */
function editDistance(a: string, b: string, max: number): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  if (al === 0) return bl;
  if (bl === 0) return al;

  let prev2: number[] = new Array(bl + 1).fill(0);
  let prev: number[] = Array.from({ length: bl + 1 }, (_, j) => j);
  let cur: number[] = new Array(bl + 1).fill(0);

  for (let i = 1; i <= al; i++) {
    cur[0] = i;
    let rowBest = cur[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowBest) rowBest = v;
    }
    if (rowBest > max) return max + 1; // no reachable cell can still win
    const spare = prev2;
    prev2 = prev;
    prev = cur;
    cur = spare;
  }
  return prev[bl];
}

/** Score one query term against one text term. 0 = no match. */
function termScore(q: string, t: string): number {
  if (q === t) return 100;
  if (t.startsWith(q)) return 85;
  if (q.startsWith(t)) return 75; // user typed more than the stored term
  if (t.includes(q)) return 70;

  const budget = typoBudget(q.length);
  if (budget > 0) {
    // Whole term, e.g. "aapple" vs "apple".
    const d = editDistance(q, t, budget);
    if (d <= budget) return 65 - d * 10;
    // Typo against the start of a longer term, e.g. "bananna" vs "bananas".
    if (t.length > q.length) {
      const head = t.slice(0, q.length + budget);
      const dh = editDistance(q, head, budget);
      if (dh <= budget) return 55 - dh * 10;
    }
  }

  // Subsequence: all chars present in order, e.g. "aple" vs "apple".
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
  return Math.max(10, 40 - gaps * 4);
}

/**
 * Score how well `query` matches `text`. 0 = no match; higher = better.
 * Every term in the query must match some term in the text.
 */
export function matchScore(query: string, text: string): number {
  const q = normalizeForSearch(query);
  const t = normalizeForSearch(text);
  if (!q) return 1;
  if (!t) return 0;

  // Whole-string shortcuts keep exact and prefix hits ranked above term hits.
  if (t === q) return 120;
  if (t.startsWith(q)) return 110;
  const idx = t.indexOf(q);
  if (idx >= 0) return 100 - Math.min(idx, 20) * 0.5;

  const qTerms = tokenize(q);
  const tTerms = tokenize(t);
  if (qTerms.length === 0 || tTerms.length === 0) return 0;

  let total = 0;
  for (const qt of qTerms) {
    let best = 0;
    for (const tt of tTerms) {
      const s = termScore(qt, tt);
      if (s > best) best = s;
      if (best === 100) break;
    }
    if (best === 0) return 0; // this term matched nothing — reject the item
    total += best;
  }
  return total / qTerms.length;
}

/** Filter + rank items by fuzzy match across the strings returned by `keysOf`. */
export function fuzzyFilter<T>(items: T[], query: string, keysOf: (item: T) => string[]): T[] {
  const q = normalizeForSearch(query);
  if (!q) return items;
  return items
    .map((item) => ({
      item,
      score: Math.max(0, ...keysOf(item).map((k) => matchScore(q, k ?? ''))),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
