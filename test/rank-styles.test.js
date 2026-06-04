import { test } from "node:test";
import assert from "node:assert/strict";
import { rankStyles } from "../src/utils/rank-styles.js";

const rows = [
  // warning: avg (10+5+0=15)/2 ... two posts
  { style: "warning", like_count: 10, reply_count: 5, retweet_count: 0 }, // 15
  { style: "warning", like_count: 20, reply_count: 0, retweet_count: 5 }, // 25 -> avg 20
  // educational: three posts, lower avg
  { style: "educational", like_count: 1, reply_count: 0, retweet_count: 0 }, // 1
  { style: "educational", like_count: 2, reply_count: 1, retweet_count: 0 }, // 3
  { style: "educational", like_count: 2, reply_count: 0, retweet_count: 0 }, // 2 -> avg 2
  // opinion: only one post (below minPosts)
  { style: "opinion", like_count: 100, reply_count: 100, retweet_count: 100 },
];

test("ranks styles by mean engagement, best first", () => {
  const ranked = rankStyles(rows, { minPosts: 2 });
  assert.deepEqual(ranked.map((r) => r.style), ["warning", "educational"]);
  assert.equal(ranked[0].avg, 20);
  assert.equal(ranked[0].count, 2);
});

test("excludes styles below the minimum post count", () => {
  const ranked = rankStyles(rows, { minPosts: 2 });
  assert.ok(!ranked.some((r) => r.style === "opinion"));
});

test("minPosts can include single-post styles", () => {
  const ranked = rankStyles(rows, { minPosts: 1 });
  // opinion has the highest avg (300) when included.
  assert.equal(ranked[0].style, "opinion");
});

test("ignores rows without a style and handles missing counts", () => {
  const ranked = rankStyles(
    [{ like_count: 5 }, { style: "casual" }, { style: "casual", like_count: 4 }],
    { minPosts: 1 }
  );
  assert.deepEqual(ranked, [{ style: "casual", avg: 2, count: 2 }]);
});

test("empty / nullish input returns an empty array", () => {
  assert.deepEqual(rankStyles([]), []);
  assert.deepEqual(rankStyles(undefined), []);
});
