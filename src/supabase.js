// Supabase logging + dedup helpers.

import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  { auth: { persistSession: false } }
);

const TABLE = "bot_logs";

// True if we've already successfully replied to this tweet in a previous run.
export async function alreadyHandled(tweetId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("id")
    .eq("tweet_id", tweetId)
    .eq("action", "reply")
    .eq("status", "success")
    .limit(1);

  if (error) {
    // Don't let a dedup-read failure block the run; log and treat as not handled.
    logger.warn(`Dedup lookup failed for ${tweetId}: ${error.message}`);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

// Insert one log row. Never throws — logging must not crash the bot.
export async function logEvent(event) {
  const row = {
    action: event.action ?? null,
    status: event.status ?? null,
    tweet_id: event.tweetId ?? null,
    tweet_text: event.tweetText ?? null,
    tweet_url: event.tweetUrl ?? null,
    author: event.author ?? null,
    reply_text: event.replyText ?? null,
    reason: event.reason ?? null,
    model: event.model ?? null,
    search_terms: event.searchTerms ?? null,
    payload: event.payload ?? null,
    error: event.error ?? null,
  };

  const { error } = await supabase.from(TABLE).insert(row);
  if (error) {
    logger.warn(`Failed to write log to Supabase: ${error.message}`);
  }
}
