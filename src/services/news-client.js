import Parser from "rss-parser";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";

const parser = new Parser({ timeout: 15000 });

/**
 * Normalize an RSS item into our standard headline shape.
 */
function normalizeItem(item, sourceName) {
  return {
    title: (item.title || "").trim(),
    description: (item.contentSnippet || item.content || "").trim().slice(0, 500),
    source: sourceName,
    url: item.link || "",
    publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
  };
}

/**
 * Fetch headlines from all configured RSS feeds. Returns normalized array.
 * Feeds that fail are logged and skipped; one bad feed never blocks the rest.
 */
export async function fetchRssHeadlines() {
  const results = [];
  const limit = config.news.perFeedLimit;

  const fetches = config.news.feeds.map(async (feed) => {
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = (parsed.items || []).slice(0, limit).map((item) => normalizeItem(item, feed.name));
      results.push(...items);
      logger.debug({ feed: feed.name, count: items.length }, "RSS feed fetched");
    } catch (err) {
      logger.warn({ feed: feed.name, error: err.message }, "RSS feed failed");
    }
  });

  await Promise.allSettled(fetches);
  logger.info({ totalHeadlines: results.length }, "RSS ingestion complete");
  return results;
}

/**
 * Optional: fetch from TheNewsAPI if a key is configured.
 * Free tier: 100 req/day, 3 articles/req.
 */
export async function fetchTheNewsApiHeadlines() {
  if (!config.news.theNewsApiKey) return [];

  try {
    const url = `https://api.thenewsapi.com/v1/news/top?locale=us&language=en&api_token=${config.news.theNewsApiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn({ status: res.status }, "TheNewsAPI request failed");
      return [];
    }
    const data = await res.json();
    const articles = (data.data || []).map((a) => ({
      title: (a.title || "").trim(),
      description: (a.description || a.snippet || "").trim().slice(0, 500),
      source: a.source || "TheNewsAPI",
      url: a.url || "",
      publishedAt: a.published_at || new Date().toISOString(),
    }));
    logger.info({ count: articles.length }, "TheNewsAPI fetched");
    return articles;
  } catch (err) {
    logger.warn({ error: err.message }, "TheNewsAPI fetch error");
    return [];
  }
}

/**
 * Fetch all headlines from all configured sources.
 */
export async function fetchAllHeadlines() {
  const [rss, theNewsApi] = await Promise.all([fetchRssHeadlines(), fetchTheNewsApiHeadlines()]);
  return [...rss, ...theNewsApi];
}
