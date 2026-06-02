import { ingest } from "./01-ingest.js";
import { classify } from "./02-classify.js";
import { editorialFilter } from "./03-editorial-filter.js";
import { dedupCheck } from "./04-dedup-check.js";
import { generatePost, generateEvergreenPost } from "./05-generate-post.js";
import { qualityCheck } from "./06-quality-check.js";
import {
  insertPost,
  markPostPublished,
  getPostCountToday,
  getLastPublishedPosts,
  insertPipelineRun,
  finishPipelineRun,
} from "../db.js";
import { postTweet } from "../services/twitter-client.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { serializeError } from "../utils/serialize-error.js";

// runNews() returns this when there's simply nothing fresh to post (as opposed
// to a hard rejection), so the caller can fall back to an evergreen post.
const NO_NEWS = Symbol("no_news");

/**
 * Run the pipeline once. Each run posts either NEWS (about a fresh headline) or
 * EVERGREEN content (a standalone tip/warning/explainer). Evergreen is chosen
 * for a configurable share of runs (config.evergreenRatio), and is also used as
 * a fallback when no fresh news passes the filter.
 */
export async function runPipeline(runType = "scheduled") {
  const stats = {
    headlinesIngested: 0,
    headlinesFiltered: 0,
    postGenerated: false,
    postPublished: false,
    details: {},
  };
  const run = await insertPipelineRun(runType);
  const runId = run.id;

  const reject = async (stage, reason, extraDetails = {}) => {
    stats.rejectionStage = stage;
    stats.rejectionReason = reason;
    stats.details = { ...stats.details, ...extraDetails };
    await finishPipelineRun(runId, stats);
    return null;
  };

  const recordTopHeadline = (h) => {
    stats.topHeadlineTitle = h?.title || null;
    stats.topHeadlineUrl = h?.url || null;
    stats.topHeadlineRelevance = h?.relevance_score ?? null;
    if (h) {
      stats.details.top_headline = {
        title: h.title,
        url: h.url,
        source: h.source,
        relevance_score: h.relevance_score,
        topic_buckets: h.topic_buckets,
        filter_reasoning: h.filter_reasoning,
      };
    }
  };

  // Insert, post, mark published, finish. Dedup must be done by the caller.
  const publishPost = async (post) => {
    stats.postGenerated = true;
    stats.details.kind = post.kind;
    stats.details.style = post.style;

    const dbResult = await insertPost({ ...post, dry_run: config.dryRun });
    stats.postId = dbResult.id;

    const tweetId = await postTweet(post.full_text);
    if (tweetId) {
      await markPostPublished(dbResult.id, tweetId);
      stats.postPublished = true;
      stats.details.tweet_id = tweetId;
    } else if (config.dryRun) {
      stats.details.tweet_id = "dry-run";
    } else {
      stats.rejectionStage = "publish";
      stats.rejectionReason = "twitter_post_failed";
    }

    if (!stats.rejectionStage) stats.rejectionStage = "completed";
    await finishPipelineRun(runId, stats);
    logger.info(
      { postId: dbResult.id, tweetId, kind: post.kind, style: post.style, text: post.full_text },
      "Pipeline complete"
    );
    return post;
  };

  // NEWS path. Returns NO_NEWS when nothing fresh is available; otherwise the
  // published post (success) or null (a hard rejection already finished the run).
  const runNews = async () => {
    stats.details.mode = "news";

    const headlines = await ingest();
    stats.headlinesIngested = headlines.length;
    if (headlines.length === 0) return NO_NEWS;

    const classified = await classify(headlines);
    const filtered = await editorialFilter(classified);
    stats.headlinesFiltered = filtered.length;
    if (filtered.length === 0) return NO_NEWS;

    const topHeadline = filtered[0];
    recordTopHeadline(topHeadline);

    const recentTweets = await getLastPublishedPosts(config.postDedupLookbackCount);
    const dedupVerdict = await dedupCheck({ headline: topHeadline, recentTweets });
    stats.details.dedup_check = {
      lookback_count: recentTweets.length,
      is_duplicate: dedupVerdict.is_duplicate,
      matched_tweet_index: dedupVerdict.matched_tweet_index ?? null,
      reasoning: dedupVerdict.reasoning || null,
      ...(dedupVerdict.error ? { llm_error: dedupVerdict.error } : {}),
    };
    if (dedupVerdict.is_duplicate) {
      logger.info(
        { reasoning: dedupVerdict.reasoning, candidate_headline: topHeadline.title },
        "Pipeline: dedup flagged candidate as already covered, skipping"
      );
      return reject("dedup", "Candidate news already covered by a recent post", {
        candidate_headline: topHeadline.title,
        candidate_url: topHeadline.url,
        matched_tweet_text: dedupVerdict.matched_tweet_text,
        reasoning: dedupVerdict.reasoning,
        lookback_count: recentTweets.length,
      });
    }

    const genResult = await generatePost({ headline: topHeadline });
    if (!genResult.post) {
      return reject("generate_post", genResult.failure?.reason || "generate_post_failed", {
        generate_failure: genResult.failure?.details || null,
      });
    }

    const qcResult = await qualityCheck(genResult.post);
    if (!qcResult.post) {
      logger.warn("News post failed quality check, not publishing");
      return reject("quality_check", qcResult.failure?.reason || "quality_check_failed", {
        generated_post: { full_text: genResult.post.full_text },
        quality_failure: qcResult.failure?.details || null,
      });
    }
    if (qcResult.quality_scores) stats.details.quality_scores = qcResult.quality_scores;

    return publishPost(qcResult.post);
  };

  // EVERGREEN path. Writes a standalone post on a random configured topic, then
  // dedups the generated text against recent posts so tips don't repeat.
  const runEvergreen = async () => {
    stats.details.mode = "evergreen";
    const topic = config.topics[Math.floor(Math.random() * config.topics.length)];
    stats.details.evergreen_topic = topic;

    const genResult = await generateEvergreenPost({ topic });
    if (!genResult.post) {
      return reject("generate_post", genResult.failure?.reason || "generate_post_failed", {
        generate_failure: genResult.failure?.details || null,
        evergreen_topic: topic,
      });
    }

    const qcResult = await qualityCheck(genResult.post);
    if (!qcResult.post) {
      logger.warn("Evergreen post failed quality check, not publishing");
      return reject("quality_check", qcResult.failure?.reason || "quality_check_failed", {
        generated_post: { full_text: genResult.post.full_text },
        quality_failure: qcResult.failure?.details || null,
      });
    }
    const checkedPost = qcResult.post;
    if (qcResult.quality_scores) stats.details.quality_scores = qcResult.quality_scores;

    const recentTweets = await getLastPublishedPosts(config.postDedupLookbackCount);
    const verdict = await dedupCheck({
      headline: { title: checkedPost.full_text, description: `evergreen ${topic}` },
      recentTweets,
    });
    stats.details.dedup_check = {
      lookback_count: recentTweets.length,
      is_duplicate: verdict.is_duplicate,
      matched_tweet_index: verdict.matched_tweet_index ?? null,
      reasoning: verdict.reasoning || null,
      ...(verdict.error ? { llm_error: verdict.error } : {}),
    };
    if (verdict.is_duplicate) {
      logger.info({ reasoning: verdict.reasoning, topic }, "Evergreen post too similar to a recent one, skipping");
      return reject("dedup", "Evergreen post too similar to a recent one", {
        topic,
        matched_tweet_text: verdict.matched_tweet_text,
        reasoning: verdict.reasoning,
      });
    }

    return publishPost(checkedPost);
  };

  try {
    // Daily post limit (UTC, excludes dry-run rows).
    const todayCount = await getPostCountToday();
    if (todayCount >= config.maxTweetsPerDay) {
      logger.info({ todayCount, max: config.maxTweetsPerDay }, "Daily tweet limit reached, skipping");
      return reject("daily_limit", "Daily tweet limit reached", {
        today_count: todayCount,
        max_tweets_per_day: config.maxTweetsPerDay,
      });
    }

    // Decide news vs evergreen for this run.
    if (Math.random() < config.evergreenRatio) {
      logger.info({ evergreenRatio: config.evergreenRatio }, "Evergreen run selected by ratio");
      return await runEvergreen();
    }

    const newsResult = await runNews();
    if (newsResult !== NO_NEWS) return newsResult;

    // No fresh news passed — don't waste the slot, post evergreen instead.
    logger.info("No fresh news passed the filter — falling back to evergreen");
    stats.details.fallback_to_evergreen = true;
    return await runEvergreen();
  } catch (err) {
    const fullError = serializeError(err);
    stats.error = fullError;
    stats.rejectionStage = stats.rejectionStage || "exception";
    stats.rejectionReason = stats.rejectionReason || err.message;
    stats.details = { ...stats.details, exception_stack: err.stack };
    await finishPipelineRun(runId, stats);
    logger.error({ error: fullError, stack: err.stack }, "Pipeline failed");
    return null;
  }
}
