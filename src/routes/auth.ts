import { Hono } from "hono"
import { deleteCookie } from "hono/cookie"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../db/client.js"
import { users } from "../db/schema/users.js"
import type { AuthVariables } from "../middleware/auth.js"

const walletAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .nullable()

export const authRoute = new Hono<{ Variables: AuthVariables }>()

authRoute.get("/profile", async (c) => {
  const userId = c.get("userId")

  const user = await db.query.users?.findFirst({
    where: eq(users.id, userId),
  })

  if (!user) {
    return c.json({ error: "User not found", code: "USER_NOT_FOUND" }, 404)
  }

  const walletAddress = walletAddressSchema.safeParse(user.walletAddress)

  return c.json({
    userId: user.id,
    email: user.email,
    walletAddress: walletAddress.success ? walletAddress.data : null,
    walletStatus: user.walletStatus,
  })
})

authRoute.post("/logout", (c) => {
  deleteCookie(c, "crossmint-jwt", { path: "/" })
  deleteCookie(c, "crossmint-refresh-token", { path: "/" })
  return c.json({ success: true })
})
