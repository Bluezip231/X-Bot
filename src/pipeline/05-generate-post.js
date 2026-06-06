import { runPrompt } from "../services/openai-client.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { truncateAtWord, stripAiTells } from "../utils/text.js";

const MAX_RETRIES = 2;
const TWEET_LIMIT = 280;
// A t.co link always counts as 23 chars; reserve 23 + 1 for the separator.
const LINK_RESERVE = 24;

/**
 * Shared retry loop. The model returns body text only; we validate length
 * against `limit` and retry with feedback. As a last resort we truncate rather
 * than drop the post. `buildPost(body, modelPost)` turns the accepted body into
 * the final post object.
 */
async function generate({ promptFile, baseInput, limit, buildPost, label }) {
  // Aim well under the hard cap — LLMs overshoot exact character counts, so give
  // a generous buffer (they tend to land ~30-50 chars over the stated target).
  const target = Math.max(80, limit - 50);
  const input = {
    ...baseInput,
    target_characters: target,
    max_characters: limit,
    allowed_styles: config.postStyles,
    call_to_actions: config.callToActions,
  };

  let lastBody = null;
  let lastModel = null;
  let attemptsUsed = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    attemptsUsed = attempt + 1;
    const userInput = { ...input };
    if (attempt > 0 && lastBody) {
      userInput.retry_feedback = `Your last attempt was ${lastBody.length} characters. Rewrite it to be at most ${target} characters while keeping the key point.`;
    }

    const result = await runPrompt(promptFile, JSON.stringify(userInput));
    const post = result.post;

    if (!post || typeof post.text !== "string" || post.text.trim().length === 0) {
      logger.error({ attempt, label }, "generate-post: no post text returned");
      continue;
    }

    // Deterministically scrub AI tells (em dashes, smart quotes) before we
    // measure length or accept the post — instructions alone aren't reliable.
    const body = stripAiTells(post.text.trim());
    lastBody = body;
    lastModel = post;

    if (body.length <= limit) {
      const out = buildPost(body, post);
      logger.info(
        { charCount: out.full_text.length, bodyCount: body.length, style: out.style, attempt, label },
        "generate-post: post generated"
      );
      return { post: out, failure: null };
    }

    logger.warn({ attempt, charCount: body.length, limit, label }, "generate-post: too long, retrying");
  }

  if (lastBody) {
    const truncated = truncateAtWord(lastBody, limit);
    const out = buildPost(truncated, lastModel);
    logger.warn(
      { fromChars: lastBody.length, toChars: truncated.length, limit, label },
      "generate-post: truncated to fit after retries"
    );
    return { post: out, failure: null };
  }

  logger.error({ label }, "generate-post: model returned no usable post");
  return {
    post: null,
    failure: { reason: "model_returned_no_post", details: { attempts: attemptsUsed } },
  };
}

/**
 * News post: written about a specific headline. Appends the source link when
 * configured (and budgets the body for it).
 */
export async function generatePost({ headline, topStyles = [] }) {
  // Only link out on a fraction of posts — a link card under every tweet is a
  // dead giveaway that an account is automated.
  const hasLink =
    config.includeSourceLink && !!headline.url && Math.random() < config.sourceLinkRatio;
  const limit = hasLink ? TWEET_LIMIT - LINK_RESERVE : TWEET_LIMIT;

  const buildPost = (body, model) => ({
    full_text: hasLink ? `${body}\n${headline.url}` : body,
    topic: model.topic || (headline.topic_buckets || [])[0] || null,
    style: model.style || null,
    kind: "news",
    source_title: headline.title,
    source_url: headline.url || null,
    passed_guardrails: false,
  });

  return generate({
    promptFile: "generate-post.txt",
    baseInput: {
      headline: headline.title,
      description: headline.description || "",
      topic_buckets: headline.topic_buckets || [],
      // Soft engagement signal: styles that have historically performed best.
      // Omitted entirely when there isn't enough data yet.
      ...(topStyles.length ? { top_performing_styles: topStyles } : {}),
    },
    limit,
    buildPost,
    label: "news",
  });
}

/**
 * Evergreen post: a standalone tip / warning / explainer / safety note on a
 * configured topic. No headline, no source link.
 */
export async function generateEvergreenPost({ topic }) {
  const limit = TWEET_LIMIT;

  const buildPost = (body, model) => ({
    full_text: body,
    topic: model.topic || topic,
    style: model.style || null,
    kind: "evergreen",
    source_title: null,
    source_url: null,
    passed_guardrails: false,
  });

  return generate({
    promptFile: "generate-evergreen.txt",
    baseInput: { topic, all_topics: config.topics },
    limit,
    buildPost,
    label: "evergreen",
  });
}
