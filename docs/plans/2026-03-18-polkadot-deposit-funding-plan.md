# Polkadot Deposit → Base USDC Funding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a webhook endpoint that receives verified PAS deposit notifications from an external Polkadot payment service, funds the user's Crossmint wallet with USDC (staging faucet), and records the deposit as an order.

**Architecture:** External service verifies PAS settlement on Paseo testnet, then calls comagent webhook. Comagent validates the request (webhook secret), looks up the user, converts PAS→USDC at a fixed rate, calls Crossmint Fund Wallet API (staging-only faucet), and inserts a deposit-type order record. Existing `orders` table is extended with `type`, `amountPas`, `amountUsdc`, `polkadotTxHash` columns. The `crossmintOrderId` column becomes nullable to support deposit orders (which have no Crossmint order). OrderServiceLive is updated to handle both order types.

**Tech Stack:** Drizzle ORM, Effect, Hono + @hono/zod-openapi, Zod, PostgreSQL, Crossmint Fund Wallet API

---

### Task 1: Add deposit error types

**Files:**
- Modify: `src/lib/errors.ts`

**Step 1: Append two new error classes after `OrderNotFoundError`**

```typescript
/**
 * Raised when a deposit with the same Polkadot tx hash already exists.
 */
export class DepositDuplicateError extends Data.TaggedError("DepositDuplicateError")<{
  transactionHash: string
}> {
  get message() {
    return `Deposit already processed for tx ${this.transactionHash}`
  }
}

/**
 * Raised when Crossmint wallet funding fails.
 */
export class DepositFundingError extends Data.TaggedError("DepositFundingError")<{
  cause?: unknown
}> {
  get message() {
    return "Failed to fund wallet"
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/errors.ts
git commit -m "feat(deposit): add DepositDuplicateError and DepositFundingError"
```

---

### Task 2: Add env vars for deposit config

**Files:**
- Modify: `src/lib/env.ts`

**Step 1: Add two new env vars to the `envSchema` object, after `SCRAPING_SERVICE_API_KEY`**

```typescript
  // Deposit — Polkadot PAS → Base USDC conversion
  PAS_TO_USDC_RATE: z.coerce.number().positive().default(0.1),
  DEPOSIT_WEBHOOK_SECRET: z.string().default(""),
```

**Step 2: Commit**

```bash
git add src/lib/env.ts
git commit -m "feat(deposit): add PAS_TO_USDC_RATE and DEPOSIT_WEBHOOK_SECRET env vars"
```

---

### Task 3: Extend orders schema with deposit columns

**Files:**
- Modify: `src/db/schema/orders.ts`

**Step 1: Replace the entire file with the updated schema**

The key changes:
- `crossmintOrderId` becomes nullable (deposits have no Crossmint order)
- Remove the unique index on `crossmintOrderId` and replace with a partial unique index
- Add `type` column (default `"checkout"` for backward compat)
- Add `amountPas`, `amountUsdc` as varchar (store as string to avoid float issues)
- Add `polkadotTxHash` with a partial unique index

```typescript
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { users } from "./users"

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 20 }).notNull().default("checkout"),
    crossmintOrderId: varchar("crossmint_order_id", { length: 255 }),
    amountPas: varchar("amount_pas", { length: 50 }),
    amountUsdc: varchar("amount_usdc", { length: 50 }),
    polkadotTxHash: varchar("polkadot_tx_hash", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_orders_user_id").on(table.userId),
    uniqueIndex("idx_orders_crossmint_order_id")
      .on(table.crossmintOrderId),
    uniqueIndex("idx_orders_polkadot_tx_hash")
      .on(table.polkadotTxHash),
  ]
)

export type Order = typeof orders.$inferSelect
export type NewOrder = typeof orders.$inferInsert
export type OrderType = "checkout" | "deposit" | "refund"
```

**Step 2: Commit**

