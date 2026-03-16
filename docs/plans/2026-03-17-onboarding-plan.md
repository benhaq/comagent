# Onboarding Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 3-step mandatory onboarding flow (name → address → sizes) that gates protected routes until complete.

**Architecture:** Extend `users` table with 13 columns + `onboarding_step` tracker. 4 new API endpoints under `/api/onboarding/*`. New `onboardingGate` middleware between `authMiddleware` and route handlers. Profile endpoint extended with `onboardingStep`.

**Tech Stack:** Bun, Hono (OpenAPI), Drizzle ORM, PostgreSQL (Neon), Zod, bun:test

---

### Task 1: Extend Users Schema

**Files:**
- Modify: `src/db/schema/users.ts`

**Step 1: Add onboarding columns to users schema**

Add these columns to the existing `users` pgTable definition, after `walletStatus` and before `createdAt`:

```typescript
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
  integer,
} from "drizzle-orm/pg-core"

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crossmintUserId: varchar("crossmint_user_id", { length: 255 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    walletAddress: varchar("wallet_address", { length: 42 }),
    crossmintWalletId: varchar("crossmint_wallet_id", { length: 255 }),
    walletStatus: varchar("wallet_status", { length: 20 })
      .notNull()
      .default("none"),

    // Onboarding fields
    onboardingStep: integer("onboarding_step").notNull().default(0),
    displayName: varchar("display_name", { length: 100 }),
    firstName: varchar("first_name", { length: 50 }),
    lastName: varchar("last_name", { length: 50 }),
    street: varchar("street", { length: 200 }),
    apt: varchar("apt", { length: 50 }),
    country: varchar("country", { length: 2 }),
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 100 }),
    zip: varchar("zip", { length: 20 }),
    topsSize: varchar("tops_size", { length: 10 }),
    bottomsSize: varchar("bottoms_size", { length: 10 }),
    footwearSize: varchar("footwear_size", { length: 10 }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_users_crossmint_user_id").on(table.crossmintUserId),
    index("idx_users_email").on(table.email),
  ]
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type WalletStatus = "none" | "pending" | "active" | "failed"
```

**Step 2: Generate migration**

Run: `bun run db:generate`
Expected: New migration file created in `src/db/migrations/`

**Step 3: Apply migration**

Run: `bun run db:migrate`
Expected: Migration applied successfully

**Step 4: Commit**

```bash
git add src/db/schema/users.ts src/db/migrations/
git commit -m "feat(onboarding): extend users table with onboarding columns"
```

---

### Task 2: Add Onboarding Zod Schemas

**Files:**
- Modify: `src/lib/openapi-schemas.ts`

**Step 1: Add onboarding request/response schemas**

Append these schemas to the end of `src/lib/openapi-schemas.ts`, before the validation hook section:

```typescript
// ─── Onboarding schemas ─────────────────────────────────────────────────────

export const ALLOWED_COUNTRIES = ["US", "GB", "AU", "CA", "DE", "FR", "JP", "SG"] as const

export const TOPS_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL"] as const

export const OnboardingStep1Schema = z
  .object({
    displayName: z.string().min(1).max(100).openapi({ example: "Ben" }),
  })
  .openapi("OnboardingStep1")

export const OnboardingStep2Schema = z
  .object({
    firstName: z.string().min(1).max(50).openapi({ example: "Ben" }),
    lastName: z.string().min(1).max(50).openapi({ example: "Smith" }),
    street: z.string().min(5).max(200).openapi({ example: "123 Main St" }),
    apt: z.string().max(50).optional().openapi({ example: "Apt 5B" }),
    country: z.enum(ALLOWED_COUNTRIES).openapi({ example: "US" }),
    city: z.string().min(2).max(100).openapi({ example: "New York" }),
    state: z.string().max(100).optional().openapi({ example: "NY" }),
    zip: z.string().min(3).max(20).openapi({ example: "10001" }),
  })
  .openapi("OnboardingStep2")

export const OnboardingStep3Schema = z
  .object({
    topsSize: z.enum(TOPS_SIZES).openapi({ example: "M" }),
    bottomsSize: z.string().min(1).max(10).openapi({ example: "32" }),
    footwearSize: z.string().min(1).max(10).openapi({ example: "10" }),
  })
  .openapi("OnboardingStep3")

export const OnboardingStepResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    step: z.number().int().openapi({ example: 1 }),
  })
  .openapi("OnboardingStepResponse")

export const OnboardingStatusSchema = z
  .object({
    step: z.number().int().openapi({ example: 0 }),
    completed: z.boolean().openapi({ example: false }),
  })
  .openapi("OnboardingStatus")
```

