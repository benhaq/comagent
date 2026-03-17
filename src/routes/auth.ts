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

const walletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable()

// ─── Set session (public — no auth middleware, sets cookie from provided JWT) ─
const setSessionRoute = createRoute({
  method: "post",
  path: "/session",
  tags: ["Auth"],
  summary: "Set session cookies from JWT (for cross-origin clients)",
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

// ─── Public auth routes (no auth middleware) ────────────────────────────────
export const publicAuthRoute = new OpenAPIHono({ defaultHook: validationHook })

publicAuthRoute.openapi(setSessionRoute, async (c) => {
  const { jwt, refreshToken } = c.req.valid("json")

  // Validate the JWT with Crossmint before setting cookies
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

// ─── Protected auth routes ──────────────────────────────────────────────────
export const authRoute = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook })

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

authRoute.openapi(logoutRoute, (c) => {
  deleteCookie(c, "crossmint-jwt", { path: "/", sameSite: "Lax" })
  deleteCookie(c, "crossmint-refresh-token", { path: "/", sameSite: "Lax" })
  return c.json({ success: true })
})
