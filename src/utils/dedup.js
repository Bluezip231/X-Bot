/**
 * Simple word-overlap similarity between two titles.
 * Returns a value between 0 and 1 (Jaccard similarity).
 */
export function titleSimilarity(a, b) {
  const wordsA = normalize(a);
  const wordsB = normalize(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return overlap / union;
}

function normalize(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

/**
 * Check if a headline duplicates something already seen, against pre-fetched
 * data: an exact URL match (`knownUrls` is a Set) or a title similar to any of
 * `recentTitles`. Pure (no DB access) — the caller fetches the recent sets
 * once per run instead of two queries per headline.
 */
export function isDuplicateAgainst(headline, { knownUrls, recentTitles, similarityThreshold = 0.6 }) {
  if (headline.url && knownUrls.has(headline.url)) return true;

  for (const existing of recentTitles) {
    if (titleSimilarity(headline.title, existing) >= similarityThreshold) {
      return true;
    }
  }

  return false;
}
