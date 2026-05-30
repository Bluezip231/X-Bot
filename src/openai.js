// Single combined ChatGPT call: filters candidate tweets for safety/interest
// AND generates a reply for each selected tweet. Returns the selections.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { config } from "./config.js";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSONALITY_PATH = path.join(__dirname, "..", "prompts", "personality.md");

const client = new OpenAI({ apiKey: config.openai.apiKey });

// Appended to the personality file so the model always returns parseable JSON.
function outputContract(maxReplies) {
  return `
## OUTPUT CONTRACT (do not deviate)

You will receive a JSON array of candidate tweets, each with "tweet_id",
"text", and "author".

Choose the BEST tweets that are safe, interesting, non-harmful, and non-NSFW,
following all rules above. Select AT MOST ${maxReplies}. It is fine to select
fewer, or none, if nothing is suitable.

For each selected tweet, write a reply that obeys the voice/tone rules and is
under 280 characters.

Respond with ONLY a JSON object of this exact shape (no markdown, no prose):

{
  "selected": [
    { "tweet_id": "<id>", "reply": "<reply text>", "reason": "<short why>" }
  ]
}

Order "selected" best-first. Never include a tweet_id that was not in the input.
`;
}

function loadPersonality() {
  return fs.readFileSync(PERSONALITY_PATH, "utf8");
}

// candidates: [{ id, text, authorUsername }]
// Returns: [{ tweet_id, reply, reason }]
export async function selectAndGenerateReplies(candidates, maxReplies) {
  const personality = loadPersonality();
  const systemPrompt = `${personality}\n${outputContract(maxReplies)}`;

  const userPayload = candidates.map((c) => ({
    tweet_id: c.id,
    text: c.text,
    author: c.authorUsername || "unknown",
  }));

  logger.info(
    `Asking ${config.openai.model} to pick up to ${maxReplies} from ${candidates.length} tweet(s).`
  );

  const completion = await client.chat.completions.create({
    model: config.openai.model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
  });

  const raw = completion.choices[0]?.message?.content || "{}";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.error("Failed to parse OpenAI JSON response:", raw);
    throw new Error(`OpenAI returned invalid JSON: ${err.message}`);
  }

  const selected = Array.isArray(parsed.selected) ? parsed.selected : [];

  // Validate shape and that ids are real candidates; trim replies to be safe.
  const validIds = new Set(candidates.map((c) => c.id));
  const clean = selected
    .filter(
      (s) =>
        s &&
        typeof s.tweet_id === "string" &&
        typeof s.reply === "string" &&
        s.reply.trim().length > 0 &&
        validIds.has(s.tweet_id)
    )
    .map((s) => ({
      tweet_id: s.tweet_id,
      reply: s.reply.trim().slice(0, 280),
      reason: typeof s.reason === "string" ? s.reason : "",
    }));

  logger.info(`Model selected ${clean.length} tweet(s) to reply to.`);
  return clean;
}
