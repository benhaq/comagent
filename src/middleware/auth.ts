import { createMiddleware } from "hono/factory"
import { getCookie, setCookie } from "hono/cookie"
import { eq } from "drizzle-orm"
import { crossmintAuth } from "../lib/crossmint.js"
import { db } from "../db/client.js"
import { users } from "../db/schema/users.js"
import { provisionNewUser } from "./auth-provision.js"
import logger from "../lib/logger.js"

export type AuthVariables = {
  userId: string
  userEmail: string
  onboardingStep: number
}

export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    // Support both cookie and Authorization: Bearer header (for local test pages)
    const authHeader = c.req.header("Authorization")
    const jwt = (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null) ?? getCookie(c, "crossmint-jwt")
    const refreshToken = c.req.header("X-Refresh-Token") ?? getCookie(c, "crossmint-refresh-token") ?? ""

    if (!jwt) {
      return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401)
    }

    let crossmintUserId: string
    let newJwt: string | undefined
    let newRefreshToken: string | undefined

    try {
      const session = await crossmintAuth.getSession({
        jwt,
        refreshToken: refreshToken ?? "",
      })
      crossmintUserId = session.userId
      newJwt = String(session.jwt)
      newRefreshToken = String(session.refreshToken)
      logger.info({ crossmintUserId, event: "auth_success" }, "Session validated")
    } catch (err) {
      logger.warn({ err, event: "auth_failure" }, "Session validation failed")
      return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401)
    }

    // Set refreshed cookies if tokens changed
    if (newJwt && newJwt !== jwt) {
      setCookie(c, "crossmint-jwt", newJwt, { httpOnly: false, path: "/" })
      logger.info({ crossmintUserId, event: "auth_refresh" }, "JWT refreshed")
    }
    if (newRefreshToken && newRefreshToken !== refreshToken) {
      setCookie(c, "crossmint-refresh-token", newRefreshToken, {
        httpOnly: false,
        path: "/",
      })
    }

    // Look up existing user
    const existingUser = await db.query.users?.findFirst({
      where: eq(users.crossmintUserId, crossmintUserId),
    })

    if (existingUser) {
      c.set("userId", existingUser.id)
      c.set("userEmail", existingUser.email)
      c.set("onboardingStep", existingUser.onboardingStep)
      await next()
      return
    }

    // New user — provision
    const result = await provisionNewUser(crossmintUserId)

    if (!result.ok) {
      return c.json({ error: result.error, code: result.code }, result.status as 401 | 500 | 503)
    }

    c.set("userId", result.userId)
    c.set("userEmail", result.email)
    c.set("onboardingStep", 0)
    await next()
  }
)
