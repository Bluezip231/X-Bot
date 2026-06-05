// Pure ranking helper (no config/db import) so it's easy to unit-test.

/**
 * Rank post styles by mean engagement (likes + replies + retweets per post).
 *
 * @param {Array<{style:string, like_count?:number, reply_count?:number, retweet_count?:number}>} rows
 * @param {{minPosts?:number}} opts - only include styles with at least this many posts.
 * @returns {Array<{style:string, avg:number, count:number}>} best-performing first.
 */
export function rankStyles(rows, { minPosts = 3 } = {}) {
  const byStyle = new Map();
  for (const r of rows || []) {
    if (!r || !r.style) continue;
    const score = (r.like_count || 0) + (r.reply_count || 0) + (r.retweet_count || 0);
    const e = byStyle.get(r.style) || { style: r.style, total: 0, count: 0 };
    e.total += score;
    e.count += 1;
    byStyle.set(r.style, e);
  }
  return [...byStyle.values()]
    .filter((e) => e.count >= minPosts)
    .map((e) => ({ style: e.style, avg: e.total / e.count, count: e.count }))
    .sort((a, b) => b.avg - a.avg);
}
