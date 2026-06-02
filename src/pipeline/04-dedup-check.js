import { runPrompt } from "../services/openai-client.js";
import { logger } from "../utils/logger.js";

/**
 * LLM-based duplicate check.
 * Compares the candidate headline against the last N published tweets and
 * returns a structured verdict. Fails open: on any error, returns
 * is_duplicate=false and surfaces the failure so a flaky LLM call does not
 * silently block all posting.
 */
export async function dedupCheck({ headline, recentTweets }) {
  if (!recentTweets || recentTweets.length === 0) {
    logger.info("Dedup check: no prior tweets, skipping");
    return { is_duplicate: false, matched_tweet_index: null, reasoning: "no_prior_tweets" };
  }

  const input = {
    candidate: {
      title: headline.title,
      description: headline.description || "",
    },
    recent_tweets: recentTweets.map((t, i) => ({
      index: i,
      full_text: t.full_text,
      posted_at: t.created_at,
    })),
  };

  let raw;
  try {
    raw = await runPrompt("dedup-check.txt", JSON.stringify(input));
  } catch (err) {
    logger.warn({ error: err.message }, "Dedup check: LLM call failed, failing open");
    return {
      is_duplicate: false,
      matched_tweet_index: null,
      reasoning: "llm_error_fail_open",
      error: err.message,
    };
  }

  const verdict = normalize(raw, recentTweets.length);
  if (!verdict) {
    logger.warn({ raw }, "Dedup check: malformed JSON, failing open");
    return {
      is_duplicate: false,
      matched_tweet_index: null,
      reasoning: "malformed_response_fail_open",
    };
  }

  const matchedTweet =
    verdict.is_duplicate && verdict.matched_tweet_index != null
      ? recentTweets[verdict.matched_tweet_index]?.full_text || null
      : null;

  logger.info(
    {
      is_duplicate: verdict.is_duplicate,
      matched_tweet_index: verdict.matched_tweet_index,
      reasoning: verdict.reasoning,
    },
    "Dedup check: verdict"
  );

  return { ...verdict, matched_tweet_text: matchedTweet };
}

function normalize(raw, recentCount) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.is_duplicate !== "boolean") return null;
  let idx = raw.matched_tweet_index;
  if (idx === undefined) idx = null;
  if (idx !== null) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= recentCount) idx = null;
  }
  const reasoning = typeof raw.reasoning === "string" ? raw.reasoning : "";
  return { is_duplicate: raw.is_duplicate, matched_tweet_index: idx, reasoning };
}
