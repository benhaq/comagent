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

// ─── Onboarding schemas ─────────────────────────────────────────────────────

export const ALLOWED_COUNTRIES = ["US", "GB", "AU", "CA", "DE", "FR", "JP", "SG"] as const

export const TOPS_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL"] as const

export const OnboardingStep1Schema = z
  .object({
    displayName: z.string().min(1).max(100).openapi({ example: "Ben" }),
  })
  .openapi("OnboardingStep1")

export const OnboardingStep2Schema = z
  .object({
    firstName: z.string().min(1).max(50).openapi({ example: "Ben" }),
    lastName: z.string().min(1).max(50).openapi({ example: "Smith" }),
    street: z.string().min(5).max(200).openapi({ example: "123 Main St" }),
    apt: z.string().max(50).optional().openapi({ example: "Apt 5B" }),
    country: z.enum(ALLOWED_COUNTRIES).openapi({ example: "US" }),
    city: z.string().min(2).max(100).openapi({ example: "New York" }),
    state: z.string().max(100).optional().openapi({ example: "NY" }),
    zip: z.string().min(3).max(20).openapi({ example: "10001" }),
  })
  .openapi("OnboardingStep2")

export const OnboardingStep3Schema = z
  .object({
    topsSize: z.enum(TOPS_SIZES).openapi({ example: "M" }),
    bottomsSize: z.string().min(1).max(10).openapi({ example: "32" }),
    footwearSize: z.string().min(1).max(10).openapi({ example: "10" }),
  })
  .openapi("OnboardingStep3")

export const OnboardingStepResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    step: z.number().int().openapi({ example: 1 }),
  })
  .openapi("OnboardingStepResponse")

export const OnboardingStatusSchema = z
  .object({
    step: z.number().int().openapi({ example: 0 }),
    completed: z.boolean().openapi({ example: false }),
  })
  .openapi("OnboardingStatus")

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