```bash
git add src/db/schema/orders.ts
git commit -m "feat(deposit): extend orders schema with type, amounts, and polkadot tx hash"
```

---

### Task 4: Generate and run migration

**Step 1: Generate Drizzle migration**

```bash
bunx drizzle-kit generate
```

Expected: new SQL file in `src/db/migrations/` with ALTER TABLE statements adding new columns and modifying constraints.

**Step 2: Review generated SQL**

Verify it contains:
- `ALTER TABLE "orders" ADD COLUMN "type" varchar(20) NOT NULL DEFAULT 'checkout'`
- `ALTER TABLE "orders" ADD COLUMN "amount_pas" varchar(50)`
- `ALTER TABLE "orders" ADD COLUMN "amount_usdc" varchar(50)`
- `ALTER TABLE "orders" ADD COLUMN "polkadot_tx_hash" varchar(255)`
- `ALTER TABLE "orders" ALTER COLUMN "crossmint_order_id" DROP NOT NULL`
- New unique index on `polkadot_tx_hash`

**Important:** If the generated migration drops and recreates the `crossmint_order_id` unique index, verify it still works for existing data.

**Step 3: Run migration**

```bash
bun run src/db/migrate.ts
```

Expected: "Migrations completed successfully"

**Step 4: Commit**

```bash
git add src/db/migrations/
git commit -m "feat(deposit): add migration for orders deposit columns"
```

---

### Task 5: Add `fundCrossmintWallet` to crossmint client

**Files:**
- Modify: `src/lib/crossmint-client.ts`

**Step 1: Add the fund wallet response type after `CrossmintTransactionResponse`**

```typescript
export interface CrossmintFundWalletResponse {
  token: string
  decimals: number
  balances: {
    base?: string
    total: string
  }
}
```

**Step 2: Add the `fundCrossmintWallet` function at the end of the file**

```typescript
// ---------------------------------------------------------------------------
// Fund wallet via staging faucet (USDXM)
// ---------------------------------------------------------------------------

export const fundCrossmintWallet = (
  walletLocator: string,
  amount: number,
  chain: string = "base-sepolia"
): Effect.Effect<CrossmintFundWalletResponse[], DepositFundingError> =>
  Effect.tryPromise({
    try: async () => {
      const url = `${baseUrl()}/api/v1-alpha2/wallets/${walletLocator}/balances`
      const body = {
        amount,
        token: "usdxm",
        chain,
      }

      logger.info({ walletLocator, amount, chain }, "Funding Crossmint wallet via staging faucet")

      const res = await fetch(url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })

      const data = await res.json()

      if (!res.ok) {
        logger.error({ status: res.status, data, walletLocator }, "Crossmint wallet funding failed")
        throw new Error(data?.message ?? `Wallet funding failed: ${res.status}`)
      }

      logger.info({ walletLocator, amount }, "Crossmint wallet funded")
      return data as CrossmintFundWalletResponse[]
    },
    catch: (cause) => new DepositFundingError({ cause }),
  })
```

**Step 3: Add the import for `DepositFundingError` at the top of the file**

Update the import line:

```typescript
import { CheckoutOrderCreationError, CheckoutPaymentError, DepositFundingError } from "./errors.js"
```

**Step 4: Commit**

```bash
git add src/lib/crossmint-client.ts
git commit -m "feat(deposit): add fundCrossmintWallet staging faucet function"
```

---

### Task 6: Create webhook auth middleware

**Files:**
- Create: `src/middleware/webhook-auth.ts`

**Step 1: Create `src/middleware/webhook-auth.ts`**

