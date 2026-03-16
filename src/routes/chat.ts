import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { model } from "../lib/model.js";
import { Effect, Layer } from "effect";
import { systemPrompt } from "../lib/chat-system-prompt.js";
import { makeProductTools } from "../services/product-tools.js";
import { ProductService } from "../services/product-service.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import type { AuthVariables } from "../middleware/auth.js";
import logger from "../lib/logger.js";
import {
  ErrorSchema,
  errorResponse,
  commonErrors,
  validationHook,
} from "../lib/openapi-schemas.js";

// ---------------------------------------------------------------------------
// Helper: convert plain {role, content} to UIMessage parts format for AI SDK v6
// ---------------------------------------------------------------------------

let msgCounter = 0
function toUIMessage(role: string, content: unknown): UIMessage {
  return {
    id: `msg-${++msgCounter}`,
    role: role as UIMessage["role"],
    parts: [{ type: "text", text: typeof content === "string" ? content : JSON.stringify(content) }],
  }
}

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const messageSchema = z
  .object({
    role: z.enum(["user", "assistant", "system", "data"]),
  })
  .passthrough();

const chatRequestSchema = z.object({
  messages: z
    .array(messageSchema)
    .min(1)
    .openapi({ description: "At least one message is required" }),
  sessionId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Route definition
// ---------------------------------------------------------------------------

const postChatRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Chat"],
  security: [{ CookieAuth: [] }],
  summary: "Send a chat message and stream LLM response",
  request: {
    body: {
      content: { "application/json": { schema: chatRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "text/event-stream": { schema: z.string() } },
      description: "Streamed LLM response with X-Session-Id header",
    },
    ...errorResponse(400, "Bad request — validation error"),
    ...errorResponse(403, "Forbidden — session owned by another user"),
    ...errorResponse(404, "Session not found"),
    ...commonErrors,
  },
});

// ---------------------------------------------------------------------------
// Route factory — binds ProductService and ChatSessionService layers at startup
// ---------------------------------------------------------------------------

export function createChatRoute(
  productServiceLayer: Layer.Layer<ProductService>,
  sessionServiceLayer: Layer.Layer<ChatSessionService>,
) {
  const tools = makeProductTools(productServiceLayer);
  const chat = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: validationHook,
  });

  // Helper: run a ChatSessionService effect, returning Either
  const runSession = <A, E>(effect: Effect.Effect<A, E, ChatSessionService>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(sessionServiceLayer), Effect.either),
    );

  chat.openapi(postChatRoute, async (c) => {
    const userId = c.get("userId");
    const { messages, sessionId: reqSessionId } = c.req.valid("json");

    // ------------------------------------------------------------------
    // Session resolution
    // ------------------------------------------------------------------
    let sessionId: string;
    let existingMessages: Array<{ role: string; content: unknown }> = [];

    if (!reqSessionId) {
      // Auto-create a new session
      const createResult = await runSession(
        ChatSessionService.pipe(Effect.flatMap((s) => s.create(userId))),
      );
      if (createResult._tag === "Left") {
        const err = createResult.left as { _tag: string; message?: string };
        logger.error({ err, userId }, "Failed to create chat session");
        return c.json(
          { error: "Failed to create session", code: err._tag },
          500,
        );
      }
      sessionId = createResult.right.id;
    } else {
      // Validate ownership and load existing messages
      const getResult = await runSession(
        ChatSessionService.pipe(
          Effect.flatMap((s) => s.getWithMessages(reqSessionId, userId)),
        ),
      );
      if (getResult._tag === "Left") {
        const err = getResult.left as { _tag: string; message?: string };
        if (err._tag === "SessionNotFound") {
          return c.json({ error: "Session not found", code: err._tag }, 404);
        }
        if (err._tag === "SessionOwnershipError") {
          return c.json({ error: "Forbidden", code: err._tag }, 403);
        }
        return c.json({ error: "Session error", code: err._tag }, 500);
      }
      sessionId = reqSessionId;
      existingMessages = getResult.right.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
    }

    // ------------------------------------------------------------------
    // Persist the latest user message
    // ------------------------------------------------------------------
    const lastMsg = messages[messages.length - 1];
    const persistUserResult = await runSession(
      ChatSessionService.pipe(
        Effect.flatMap((s) =>
          s.addMessage(sessionId, lastMsg.role as string, lastMsg.content),
        ),
      ),
    );
    if (persistUserResult._tag === "Left") {
      logger.warn(
        { err: persistUserResult.left, sessionId },
        "Failed to persist user message",
      );
    }

    // ------------------------------------------------------------------
    // Build model message history: DB history + latest user message
    // AI SDK v6 convertToModelMessages expects UIMessage[] with parts array
    // ------------------------------------------------------------------
    const uiMessages: UIMessage[] =
      existingMessages.length > 0
        ? [
            ...existingMessages.map((m) => toUIMessage(m.role, m.content)),
            toUIMessage(lastMsg.role as string, lastMsg.content),
          ]
        : messages.map((m) => toUIMessage(m.role as string, m.content));
    const modelMessages = await convertToModelMessages(uiMessages);

    // ------------------------------------------------------------------
    // Stream LLM response
    // ------------------------------------------------------------------
    const result = streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(3),
      onStepFinish: ({ toolCalls, toolResults }) => {
        if (toolCalls.length > 0) {
          logger.info(
            { toolCalls: toolCalls.map((tc: any) => ({ name: tc.toolName, args: tc.args })) },
            "Tool calls executed"
          )
        }
        if (toolResults.length > 0) {
          logger.info(
            { toolResults: toolResults.map((tr: any) => ({ name: tr.toolName, resultPreview: JSON.stringify(tr.result).slice(0, 200) })) },
            "Tool results received"
          )
        }
      },
      onFinish: async ({ text }) => {
        try {
          await Effect.runPromise(
            ChatSessionService.pipe(
              Effect.flatMap((s) => s.addMessage(sessionId, "assistant", text)),
              Effect.provide(sessionServiceLayer),
            ),
          );

          // Auto-title on first exchange (user + assistant = 2 messages persisted)
          const totalMessages = existingMessages.length + 2;
          if (totalMessages <= 2) {
            await Effect.runPromise(
              ChatSessionService.pipe(
                Effect.flatMap((s) => s.autoTitle(sessionId)),
                Effect.provide(sessionServiceLayer),
                Effect.either,
              ),
            );
          }
        } catch (err) {
          logger.error(
            { err, sessionId },
            "Failed to persist assistant message",
          );
        }
      },
    });

    // Set session ID header so client can track it
    const response = result.toUIMessageStreamResponse();
    response.headers.set("X-Session-Id", sessionId);
    return response;
  });

  return chat;
}
