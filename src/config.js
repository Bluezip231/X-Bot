// Loads, validates, and normalizes configuration.
//
// Two sources, by design:
//   1. SECRETS  — read only from the environment (local .env, or Heroku config
//      vars). Never committed. Listed in REQUIRED below.
//   2. RUNTIME  — non-secret behavior, defined in ../runtime.config.js, which
//      IS committed and deploys with the code. An env var of the same name
//      overrides its value, so Heroku config vars / local .env still win.
//
// Fails fast with a clear message if any required secret is missing.

import dotenv from "dotenv";
import { runtime } from "../runtime.config.js";

dotenv.config();

// --- env readers: return the env value when set & non-empty, else fallback ---
function envStr(key, fallback) {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

function envBool(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return String(v).trim().toLowerCase() === "true";
}

function envInt(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envList(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return v
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function envFloat(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

const REQUIRED = [
  "TWITTER_APP_KEY",
  "TWITTER_APP_SECRET",
  "TWITTER_ACCESS_TOKEN",
  "TWITTER_ACCESS_SECRET",
  "OPENAI_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(
    `Missing required secret environment variables: ${missing.join(", ")}. ` +
      `Set them in .env (locally) or as Heroku config vars.`
  );
}

const topics = envList("TOPICS", runtime.topics);
if (topics.length === 0) {
  throw new Error(
    "No topics configured — set at least one in runtime.config.js (topics) or the TOPICS env var."
  );
}

export const config = {
  twitter: {
    appKey: process.env.TWITTER_APP_KEY,
    appSecret: process.env.TWITTER_APP_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: envStr("OPENAI_MODEL", runtime.openaiModel),
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  news: {
    feeds: runtime.newsFeeds,
    perFeedLimit: envInt("PER_FEED_LIMIT", runtime.perFeedLimit),
    // Skip headlines older than this many hours at ingest (0 disables).
    maxHeadlineAgeHours: Math.max(0, envInt("MAX_HEADLINE_AGE_HOURS", runtime.maxHeadlineAgeHours)),
    // Optional extra source. Secret (env-only); empty disables it.
    theNewsApiKey: envStr("THENEWSAPI_KEY", ""),
  },
  // Topics the bot targets (injected into the classify/filter prompts).
  topics,
  maxTweetsPerDay: envInt("MAX_TWEETS_PER_DAY", runtime.maxTweetsPerDay),
  // How many tweets to post per scan (bounded by maxTweetsPerDay).
  tweetsPerRun: Math.max(1, envInt("TWEETS_PER_RUN", runtime.tweetsPerRun)),
  // Minimum minutes between published posts (0 disables). Spreads posts out.
  minPostSpacingMinutes: Math.max(0, envInt("MIN_POST_SPACING_MINUTES", runtime.minPostSpacingMinutes)),
  editorialThreshold: envInt("EDITORIAL_THRESHOLD", runtime.editorialThreshold),
  postDedupLookbackCount: envInt("POST_DEDUP_LOOKBACK_COUNT", runtime.postDedupLookbackCount),
  includeSourceLink: envBool("INCLUDE_SOURCE_LINK", runtime.includeSourceLink),
  // Fraction of news posts (0-1) that get the source link appended.
  sourceLinkRatio: Math.min(1, Math.max(0, envFloat("SOURCE_LINK_RATIO", runtime.sourceLinkRatio))),
  cleanupDays: envInt("CLEANUP_DAYS", runtime.cleanupDays),
  // Post styles the model may write in, and CTAs it may weave in.
  postStyles: envList("POST_STYLES", runtime.postStyles),
  callToActions: envList("CALL_TO_ACTIONS", runtime.callToActions),
  // Share of runs (0-1) that post evergreen content instead of news.
  evergreenRatio: Math.min(1, Math.max(0, envFloat("EVERGREEN_RATIO", runtime.evergreenRatio))),
  // Max evergreen FALLBACK posts per day (caps generic tips on slow news days).
  maxEvergreenPerDay: Math.max(0, envInt("MAX_EVERGREEN_PER_DAY", runtime.maxEvergreenPerDay)),
  // How far back the daily engagement refresh updates metrics.
  metricsLookbackDays: envInt("METRICS_LOOKBACK_DAYS", runtime.metricsLookbackDays),
  // Product promo posts (kind: "promo") — occasional posts about the owner's
  // own product, linking to it. Disabled when the URL is empty or maxPerWeek=0.
  promo: {
    enabled: envBool("PROMO_ENABLED", runtime.promoEnabled),
    name: envStr("PROMO_NAME", runtime.promoName),
    url: envStr("PROMO_URL", runtime.promoUrl),
    description: envStr("PROMO_DESCRIPTION", runtime.promoDescription),
    maxPerWeek: Math.max(0, envInt("PROMO_MAX_PER_WEEK", runtime.promoMaxPerWeek)),
  },
  // Engagement feedback: bias new posts toward historically best-performing
  // styles (soft signal; no effect until posts have accumulated metrics).
  styleFeedback: {
    enabled: envBool("STYLE_FEEDBACK_ENABLED", runtime.styleFeedbackEnabled),
    lookbackDays: envInt("STYLE_FEEDBACK_DAYS", runtime.styleFeedbackDays),
    minPosts: Math.max(1, envInt("STYLE_FEEDBACK_MIN_POSTS", runtime.styleFeedbackMinPosts)),
  },
  // Engagement dashboard (served on the public Heroku URL).
  dashboard: {
    // HTTP basic-auth credentials (secrets, env-only). If unset, the dashboard
    // route returns 503 so analytics are never accidentally public.
    user: envStr("DASHBOARD_USER", ""),
    pass: envStr("DASHBOARD_PASS", ""),
    // Heroku provides PORT; default for local runs.
    port: envInt("PORT", 3000),
    weeks: envInt("DASHBOARD_WEEKS", runtime.dashboardWeeks),
  },
  // When true, run the full pipeline but do NOT post to X (logs the would-be post).
  dryRun: envBool("DRY_RUN", runtime.dryRun),
  debug: envBool("DEBUG", false),
  cron: {
    schedule: envStr("CRON_SCHEDULE", runtime.cronSchedule),
    timezone: envStr("CRON_TIMEZONE", runtime.cronTimezone),
    runOnStartup: envBool("RUN_ON_STARTUP", runtime.runOnStartup),
  },
};