**Step 2: Commit**

```bash
git add src/lib/openapi-schemas.ts
git commit -m "feat(onboarding): add Zod schemas for onboarding steps"
```

---

### Task 3: Create Onboarding Route

**Files:**
- Create: `src/routes/onboarding.ts`

**Step 1: Write the failing test**

Create `tests/integration/onboarding.test.ts`:

```typescript
/**
 * Integration tests: Onboarding API endpoints
 *
 * Strategy:
 * - Real DB (Neon) — no DB mocks
 * - Crossmint SDK mocked (external service boundary)
 * - Hono app assembled inline
 * - Each test cleans up its own rows via afterEach
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, mock, spyOn } from "bun:test"
import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "../../src/db/client.js"
import { users } from "../../src/db/schema/users.js"
import { authMiddleware } from "../../src/middleware/auth.js"
import { onboardingRoute } from "../../src/routes/onboarding.js"
import { authRoute } from "../../src/routes/auth.js"

// ─── Test fixtures ────────────────────────────────────────────────────────────

const FAKE_CROSSMINT_USER_ID = "cm-onboard-test-001"
const FAKE_EMAIL = "onboard@example.com"
const FAKE_WALLET_ADDRESS = "0xDeAdBeEf00000000000000000000000000000002"
const FAKE_WALLET_ID = "wlt-onboard-001"
const VALID_JWT = "eyJ.valid.onboard"
const VALID_REFRESH = "refresh-onboard-abc"

// ─── Mock Crossmint SDK ───────────────────────────────────────────────────────

import * as crossmintLib from "../../src/lib/crossmint.js"
import * as walletService from "../../src/services/wallet-service.js"
import { Effect } from "effect"

const mockGetSession = mock(async (_: { jwt: string; refreshToken: string }) => ({
  userId: FAKE_CROSSMINT_USER_ID,
  jwt: VALID_JWT,
  refreshToken: VALID_REFRESH,
}))

const mockGetUser = mock(async (_: string) => ({
  email: FAKE_EMAIL,
}))

const mockProvisionWallet = mock((_email: string) =>
  Effect.succeed({ address: FAKE_WALLET_ADDRESS, walletId: FAKE_WALLET_ID })
)

// ─── Build test app ───────────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono()
  app.use("/api/*", authMiddleware)
  app.route("/api/onboarding", onboardingRoute)
  app.route("/api/auth", authRoute)
  return app
}

function validCookieHeader() {
  return `crossmint-jwt=${VALID_JWT}; crossmint-refresh-token=${VALID_REFRESH}`
}

async function cleanupTestUser() {
  await db.delete(users).where(eq(users.crossmintUserId, FAKE_CROSSMINT_USER_ID))
}

async function seedUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db
    .insert(users)
    .values({
      crossmintUserId: FAKE_CROSSMINT_USER_ID,
      email: FAKE_EMAIL,
      walletAddress: FAKE_WALLET_ADDRESS,
      crossmintWalletId: FAKE_WALLET_ID,
      walletStatus: "active",
      onboardingStep: 0,
      ...overrides,
    })
    .returning()
  return user
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(() => {
  ;(crossmintLib.crossmintAuth as any).getSession = mockGetSession
  ;(crossmintLib.crossmintAuth as any).getUser = mockGetUser
  ;(crossmintLib.crossmintAuth as any).logout = mock(async () => {})
  spyOn(walletService, "provisionWallet").mockImplementation(mockProvisionWallet)
})

afterEach(async () => {
  await cleanupTestUser()
  mockGetSession.mockClear()
  mockGetUser.mockClear()
  mockProvisionWallet.mockClear()
})

afterAll(async () => {
  await cleanupTestUser()
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/onboarding/status
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/onboarding/status", () => {
  it("returns step 0 and completed false for new user", async () => {
    await seedUser()
    const app = buildApp()
    const res = await app.request("/api/onboarding/status", {
      headers: { Cookie: validCookieHeader() },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.step).toBe(0)
    expect(body.completed).toBe(false)
  })

  it("returns step 3 and completed true after full onboarding", async () => {
    await seedUser({ onboardingStep: 3 })
    const app = buildApp()
    const res = await app.request("/api/onboarding/status", {
      headers: { Cookie: validCookieHeader() },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.step).toBe(3)
    expect(body.completed).toBe(true)
  })

  it("returns 401 without auth", async () => {
    const app = buildApp()
    const res = await app.request("/api/onboarding/status")
    expect(res.status).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onboarding/step-1
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/onboarding/step-1", () => {
  it("saves display name and advances to step 1", async () => {
    await seedUser()
    const app = buildApp()
    const res = await app.request("/api/onboarding/step-1", {
      method: "POST",
      headers: { Cookie: validCookieHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Ben" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.step).toBe(1)

    const user = await db.query.users?.findFirst({
      where: eq(users.crossmintUserId, FAKE_CROSSMINT_USER_ID),
    })
    expect(user!.displayName).toBe("Ben")
    expect(user!.onboardingStep).toBe(1)
  })

  it("rejects empty display name", async () => {
    await seedUser()
    const app = buildApp()
    const res = await app.request("/api/onboarding/step-1", {
      method: "POST",
      headers: { Cookie: validCookieHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "" }),
    })
    expect(res.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onboarding/step-2
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/onboarding/step-2", () => {
  it("saves address and advances to step 2", async () => {
    await seedUser({ onboardingStep: 1 })
    const app = buildApp()
    const res = await app.request("/api/onboarding/step-2", {
      method: "POST",
      headers: { Cookie: validCookieHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Ben",
        lastName: "Smith",
        street: "123 Main St",
        country: "US",
        city: "New York",
        state: "NY",
        zip: "10001",
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.step).toBe(2)

    const user = await db.query.users?.findFirst({
      where: eq(users.crossmintUserId, FAKE_CROSSMINT_USER_ID),
    })
    expect(user!.firstName).toBe("Ben")
    expect(user!.country).toBe("US")
    expect(user!.onboardingStep).toBe(2)
  })

  it("rejects if step 1 not completed", async () => {
    await seedUser({ onboardingStep: 0 })
    const app = buildApp()
    const res = await app.request("/api/onboarding/step-2", {
      method: "POST",
      headers: { Cookie: validCookieHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Ben",
        lastName: "Smith",
        street: "123 Main St",
        country: "US",
        city: "New York",
        zip: "10001",
      }),
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("STEP_NOT_REACHED")
  })

  it("rejects invalid country code", async () => {
    await seedUser({ onboardingStep: 1 })
    const app = buildApp()
    const res = await app.request("/api/onboarding/step-2", {
      method: "POST",
      headers: { Cookie: validCookieHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Ben",
        lastName: "Smith",
        street: "123 Main St",
        country: "XX",
        city: "New York",
        zip: "10001",
      }),
    })
    expect(res.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/onboarding/step-3
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/onboarding/step-3", () => {
  it("saves sizes and completes onboarding", async () => {
    await seedUser({ onboardingStep: 2 })
    const app = buildApp()
    const res = await app.request("/api/onboarding/step-3", {
      method: "POST",
      headers: { Cookie: validCookieHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        topsSize: "M",
        bottomsSize: "32",
        footwearSize: "10",
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.step).toBe(3)

    const user = await db.query.users?.findFirst({
      where: eq(users.crossmintUserId, FAKE_CROSSMINT_USER_ID),
    })
    expect(user!.topsSize).toBe("M")
    expect(user!.bottomsSize).toBe("32")
    expect(user!.footwearSize).toBe("10")
    expect(user!.onboardingStep).toBe(3)
  })

  it("rejects if step 2 not completed", async () => {
    await seedUser({ onboardingStep: 1 })
    const app = buildApp()
    const res = await app.request("/api/onboarding/step-3", {
      method: "POST",
      headers: { Cookie: validCookieHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        topsSize: "M",
        bottomsSize: "32",
        footwearSize: "10",
      }),
    })
    expect(res.status).toBe(403)
  })

  it("rejects invalid tops size", async () => {
    await seedUser({ onboardingStep: 2 })
    const app = buildApp()
    const res = await app.request("/api/onboarding/step-3", {
      method: "POST",
      headers: { Cookie: validCookieHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        topsSize: "XXXL",
        bottomsSize: "32",
        footwearSize: "10",
      }),
    })
    expect(res.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Profile includes onboardingStep
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/auth/profile includes onboardingStep", () => {
  it("includes onboardingStep in profile response", async () => {
    await seedUser({ onboardingStep: 2 })
    const app = buildApp()
    const res = await app.request("/api/auth/profile", {
      headers: { Cookie: validCookieHeader() },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.onboardingStep).toBe(2)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/onboarding.test.ts`
