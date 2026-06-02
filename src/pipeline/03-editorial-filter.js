import { runPrompt } from "../services/openai-client.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const BATCH_SIZE = 30;

function topicsLine() {
  return `Target topics: ${config.topics.join(", ")}.`;
}

/**
 * Filter a single batch. Returns filtered array with original indices preserved.
 */
async function filterBatch(headlines, startIndex) {
  const headlineList = headlines
    .map((h, i) => `${startIndex + i}. [${h.topic_buckets.join(", ")}] ${h.title}`)
    .join("\n");
  const userMessage = `${topicsLine()}\n\nHeadlines (use the exact index shown):\n${headlineList}`;

  const result = await runPrompt("editorial-filter.txt", userMessage);
  return result.filtered || [];
}

/**
 * Step 3: Score on-topic relevance and apply the editorial filter via ChatGPT.
 * Batches large sets to avoid JSON truncation.
 * Returns only headlines that pass the threshold, sorted best-first.
 */
export async function editorialFilter(headlines) {
  if (headlines.length === 0) return [];

  const filtered = [];
  for (let i = 0; i < headlines.length; i += BATCH_SIZE) {
    const batch = headlines.slice(i, i + BATCH_SIZE);
    logger.info({ batch: Math.floor(i / BATCH_SIZE) + 1, size: batch.length }, "Filtering batch");
    const batchResult = await filterBatch(batch, i);
    filtered.push(...batchResult);
  }

  const passed = [];
  for (const item of filtered) {
    const original = headlines[item.index];
    const title = original?.title || `index:${item.index}`;
    const accepted = item.passes_filter && item.relevance_score >= config.editorialThreshold;

    logger.info(
      {
        title,
        relevance: item.relevance_score,
        passes: item.passes_filter,
        aboveThreshold: item.relevance_score >= config.editorialThreshold,
        accepted,
        reasoning: item.reasoning,
      },
      accepted ? "ACCEPTED headline" : "REJECTED headline"
    );

    if (accepted && original) {
      passed.push({
        ...original,
        relevance_score: item.relevance_score,
        filter_reasoning: item.reasoning,
      });
    }
  }

  passed.sort((a, b) => b.relevance_score - a.relevance_score);

  logger.info(
    { input: headlines.length, passed: passed.length, threshold: config.editorialThreshold },
    "Pipeline step 3: editorial filter applied"
  );

  return passed;
}