```typescript
import { createMiddleware } from "hono/factory"
import { env } from "../lib/env.js"
import logger from "../lib/logger.js"

/**
 * Validates X-Webhook-Secret header against DEPOSIT_WEBHOOK_SECRET env var.
 * Returns 401 if missing or mismatched.
 */
export const webhookAuth = createMiddleware(async (c, next) => {
  const secret = c.req.header("X-Webhook-Secret")

  if (!env.DEPOSIT_WEBHOOK_SECRET) {
    logger.warn("DEPOSIT_WEBHOOK_SECRET not configured — rejecting webhook")
    return c.json({ error: "Webhook not configured", code: "WEBHOOK_NOT_CONFIGURED" }, 503)
  }

  if (!secret || secret !== env.DEPOSIT_WEBHOOK_SECRET) {
    logger.warn({ hasSecret: !!secret }, "Webhook auth failed — invalid secret")
    return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401)
  }

  await next()
})
```

**Step 2: Commit**

```bash
git add src/middleware/webhook-auth.ts
git commit -m "feat(deposit): add webhook auth middleware"
```

---

### Task 7: Create DepositService Effect tag + interface

**Files:**
- Create: `src/services/deposit-service.ts`

**Step 1: Create `src/services/deposit-service.ts`**

```typescript
import { Context, Effect } from "effect"
import type {
  DatabaseError,
  DepositDuplicateError,
  DepositFundingError,
  CheckoutNoWalletError,
} from "../lib/errors.js"

export interface DepositResult {
  orderId: string
  amountPAS: string
  amountUSDC: string
  crossmintFundingStatus: "funded"
}

export interface DepositServiceShape {
  confirmDeposit(
    userId: string,
    amountPAS: number,
    transactionHash: string,
  ): Effect.Effect<
    DepositResult,
    | DatabaseError
    | DepositDuplicateError
    | DepositFundingError
    | CheckoutNoWalletError
  >
}

export class DepositService extends Context.Tag("DepositService")<
  DepositService,
  DepositServiceShape
>() {}
```

**Step 2: Commit**

```bash
git add src/services/deposit-service.ts
git commit -m "feat(deposit): add DepositService Effect tag and interface"
```

---

### Task 8: Implement DepositServiceLive

**Files:**
- Create: `src/services/deposit-service-live.ts`

**Step 1: Create `src/services/deposit-service-live.ts`**

```typescript
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { users } from "../db/schema/users.js"
import { orders } from "../db/schema/orders.js"
import {
  DatabaseError,
  DepositDuplicateError,
  DepositFundingError,
  CheckoutNoWalletError,
} from "../lib/errors.js"
import { fundCrossmintWallet } from "../lib/crossmint-client.js"
import { env } from "../lib/env.js"
import { DepositService } from "./deposit-service.js"
import type { DepositServiceShape } from "./deposit-service.js"
import logger from "../lib/logger.js"

const dbError = (cause: unknown) => new DatabaseError({ cause })

const impl: DepositServiceShape = {
  confirmDeposit: (userId, amountPAS, transactionHash) =>
    Effect.gen(function* () {
      // 1. Check for duplicate tx hash
      const existing = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(orders)
            .where(eq(orders.polkadotTxHash, transactionHash))
            .then((rows) => rows[0] ?? null),
        catch: dbError,
      })

      if (existing) {
        return yield* Effect.fail(new DepositDuplicateError({ transactionHash }))
      }

      // 2. Fetch user
      const user = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .then((rows) => rows[0] ?? null),
        catch: dbError,
      })

      if (!user) {
        return yield* Effect.fail(new DatabaseError({ cause: "User not found" }))
      }

      // 3. Guard: wallet must exist
      if (!user.crossmintWalletId || !user.walletAddress) {
        return yield* Effect.fail(new CheckoutNoWalletError({ userId }))
      }

      // 4. Convert PAS → USDC
      const amountUSDC = amountPAS * env.PAS_TO_USDC_RATE
      const amountUSDCStr = amountUSDC.toFixed(2)

      // 5. Fund wallet via Crossmint staging faucet
      const walletLocator = `email:${user.email}:evm`
      yield* fundCrossmintWallet(walletLocator, amountUSDC)

      // 6. Insert deposit order record
      const depositOrder = yield* Effect.tryPromise({
        try: () =>
          db
            .insert(orders)
            .values({
              userId,
              type: "deposit",
              amountPas: String(amountPAS),
              amountUsdc: amountUSDCStr,
              polkadotTxHash: transactionHash,
            })
            .returning()
            .then((rows) => rows[0]),
        catch: (cause) => {
          // Handle unique constraint violation on polkadot_tx_hash
          const msg = String(cause)
          if (msg.includes("idx_orders_polkadot_tx_hash") || msg.includes("unique")) {
            return new DepositDuplicateError({ transactionHash })
          }
          return new DatabaseError({ cause })
        },
      })

      logger.info(
        { userId, orderId: depositOrder.id, amountPAS, amountUSDC: amountUSDCStr, transactionHash },
        "Deposit funded and recorded"
      )

      return {
        orderId: depositOrder.id,
        amountPAS: String(amountPAS),
        amountUSDC: amountUSDCStr,
        crossmintFundingStatus: "funded" as const,
      }
    }),
}

export const DepositServiceLive = Layer.succeed(DepositService, impl)
```

