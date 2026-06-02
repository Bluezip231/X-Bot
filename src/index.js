// Entrypoint. Always-on worker that posts news on an internal cron schedule.
// Pass --once (or set RUN_ONCE=true) to run a single pipeline pass and exit.

import cron from "node-cron";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { initDb } from "./db.js";
import { runPipeline } from "./pipeline/index.js";
import { startScheduler, stopScheduler, runPostingJob } from "./scheduler.js";
import { startServer } from "./server.js";

async function main() {
  // Must run before any pipeline call — dedup.js lazily uses the module-scoped
  // Supabase client created here.
  await initDb();

  const onceMode = process.argv.includes("--once") || process.env.RUN_ONCE === "true";
  if (onceMode) {
    logger.info("Running a single pipeline pass (--once).");
    await runPipeline("manual");
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
