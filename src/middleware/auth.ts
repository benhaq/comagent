import { createMiddleware } from "hono/factory"
import { getCookie, setCookie } from "hono/cookie"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { crossmintAuth } from "../lib/crossmint.js"
import { db } from "../db/client.js"
import { users } from "../db/schema/users.js"
import { provisionWallet } from "../services/wallet-service.js"
import logger from "../lib/logger.js"

export type AuthVariables = {
  userId: string    // internal users.id UUID (for DB FK compat)
  userEmail: string
}

export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const jwt = getCookie(c, "crossmint-jwt")
    const refreshToken = getCookie(c, "crossmint-refresh-token")

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
      await next()
      return
    }

    // New user — fetch email
    let email: string
    try {
      const profile = await crossmintAuth.getUser(crossmintUserId)
      email = profile.email
    } catch (err) {
      logger.error({ err, crossmintUserId }, "Failed to fetch user profile")
      return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401)
    }

    // Insert pending user row (ON CONFLICT DO NOTHING handles concurrent requests)
    const inserted = await db
      .insert(users)
      .values({ crossmintUserId, email, walletStatus: "pending" })
      .onConflictDoNothing()
      .returning({ id: users.id })

    const internalUserId =
      inserted[0]?.id ??
      (
        await db.query.users?.findFirst({
          where: eq(users.crossmintUserId, crossmintUserId),
        })
      )?.id

    if (!internalUserId) {
      return c.json({ error: "Internal Server Error", code: "USER_CREATE_FAILED" }, 500)
    }

    // Provision wallet via Effect
    const walletResult = await Effect.runPromise(
      Effect.either(provisionWallet(email))
    )

    if (walletResult._tag === "Left") {
      const err = walletResult.left
      logger.error(
        { crossmintUserId, cause: err.cause instanceof Error ? err.cause.message : String(err.cause), event: "wallet_provision_failed" },
        "Wallet provisioning failed — rolling back user row"
      )
      await db.delete(users).where(eq(users.id, internalUserId))
      return c.json(
        { error: "Service Unavailable", code: "WALLET_PROVISION_FAILED" },
        503
      )
    }

    const { address, walletId } = walletResult.right

    await db
      .update(users)
      .set({
        walletAddress: address,
        crossmintWalletId: walletId,
        walletStatus: "active",
        updatedAt: new Date(),
      })
      .where(eq(users.id, internalUserId))

    c.set("userId", internalUserId)
    c.set("userEmail", email)
    await next()
  }
)
