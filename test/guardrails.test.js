import { test } from "node:test";
import assert from "node:assert/strict";
import { weightedLength, checkGuardrails, findBotTells } from "../src/utils/guardrails.js";

test("weightedLength counts a URL as 23 chars", () => {
  const url = "https://example.com/a-very-long-path-that-exceeds-23-characters";
  assert.equal(weightedLength(url), 23);
  assert.equal(weightedLength("hi " + url), 3 + 23);
});

test("a normal post passes", () => {
  const r = checkGuardrails({ full_text: "A clear, plain-spoken take on the news." });
  assert.equal(r.passed, true);
  assert.deepEqual(r.violations, []);
});

test("empty text fails", () => {
  const r = checkGuardrails({ full_text: "   " });
  assert.equal(r.passed, false);
  assert.ok(r.violations.some((v) => /empty/i.test(v)));
});

test("over-length (weighted) fails", () => {
  const r = checkGuardrails({ full_text: "x".repeat(281) });
  assert.equal(r.passed, false);
  assert.ok(r.violations.some((v) => /280/.test(v)));
});

test("a post with a link stays under the limit via weighting", () => {
  // 256 body chars + a long link → real length > 280 but weighted ~279.
  const body = "y".repeat(256);
  const r = checkGuardrails({ full_text: `${body}\nhttps://example.com/${"z".repeat(80)}` });
  assert.equal(r.passed, true);
});

test("too many hashtags fails", () => {
  const r = checkGuardrails({ full_text: "news #a #b #c" });
  assert.equal(r.passed, false);
  assert.ok(r.violations.some((v) => /hashtag/i.test(v)));
});

test("leftover template placeholder fails", () => {
  assert.equal(checkGuardrails({ full_text: "Hello [name], welcome" }).passed, false);
  assert.equal(checkGuardrails({ full_text: "Value is {{x}}" }).passed, false);
  assert.equal(checkGuardrails({ full_text: "TODO write this" }).passed, false);
});

test("findBotTells flags the canned phrases from real bot-sounding posts", () => {
  const realExamples = [
    "This underscores the vulnerability of even encrypted systems. If you're using similar platforms, it's time to rethink your security practices.",
    "This isn't just another attack, it's a reminder of how quickly threats evolve. If you're not monitoring your systems closely, you could be next.",
    "With 39 rated Critical, the stakes are high for users. Make sure your systems are updated.",
    "This isn't just a tech issue; it's a national security concern. Stay informed on these threats and ensure your defenses are strong.",
  ];
  for (const text of realExamples) {
    assert.ok(findBotTells(text).length > 0, `expected bot tells in: ${text}`);
  }
});

test("findBotTells leaves human-sounding posts alone", () => {
  const humanExamples = [
    "73,000 French government accounts hit. On their ENCRYPTED platform. Encryption protects the message in transit, not an account with a weak login.",
    "The worm part is what gets me. One infected laptop and it walks the whole network by itself.",
    "Most scams don't look like scams. That's the whole point. Check the address bar. Every time.",
    "Anyone else getting these texts this week?",
  ];
  for (const text of humanExamples) {
    assert.deepEqual(findBotTells(text), [], `expected no bot tells in: ${text}`);
  }
});

test("checkGuardrails fails a post with canned bot phrasing", () => {
  const r = checkGuardrails({
    full_text: "This is a stark reminder to stay vigilant and ensure your systems are patched.",
  });
  assert.equal(r.passed, false);
  assert.ok(r.violations.some((v) => /canned bot phrasing/i.test(v)));
});
