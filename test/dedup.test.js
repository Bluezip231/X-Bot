import { test } from "node:test";
import assert from "node:assert/strict";
import { titleSimilarity, isDuplicateAgainst } from "../src/utils/dedup.js";

test("titleSimilarity: identical titles score 1", () => {
  assert.equal(titleSimilarity("OpenAI launches GPT-5 model", "OpenAI launches GPT-5 model"), 1);
});

test("titleSimilarity: unrelated titles score low", () => {
  const sim = titleSimilarity(
    "OpenAI launches GPT-5 model",
    "Ransomware gang hits hospital network"
  );
  assert.ok(sim < 0.2, `expected < 0.2, got ${sim}`);
});

test("isDuplicateAgainst: exact URL match is a duplicate", () => {
  const dup = isDuplicateAgainst(
    { title: "Completely different wording here", url: "https://example.com/a" },
    { knownUrls: new Set(["https://example.com/a"]), recentTitles: [] }
  );
  assert.equal(dup, true);
});

test("isDuplicateAgainst: similar title is a duplicate", () => {
  const dup = isDuplicateAgainst(
    { title: "OpenAI launches new GPT-5 model today", url: "https://example.com/b" },
    {
      knownUrls: new Set(),
      recentTitles: ["OpenAI launches GPT-5 model"],
    }
  );
  assert.equal(dup, true);
});

test("isDuplicateAgainst: fresh headline passes", () => {
  const dup = isDuplicateAgainst(
    { title: "Ransomware gang hits hospital network", url: "https://example.com/c" },
    {
      knownUrls: new Set(["https://example.com/a"]),
      recentTitles: ["OpenAI launches GPT-5 model"],
    }
  );
  assert.equal(dup, false);
});

test("isDuplicateAgainst: missing URL still checks titles", () => {
  const dup = isDuplicateAgainst(
    { title: "OpenAI launches GPT-5 model", url: "" },
    { knownUrls: new Set(), recentTitles: ["OpenAI launches GPT-5 model"] }
  );
  assert.equal(dup, true);
});
