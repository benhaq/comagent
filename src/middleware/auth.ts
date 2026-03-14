import { createMiddleware } from "hono/factory"
import { env } from "../lib/env.js"

export type AuthVariables = { userId: string }

export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const authorization = c.req.header("Authorization")
    const token = authorization?.replace("Bearer ", "")

    if (!token || token !== env.AUTH_TOKEN) {
      return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401)
    }

    // Stub: hardcoded userId for development
    c.set("userId", "00000000-0000-0000-0000-000000000001")
    await next()
  }
)
