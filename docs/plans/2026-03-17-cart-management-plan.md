# Cart Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Status:** COMPLETE — Tasks 1–9 implemented and verified via code review (2026-03-17). Task 10 (smoke test) pending manual verification.
**Review report:** `docs/plans/reports/code-reviewer-260317-cart-management-review.md`

**Goal:** Add persistent shopping cart with REST API — add item, remove item, list cart — max 5 variant-specific items per user.

**Architecture:** New `cart_items` Drizzle table with snapshotted product data. Effect-based `CartService` (tag + live layer). Hono OpenAPI routes at `/api/cart`. Mirrors existing `ChatSessionService` / `sessions` patterns exactly.

**Tech Stack:** Drizzle ORM, Effect, Hono + @hono/zod-openapi, Zod, PostgreSQL

---

### Task 1: Add cart error types

**Files:**
- Modify: `src/lib/errors.ts`

**Step 1: Add three new tagged errors to `src/lib/errors.ts`**

Append after the `WalletProvisioningError` class:

```typescript
/**
 * Raised when user's cart already has 5 items.
 */
export class CartFullError extends Data.TaggedError("CartFullError")<{
  userId: string
}> {}

/**
 * Raised when the same product+size+color variant is already in cart.
 */
export class CartDuplicateItemError extends Data.TaggedError("CartDuplicateItemError")<{
  productId: string
  size: string
  color: string
}> {}

/**
 * Raised when a cart item is not found or not owned by user.
 */
export class CartItemNotFoundError extends Data.TaggedError("CartItemNotFoundError")<{
  itemId: string
}> {}
```

**Step 2: Commit**

```bash
git add src/lib/errors.ts
git commit -m "feat(cart): add CartFullError, CartDuplicateItemError, CartItemNotFoundError"
```

---

### Task 2: Create `cart_items` Drizzle schema

**Files:**
- Create: `src/db/schema/cart-items.ts`

**Step 1: Create `src/db/schema/cart-items.ts`**

```typescript
import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { users } from "./users"

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: varchar("product_id", { length: 255 }).notNull(),
    productName: varchar("product_name", { length: 500 }).notNull(),
    price: integer("price").notNull(),
    image: varchar("image", { length: 2048 }).notNull(),
    size: varchar("size", { length: 50 }).notNull(),
    color: varchar("color", { length: 50 }).notNull(),
    productUrl: varchar("product_url", { length: 2048 }).notNull(),
    retailer: varchar("retailer", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_cart_items_user_id").on(table.userId),
    uniqueIndex("idx_cart_items_user_variant").on(
      table.userId,
      table.productId,
      table.size,
      table.color
    ),
  ]
)

export type CartItem = typeof cartItems.$inferSelect
export type NewCartItem = typeof cartItems.$inferInsert
```

**Step 2: Commit**

```bash
git add src/db/schema/cart-items.ts
git commit -m "feat(cart): add cart_items Drizzle schema"
```

---

### Task 3: Update relations and DB client

**Files:**
- Modify: `src/db/schema/relations.ts`
- Modify: `src/db/client.ts`

**Step 1: Add cart relations to `src/db/schema/relations.ts`**

Add import at top:
```typescript
import { cartItems } from "./cart-items"
```

Add `cartItems` to the existing `usersRelations` `many` list:
```typescript
export const usersRelations = relations(users, ({ many }) => ({
  chatSessions: many(chatSessions),
  cartItems: many(cartItems),
}))
```

Add new relation block:
```typescript
export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  user: one(users, { fields: [cartItems.userId], references: [users.id] }),
}))
```

**Step 2: Register schema in `src/db/client.ts`**

Add import:
```typescript
import * as cartItemsSchema from "./schema/cart-items.js"
```

Add `...cartItemsSchema` to the `drizzle()` schema object:
```typescript
export const db = drizzle(queryClient, {
  schema: { ...chatSessionsSchema, ...chatMessagesSchema, ...usersSchema, ...relationsSchema, ...cartItemsSchema },
})
```

**Step 3: Commit**

