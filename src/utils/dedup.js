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
 * Check if a headline is a duplicate of something we've already ingested.
 * Returns true if it should be skipped.
 * Uses lazy import of db.js to avoid eager config validation in tests.
 */
export async function isDuplicate(headline, { similarityThreshold = 0.6, hoursBack = 48 } = {}) {
  const { getRecentHeadlineUrls, getRecentHeadlineTitles } = await import("../db.js");

  // URL exact match
  const knownUrls = await getRecentHeadlineUrls(hoursBack);
  if (headline.url && knownUrls.has(headline.url)) return true;

  // Title similarity check
  const recentTitles = await getRecentHeadlineTitles(hoursBack);
  for (const existing of recentTitles) {
    if (titleSimilarity(headline.title, existing) >= similarityThreshold) {
      return true;
    }
  }

  return false;
}
