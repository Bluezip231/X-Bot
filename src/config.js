// Loads, validates, and normalizes environment configuration.
// Fails fast with a clear message if any required variable is missing.

import dotenv from "dotenv";

dotenv.config();

function bool(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function int(value, fallback) {
  const n = parseInt(value, 10);
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
    `Missing required environment variables: ${missing.join(", ")}. ` +
      `Copy .env.example to .env (locally) or set Heroku config vars.`
  );
}

const searchTerms = (process.env.SEARCH_TERMS || "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

if (searchTerms.length === 0) {
  throw new Error("SEARCH_TERMS is empty — set at least one hashtag/keyword.");
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
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  search: {
    terms: searchTerms,
    maxCandidates: int(process.env.MAX_CANDIDATES, 20),
    lang: (process.env.SEARCH_LANG || "").trim(),
    excludeRetweets: bool(process.env.EXCLUDE_RETWEETS, true),
  },
  repliesPerRun: int(process.env.REPLIES_PER_RUN, 1),
  // When true, run the full pipeline (search + filter + log) but do NOT
  // like or reply. Useful for testing before going live.
  dryRun: bool(process.env.DRY_RUN, false),
  cron: {
    schedule: process.env.CRON_SCHEDULE || "0 * * * *",
    timezone: process.env.CRON_TIMEZONE || "UTC",
    runOnStartup: bool(process.env.RUN_ON_STARTUP, true),
  },
};
