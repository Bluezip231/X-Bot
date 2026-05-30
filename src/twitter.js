// Thin wrapper around twitter-api-v2 for search, like, and reply.

import { TwitterApi } from "twitter-api-v2";
import { config } from "./config.js";
import { logger } from "./logger.js";

const client = new TwitterApi({
  appKey: config.twitter.appKey,
  appSecret: config.twitter.appSecret,
  accessToken: config.twitter.accessToken,
  accessSecret: config.twitter.accessSecret,
});

let cachedUserId = null;

// The authenticated user's id is required to like a tweet (v2 like endpoint).
async function getUserId() {
  if (cachedUserId) return cachedUserId;
  const me = await client.v2.me();
  cachedUserId = me.data.id;
  return cachedUserId;
}

// Build a v2 search query from the configured terms + filters.
function buildQuery() {
  const { terms, excludeRetweets, lang } = config.search;
  // OR-join terms and wrap so the filters apply to the whole group.
  const grouped = `(${terms.join(" OR ")})`;
  const parts = [grouped];
  if (excludeRetweets) parts.push("-is:retweet");
  if (lang) parts.push(`lang:${lang}`);
  return parts.join(" ");
}

// Search recent tweets and return normalized objects.
// NOTE: v2 recent search requires at least the paid Basic API tier.
export async function searchTweets() {
  const query = buildQuery();
  // The API requires max_results between 10 and 100.
  const maxResults = Math.min(Math.max(config.search.maxCandidates, 10), 100);

  logger.info(`Searching tweets: query="${query}" max_results=${maxResults}`);

  const result = await client.v2.search(query, {
    max_results: maxResults,
    "tweet.fields": ["author_id", "created_at", "lang", "public_metrics"],
    expansions: ["author_id"],
    "user.fields": ["username"],
  });

  const tweets = result.tweets || [];
  const usersById = new Map(
    (result.includes?.users || []).map((u) => [u.id, u])
  );

  const normalized = tweets.map((t) => {
    const author = usersById.get(t.author_id);
    const username = author?.username || null;
    return {
      id: t.id,
      text: t.text,
      authorId: t.author_id,
      authorUsername: username,
      createdAt: t.created_at,
      url: username ? `https://x.com/${username}/status/${t.id}` : null,
    };
  });

  logger.info(`Found ${normalized.length} candidate tweet(s).`);
  return normalized;
}

export async function likeTweet(tweetId) {
  const userId = await getUserId();
  return client.v2.like(userId, tweetId);
}

export async function replyToTweet(tweetId, text) {
  return client.v2.reply(text, tweetId);
}
