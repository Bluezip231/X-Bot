// Engagement feedback: turn stored post metrics into a soft signal that biases
// future posts toward the styles that have historically performed best.
//
// Metrics are refreshed once a day (see engagement.js), so the ranking is
// cached in-memory for a few hours to avoid a DB round-trip on every scan.

import { getStyleEngagement } from "./db.js";
import { rankStyles } from "./utils/rank-styles.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const TOP_N = 3;

let cache = { at: 0, styles: [] };

/** Reset the in-memory cache. Exposed for tests. */
export function _resetTopStylesCache() {
  cache = { at: 0, styles: [] };
}

/**
 * Top-performing post styles (best first), or [] when feedback is disabled or
 * there isn't enough data yet. Degrades to [] on any error — callers treat an
 * empty list as "no preference", so the generator just picks the best-fitting
 * style as before.
 */
export async function getTopStyles({ now = Date.now() } = {}) {
  if (!config.styleFeedback.enabled) return [];
  if (now - cache.at < CACHE_TTL_MS) return cache.styles;

  let styles = [];
  try {
    const rows = await getStyleEngagement(config.styleFeedback.lookbackDays);
    styles = rankStyles(rows, { minPosts: config.styleFeedback.minPosts })
      .slice(0, TOP_N)
      .map((s) => s.style);
    if (styles.length) {
      logger.info({ topStyles: styles }, "Engagement feedback: top-performing styles");
    }
  } catch (err) {
    logger.warn({ error: err.message }, "getTopStyles failed — proceeding with no style preference");
    styles = [];
  }

  cache = { at: now, styles };
  return styles;
}
