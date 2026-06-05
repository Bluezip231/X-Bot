// Entrypoint. Supports two ways to run:
//   - Always-on worker (default): serves the dashboard and runs an internal cron.
//   - One-shot CLI modes for periodic schedulers (e.g. GitHub Actions), each of
//     which does a single task and exits:
//       --post     a single SCHEDULED posting pass (honors min-spacing)
//       --refresh  refresh stored engagement metrics
//       --cleanup  prune old headlines / pipeline runs
//       --once     a single MANUAL posting pass (bypasses spacing; for testing)

import cron from "node-cron";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { initDb, cleanupOldData } from "./db.js";
import { runPipeline } from "./pipeline/index.js";
import { refreshEngagement } from "./engagement.js";
import { startScheduler, stopScheduler, runPostingJob } from "./scheduler.js";
import { startServer } from "./server.js";

async function main() {
  // Must run before any pipeline/db call — dedup.js lazily uses the
  // module-scoped Supabase client created here.
  await initDb();

  const argv = process.argv.slice(2);

  // One-shot CLI modes (used by GitHub Actions / cron). Each runs a single task
  // and exits, so the bot works as a periodic invocation, not a live process.
  if (argv.includes("--cleanup")) {
    logger.info("Running cleanup (--cleanup).");
    const r = await cleanupOldData(config.cleanupDays);
    logger.info(
      { headlinesDeleted: r.headlinesDeleted, runsDeleted: r.runsDeleted },
      "Cleanup complete"
    );
    process.exit(0);
  }

  if (argv.includes("--refresh")) {
    logger.info("Running engagement refresh (--refresh).");
    await refreshEngagement();
    process.exit(0);
  }

  // --post is a real scheduled pass (min-spacing applies); --once is a manual
  // pass (spacing bypassed) for ad-hoc local testing.
  const postMode = argv.includes("--post");
  const onceMode = argv.includes("--once") || process.env.RUN_ONCE === "true";
  if (postMode || onceMode) {
    const runType = postMode ? "scheduled" : "manual";
    logger.info({ runType }, `Running a single pipeline pass (${postMode ? "--post" : "--once"}).`);
    await runPipeline(runType);
    process.exit(0);
  }

  if (!cron.validate(config.cron.schedule)) {
    throw new Error(`Invalid CRON_SCHEDULE: "${config.cron.schedule}"`);
  }

  // Web dyno: bind $PORT promptly (serves the engagement dashboard), then start
  // the posting + refresh scheduler in the same process.
  startServer();
  startScheduler();

  if (config.cron.runOnStartup) {
    logger.info("RUN_ON_STARTUP enabled — running an initial pass now.");
    await runPostingJob();
  }

  const shutdown = (signal) => {
    logger.info({ signal }, "Shutdown signal received");
    stopScheduler();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("News bot is running. Waiting for scheduled jobs...");
}

main().catch((err) => {
  logger.error("Fatal startup error:", err);
  process.exit(1);
});
