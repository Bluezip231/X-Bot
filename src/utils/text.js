// Pure text helpers (no config import) so they're easy to unit-test.

/**
 * Strip the most mechanical AI-writing tells from a tweet body so a generated
 * post reads like a person typed it:
 *  - em/en dashes (— –), which almost nobody types by hand, become a comma
 *  - "--" used as prose punctuation (space-bounded) becomes a comma
 *  - curly/"smart" quotes and apostrophes become straight ASCII ones
 * Hyphens inside compound words (end-to-end) are left alone, and so are
 * technical double-hyphen tokens like CLI flags (--ignore-scripts) and CSS
 * custom properties (--brand-color), which are NOT prose punctuation.
 */
export function stripAiTells(text) {
  return (
    text
      // smart double quotes -> straight
      .replace(/[“”]/g, '"')
      // smart single quotes / apostrophes -> straight
      .replace(/[‘’]/g, "'")
      // em/en dash (any surrounding spaces) -> comma + space
      .replace(/\s*[—–]\s*/g, ", ")
      // "--" only when used as a dash, i.e. bounded by spaces on both sides.
      // This deliberately spares "--flag" / "--prop" technical tokens.
      .replace(/ +--+ +/g, ", ")
      // tidy up artifacts the replacement can create
      .replace(/ {2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/,\s*,/g, ",")
      .replace(/,(\s*[.!?])/g, "$1")
      .trim()
  );
}

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
