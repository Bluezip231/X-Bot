import { runPrompt } from "../services/openai-client.js";
import { checkGuardrails } from "../utils/guardrails.js";
import { logger } from "../utils/logger.js";

/**
 * Step 6: Programmatic guardrails + ChatGPT accuracy/tone check.
 * Returns the post with passed_guardrails set, or null if it fails.
 */
export async function qualityCheck(post) {
  // Programmatic guardrails first (fast, deterministic).
  const guardrailResult = checkGuardrails(post);
  if (!guardrailResult.passed) {
    logger.warn({ violations: guardrailResult.violations }, "Quality check: programmatic guardrails failed");
    return {
      post: null,
      failure: {
        reason: "programmatic_guardrails_failed",
        details: { violations: guardrailResult.violations },
      },
    };
  }

  // ChatGPT accuracy/tone verification (fails open if the call errors).
  let qualityScores = null;
  try {
    // Low temperature: verification is a judgment task — consistency over flair.
    const result = await runPrompt(
      "quality-check.txt",
      JSON.stringify({
        full_text: post.full_text,
        source_title: post.source_title || null,
        kind: post.kind || "news",
      }),
      { temperature: 0.2 }
    );

    const quality = result.quality;
    if (quality && !quality.passes) {
      logger.warn({ issues: quality.issues, suggestion: quality.suggestion }, "Quality check: failed");
      return {
        post: null,
        failure: {
          reason: "quality_check_failed",
          details: { issues: quality.issues, suggestion: quality.suggestion, scores: quality.scores },
        },
      };
    }

    qualityScores = quality?.scores || null;
    logger.info({ scores: qualityScores }, "Quality check passed");
  } catch (err) {
    logger.warn({ error: err.message }, "Quality check: LLM check errored, proceeding on programmatic pass");
  }

  return {
    post: { ...post, passed_guardrails: true },
    failure: null,
    quality_scores: qualityScores,
  };
}
