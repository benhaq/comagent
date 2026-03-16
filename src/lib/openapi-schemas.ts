import { z } from "@hono/zod-openapi"

// ─── Reusable schemas ────────────────────────────────────────────────────────

export const ErrorSchema = z
  .object({
    error: z.string().openapi({ example: "Error message" }),
    code: z.string().openapi({ example: "ERROR_CODE" }),
  })
  .openapi("Error")

export const ChatSessionSchema = z
  .object({
    id: z.string().uuid().openapi({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }),
    userId: z.string().uuid().openapi({ example: "f0e1d2c3-b4a5-6789-0abc-def123456789" }),
    title: z.string().nullable().openapi({ example: "Shopping for sneakers" }),
    createdAt: z.string().openapi({ example: "2026-03-16T10:00:00.000Z" }),
    updatedAt: z.string().openapi({ example: "2026-03-16T10:05:00.000Z" }),
  })
  .openapi("ChatSession")

export const ChatMessageSchema = z
  .object({
    id: z.string().uuid().openapi({ example: "b2c3d4e5-f6a7-8901-bcde-f12345678901" }),
    sessionId: z.string().uuid().openapi({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }),
    role: z.string().openapi({ example: "user" }),
    content: z.unknown().openapi({ example: "What running shoes do you recommend?" }),
    createdAt: z.string().openapi({ example: "2026-03-16T10:01:00.000Z" }),
  })
  .openapi("ChatMessage")

export const SessionWithMessagesSchema = ChatSessionSchema.extend({
  messages: z.array(ChatMessageSchema),
}).openapi("SessionWithMessages")

export const SessionListSchema = z
  .object({
    sessions: z.array(ChatSessionSchema),
    total: z.number().int().openapi({ example: 5 }),
  })
  .openapi("SessionList")

export const UserProfileSchema = z
  .object({
    userId: z.string().uuid().openapi({ example: "f0e1d2c3-b4a5-6789-0abc-def123456789" }),
    email: z.string().email().openapi({ example: "user@example.com" }),
    walletAddress: z.string().nullable().openapi({ example: "0xDeAdBeEf00000000000000000000000000000001" }),
    walletStatus: z.string().openapi({ example: "active" }),
  })
  .openapi("UserProfile")

// ─── Param schemas ───────────────────────────────────────────────────────────

export const SessionIdParamSchema = z.object({
  id: z.string().uuid().openapi({
    param: { name: "id", in: "path" },
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  }),
})

// ─── Error responses (reusable) ──────────────────────────────────────────────

export const errorResponse = (status: number, description: string) => ({
  [status]: {
    content: { "application/json": { schema: ErrorSchema } },
    description,
  },
})

export const commonErrors = {
  ...errorResponse(401, "Unauthorized — missing or invalid JWT"),
  ...errorResponse(500, "Internal server error"),
}

// ─── Shared validation hook ──────────────────────────────────────────────────

/**
 * Default hook for OpenAPIHono — returns consistent `{ error, code }` on validation failure.
 * Pass as `defaultHook` to `new OpenAPIHono({ defaultHook: validationHook })`.
 */
export const validationHook = (result: { success: boolean; error?: unknown }, c: any) => {
  if (!result.success) {
    return c.json({ error: "Validation error", code: "VALIDATION_ERROR" }, 400)
  }
}
