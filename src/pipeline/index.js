import { ingest } from "./01-ingest.js";
import { classify } from "./02-classify.js";
import { editorialFilter } from "./03-editorial-filter.js";
import { dedupCheck } from "./04-dedup-check.js";
import { generatePost, generateEvergreenPost, generatePromoPost } from "./05-generate-post.js";
import { qualityCheck } from "./06-quality-check.js";
import {
  insertPost,
  markPostPublished,
  getPostCountToday,
  getLastPublishedPosts,
  getLastPublishedAt,
  getLastPostAttemptAt,
  insertPipelineRun,
  finishPipelineRun,
} from "../db.js";
import { postTweet } from "../services/twitter-client.js";
import { getTopStyles } from "../insights.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { serializeError } from "../utils/serialize-error.js";

// runNews() returns this when there's nothing fresh to post (so the caller can
// fall back to an evergreen post).
const NO_NEWS = Symbol("no_news");
// runNews() returns this when the database is unwritable, so the caller stops
// the whole run (fail closed) instead of attempting an evergreen fallback that
// would hit the same wall.
const DB_FAILED = Symbol("db_failed");
// runNews() returns this when posting to X failed, so the caller stops instead
// of attempting an evergreen fallback against the same failing API.
const TWITTER_FAILED = Symbol("twitter_failed");

// Quality-check failures that are worth one revision pass: the reviewer (or
// the programmatic guardrails, e.g. canned bot phrasing) said WHY the draft
// failed, so the writer can fix it instead of the story being dropped.
const REVISABLE_FAILURES = new Set(["quality_check_failed", "programmatic_guardrails_failed"]);

