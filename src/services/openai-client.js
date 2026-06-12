import OpenAI from "openai";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "prompts");

const openai = new OpenAI({ apiKey: config.openai.apiKey });

const promptCache = new Map();

/**
 * Load a prompt template from the prompts/ directory (cached).
 */
export function loadPrompt(name) {
  if (promptCache.has(name)) return promptCache.get(name);
  const filePath = join(PROMPTS_DIR, name);
  const content = readFileSync(filePath, "utf-8");
  promptCache.set(name, content);
  return content;
}

/**
 * Call ChatGPT with a system prompt and user message.
 * Returns the parsed JSON response (jsonMode) or raw text. Retries on failure.
 */
export async function chatCompletion({
  systemPrompt,
  userMessage,
  jsonMode = false,
  maxRetries = 2,
  temperature = 0.7,
}) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const params = {
        model: config.openai.model,
        messages,
        temperature,
        max_tokens: 4096,
      };

      if (jsonMode) {
        params.response_format = { type: "json_object" };
      }

      const response = await openai.chat.completions.create(params);
      const content = response.choices[0]?.message?.content || "";

      if (jsonMode) {
        return JSON.parse(content);
      }
      return content;
    } catch (err) {
      logger.warn(
        {
          attempt,
          error: err.message,
          status: err.status,
          error_body: err.error,
          code: err.code,
          type: err.type,
        },
        "OpenAI call failed"
      );
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/**
 * Convenience: load the persona system prompt + a task prompt, and call ChatGPT.
 */
export async function runPrompt(promptFile, userMessage, { jsonMode = true, temperature } = {}) {
  const systemPrompt = loadPrompt("system-persona.txt");
  const taskPrompt = loadPrompt(promptFile);
  return chatCompletion({
    systemPrompt: systemPrompt + "\n\n" + taskPrompt,
    userMessage,
    jsonMode,
    ...(temperature !== undefined ? { temperature } : {}),
  });
}
