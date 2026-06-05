import { test } from "node:test";
import assert from "node:assert/strict";
import { truncateAtWord } from "../src/utils/text.js";

test("returns text unchanged when within the limit", () => {
  assert.equal(truncateAtWord("short and sweet", 280), "short and sweet");
});

test("returns text unchanged at exactly the limit", () => {
  const s = "x".repeat(50);
  assert.equal(truncateAtWord(s, 50), s);
});

test("trims at a word boundary and appends an ellipsis", () => {
  const out = truncateAtWord("the quick brown fox jumps", 18);
  assert.ok(out.length <= 18, `expected <= 18, got ${out.length}`);
  assert.ok(out.endsWith("…"));
  assert.ok(!out.includes("  "));
  // Should cut at a space, not mid-word.
  assert.ok(/[a-z]…$/.test(out));
});

test("strips trailing punctuation before the ellipsis", () => {
  const out = truncateAtWord("hello world, this is a test sentence", 14);
  assert.ok(!/[,.;:!?-]…$/.test(out), `unexpected trailing punctuation: ${out}`);
  assert.ok(out.endsWith("…"));
});

test("hard-cuts when the only space is too early", () => {
  // One early space, then a long unbroken run — no late word boundary to use.
  const out = truncateAtWord("a " + "b".repeat(40), 20);
  assert.ok(out.length <= 20);
  assert.ok(out.endsWith("…"));
});
