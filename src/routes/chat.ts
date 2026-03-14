import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { streamText, convertToModelMessages, stepCountIs } from "ai"
import { openai } from "@ai-sdk/openai"
import { Layer } from "effect"
import { systemPrompt } from "../lib/chat-system-prompt.js"
import { makeProductTools } from "../services/product-tools.js"
import { ProductService } from "../services/product-service.js"

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const messageSchema = z
  .object({
    role: z.enum(["user", "assistant", "system", "data"]),
  })
  .passthrough()

const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1, "At least one message is required"),
  sessionId: z.string().uuid().optional(),
})

// ---------------------------------------------------------------------------
// Route factory — binds ProductService layer at startup
// ---------------------------------------------------------------------------

export function createChatRoute(productServiceLayer: Layer.Layer<ProductService>) {
  const tools = makeProductTools(productServiceLayer)
  const chat = new Hono()

  chat.post(
    "/",
    zValidator("json", chatRequestSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: "Invalid request body", code: "VALIDATION_ERROR" }, 400)
      }
    }),
    async (c) => {
      const { messages } = c.req.valid("json")

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modelMessages = await convertToModelMessages(messages as any)

      const result = streamText({
        model: openai("gpt-4o"),
        system: systemPrompt,
        messages: modelMessages,
        tools,
        stopWhen: stepCountIs(3),
      })

      return result.toUIMessageStreamResponse()
    }
  )

  return chat
}
