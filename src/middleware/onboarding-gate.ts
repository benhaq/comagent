import { createMiddleware } from "hono/factory"
import { eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { users } from "../db/schema/users.js"
import type { AuthVariables } from "./auth.js"

export const onboardingGate = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const userId = c.get("userId")

    const user = await db.query.users?.findFirst({
      where: eq(users.id, userId),
      columns: { onboardingStep: true },
    })

    if (!user || user.onboardingStep < 3) {
      return c.json(
        {
          error: "Onboarding incomplete",
          code: "ONBOARDING_INCOMPLETE",
          step: user?.onboardingStep ?? 0,
        },
        403
      )
    }

    await next()
  }
)
