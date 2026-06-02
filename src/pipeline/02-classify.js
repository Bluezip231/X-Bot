import { runPrompt } from "../services/openai-client.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const BATCH_SIZE = 30;

function topicsLine() {
  return `Allowed topic buckets: ${config.topics.join(", ")}.`;
}

/**
 * Classify a single batch of headlines. Returns classifications array.
 * The configured topics are injected into the user message so the static
 * prompt stays topic-agnostic.
 */
async function classifyBatch(headlines, startIndex) {
  const headlineList = headlines.map((h, i) => `${startIndex + i}. ${h.title}`).join("\n");
  const userMessage = `${topicsLine()}\n\nHeadlines (use the exact index shown):\n${headlineList}`;

  const result = await runPrompt("classify.txt", userMessage);
  return result.classifications || [];
}

/**
 * Step 2: Classify headlines into the configured topic buckets via ChatGPT.
 * Batches large sets to avoid JSON truncation.
 * Returns headlines enriched with topic_buckets and initial_relevance.
 */
export async function classify(headlines) {
  if (headlines.length === 0) return [];

  const allClassifications = [];
  for (let i = 0; i < headlines.length; i += BATCH_SIZE) {
    const batch = headlines.slice(i, i + BATCH_SIZE);
    logger.info({ batch: Math.floor(i / BATCH_SIZE) + 1, size: batch.length }, "Classifying batch");
    const classifications = await classifyBatch(batch, i);
    allClassifications.push(...classifications);
  }

  const enriched = headlines.map((h, i) => {
    const c = allClassifications.find((cl) => cl.index === i);
    return {
      ...h,
      topic_buckets: c?.topic_buckets || ["unknown"],
      initial_relevance: c?.initial_relevance ?? 0,
    };
  });

  for (const h of enriched) {
    logger.info(
      { title: h.title, topics: h.topic_buckets, relevance: h.initial_relevance, source: h.source },
      "Classified headline"
    );
  }

  logger.info({ classified: enriched.length }, "Pipeline step 2: headlines classified");
  return enriched;
}
