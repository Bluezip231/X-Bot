import cron from "node-cron";
import { runPipeline } from "./pipeline/index.js";
import { cleanupOldData } from "./db.js";
import { refreshEngagement } from "./engagement.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

let jobs = [];
let running = false;

/**
 * Run one posting pass, guarding against overlap if a pass runs longer than
 * the cron interval. Exported so index.js can fire it on startup.
 */
export async function runPostingJob() {
  if (running) {
    logger.warn("Previous pipeline run still in progress — skipping this tick.");
    return;
  }
  running = true;
  try {
    await runPipeline("scheduled");
  } catch (err) {
    logger.error({ error: err.message, stack: err.stack }, "Posting job failed");
  } finally {
    running = false;
  }
}

export function startScheduler() {
  // Main posting job on the configured schedule.
  jobs.push(cron.schedule(config.cron.schedule, runPostingJob, { timezone: config.cron.timezone }));

  // Daily engagement refresh at 02:00 — updates likes/replies/retweets for the
  // dashboard.
  jobs.push(
    cron.schedule(
      "0 2 * * *",
      async () => {
        try {
          await refreshEngagement();
        } catch (err) {
          logger.error({ error: err.message, stack: err.stack }, "Engagement refresh job failed");
        }
      },
      { timezone: config.cron.timezone }
    )
  );

  // Daily cleanup at 03:00 in the configured timezone.
  jobs.push(
    cron.schedule(
      "0 3 * * *",
      async () => {
        try {
          const r = await cleanupOldData(config.cleanupDays);
          logger.info(
            { headlinesDeleted: r.headlinesDeleted, runsDeleted: r.runsDeleted },
            "Daily cleanup completed"
          );
        } catch (err) {
          logger.error({ error: err.message, stack: err.stack }, "Cleanup job failed");
        }
      },
      { timezone: config.cron.timezone }
    )
  );

  logger.info(
    { schedule: config.cron.schedule, tz: config.cron.timezone },
    "Scheduler started (posting + daily engagement refresh + cleanup)"
  );
}

export function stopScheduler() {
  for (const job of jobs) {
    job.stop();
  }
  jobs = [];
  logger.info("Scheduler stopped");
}
