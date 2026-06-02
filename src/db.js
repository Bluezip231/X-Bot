import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

let supabase;

export async function initDb() {
  supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  });
  logger.info("Supabase client initialized");
  return supabase;
}

export function getDb() {
  if (!supabase) throw new Error("Database not initialized. Call initDb() first.");
  return supabase;
}

// --- Headline helpers ---

export async function insertHeadline({ title, description, source, url, publishedAt }) {
  const { error } = await supabase.from("headlines").upsert(
    {
      title,
      description: description || "",
      source,
      url,
      published_at: publishedAt || null,
    },
    { onConflict: "url" }
  );
  if (error) logger.warn({ error: error.message }, "Insert headline failed");
}

export async function getRecentHeadlineUrls(hoursBack = 48) {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("headlines").select("url").gte("ingested_at", since);

  if (error) {
    logger.warn({ error: error.message }, "getRecentHeadlineUrls failed");
    return new Set();
  }
  return new Set(data.map((r) => r.url));
}

export async function getRecentHeadlineTitles(hoursBack = 48) {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("headlines").select("title").gte("ingested_at", since);

  if (error) {
    logger.warn({ error: error.message }, "getRecentHeadlineTitles failed");
    return [];
  }
  return data.map((r) => r.title);
}

// --- Post helpers ---

export async function insertPost(post) {
  const { data, error } = await supabase
    .from("posts")
    .insert({
      full_text: post.full_text,
      topic: post.topic || null,
      kind: post.kind || "news",
      style: post.style || null,
      source_title: post.source_title || null,
      source_url: post.source_url || null,
      passed_guardrails: post.passed_guardrails || false,
      dry_run: post.dry_run || false,
    })
    .select("id")
    .single();

  if (error) {
    logger.error({ error: error.message }, "Insert post failed");
    return { id: null };
  }
  return { id: data.id };
}

export async function markPostPublished(postId, tweetId) {
  const { error } = await supabase
    .from("posts")
    .update({ published: true, tweet_id: tweetId })
    .eq("id", postId);

  if (error) logger.warn({ error: error.message }, "markPostPublished failed");
}

/**
 * Count posts that count toward the daily limit: actually published, and not
 * dry-run rows. Uses UTC midnight as the day boundary.
 */
export async function getPostCountToday() {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("posts")
    .select("*", { count: "exact", head: true })
    .eq("published", true)
    .eq("dry_run", false)
    .gte("created_at", startOfDay.toISOString());

  if (error) {
    logger.warn({ error: error.message }, "getPostCountToday failed");
    return 0;
  }
  return count || 0;
}

/**
 * Fetch the last N published posts, newest first. Used by the dedup check to
 * compare a candidate headline against recent posts.
 */
export async function getLastPublishedPosts(limit = 5) {
  const { data, error } = await supabase
    .from("posts")
    .select("full_text, created_at")
    .eq("published", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.warn({ error: error.message }, "getLastPublishedPosts failed");
    return [];
  }
  return data || [];
}

// --- Engagement / dashboard helpers ---

/**
 * Published, real (non-dry-run) posts from the last `daysBack` days that have a
 * tweet_id — the set whose engagement we refresh from the X API.
 */
export async function getPostsForMetrics(daysBack = 14) {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("posts")
    .select("id, tweet_id")
    .eq("published", true)
    .eq("dry_run", false)
    .not("tweet_id", "is", null)
    .gte("created_at", since);

  if (error) {
    logger.warn({ error: error.message }, "getPostsForMetrics failed");
    return [];
  }
  return (data || []).filter((r) => r.tweet_id && r.tweet_id !== "dry-run");
}

export async function updatePostMetrics(id, { like_count, reply_count, retweet_count }) {
  const { error } = await supabase
    .from("posts")
    .update({
      like_count,
      reply_count,
      retweet_count,
      metrics_updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) logger.warn({ error: error.message, id }, "updatePostMetrics failed");
}

/**
 * Published, real posts in the dashboard window, with their stored engagement,
 * newest first. The dashboard aggregates these by week / topic / style.
 */
export async function getPostsForDashboard(daysBack = 56) {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("posts")
    .select(
      "created_at, topic, kind, style, like_count, reply_count, retweet_count, tweet_id, full_text, metrics_updated_at"
    )
    .eq("published", true)
    .eq("dry_run", false)
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) {
    logger.warn({ error: error.message }, "getPostsForDashboard failed");
    return [];
  }
  return data || [];
}

// --- Pipeline run helpers ---

export async function insertPipelineRun(runType) {
  const { data, error } = await supabase
    .from("pipeline_runs")
    .insert({ run_type: runType })
    .select("id")
    .single();

  if (error) {
    logger.error({ error: error.message }, "Insert pipeline run failed");
    return { id: null };
  }
  return { id: data.id };
}

export async function finishPipelineRun(id, stats) {
  if (!id) return;
  const { error } = await supabase
    .from("pipeline_runs")
    .update({
      headlines_ingested: stats.headlinesIngested || 0,
      headlines_filtered: stats.headlinesFiltered || 0,
      post_generated: stats.postGenerated || false,
      post_published: stats.postPublished || false,
      rejection_stage: stats.rejectionStage || null,
      rejection_reason: stats.rejectionReason || null,
      details: stats.details && Object.keys(stats.details).length > 0 ? stats.details : null,
      post_id: stats.postId || null,
      top_headline_title: stats.topHeadlineTitle || null,
      top_headline_url: stats.topHeadlineUrl || null,
      top_headline_relevance: stats.topHeadlineRelevance ?? null,
      error: stats.error || null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) logger.warn({ error: error.message }, "finishPipelineRun failed");
}

/**
 * Prune old headlines and pipeline runs. Also removes never-finished runs by
 * started_at so crashed runs don't accumulate.
 */
export async function cleanupOldData(daysToKeep = 7) {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();

  const { count: headlinesDeleted, error: hErr } = await supabase
    .from("headlines")
    .delete({ count: "exact" })
    .lt("ingested_at", cutoff);

  if (hErr) logger.warn({ error: hErr.message }, "Cleanup headlines failed");

  const { count: runsDeleted, error: rErr } = await supabase
    .from("pipeline_runs")
    .delete({ count: "exact" })
    .lt("started_at", cutoff);

  if (rErr) logger.warn({ error: rErr.message }, "Cleanup pipeline_runs failed");

  return { headlinesDeleted: headlinesDeleted || 0, runsDeleted: runsDeleted || 0 };
}
