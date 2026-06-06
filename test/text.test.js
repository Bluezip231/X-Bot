import { test } from "node:test";
import assert from "node:assert/strict";
import { truncateAtWord, stripAiTells } from "../src/utils/text.js";

test("stripAiTells: spaced em dash becomes a comma", () => {
  assert.equal(
    stripAiTells("Stay alert — not every visit is legitimate."),
    "Stay alert, not every visit is legitimate."
  );
});

test("stripAiTells: tight em dash becomes a comma", () => {
  assert.equal(
    stripAiTells("government practices—protecting info matters"),
    "government practices, protecting info matters"
  );
});

test("stripAiTells: en dash and double-hyphen are handled too", () => {
  assert.equal(stripAiTells("a – b"), "a, b");
  assert.equal(stripAiTells("a -- b"), "a, b");
});

test("stripAiTells: smart quotes and apostrophes become straight", () => {
  assert.equal(stripAiTells("It’s a “stark” reminder"), `It's a "stark" reminder`);
});

test("stripAiTells: leaves hyphens in compound words alone", () => {
  assert.equal(stripAiTells("end-to-end encryption, one-letter typo"), "end-to-end encryption, one-letter typo");
});

test("stripAiTells: no dash before terminal punctuation artifact", () => {
  // a dash right before a period shouldn't leave a dangling comma
  assert.equal(stripAiTells("the point lands —."), "the point lands.");
});

test("stripAiTells: contains no em/en dashes after cleaning", () => {
  const out = stripAiTells("one — two – three -- four");
  assert.ok(!/[—–]/.test(out));
});

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
