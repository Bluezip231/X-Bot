/**
 * Programmatic guardrail checks for a generated news post.
 * Returns { passed: boolean, violations: string[] }.
 *
 * Generalized news bot: we only enforce mechanical safety here (length,
 * hashtag spam, leftover template tokens). Tone/factual checks are handled by
 * the LLM quality-check step.
 */

const MAX_HASHTAGS = 2;

// X counts every URL as 23 characters regardless of its real length. Count the
// post the way X does so an appended source link doesn't trip the limit.
// (CJK/emoji still measured by .length — acceptable for an English-language bot.)
export function weightedLength(text) {
  const urlRegex = /https?:\/\/\S+/g;
  const urlCount = (text.match(urlRegex) || []).length;
  const withoutUrls = text.replace(urlRegex, "");
  return withoutUrls.length + urlCount * 23;
}

export function checkGuardrails(post) {
  const violations = [];
  const text = post.full_text || "";

  if (text.trim().length === 0) {
    violations.push("Post text is empty");
  }

  const wlen = weightedLength(text);
  if (wlen > 280) {
    violations.push(`Exceeds 280 characters (weighted ${wlen})`);
  }

  const hashtags = text.match(/#\w+/g);
  if (hashtags && hashtags.length > MAX_HASHTAGS) {
    violations.push(`Too many hashtags (${hashtags.length}, max ${MAX_HASHTAGS}): ${hashtags.join(", ")}`);
  }

  // Leftover prompt/template placeholders that should never reach a post.
  if (/\[[a-z][a-z _]{1,30}\]|\{\{[^}]*\}\}|\bTODO\b/i.test(text)) {
    violations.push("Contains a leftover template placeholder");
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
