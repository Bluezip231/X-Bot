import { test } from "node:test";
import assert from "node:assert/strict";
import { weightedLength, checkGuardrails } from "../src/utils/guardrails.js";

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