```bash
git add src/db/schema/relations.ts src/db/client.ts
git commit -m "feat(cart): register cart_items in relations and DB client"
```

---

### Task 4: Generate and run migration

**Step 1: Generate Drizzle migration**

```bash
bunx drizzle-kit generate
```

Expected: new SQL file in `src/db/migrations/` creating `cart_items` table with indexes.

**Step 2: Review generated SQL**

Verify it contains:
- `CREATE TABLE "cart_items"` with all columns
- `idx_cart_items_user_id` index
- `idx_cart_items_user_variant` unique index
- FK to `users.id` with `ON DELETE CASCADE`

**Step 3: Run migration**

```bash
bun run src/db/migrate.ts
```

Expected: "Migrations completed successfully"

**Step 4: Commit**

```bash
git add src/db/migrations/
git commit -m "feat(cart): add cart_items migration"
```

---

### Task 5: Create CartService Effect tag + interface

**Files:**
- Create: `src/services/cart-service.ts`

**Step 1: Create `src/services/cart-service.ts`**

Follow `chat-session-service.ts` pattern exactly:

```typescript
import { Context, Effect } from "effect"
import type { CartItem } from "../db/schema/cart-items.js"
import type {
  DatabaseError,
  CartFullError,
  CartDuplicateItemError,
  CartItemNotFoundError,
} from "../lib/errors.js"

export interface AddCartItemInput {
  productId: string
  productName: string
  price: number
  image: string
  size: string
  color: string
  productUrl: string
  retailer: string
}

export interface CartServiceShape {
  getCart(userId: string): Effect.Effect<
    { items: CartItem[]; count: number },
    DatabaseError
  >

  addItem(userId: string, item: AddCartItemInput): Effect.Effect<
    CartItem,
    CartFullError | CartDuplicateItemError | DatabaseError
  >

  removeItem(userId: string, itemId: string): Effect.Effect<
    void,
    CartItemNotFoundError | DatabaseError
  >
}

export class CartService extends Context.Tag("CartService")<
  CartService,
  CartServiceShape
>() {}
```

**Step 2: Commit**

```bash
git add src/services/cart-service.ts
git commit -m "feat(cart): add CartService Effect tag and interface"
```

---

### Task 6: Implement CartServiceLive

**Files:**
- Create: `src/services/cart-service-live.ts`

**Step 1: Create `src/services/cart-service-live.ts`**

Follow `chat-session-service-live.ts` patterns (Effect.tryPromise, dbError helper, Layer.succeed):

```typescript
import { Effect, Layer } from "effect"
import { eq, and, asc, count } from "drizzle-orm"
import { db } from "../db/client.js"
import { cartItems } from "../db/schema/cart-items.js"
import {
  DatabaseError,
  CartFullError,
  CartDuplicateItemError,
  CartItemNotFoundError,
} from "../lib/errors.js"
import { CartService } from "./cart-service.js"
import type { CartServiceShape, AddCartItemInput } from "./cart-service.js"

const MAX_CART_ITEMS = 5

const dbError = (cause: unknown) => new DatabaseError({ cause })

const impl: CartServiceShape = {
  getCart: (userId) =>
    Effect.tryPromise({
      try: async () => {
        const items = await db
          .select()
          .from(cartItems)
          .where(eq(cartItems.userId, userId))
          .orderBy(asc(cartItems.createdAt))
        return { items, count: items.length }
      },
      catch: dbError,
    }),

  addItem: (userId, item) =>
    Effect.tryPromise({
      try: () =>
        db
          .select({ value: count() })
          .from(cartItems)
          .where(eq(cartItems.userId, userId))
          .then((rows) => Number(rows[0].value)),
      catch: dbError,
    }).pipe(
      Effect.flatMap((currentCount) =>
        currentCount >= MAX_CART_ITEMS
          ? Effect.fail(new CartFullError({ userId }))
          : Effect.void
      ),
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: () =>
            db
              .insert(cartItems)
              .values({ userId, ...item })
              .returning()
              .then((rows) => rows[0]),
          catch: (cause) => {
            // Postgres unique constraint violation = duplicate variant
            const err = cause as { code?: string }
            if (err?.code === "23505") {
              return new CartDuplicateItemError({
                productId: item.productId,
                size: item.size,
                color: item.color,
              })
            }
            return dbError(cause)
          },
        })
      ),
    ),

  removeItem: (userId, itemId) =>
    Effect.tryPromise({
      try: () =>
        db
          .delete(cartItems)
          .where(and(eq(cartItems.id, itemId), eq(cartItems.userId, userId)))
          .returning()
          .then((rows) => rows.length),
      catch: dbError,
    }).pipe(
      Effect.flatMap((deleted) =>
        deleted === 0
          ? Effect.fail(new CartItemNotFoundError({ itemId }))
          : Effect.void
      ),
    ),
}

export const CartServiceLive = Layer.succeed(CartService, impl)
```