// Turn a failed quality check into retry feedback for the writer.
function buildRevisionFeedback(post, details = {}) {
  const problems = [...(details.violations || []), ...(details.issues || [])].join("; ");
  const suggestion = details.suggestion || "";
  return [
    `A pre-publish reviewer rejected your previous draft: "${post.full_text}".`,
    problems ? `Problems: ${problems}.` : "",
    suggestion ? `Suggestion: ${suggestion}.` : "",
    "Write a fresh draft that fixes these problems.",
  ]
    .filter(Boolean)
    .join(" ");
}

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

    // Fail closed: if we couldn't record the post, do NOT tweet. The daily cap,
    // spacing, and dedup are all enforced by reading prior posts from the DB, so
    // tweeting without a record would silently defeat them and let the bot run
    // away (post every run, repeat stories). Better to skip than to spam.
    if (!dbResult.id && !config.dryRun) {
      logger.error(
        { kind: post.kind, style: post.style },
        "Skipping post: could not record it in the database (post not tweeted)"
      );
      return { posted: false, postId: null, dbFailed: true };
    }

    let tweetId = null;
    try {
      tweetId = await postTweet(post.full_text);
    } catch (err) {
      // A transient X API failure shouldn't abort the whole run as an
      // exception. The post row stays unpublished, so it never counts toward
      // the daily cap; the caller records the failure and stops gracefully.
      logger.error({ error: err.message, postId: dbResult.id }, "Tweet failed to post");
      return { posted: false, postId: dbResult.id, twitterFailed: true };
    }
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
  // nothing landed (so the caller can fall back to evergreen). `topStyles` is a
  // soft engagement signal passed to the generator (may be empty).
  const runNews = async (capacity, topStyles) => {
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
    let dbFailed = false;
    let twitterFailed = false;

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

      const gen = await generatePost({ headline, topStyles });
      if (!gen.post) {
        skipped.push({ title: headline.title, reason: gen.failure?.reason || "generate_failed" });
        continue;
      }

      let qc = await qualityCheck(gen.post);
      // One revision pass: when the reviewer rejects the draft, hand its
      // feedback back to the writer instead of dropping the story outright.
      if (!qc.post && REVISABLE_FAILURES.has(qc.failure?.reason)) {
        logger.info({ title: headline.title }, "Quality check failed — regenerating once with reviewer feedback");
        const revisionFeedback = buildRevisionFeedback(gen.post, qc.failure.details);
        const regen = await generatePost({ headline, topStyles, revisionFeedback });
        if (regen.post) qc = await qualityCheck(regen.post);
      }
      if (!qc.post) {
        skipped.push({ title: headline.title, reason: qc.failure?.reason || "quality_failed" });
        continue;
      }

      const res = await publishOne(qc.post);
      if (res.posted) {
        published.push({ tweet_id: res.tweetId, topic: qc.post.topic, style: qc.post.style, title: headline.title });
        if (!stats.postId) stats.postId = res.postId;
      } else if (res.dbFailed) {
        // Database is unwritable — every post this run would hit the same wall
        // (and tweeting blind would defeat the daily cap), so stop here.
        skipped.push({ title: headline.title, reason: "db_insert_failed" });
        dbFailed = true;
        break;
      } else {
        skipped.push({ title: headline.title, reason: "twitter_post_failed" });
        // The failure may be ambiguous (a timeout can mean the tweet actually
        // went through unrecorded), so don't try to post another story this run.
        twitterFailed = true;
        break;
      }
    }

    stats.postGenerated = published.length > 0;
    stats.postPublished = published.length > 0;
    stats.details.published_count = published.length;
    stats.details.published = published;
    if (skipped.length) stats.details.skipped = skipped;

    // DB is unwritable and nothing landed → stop the whole run; do NOT fall
    // back to evergreen (it would just hit the same failed insert).
    if (dbFailed && published.length === 0) return DB_FAILED;

    // X itself is failing → also stop without an evergreen fallback (it would
    // hit the same API, and a tweet may have gone through unrecorded).
    if (twitterFailed && published.length === 0) return TWITTER_FAILED;

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

    let gen = await generateEvergreenPost({ topic });
    if (!gen.post) {
      return reject("generate_post", gen.failure?.reason || "generate_post_failed", {
        generate_failure: gen.failure?.details || null,
        evergreen_topic: topic,
      });
    }

    let qc = await qualityCheck(gen.post);
    // One revision pass with the reviewer's feedback before giving up.
    if (!qc.post && REVISABLE_FAILURES.has(qc.failure?.reason)) {
      logger.info({ topic }, "Quality check failed — regenerating once with reviewer feedback");
      const revisionFeedback = buildRevisionFeedback(gen.post, qc.failure.details);
      const regen = await generateEvergreenPost({ topic, revisionFeedback });
      if (regen.post) {
        gen = regen;
        qc = await qualityCheck(regen.post);
      }
    }
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
      stats.rejectionReason = res.dbFailed ? "db_insert_failed" : "twitter_post_failed";
    }
    if (!stats.rejectionStage) stats.rejectionStage = "completed";
    await finishPipelineRun(runId, stats);
    logger.info({ kind: "evergreen", topic, tweetId: res.tweetId }, "Evergreen run complete");
    return checked;
  };

  // PROMO path: one value-first post about the owner's product, link appended.
  const runPromo = async () => {
    stats.details.mode = "promo";

    // Recent promos are handed to the writer so each one takes a new angle.
    const previousPromos = await getLastPublishedPosts(3, { kind: "promo" });

    let gen = await generatePromoPost({ previousPromos });
    if (!gen.post) {
      return reject("generate_post", gen.failure?.reason || "generate_post_failed", {
        generate_failure: gen.failure?.details || null,
      });
    }

    let qc = await qualityCheck(gen.post);
    // One revision pass with the reviewer's feedback before giving up.
    if (!qc.post && REVISABLE_FAILURES.has(qc.failure?.reason)) {
      logger.info("Quality check failed — regenerating promo once with reviewer feedback");
      const revisionFeedback = buildRevisionFeedback(gen.post, qc.failure.details);
      const regen = await generatePromoPost({ previousPromos, revisionFeedback });
      if (regen.post) {
        gen = regen;
        qc = await qualityCheck(regen.post);
      }
    }
    if (!qc.post) {
      logger.warn("Promo post failed quality check, not publishing");
      return reject("quality_check", qc.failure?.reason || "quality_check_failed", {
        generated_post: { full_text: gen.post.full_text },
        quality_failure: qc.failure?.details || null,
      });
    }
    if (qc.quality_scores) stats.details.quality_scores = qc.quality_scores;

    const res = await publishOne(qc.post);
    stats.postGenerated = true;
    stats.postPublished = !!res.posted;
    stats.postId = res.postId;
    stats.details.published_count = res.posted ? 1 : 0;
    if (res.tweetId) stats.details.tweet_id = res.tweetId;
    if (!res.posted && !config.dryRun) {
      stats.rejectionStage = "publish";
      stats.rejectionReason = res.dbFailed ? "db_insert_failed" : "twitter_post_failed";
    }
    if (!stats.rejectionStage) stats.rejectionStage = "completed";
    await finishPipelineRun(runId, stats);
    logger.info({ kind: "promo", tweetId: res.tweetId }, "Promo run complete");
    return qc.post;
  };

  try {
    // --- Cheap gates first: bail out BEFORE any ingest / LLM calls so a scan
    // that can't post costs nothing. ---

    // Daily tweet limit (day boundary = local midnight in the configured tz).
    const todayCount = await getPostCountToday();
    const capacity = config.maxTweetsPerDay - todayCount;
    if (capacity <= 0) {
      logger.info({ todayCount, max: config.maxTweetsPerDay }, "Daily tweet limit reached, skipping");
      return reject("daily_limit", "Daily tweet limit reached", {
        today_count: todayCount,
        max_tweets_per_day: config.maxTweetsPerDay,
      });
    }

    // Minimum spacing between posts, so the day's tweets are spread out instead
    // of clustered in the first few scans. Only enforced for scheduled runs —
    // manual/--once runs (testing) bypass it.
    if (runType === "scheduled" && config.minPostSpacingMinutes > 0) {
      const lastAt = await getLastPublishedAt();
      if (lastAt) {
        const minsSince = (Date.now() - lastAt.getTime()) / 60000;
        if (minsSince < config.minPostSpacingMinutes) {
          logger.info(
            { minsSince: Math.round(minsSince), minSpacing: config.minPostSpacingMinutes },
            "Minimum post spacing not met, skipping"
          );
          return reject("min_spacing", "Minimum spacing since last post not met", {
            minutes_since_last_post: Math.round(minsSince),
            min_post_spacing_minutes: config.minPostSpacingMinutes,
          });
        }
      }
    }

    // Product promo, self-spaced to ~promoMaxPerWeek: a promo is due when none
    // has been published for 168/maxPerWeek hours (2/week = one every ~3.5
    // days). Promos take the slot for this scan; news resumes next run. The
    // daily cap and min-spacing gates above already applied.
    if (config.promo.enabled && config.promo.url && config.promo.maxPerWeek > 0) {
      const intervalMs = (168 / config.promo.maxPerWeek) * 60 * 60 * 1000;
      // In dry-run nothing is ever marked published, so space test promos by
      // attempt instead — otherwise every dry-run scan would pick the promo path.
      const lastPromoAt = config.dryRun
        ? await getLastPostAttemptAt("promo")
        : await getLastPublishedAt({ kind: "promo" });
      if (!lastPromoAt || Date.now() - lastPromoAt.getTime() >= intervalMs) {
        logger.info(
          { lastPromoAt: lastPromoAt?.toISOString() || null, maxPerWeek: config.promo.maxPerWeek },
          "Promo post due — running promo instead of news this scan"
        );
        return await runPromo();
      }
    }

    // News vs evergreen for this scan.
    if (Math.random() < config.evergreenRatio) {
      logger.info({ evergreenRatio: config.evergreenRatio }, "Evergreen run selected by ratio");
      return await runEvergreen();
    }

    // Soft engagement signal: styles that have historically performed best.
    const topStyles = await getTopStyles();

    const newsResult = await runNews(capacity, topStyles);
    // Database unwritable: stop the whole run. Don't try evergreen — it would
    // just hit the same failed insert.
    if (newsResult === DB_FAILED) {
      logger.error("Database insert failed — stopping run without evergreen fallback");
      return reject("publish", "db_insert_failed", { mode: "news" });
    }
    if (newsResult === TWITTER_FAILED) {
      logger.error("Posting to X failed — stopping run without evergreen fallback");
      return reject("publish", "twitter_post_failed", { mode: "news" });
    }
    if (newsResult !== NO_NEWS) return newsResult;

    // No fresh news. Fall back to a standalone evergreen tip — but only up to
    // maxEvergreenPerDay, so a slow news day doesn't fill the feed with generic
    // tips. Once that cap is hit, stay silent until real news shows up.
    const evergreenToday = await getPostCountToday({ kind: "evergreen" });
    if (evergreenToday >= config.maxEvergreenPerDay) {
      logger.info(
        { evergreenToday, max: config.maxEvergreenPerDay },
        "No fresh news and evergreen fallback cap reached — skipping"
      );
      return reject("no_news", "No fresh news and evergreen cap reached", {
        evergreen_today: evergreenToday,
        max_evergreen_per_day: config.maxEvergreenPerDay,
      });
    }

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
