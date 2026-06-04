// Pure text helpers (no config import) so they're easy to unit-test.

/**
 * Trim an over-long body to `max` characters at a word boundary so a slightly
 * long post still ships (with an ellipsis) instead of being dropped entirely.
 * If the last space is too early (< 60% of max), hard-cuts rather than leaving
 * an awkwardly short result.
 */
export function truncateAtWord(text, max) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1); // leave room for the ellipsis
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return base.replace(/[\s,.;:!?-]+$/, "") + "…";
}