Expected: FAIL — `Cannot find module "../../src/routes/onboarding.js"`

**Step 3: Create the onboarding route**

Create `src/routes/onboarding.ts`:

```typescript
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { users } from "../db/schema/users.js"
import type { AuthVariables } from "../middleware/auth.js"
import {
  OnboardingStep1Schema,
  OnboardingStep2Schema,
  OnboardingStep3Schema,
  OnboardingStepResponseSchema,
  OnboardingStatusSchema,
  ErrorSchema,
  errorResponse,
  commonErrors,
  validationHook,
} from "../lib/openapi-schemas.js"

const security = [{ CookieAuth: [] }]

// ─── Route definitions ──────────────────────────────────────────────────────

const statusRoute = createRoute({
  method: "get",
  path: "/status",
  tags: ["Onboarding"],
  security,
  summary: "Get onboarding status",
  responses: {
    200: {
      content: { "application/json": { schema: OnboardingStatusSchema } },
      description: "Current onboarding status",
    },
    ...commonErrors,
  },
})

const step1Route = createRoute({
  method: "post",
  path: "/step-1",
  tags: ["Onboarding"],
  security,
  summary: "Step 1: Set display name",
  request: {
    body: { content: { "application/json": { schema: OnboardingStep1Schema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: OnboardingStepResponseSchema } },
      description: "Step 1 completed",
    },
    ...errorResponse(400, "Validation error"),
    ...commonErrors,
  },
})

const step2Route = createRoute({
  method: "post",
  path: "/step-2",
  tags: ["Onboarding"],
  security,
  summary: "Step 2: Set shipping address",
  request: {
    body: { content: { "application/json": { schema: OnboardingStep2Schema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: OnboardingStepResponseSchema } },
      description: "Step 2 completed",
    },
    ...errorResponse(400, "Validation error"),
    ...errorResponse(403, "Previous step not completed"),
    ...commonErrors,
  },
})

const step3Route = createRoute({
  method: "post",
  path: "/step-3",
  tags: ["Onboarding"],
  security,
  summary: "Step 3: Set clothing sizes",
  request: {
    body: { content: { "application/json": { schema: OnboardingStep3Schema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: OnboardingStepResponseSchema } },
      description: "Step 3 completed — onboarding finished",
    },
    ...errorResponse(400, "Validation error"),
    ...errorResponse(403, "Previous step not completed"),
    ...commonErrors,
  },
})

// ─── Handlers ───────────────────────────────────────────────────────────────

export const onboardingRoute = new OpenAPIHono<{ Variables: AuthVariables }>({
  defaultHook: validationHook,
})

onboardingRoute.openapi(statusRoute, async (c) => {
  const userId = c.get("userId")
  const user = await db.query.users?.findFirst({
    where: eq(users.id, userId),
    columns: { onboardingStep: true },
  })
  const step = user?.onboardingStep ?? 0
  return c.json({ step, completed: step >= 3 })
})

onboardingRoute.openapi(step1Route, async (c) => {
  const userId = c.get("userId")
  const { displayName } = c.req.valid("json")

  await db
    .update(users)
    .set({ displayName, onboardingStep: 1, updatedAt: new Date() })
    .where(eq(users.id, userId))

  return c.json({ success: true, step: 1 })
})

onboardingRoute.openapi(step2Route, async (c) => {
  const userId = c.get("userId")

  const user = await db.query.users?.findFirst({
    where: eq(users.id, userId),
    columns: { onboardingStep: true },
  })

  if (!user || user.onboardingStep < 1) {
    return c.json({ error: "Complete step 1 first", code: "STEP_NOT_REACHED" }, 403) as never
  }

  const data = c.req.valid("json")

  await db
    .update(users)
    .set({
      firstName: data.firstName,
      lastName: data.lastName,
      street: data.street,
      apt: data.apt ?? null,
      country: data.country,
      city: data.city,
      state: data.state ?? null,
      zip: data.zip,
      onboardingStep: 2,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))

  return c.json({ success: true, step: 2 })
})

onboardingRoute.openapi(step3Route, async (c) => {
  const userId = c.get("userId")

  const user = await db.query.users?.findFirst({
    where: eq(users.id, userId),
    columns: { onboardingStep: true },
  })

  if (!user || user.onboardingStep < 2) {
    return c.json({ error: "Complete step 2 first", code: "STEP_NOT_REACHED" }, 403) as never
  }

  const { topsSize, bottomsSize, footwearSize } = c.req.valid("json")

  await db
    .update(users)
    .set({
      topsSize,
      bottomsSize,
      footwearSize,
      onboardingStep: 3,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))

  return c.json({ success: true, step: 3 })
})
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/integration/onboarding.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/routes/onboarding.ts tests/integration/onboarding.test.ts
git commit -m "feat(onboarding): add onboarding route with 3-step endpoints and tests"
```

