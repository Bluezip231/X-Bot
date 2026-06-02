// Refreshes stored engagement (likes / replies / retweets) for recently
// published posts from the X API. Runs on a daily cron; the dashboard reads the
// stored numbers.

import { getPostsForMetrics, updatePostMetrics } from "./db.js";
import { fetchTweetMetrics } from "./services/twitter-client.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

export async function refreshEngagement(daysBack = config.metricsLookbackDays) {
  const posts = await getPostsForMetrics(daysBack);
  if (posts.length === 0) {
    logger.info("Engagement refresh: no published posts to update");
    return { updated: 0, checked: 0 };
  }

  const metrics = await fetchTweetMetrics(posts.map((p) => p.tweet_id));

  let updated = 0;
  for (const p of posts) {
    const m = metrics.get(p.tweet_id);
    if (!m) continue; // tweet deleted, or lookup missed it — leave prior values
    await updatePostMetrics(p.id, m);
    updated += 1;
  }

  logger.info({ updated, checked: posts.length }, "Engagement refresh complete");
  return { updated, checked: posts.length };
}