**Step 2: Commit**

```bash
git add src/services/deposit-service-live.ts
git commit -m "feat(deposit): implement DepositServiceLive with Crossmint staging faucet"
```

---

### Task 9: Add OpenAPI schemas for deposit webhook

**Files:**
- Modify: `src/lib/openapi-schemas.ts`

**Step 1: Add deposit schemas after `OrderIdParamSchema`**

```typescript
// ─── Deposit schemas ───────────────────────────────────────────────────────

export const DepositConfirmRequestSchema = z
  .object({
    amountPAS: z.number().positive().openapi({ example: 100 }),
    transactionHash: z.string().min(1).openapi({ example: "0xabc123def456..." }),
  })
  .openapi("DepositConfirmRequest")

export const DepositConfirmResponseSchema = z
  .object({
    orderId: z.string().uuid().openapi({ example: "d1e2f3a4-b5c6-7890-defg-234567890123" }),
    amountPAS: z.string().openapi({ example: "100" }),
    amountUSDC: z.string().openapi({ example: "10.00" }),
    crossmintFundingStatus: z.string().openapi({ example: "funded" }),
  })
  .openapi("DepositConfirmResponse")

export const UserIdParamSchema = z.object({
  userId: z.string().uuid().openapi({
    param: { name: "userId", in: "path" },
    example: "f0e1d2c3-b4a5-6789-0abc-def123456789",
  }),
})
```

**Step 2: Add `type` field to `OrderSummarySchema`**

Update the existing `OrderSummarySchema` — add `type` as the first field in the object:

```typescript
    type: z.string().openapi({ example: "checkout" }),
```

And make `crossmintOrderId` optional:

```typescript
    crossmintOrderId: z.string().nullable().openapi({ example: "ed34a579-7fbc-4509-b8d8-9e61954cd555" }),
```

**Step 3: Commit**

```bash
git add src/lib/openapi-schemas.ts
git commit -m "feat(deposit): add deposit webhook OpenAPI schemas and update OrderSummary"
```

---

### Task 10: Create deposit route

**Files:**
- Create: `src/routes/deposit.ts`

**Step 1: Create `src/routes/deposit.ts`**

This route does NOT use `authMiddleware` or `onboardingGate` — it uses `webhookAuth` instead.

