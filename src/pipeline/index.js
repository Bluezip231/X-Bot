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

// runNews() returns this when there's nothing fresh to post (so the caller can
// fall back to an evergreen post).
const NO_NEWS = Symbol("no_news");

/**
 * Run one scan. Posts up to `tweetsPerRun` NEWS tweets (distinct top stories),
 * or one EVERGREEN tweet — chosen by config.evergreenRatio, with evergreen as a
 * fallback when no fresh news passes. Never exceeds maxTweetsPerDay.
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

  // Insert one post row, post it (unless dry run), mark published. Does NOT
  // finish the pipeline run (a run may publish several). Returns { posted, ... }.
  const publishOne = async (post) => {
    const dbResult = await insertPost({ ...post, dry_run: config.dryRun });
    const tweetId = await postTweet(post.full_text);
    if (tweetId) {
      await markPostPublished(dbResult.id, tweetId);
      logger.info(
        { postId: dbResult.id, tweetId, kind: post.kind, style: post.style, text: post.full_text },
        "Posted"
      );
      return { posted: true, tweetId, postId: dbResult.id };
    }
    if (config.dryRun) {
      // postTweet already logged "[DRY RUN] Would post"; count it for loop progress.
      return { posted: true, tweetId: "dry-run", postId: dbResult.id };
    }
    return { posted: false, postId: dbResult.id };
  };

  // NEWS path: post up to `target` distinct top stories. Returns NO_NEWS if
  // nothing landed (so the caller can fall back to evergreen).
  const runNews = async (capacity) => {
    stats.details.mode = "news";

    const headlines = await ingest();
    stats.headlinesIngested = headlines.length;
    if (headlines.length === 0) return NO_NEWS;

    const classified = await classify(headlines);
    const filtered = await editorialFilter(classified);
    stats.headlinesFiltered = filtered.length;
    if (filtered.length === 0) return NO_NEWS;

    recordTopHeadline(filtered[0]);

    const target = Math.min(config.tweetsPerRun, capacity);
    const published = [];
    const skipped = [];

    for (const headline of filtered) {
      if (published.length >= target) break;

      // Dedup vs recent posts (re-queried each iteration so it also sees the
      // ones we just posted this run).
      const recent = await getLastPublishedPosts(config.postDedupLookbackCount);
      const verdict = await dedupCheck({ headline, recentTweets: recent });
      if (verdict.is_duplicate) {
        skipped.push({ title: headline.title, reason: "duplicate", detail: verdict.reasoning });
        continue;
      }

      const gen = await generatePost({ headline });
      if (!gen.post) {
        skipped.push({ title: headline.title, reason: gen.failure?.reason || "generate_failed" });
        continue;
      }

      const qc = await qualityCheck(gen.post);
      if (!qc.post) {
        skipped.push({ title: headline.title, reason: qc.failure?.reason || "quality_failed" });
        continue;
      }

      const res = await publishOne(qc.post);
      if (res.posted) {
        published.push({ tweet_id: res.tweetId, topic: qc.post.topic, style: qc.post.style, title: headline.title });
        if (!stats.postId) stats.postId = res.postId;
      } else {
        skipped.push({ title: headline.title, reason: "twitter_post_failed" });
      }
    }

    stats.postGenerated = published.length > 0;
    stats.postPublished = published.length > 0;
    stats.details.published_count = published.length;
    stats.details.published = published;
    if (skipped.length) stats.details.skipped = skipped;

    if (published.length === 0) return NO_NEWS; // nothing landed → let caller try evergreen

    stats.rejectionStage = "completed";
    await finishPipelineRun(runId, stats);
    logger.info({ count: published.length, target }, "News run complete");
    return published;
  };

  // EVERGREEN path: one standalone post on a random configured topic.
  const runEvergreen = async () => {
    stats.details.mode = "evergreen";
    const topic = config.topics[Math.floor(Math.random() * config.topics.length)];
    stats.details.evergreen_topic = topic;

    const gen = await generateEvergreenPost({ topic });
    if (!gen.post) {
      return reject("generate_post", gen.failure?.reason || "generate_post_failed", {
        generate_failure: gen.failure?.details || null,
        evergreen_topic: topic,
      });
    }

    const qc = await qualityCheck(gen.post);
    if (!qc.post) {
      logger.warn("Evergreen post failed quality check, not publishing");
      return reject("quality_check", qc.failure?.reason || "quality_check_failed", {
        generated_post: { full_text: gen.post.full_text },
        quality_failure: qc.failure?.details || null,
      });
    }
    const checked = qc.post;
    if (qc.quality_scores) stats.details.quality_scores = qc.quality_scores;

    const recent = await getLastPublishedPosts(config.postDedupLookbackCount);
    const verdict = await dedupCheck({
      headline: { title: checked.full_text, description: `evergreen ${topic}` },
      recentTweets: recent,
    });
    stats.details.dedup_check = {
      lookback_count: recent.length,
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

    const res = await publishOne(checked);
    stats.postGenerated = true;
    stats.postPublished = !!res.posted;
    stats.postId = res.postId;
    stats.details.published_count = res.posted ? 1 : 0;
    if (res.tweetId) stats.details.tweet_id = res.tweetId;
    if (!res.posted && !config.dryRun) {
      stats.rejectionStage = "publish";
      stats.rejectionReason = "twitter_post_failed";
    }
    if (!stats.rejectionStage) stats.rejectionStage = "completed";
    await finishPipelineRun(runId, stats);
    logger.info({ kind: "evergreen", topic, tweetId: res.tweetId }, "Evergreen run complete");
    return checked;
  };

  try {
    // Daily tweet limit (UTC, excludes dry-run rows).
    const todayCount = await getPostCountToday();
    const capacity = config.maxTweetsPerDay - todayCount;
    if (capacity <= 0) {
      logger.info({ todayCount, max: config.maxTweetsPerDay }, "Daily tweet limit reached, skipping");
      return reject("daily_limit", "Daily tweet limit reached", {
        today_count: todayCount,
        max_tweets_per_day: config.maxTweetsPerDay,
      });
    }

    // News vs evergreen for this scan.
    if (Math.random() < config.evergreenRatio) {
      logger.info({ evergreenRatio: config.evergreenRatio }, "Evergreen run selected by ratio");
      return await runEvergreen();
    }

    const newsResult = await runNews(capacity);
    if (newsResult !== NO_NEWS) return newsResult;

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
