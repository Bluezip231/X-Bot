import { fetchAllHeadlines } from "../services/news-client.js";
import { insertHeadline, getRecentHeadlineUrls, getRecentHeadlineTitles } from "../db.js";
import { isDuplicateAgainst } from "../utils/dedup.js";
import { isOlderThanHours } from "../utils/time.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const DEDUP_HOURS_BACK = 48;

/**
 * Step 1: Fetch headlines, drop stale items, deduplicate, store in DB.
 * Returns array of new (non-duplicate) headlines.
 */
export async function ingest() {
  const raw = await fetchAllHeadlines();
  logger.info({ rawCount: raw.length }, "Pipeline step 1: raw headlines fetched");

  // Fetch the recent URL/title sets once for the whole batch (instead of two
  // DB queries per headline). Accepted items are added to the in-memory sets
  // as we go, so duplicates within the same fetch are still caught.
  const [knownUrls, recentTitles] = await Promise.all([
    getRecentHeadlineUrls(DEDUP_HOURS_BACK),
    getRecentHeadlineTitles(DEDUP_HOURS_BACK),
  ]);

  const maxAgeHours = config.news.maxHeadlineAgeHours;
  let staleCount = 0;
  const fresh = [];
  for (const headline of raw) {
    if (!headline.title || headline.title.length < 10) continue;
    // Feeds sometimes resurface old items (and the headlines table is pruned
    // after cleanupDays), so without an age gate an old story could come back
    // and get posted as fresh news.
    if (maxAgeHours > 0 && isOlderThanHours(headline.publishedAt, maxAgeHours)) {
      staleCount++;
      continue;
    }
    if (isDuplicateAgainst(headline, { knownUrls, recentTitles })) continue;

    await insertHeadline(headline);
    if (headline.url) knownUrls.add(headline.url);
    recentTitles.push(headline.title);
    fresh.push(headline);
  }

  if (staleCount > 0) {
    logger.info({ staleCount, maxAgeHours }, "Pipeline step 1: stale headlines skipped");
  }
  logger.info({ freshCount: fresh.length }, "Pipeline step 1: new headlines after dedup");
  return fresh;
}