**Step 2: Commit**

```bash
git add src/services/cart-service-live.ts
git commit -m "feat(cart): implement CartServiceLive with Drizzle"
```

---

### Task 7: Add OpenAPI schemas for cart

**Files:**
- Modify: `src/lib/openapi-schemas.ts`

**Step 1: Add cart schemas to `src/lib/openapi-schemas.ts`**

Append after `SessionListSchema`:

```typescript
export const CartItemSchema = z
  .object({
    id: z.string().uuid().openapi({ example: "c1d2e3f4-a5b6-7890-cdef-123456789012" }),
    userId: z.string().uuid().openapi({ example: "f0e1d2c3-b4a5-6789-0abc-def123456789" }),
    productId: z.string().openapi({ example: "B0CXYZ1234" }),
    productName: z.string().openapi({ example: "Nike Air Max 90" }),
    price: z.number().int().openapi({ example: 14999 }),
    image: z.string().url().openapi({ example: "https://example.com/shoe.jpg" }),
    size: z.string().openapi({ example: "10" }),
    color: z.string().openapi({ example: "Black" }),
    productUrl: z.string().url().openapi({ example: "https://amazon.com/dp/B0CXYZ1234" }),
    retailer: z.string().openapi({ example: "Amazon" }),
    createdAt: z.string().openapi({ example: "2026-03-17T12:00:00.000Z" }),
  })
  .openapi("CartItem")

export const CartListSchema = z
  .object({
    items: z.array(CartItemSchema),
    count: z.number().int().openapi({ example: 2 }),
  })
  .openapi("CartList")

export const AddCartItemSchema = z
  .object({
    productId: z.string().min(1),
    productName: z.string().min(1).max(500),
    price: z.number().int().positive(),
    image: z.string().url(),
    size: z.string().min(1).max(50),
    color: z.string().min(1).max(50),
    productUrl: z.string().url(),
    retailer: z.string().min(1).max(255),
  })
  .openapi("AddCartItem")

export const CartItemIdParamSchema = z.object({
  itemId: z.string().uuid().openapi({
    param: { name: "itemId", in: "path" },
    example: "c1d2e3f4-a5b6-7890-cdef-123456789012",
  }),
})
```

**Step 2: Commit**

```bash
git add src/lib/openapi-schemas.ts
git commit -m "feat(cart): add OpenAPI schemas for cart endpoints"
```

---

### Task 8: Create cart routes

**Files:**
- Create: `src/routes/cart.ts`

**Step 1: Create `src/routes/cart.ts`**

Follow `src/routes/sessions.ts` pattern exactly:

