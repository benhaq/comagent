import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { crossmintAuth } from "../lib/crossmint.js"
import { db } from "../db/client.js"
import { users } from "../db/schema/users.js"
import { provisionWallet } from "../services/wallet-service.js"
import logger from "../lib/logger.js"

type ProvisionResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; status: number; error: string; code: string }

/**
 * Provisions a new user: fetch Crossmint profile, insert DB row, provision wallet.
 * Returns `{ ok: true, userId, email }` on success or `{ ok: false, status, error, code }` on failure.
 */
export async function provisionNewUser(crossmintUserId: string): Promise<ProvisionResult> {
  // Fetch email from Crossmint
  let email: string
  try {
    const profile = await crossmintAuth.getUser(crossmintUserId)
    email = profile.email
  } catch (err) {
    logger.error({ err, crossmintUserId }, "Failed to fetch user profile")
    return { ok: false, status: 401, error: "Unauthorized", code: "UNAUTHORIZED" }
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
    return { ok: false, status: 500, error: "Internal Server Error", code: "USER_CREATE_FAILED" }
  }

  // Provision wallet via Effect
  const walletResult = await Effect.runPromise(Effect.either(provisionWallet(email)))

  if (walletResult._tag === "Left") {
    const err = walletResult.left
    logger.error(
      {
        crossmintUserId,
        cause: err.cause instanceof Error ? err.cause.message : String(err.cause),
        event: "wallet_provision_failed",
      },
      "Wallet provisioning failed — rolling back user row"
    )
    await db.delete(users).where(eq(users.id, internalUserId))
    return { ok: false, status: 503, error: "Service Unavailable", code: "WALLET_PROVISION_FAILED" }
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

  return { ok: true, userId: internalUserId, email }
}
