import { createOpenAI } from "@ai-sdk/openai"
import { env } from "./env.js"

/**
 * AI model instance via OpenRouter.
 * OpenRouter is OpenAI-compatible — we reuse @ai-sdk/openai with a custom baseURL.
 * Model is selected via LLM_MODEL env var (e.g. "openai/gpt-4o", "anthropic/claude-sonnet-4").
 */
const openrouter = createOpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  headers: {
    "HTTP-Referer": "https://github.com/comagent",
    "X-Title": "ComagentAI",
  },
})

export const model = openrouter(env.LLM_MODEL)
