import { TwitterApi } from "twitter-api-v2";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

let rwClient = null;

function getClient() {
  if (!rwClient) {
    const client = new TwitterApi({
      appKey: config.twitter.appKey,
      appSecret: config.twitter.appSecret,
      accessToken: config.twitter.accessToken,
      accessSecret: config.twitter.accessSecret,
    });
    rwClient = client.readWrite;
  }
  return rwClient;
}

/**
 * Post an original tweet. Respects config.dryRun.
 * Returns the tweet ID, or null in dry-run mode.
 */
export async function postTweet(text) {
  if (config.dryRun) {
    logger.info({ text }, "[DRY RUN] Would post tweet");
    return null;
  }

  try {
    const client = getClient();
    const result = await client.v2.tweet(text);
    const tweetId = result.data.id;
    logger.info({ tweetId, textLength: text.length }, "Tweet posted");
    return tweetId;
  } catch (err) {
    logger.error(
      {
        error: err.message,
        code: err.code,
        status: err.status || err.statusCode,
        data: err.data,
        response_body: err.body,
      },
      "Failed to post tweet"
    );
    throw err;
  }
}

/**
 * Fetch public engagement metrics for the given tweet IDs.
 * Returns a Map of tweetId -> { like_count, reply_count, retweet_count }.
 * Batches by 100 (the X API lookup limit) and logs (does not throw) on error.
 */
export async function fetchTweetMetrics(tweetIds) {
  const out = new Map();
  if (!tweetIds || tweetIds.length === 0) return out;

  const client = getClient();
  for (let i = 0; i < tweetIds.length; i += 100) {
    const batch = tweetIds.slice(i, i + 100);
    try {
      const res = await client.v2.tweets(batch, { "tweet.fields": ["public_metrics"] });
      for (const t of res.data || []) {
        const m = t.public_metrics || {};
        out.set(t.id, {
          like_count: m.like_count ?? 0,
          reply_count: m.reply_count ?? 0,
          retweet_count: m.retweet_count ?? 0,
        });
      }
    } catch (err) {
      logger.error(
        { error: err.message, code: err.code, status: err.status || err.statusCode, data: err.data },
        "Failed to fetch tweet metrics"
      );
    }
  }
  return out;
}
