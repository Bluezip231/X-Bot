/**
 * Programmatic guardrail checks for a generated news post.
 * Returns { passed: boolean, violations: string[] }.
 *
 * Generalized news bot: we only enforce mechanical safety here (length,
 * hashtag spam, leftover template tokens). Tone/factual checks are handled by
 * the LLM quality-check step.
 */

const MAX_HASHTAGS = 2;

// Canned bot phrasing the model keeps producing despite prompt instructions.
// Any match fails the post, which (via the pipeline's revision pass) sends it
// back to the writer with the violation named. Patterns are case-insensitive
// and deliberately specific — generic words people actually use stay legal.
const BOT_TELL_PATTERNS = [
  [/\bunderscor(?:es|ing|ed)\b/i, '"underscores"'],
  [/\bstark reminder\b/i, '"stark reminder"'],
  [/\ba reminder (?:of|that|to)\b/i, '"a reminder of/that"'],
  [/\bhighlights? the (?:importance|need|vulnerabilit|risk)/i, '"highlights the importance/need/risk"'],
  [/\bstay (?:informed|vigilant|safe|alert)\b/i, '"stay informed/vigilant/safe/alert"'],
  [/\bensure your\b/i, '"ensure your"'],
  [/\bmake sure your\b/i, '"make sure your"'],
  [/\byou could be next\b/i, '"you could be next"'],
  [/\b(?:isn't|is not) just (?:a|an|another)\b/i, '"isn\'t just a/another" parallelism'],
  [/\bnot just a .{0,20} issue\b/i, '"not just a ... issue" parallelism'],
  [/\bit's time to (?:rethink|reconsider|take)\b/i, '"it\'s time to rethink"'],
  [/\bthe stakes are high\b/i, '"the stakes are high"'],
  [/\bin today's (?:digital|fast-paced|connected)\b/i, '"in today\'s digital..."'],
  [/\bdigital (?:age|landscape)\b/i, '"digital age/landscape"'],
  [/\bgame.?changer\b/i, '"game changer"'],
  [/\bbuckle up\b/i, '"buckle up"'],
  [/\bwake-?up call\b/i, '"wake-up call"'],
  [/\bdelve\b/i, '"delve"'],
  [/\bbe careful out there\b/i, '"be careful out there"'],
];

/** Bot-tell phrases found in `text` (labels for the writer), or []. */
export function findBotTells(text) {
  const hits = [];
  for (const [pattern, label] of BOT_TELL_PATTERNS) {
    if (pattern.test(text)) hits.push(label);
  }
  return hits;
}

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

  const botTells = findBotTells(text);
  if (botTells.length > 0) {
    violations.push(
      `Contains canned bot phrasing (${botTells.join(", ")}). Rewrite in a personal, first-person voice without these phrases.`
    );
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
