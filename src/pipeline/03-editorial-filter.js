import { runPrompt } from "../services/openai-client.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const BATCH_SIZE = 30;

// Headlines the classifier already marked as off-topic ("unknown" bucket only)
// or near-zero relevance can't pass the strict editorial filter anyway — drop
// them before the LLM scoring pass so they don't cost tokens. Kept well below
// editorialThreshold so this is purely a cheap pre-cut, never the real gate.
const MIN_INITIAL_RELEVANCE = 3;

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

  // Low temperature: editorial scoring is a judgment task — consistency over flair.
  const result = await runPrompt("editorial-filter.txt", userMessage, { temperature: 0.2 });
  return result.filtered || [];
}

/**
 * Step 3: Score on-topic relevance and apply the editorial filter via ChatGPT.
 * Batches large sets to avoid JSON truncation.
 * Returns only headlines that pass the threshold, sorted best-first.
 */
export async function editorialFilter(headlines) {
  if (headlines.length === 0) return [];

  const candidates = headlines.filter(
    (h) =>
      (h.topic_buckets || []).some((b) => b !== "unknown") &&
      (h.initial_relevance ?? 0) >= MIN_INITIAL_RELEVANCE
  );
  if (candidates.length < headlines.length) {
    logger.info(
      { input: headlines.length, candidates: candidates.length, minInitialRelevance: MIN_INITIAL_RELEVANCE },
      "Editorial filter: off-topic/low-relevance headlines dropped before LLM scoring"
    );
  }
  if (candidates.length === 0) {
    logger.info({ input: headlines.length, passed: 0 }, "Pipeline step 3: editorial filter applied");
    return [];
  }

  const filtered = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    logger.info({ batch: Math.floor(i / BATCH_SIZE) + 1, size: batch.length }, "Filtering batch");
    const batchResult = await filterBatch(batch, i);
    filtered.push(...batchResult);
  }

  const passed = [];
  for (const item of filtered) {
    const original = candidates[item.index];
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
