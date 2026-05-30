// Entrypoint. Runs the bot on an internal cron schedule (always-on worker).
// Pass --once (or set npm run once) to run a single pass and exit.

import cron from "node-cron";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { searchTweets, likeTweet, replyToTweet } from "./twitter.js";
import { selectAndGenerateReplies } from "./openai.js";
import { alreadyHandled, logEvent } from "./supabase.js";

// Prevents overlapping runs if a pass takes longer than the cron interval.
let running = false;

async function runOnce() {
  if (running) {
    logger.warn("Previous run still in progress — skipping this tick.");
    return;
  }
  running = true;

  const summary = { found: 0, considered: 0, selected: 0, replied: 0, dryRun: 0, failed: 0 };

  try {
    logger.info(`=== Run started ===${config.dryRun ? " [DRY RUN — no likes/replies]" : ""}`);

    // 1. Search.
    const candidates = await searchTweets();
    summary.found = candidates.length;

    // 2. Dedup against Supabase.
    const fresh = [];
    for (const tweet of candidates) {
      if (await alreadyHandled(tweet.id)) {
        logger.info(`Skipping already-handled tweet ${tweet.id}.`);
      } else {
        fresh.push(tweet);
      }
    }
    summary.considered = fresh.length;

    if (fresh.length === 0) {
      logger.info("No fresh candidates to process.");
      await logEvent({ action: "run_summary", status: "success", payload: summary });
      logger.info("=== Run finished ===", summary);
      return;
    }

    // 3. Filter + generate replies in a single ChatGPT call.
    const picks = await selectAndGenerateReplies(fresh, config.repliesPerRun);
    const limited = picks.slice(0, config.repliesPerRun);
    summary.selected = limited.length;

    // 4. Like then reply to each pick.
    const byId = new Map(fresh.map((t) => [t.id, t]));
    const searchTerms = config.search.terms.join(", ");

    for (const pick of limited) {
      const tweet = byId.get(pick.tweet_id);

      // Full context attached to every log row so one record tells the story:
      // which tweet, what it said, why we chose it, which model decided.
      const context = {
        tweetId: pick.tweet_id,
        tweetText: tweet?.text ?? null,
        tweetUrl: tweet?.url ?? null,
        author: tweet?.authorUsername ?? null,
        reason: pick.reason,
        model: config.openai.model,
        searchTerms,
      };

      try {
        // Dry run: log what we WOULD post (with reasoning), but take no action.
        // Logged with status "dry_run" so it never counts toward dedup.
        if (config.dryRun) {
          logger.info(
            `[DRY RUN] Would like + reply to ${pick.tweet_id} (@${context.author}): ${pick.reply}`
          );
          await logEvent({ ...context, action: "reply", status: "dry_run", replyText: pick.reply });
          summary.dryRun += 1;
          continue;
        }

        // Re-check dedup right before acting (guards against races).
        if (await alreadyHandled(pick.tweet_id)) {
          logger.info(`Tweet ${pick.tweet_id} handled since selection — skipping.`);
          await logEvent({
            ...context,
            action: "skip",
            status: "success",
            reason: "already handled before action",
          });
          continue;
        }

        // Like first (per requirements), then reply.
        await likeTweet(pick.tweet_id);
        await logEvent({ ...context, action: "like", status: "success" });

        await replyToTweet(pick.tweet_id, pick.reply);
        await logEvent({
          ...context,
          action: "reply",
          status: "success",
          replyText: pick.reply,
        });

        summary.replied += 1;
        logger.info(`Replied to ${pick.tweet_id} (@${context.author}): ${pick.reply}`);
      } catch (err) {
        summary.failed += 1;
        logger.error(`Failed to act on tweet ${pick.tweet_id}: ${err.message}`);
        await logEvent({
          ...context,
          action: "error",
          status: "failed",
          replyText: pick.reply,
          error: err.message,
        });
      }
    }

    await logEvent({ action: "run_summary", status: "success", payload: summary });
    logger.info("=== Run finished ===", summary);
  } catch (err) {
    logger.error("Run failed:", err);
    await logEvent({ action: "run_summary", status: "failed", payload: summary, error: err.message });
  } finally {
    running = false;
  }
}

async function main() {
  const onceMode =
    process.argv.includes("--once") || process.env.RUN_ONCE === "true";

  if (onceMode) {
    logger.info("Running a single pass (--once).");
    await runOnce();
    process.exit(0);
  }

  if (!cron.validate(config.cron.schedule)) {
    throw new Error(`Invalid CRON_SCHEDULE: "${config.cron.schedule}"`);
  }

  logger.info(
    `Scheduler started. schedule="${config.cron.schedule}" tz=${config.cron.timezone}`
  );

  cron.schedule(config.cron.schedule, runOnce, { timezone: config.cron.timezone });

  if (config.cron.runOnStartup) {
    logger.info("RUN_ON_STARTUP enabled — running an initial pass now.");
    await runOnce();
  }
}

main().catch((err) => {
  logger.error("Fatal startup error:", err);
  process.exit(1);
});