```typescript
import { OpenAPIHono, createRoute } from "@hono/zod-openapi"
import { Effect, Layer } from "effect"
import { CartService } from "../services/cart-service.js"
import type { AuthVariables } from "../middleware/auth.js"
import {
  CartItemSchema,
  CartListSchema,
  AddCartItemSchema,
  CartItemIdParamSchema,
  commonErrors,
  errorResponse,
  validationHook,
} from "../lib/openapi-schemas.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cartErrorToStatus(tag: string): 400 | 404 | 409 | 500 {
  if (tag === "CartFullError") return 400
  if (tag === "CartDuplicateItemError") return 409
  if (tag === "CartItemNotFoundError") return 404
  return 500
}

function runService<A, E>(eff: Effect.Effect<A, E, never>) {
  return Effect.runPromise(Effect.either(eff))
}

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

const security = [{ CookieAuth: [] }]

const listCartRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Cart"],
  security,
  summary: "List cart items",
  responses: {
    200: {
      content: { "application/json": { schema: CartListSchema } },
      description: "Cart contents",
    },
    ...commonErrors,
  },
})

const addCartItemRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Cart"],
  security,
  summary: "Add item to cart",
  request: {
    body: {
      content: { "application/json": { schema: AddCartItemSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: CartItemSchema } },
      description: "Item added to cart",
    },
    ...errorResponse(400, "Cart is full (max 5 items)"),
    ...errorResponse(409, "Duplicate variant already in cart"),
    ...commonErrors,
  },
})

const removeCartItemRoute = createRoute({
  method: "delete",
  path: "/{itemId}",
  tags: ["Cart"],
  security,
  summary: "Remove item from cart",
  request: { params: CartItemIdParamSchema },
  responses: {
    204: { description: "Item removed" },
    ...errorResponse(404, "Cart item not found"),
    ...commonErrors,
  },
})

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createCartRoutes(layer: Layer.Layer<CartService>) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: validationHook,
  })

  app.openapi(listCartRoute, async (c) => {
    const userId = c.get("userId")
    const result = await runService(
      CartService.pipe(
        Effect.flatMap((s) => s.getCart(userId)),
        Effect.provide(layer),
      ),
    )
    if (result._tag === "Left") {
      const err = result.left as { _tag: string; message?: string }
      return c.json(
        { error: err.message ?? "Failed to list cart", code: err._tag },
        500,
      ) as never
    }
    return c.json(result.right as any, 200)
  })

  app.openapi(addCartItemRoute, async (c) => {
    const userId = c.get("userId")
    const body = c.req.valid("json")
    const result = await runService(
      CartService.pipe(
        Effect.flatMap((s) => s.addItem(userId, body)),
        Effect.provide(layer),
      ),
    )
    if (result._tag === "Left") {
      const err = result.left as { _tag: string; message?: string }
      return c.json(
        { error: err.message ?? "Failed to add item", code: err._tag },
        cartErrorToStatus(err._tag),
      ) as never
    }
    return c.json(result.right as any, 201)
  })

  app.openapi(removeCartItemRoute, async (c) => {
    const userId = c.get("userId")
    const { itemId } = c.req.valid("param")
    const result = await runService(
      CartService.pipe(
        Effect.flatMap((s) => s.removeItem(userId, itemId)),
        Effect.provide(layer),
      ),
    )
    if (result._tag === "Left") {
      const err = result.left as { _tag: string; message?: string }
      return c.json(
        { error: err.message ?? "Cart item error", code: err._tag },
        cartErrorToStatus(err._tag),
      ) as never
    }
    return new Response(null, { status: 204 }) as never
  })

  return app
}
```

**Step 2: Commit**

```bash
git add src/routes/cart.ts
git commit -m "feat(cart): add Hono OpenAPI cart routes"
```

---

### Task 9: Wire up cart routes in `index.ts`

**Files:**
- Modify: `src/index.ts`

**Step 1: Add imports to `src/index.ts`**

Add after the `ChatSessionServiceLive` import:

```typescript
import { createCartRoutes } from "./routes/cart.js"
import { CartServiceLive } from "./services/cart-service-live.js"
```

**Step 2: Register route**

Add after the `/api/sessions` route registration:

```typescript
app.route("/api/cart", createCartRoutes(CartServiceLive))
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(cart): wire up /api/cart routes in index.ts"
```

---

### Task 10: Verify and smoke test

**Step 1: Start the server**

```bash
bun run src/index.ts
```

Expected: server starts without errors.

**Step 2: Check Swagger docs**

Open `/swagger` — verify Cart tag appears with three endpoints: GET `/api/cart`, POST `/api/cart`, DELETE `/api/cart/{itemId}`.

**Step 3: Commit all remaining changes (if any)**

```bash
git add -A
git commit -m "feat(cart): cart management feature complete"
```