---

### Task 4: Extend Profile Response with onboardingStep

**Files:**
- Modify: `src/lib/openapi-schemas.ts` (UserProfileSchema)
- Modify: `src/routes/auth.ts` (profile handler)

**Step 1: Add onboardingStep to UserProfileSchema**

In `src/lib/openapi-schemas.ts`, update `UserProfileSchema`:

```typescript
export const UserProfileSchema = z
  .object({
    userId: z.string().uuid().openapi({ example: "f0e1d2c3-b4a5-6789-0abc-def123456789" }),
    email: z.string().email().openapi({ example: "user@example.com" }),
    walletAddress: z.string().nullable().openapi({ example: "0xDeAdBeEf00000000000000000000000000000001" }),
    walletStatus: z.string().openapi({ example: "active" }),
    onboardingStep: z.number().int().openapi({ example: 0 }),
  })
  .openapi("UserProfile")
```

**Step 2: Update profile handler in auth.ts**

In `src/routes/auth.ts`, update the profile handler response to include `onboardingStep`:

```typescript
  return c.json({
    userId: user.id,
    email: user.email,
    walletAddress: walletAddress.success ? walletAddress.data : null,
    walletStatus: user.walletStatus,
    onboardingStep: user.onboardingStep,
  })
```

**Step 3: Run all tests**

