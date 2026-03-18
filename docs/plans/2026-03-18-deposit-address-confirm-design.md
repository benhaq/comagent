# Deposit Webhook: Add Address Path Param — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Change deposit confirmation endpoint to include wallet address in path and validate userId+address pair exists in users table.

**Architecture:** Add `address` path param to existing Hono OpenAPI route, update Zod param schema, modify service interface to accept address, update Drizzle query to filter by both `id` and `walletAddress`.

**Tech Stack:** Hono + zod-openapi, Drizzle ORM, Effect, TypeScript/Bun

---

### Task 1: Add Address Param Schema

**Files:**
- Modify: `src/lib/openapi-schemas.ts:238-243`

**Step 1: Add the new param schema**

In `src/lib/openapi-schemas.ts`, add a new schema below `UserIdParamSchema` (line ~243):

```typescript
export const DepositParamsSchema = z.object({
  userId: z.string().uuid().openapi({
    param: { name: "userId", in: "path" },
    example: "f0e1d2c3-b4a5-6789-0abc-def123456789",
  }),
  address: z.string().min(1).openapi({
    param: { name: "address", in: "path" },
    example: "0x1234567890abcdef1234567890abcdef12345678",
    description: "User EVM wallet address",
  }),
})
```

**Step 2: Commit**

```bash
git add src/lib/openapi-schemas.ts
git commit -m "feat(deposit): add DepositParamsSchema with address path param"
```

---

### Task 2: Update Service Interface

**Files:**
- Modify: `src/services/deposit-service.ts:16-27`

**Step 1: Add `address` parameter to `confirmDeposit` signature**

Change the interface at line 17:

```typescript
export interface DepositServiceShape {
  confirmDeposit(
    userId: string,
    address: string,
    amountPAS: string,
    transactionHash: string,
  ): Effect.Effect<
    DepositResult,
    | DatabaseError
    | DepositDuplicateError
    | DepositFundingError
    | CheckoutNoWalletError
  >
}
```

**Step 2: Commit**

```bash
git add src/services/deposit-service.ts
git commit -m "feat(deposit): add address param to DepositServiceShape interface"
```

---

### Task 3: Update Service Implementation

**Files:**
- Modify: `src/services/deposit-service-live.ts:21-36`

**Step 1: Update `confirmDeposit` to accept `address` and filter by both fields**

At line 21, change the function signature and query:

```typescript
const impl: DepositServiceShape = {
  confirmDeposit: (userId, address, amountPAS, transactionHash) =>
    Effect.gen(function* () {
      // 1. Fetch user by id + walletAddress
      const user = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(users)
            .where(and(eq(users.id, userId), eq(users.walletAddress, address)))
            .then((rows) => rows[0] ?? null),
        catch: dbError,
      })

      if (!user) {
        return yield* Effect.fail(new DatabaseError({ cause: "User not found or address mismatch" }))
      }

      // 2. Guard: wallet must exist — already guaranteed by query filter, but keep for safety
      if (!user.walletAddress) {
        return yield* Effect.fail(new CheckoutNoWalletError({ userId }))
      }
```

Also add `and` to the drizzle-orm import at line 3:

```typescript
import { eq, and } from "drizzle-orm"
```

The rest of the function (lines 43–94) stays unchanged.

**Step 2: Verify types compile**

Run: `bun run typecheck` (or `bunx tsc --noEmit`)
Expected: No errors

**Step 3: Commit**

```bash
git add src/services/deposit-service-live.ts
git commit -m "feat(deposit): filter user lookup by id + walletAddress"
```

---

### Task 4: Update Route Definition and Handler

**Files:**
- Modify: `src/routes/deposit.ts:1-98`

**Step 1: Update imports, route path, and handler**

Change the import at line 6 to use `DepositParamsSchema` instead of `UserIdParamSchema`:

```typescript
import {
  DepositConfirmRequestSchema,
  DepositConfirmResponseSchema,
  DepositParamsSchema,
  errorResponse,
  validationHook,
} from "../lib/openapi-schemas.js"
```

Update the route definition at line 32–56. Change `path` and `params`:

```typescript
const confirmDepositRoute = createRoute({
  method: "post",
  path: "/{userId}/{address}/confirm",
  tags: ["Deposit"],
  security,
  summary: "Confirm PAS deposit and fund user wallet with USDC",
  request: {
    params: DepositParamsSchema,
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
    ...errorResponse(404, "User not found or address mismatch"),
    ...errorResponse(409, "Duplicate transaction hash"),
    ...errorResponse(502, "Crossmint funding failed"),
    ...errorResponse(500, "Internal server error"),
  },
})
```

Update the handler at line 78–80 to extract `address` and pass it to service:

```typescript
  app.openapi(confirmDepositRoute, async (c) => {
    const { userId, address } = c.req.valid("param")
    const { amountPAS, transactionHash } = c.req.valid("json")
    const result = await runService(
      DepositService.pipe(
        Effect.flatMap((s) => s.confirmDeposit(userId, address, String(amountPAS), transactionHash)),
        Effect.provide(layer),
      ),
    )
```

**Step 2: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/routes/deposit.ts
git commit -m "feat(deposit): change route to /{userId}/{address}/confirm"
```

---

### Task 5: Smoke Test

**Step 1: Start the dev server**

Run: `bun run dev`

**Step 2: Verify the new endpoint responds**

```bash
curl -X POST http://localhost:3000/api/deposit/f0e1d2c3-b4a5-6789-0abc-def123456789/0x1234567890abcdef1234567890abcdef12345678/confirm \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_SECRET" \
  -d '{"amountPAS": 100, "transactionHash": "0xtesthash123"}'
```

Expected: 404 with `"User not found or address mismatch"` (since the UUID/address combo won't exist)

**Step 3: Verify old endpoint no longer responds**

```bash
curl -X POST http://localhost:3000/api/deposit/f0e1d2c3-b4a5-6789-0abc-def123456789/confirm \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_SECRET" \
  -d '{"amountPAS": 100, "transactionHash": "0xtesthash456"}'
```

Expected: 404 (route not found)

**Step 4: Check OpenAPI docs reflect new path**

Visit: `http://localhost:3000/doc` or `/swagger`
Expected: Deposit endpoint shows `/{userId}/{address}/confirm` with both path params documented

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(deposit): complete address param confirmation webhook"
```