```typescript
import { OpenAPIHono, createRoute } from "@hono/zod-openapi"
import { Effect, Layer } from "effect"
import { DepositService } from "../services/deposit-service.js"
import { runService } from "../lib/effect-utils.js"
import { webhookAuth } from "../middleware/webhook-auth.js"
import {
  DepositConfirmRequestSchema,
  DepositConfirmResponseSchema,
  UserIdParamSchema,
  errorResponse,
  validationHook,
} from "../lib/openapi-schemas.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function depositErrorToStatus(tag: string): 400 | 404 | 409 | 502 | 500 {
  if (tag === "CheckoutNoWalletError") return 400
  if (tag === "DatabaseError") return 404
  if (tag === "DepositDuplicateError") return 409
  if (tag === "DepositFundingError") return 502
  return 500
}

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

const security = [{ WebhookSecret: [] }]

const confirmDepositRoute = createRoute({
  method: "post",
  path: "/{userId}/confirm",
  tags: ["Deposit"],
  security,
  summary: "Confirm PAS deposit and fund user wallet with USDC",
  request: {
    params: UserIdParamSchema,
    body: {
      content: { "application/json": { schema: DepositConfirmRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: DepositConfirmResponseSchema } },
      description: "Deposit confirmed and wallet funded",
    },
    ...errorResponse(400, "User has no wallet"),
    ...errorResponse(401, "Unauthorized — invalid webhook secret"),
    ...errorResponse(409, "Duplicate transaction hash"),
    ...errorResponse(502, "Crossmint funding failed"),
    ...errorResponse(500, "Internal server error"),
  },
})

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createDepositRoutes(layer: Layer.Layer<DepositService>) {
  const app = new OpenAPIHono({
    defaultHook: validationHook,
  })

  // Webhook auth for all deposit routes
  app.use("*", webhookAuth)

  // Register webhook secret security scheme
  app.openAPIRegistry.registerComponent("securitySchemes", "WebhookSecret", {
    type: "apiKey",
    in: "header",
    name: "X-Webhook-Secret",
    description: "Shared secret for webhook authentication",
  })

  app.openapi(confirmDepositRoute, async (c) => {
    const { userId } = c.req.valid("param")
    const { amountPAS, transactionHash } = c.req.valid("json")
    const result = await runService(
      DepositService.pipe(
        Effect.flatMap((s) => s.confirmDeposit(userId, amountPAS, transactionHash)),
        Effect.provide(layer),
      ),
    )
    if (result._tag === "Left") {
      const err = result.left as { _tag: string; message?: string }
      return c.json(
        { error: err.message ?? "Deposit failed", code: err._tag },
        depositErrorToStatus(err._tag),
      ) as never
    }
    return c.json(result.right as any, 201)
  })

  return app
}
```

**Step 2: Commit**

```bash
git add src/routes/deposit.ts
git commit -m "feat(deposit): add Hono OpenAPI deposit webhook route"
```

---

### Task 11: Update OrderServiceLive to handle deposit orders

**Files:**
- Modify: `src/services/order-service.ts`
- Modify: `src/services/order-service-live.ts`

**Step 1: Update `OrderSummary` interface in `src/services/order-service.ts`**

Add `type` field and make `crossmintOrderId` nullable:

```typescript
export interface OrderSummary {
  orderId: string
  type: string
  crossmintOrderId: string | null
  phase: string
  lineItems: unknown[]
  payment: { status: string; currency: string }
  quote?: { totalPrice?: { amount: string; currency: string } }
  amountPas?: string | null
  amountUsdc?: string | null
  polkadotTxHash?: string | null
  createdAt: string
}
```

**Step 2: Update `order-service-live.ts` to handle deposit-type orders**

In `listOrders`, update the loop to skip Crossmint fetch for deposit orders:

```typescript
      for (const local of localOrders) {
        if (local.type === "deposit") {
          results.push({
            orderId: local.id,
            type: "deposit",
            crossmintOrderId: null,
            phase: "completed",
            lineItems: [],
            payment: { status: "funded", currency: "usdc" },
            amountPas: local.amountPas,
            amountUsdc: local.amountUsdc,
            polkadotTxHash: local.polkadotTxHash,
            createdAt: local.createdAt.toISOString(),
          })
          continue
        }

        // Existing Crossmint fetch logic for checkout orders...
```

