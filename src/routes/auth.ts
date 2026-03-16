import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { deleteCookie } from "hono/cookie"
import { eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { users } from "../db/schema/users.js"
import type { AuthVariables } from "../middleware/auth.js"
import { UserProfileSchema, ErrorSchema, errorResponse, commonErrors, validationHook } from "../lib/openapi-schemas.js"

const security = [{ CookieAuth: [] }]

const profileRoute = createRoute({
  method: "get",
  path: "/profile",
  tags: ["Auth"],
  security,
  summary: "Get authenticated user profile",
  responses: {
    200: {
      content: { "application/json": { schema: UserProfileSchema } },
      description: "Authenticated user profile",
    },
    ...errorResponse(404, "User not found"),
    ...commonErrors,
  },
})

const logoutRoute = createRoute({
  method: "post",
  path: "/logout",
  tags: ["Auth"],
  security,
  summary: "Logout and clear session cookies",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ success: z.boolean() }) } },
      description: "Successfully logged out",
    },
    ...errorResponse(401, "Unauthorized — missing or invalid JWT"),
  },
})

const walletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable()

export const authRoute = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook })

authRoute.openapi(profileRoute, async (c) => {
  const userId = c.get("userId")

  const user = await db.query.users?.findFirst({
    where: eq(users.id, userId),
  })

  if (!user) {
    return c.json({ error: "User not found", code: "USER_NOT_FOUND" }, 404) as never
  }

  const walletAddress = walletAddressSchema.safeParse(user.walletAddress)

  return c.json({
    userId: user.id,
    email: user.email,
    walletAddress: walletAddress.success ? walletAddress.data : null,
    walletStatus: user.walletStatus,
  })
})

authRoute.openapi(logoutRoute, (c) => {
  deleteCookie(c, "crossmint-jwt", { path: "/" })
  deleteCookie(c, "crossmint-refresh-token", { path: "/" })
  return c.json({ success: true })
})
