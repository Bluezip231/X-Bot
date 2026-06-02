import { fetchAllHeadlines } from "../services/news-client.js";
import { insertHeadline } from "../db.js";
import { isDuplicate } from "../utils/dedup.js";
import { logger } from "../utils/logger.js";

/**
 * Step 1: Fetch headlines, deduplicate, store in DB.
 * Returns array of new (non-duplicate) headlines.
 */
export async function ingest() {
  const raw = await fetchAllHeadlines();
  logger.info({ rawCount: raw.length }, "Pipeline step 1: raw headlines fetched");

  const fresh = [];
  for (const headline of raw) {
    if (!headline.title || headline.title.length < 10) continue;
    if (await isDuplicate(headline)) continue;

    await insertHeadline(headline);
    fresh.push(headline);
  }

  logger.info({ freshCount: fresh.length }, "Pipeline step 1: new headlines after dedup");
  return fresh;
}
