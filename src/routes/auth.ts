import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { deleteCookie, setCookie } from "hono/cookie"
import { eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { users } from "../db/schema/users.js"
import type { AuthVariables } from "../middleware/auth.js"
import { crossmintAuth } from "../lib/crossmint.js"
import logger from "../lib/logger.js"
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

const setSessionRoute = createRoute({
  method: "post",
  path: "/session",
  tags: ["Auth"],
  summary: "Set session cookies from JWT (public — no auth required)",
  description: "Validates the provided JWT with Crossmint and sets httpOnly session cookies. Used by frontend clients after completing OTP login.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            jwt: z.string().min(1),
            refreshToken: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ success: z.boolean() }) } },
      description: "Cookies set successfully",
    },
    ...errorResponse(401, "Invalid JWT"),
  },
})

const walletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable()

export const authRoute = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook })

// Public — session setup (no auth middleware; exempted in index.ts)
authRoute.openapi(setSessionRoute, async (c) => {
  const { jwt, refreshToken } = c.req.valid("json")

  try {
    await crossmintAuth.getSession({ jwt, refreshToken: refreshToken ?? "" })
  } catch (err) {
    logger.warn({ err, event: "set_session_invalid_jwt" }, "Invalid JWT in set-session")
    return c.json({ error: "Invalid JWT", code: "UNAUTHORIZED" }, 401) as never
  }

  const cookieOpts = { httpOnly: true, path: "/", sameSite: "Lax" as const }
  setCookie(c, "crossmint-jwt", jwt, cookieOpts)
  if (refreshToken) {
    setCookie(c, "crossmint-refresh-token", refreshToken, cookieOpts)
  }

  return c.json({ success: true })
})

// Protected — profile
authRoute.openapi(profileRoute, async (c) => {
  const userId = c.get("userId")

  const user = await db.query.users?.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, email: true, walletAddress: true, walletStatus: true, onboardingStep: true },
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
    onboardingStep: user.onboardingStep,
  })
})

// Protected — logout
authRoute.openapi(logoutRoute, (c) => {
  deleteCookie(c, "crossmint-jwt", { path: "/", sameSite: "Lax" })
  deleteCookie(c, "crossmint-refresh-token", { path: "/", sameSite: "Lax" })
  return c.json({ success: true })
})