Run: `bun test`
Expected: All tests PASS (including existing auth tests + new onboarding tests)

**Step 4: Commit**

```bash
git add src/lib/openapi-schemas.ts src/routes/auth.ts
git commit -m "feat(onboarding): include onboardingStep in profile response"
```

---

### Task 5: Create Onboarding Gate Middleware

**Files:**
- Create: `src/middleware/onboarding-gate.ts`

**Step 1: Write the failing test**

Add to `tests/integration/onboarding.test.ts` at the bottom:

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// Onboarding gate middleware
// ─────────────────────────────────────────────────────────────────────────────

import { onboardingGate } from "../../src/middleware/onboarding-gate.js"

describe("Onboarding gate middleware", () => {
  function buildGatedApp() {
    const app = new Hono()
    app.use("/api/*", authMiddleware)
    app.route("/api/onboarding", onboardingRoute)
    app.route("/api/auth", authRoute)
    // Gated route
    app.use("/api/chat/*", onboardingGate)
    app.get("/api/chat/test", (c) => c.json({ ok: true }))
    return app
  }

  it("blocks user with incomplete onboarding", async () => {
    await seedUser({ onboardingStep: 1 })
    const app = buildGatedApp()
    const res = await app.request("/api/chat/test", {
      headers: { Cookie: validCookieHeader() },
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("ONBOARDING_INCOMPLETE")
    expect(body.step).toBe(1)
  })

  it("allows user with completed onboarding", async () => {
    await seedUser({ onboardingStep: 3 })
    const app = buildGatedApp()
    const res = await app.request("/api/chat/test", {
      headers: { Cookie: validCookieHeader() },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it("blocks user with step 0", async () => {
    await seedUser({ onboardingStep: 0 })
    const app = buildGatedApp()
    const res = await app.request("/api/chat/test", {
      headers: { Cookie: validCookieHeader() },
    })
    expect(res.status).toBe(403)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/onboarding.test.ts`
Expected: FAIL — `Cannot find module "../../src/middleware/onboarding-gate.js"`

**Step 3: Create the onboarding gate middleware**

Create `src/middleware/onboarding-gate.ts`:

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/integration/onboarding.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/middleware/onboarding-gate.ts tests/integration/onboarding.test.ts
git commit -m "feat(onboarding): add onboarding gate middleware with tests"
```

---

### Task 6: Wire Up Routes in index.ts

**Files:**
- Modify: `src/index.ts`

**Step 1: Add onboarding route and gate middleware**

In `src/index.ts`, add these imports at the top with the other imports:

```typescript
import { onboardingRoute } from "./routes/onboarding.js"
import { onboardingGate } from "./middleware/onboarding-gate.js"
```

Then update the protected routes section. The onboarding route goes BEFORE the gate. Chat and sessions get the gate applied:

```typescript
// Auth middleware for all protected routes
app.use("/api/*", authMiddleware)

// Onboarding routes (no gate — accessible during onboarding)
app.route("/api/onboarding", onboardingRoute)

// Auth routes (no gate — profile/logout always accessible)
app.route("/api/auth", authRoute)

// Onboarding gate for remaining protected routes
app.use("/api/chat/*", onboardingGate)
app.use("/api/sessions/*", onboardingGate)

// Gated API routes
app.route(
  "/api/chat",
  createChatRoute(productServiceLayer, ChatSessionServiceLive),
)
app.route("/api/sessions", createSessionRoutes(ChatSessionServiceLive))
```

**Step 2: Run all tests**

Run: `bun test`
Expected: All tests PASS

**Step 3: Manually verify Swagger**

Run: `bun run dev`
Open: `http://localhost:3000/swagger`
Verify: Onboarding endpoints appear under "Onboarding" tag

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(onboarding): wire onboarding route and gate into app"
```

---

### Task 7: Final Verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests PASS

**Step 2: Run type check**

Run: `bunx tsc --noEmit`
Expected: No type errors

**Step 3: Test manually with curl (optional)**

```bash
# Get status (should be step 0)
curl -s http://localhost:3000/api/onboarding/status -H "Cookie: crossmint-jwt=YOUR_JWT"

# Step 1
curl -s -X POST http://localhost:3000/api/onboarding/step-1 \
  -H "Cookie: crossmint-jwt=YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Ben"}'

# Step 2
curl -s -X POST http://localhost:3000/api/onboarding/step-2 \
  -H "Cookie: crossmint-jwt=YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Ben","lastName":"Smith","street":"123 Main St","country":"US","city":"New York","state":"NY","zip":"10001"}'

# Step 3
curl -s -X POST http://localhost:3000/api/onboarding/step-3 \
  -H "Cookie: crossmint-jwt=YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"topsSize":"M","bottomsSize":"32","footwearSize":"10"}'

# Chat should now work (was 403 before)
curl -s http://localhost:3000/api/chat -H "Cookie: crossmint-jwt=YOUR_JWT"
```

**Step 4: Final commit**

```bash
git commit --allow-empty -m "chore(onboarding): implementation complete — all tests passing"
```