In `getOrder`, add the same check after fetching the local order:

```typescript
      if (local.type === "deposit") {
        return {
          orderId: local.id,
          type: "deposit",
          crossmintOrderId: null,
          phase: "completed",
          lineItems: [],
          payment: { status: "funded", currency: "usdc" },
          amountPas: local.amountPas,
          amountUsdc: local.amountUsdc,
          polkadotTxHash: local.polkadotTxHash,
          createdAt: local.createdAt.toISOString(),
        }
      }
```

Also update `mapCrossmintOrder` to include `type: "checkout"` and the new nullable fields.

**Step 3: Commit**

```bash
git add src/services/order-service.ts src/services/order-service-live.ts
git commit -m "feat(deposit): update OrderService to handle deposit-type orders"
```

---

### Task 12: Update CheckoutServiceLive for new schema

**Files:**
- Modify: `src/services/checkout-service-live.ts`

**Step 1: Update the order insert to include `type: "checkout"`**

In the insert statement (step 8), add the `type` field:

```typescript
      const localOrder = yield* Effect.tryPromise({
        try: () =>
          db
            .insert(orders)
            .values({
              userId,
              type: "checkout",
              crossmintOrderId: crossmintOrder.orderId,
            })
            .returning()
            .then((rows) => rows[0]),
        catch: dbError,
      })
```

**Step 2: Commit**

```bash
git add src/services/checkout-service-live.ts
git commit -m "feat(deposit): add explicit type='checkout' to checkout order insert"
```

---

### Task 13: Wire up deposit route in index.ts

**Files:**
- Modify: `src/index.ts`

**Step 1: Add imports after the cart imports**

```typescript
import { createDepositRoutes } from "./routes/deposit.js";
import { DepositServiceLive } from "./services/deposit-service-live.js";
```

**Step 2: Register the deposit route**

Add BEFORE the auth middleware block (deposit uses its own webhook auth, not Crossmint JWT):

```typescript
// Deposit webhook (uses its own webhook-secret auth, not JWT)
app.route("/api/deposit", createDepositRoutes(DepositServiceLive));
```

Place this line after the health route and before `app.use("/api/*", ...)`. The deposit route has its own `webhookAuth` middleware, so it must be registered before the catch-all auth middleware on `/api/*`.

**Alternatively**, update the auth middleware skip condition to also skip deposit webhook:

```typescript
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/auth/session" && c.req.method === "POST") return next();
  if (c.req.path.startsWith("/api/deposit/")) return next();
  return (authMiddleware as any)(c, next);
});
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(deposit): wire up /api/deposit webhook route"
```

---

### Task 14: Verify and smoke test

**Step 1: TypeScript type check**

```bash
bunx tsc --noEmit
```

Expected: zero errors.

**Step 2: Start the server**

```bash
bun run src/index.ts
```

Expected: server starts without errors.

**Step 3: Check Swagger docs**

Open `/swagger` — verify:
- **Deposit** tag with `POST /api/deposit/{userId}/confirm`
- **Orders** responses now include `type` field

**Step 4: Test webhook auth rejection**

```bash
curl -s -X POST http://localhost:3001/api/deposit/00000000-0000-0000-0000-000000000000/confirm \
  -H "Content-Type: application/json" \
  -d '{"amountPAS": 100, "transactionHash": "0xtest"}' | jq .
```

Expected: `401 Unauthorized` (no webhook secret header).

**Step 5: Test with valid secret but fake user**

```bash
curl -s -X POST http://localhost:3001/api/deposit/00000000-0000-0000-0000-000000000000/confirm \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: <your-secret>" \
  -d '{"amountPAS": 100, "transactionHash": "0xtest"}' | jq .
```

Expected: `404` (user not found) — confirming the full flow reaches the service.

**Step 6: Commit any remaining changes**

```bash
git add -A
git commit -m "feat(deposit): deposit webhook feature complete"
```
