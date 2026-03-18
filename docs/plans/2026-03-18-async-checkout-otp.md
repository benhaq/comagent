# Async Checkout with Email OTP — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor checkout so backend creates Crossmint order only (returns serializedTransaction), frontend uses `@crossmint/client-sdk-react-ui` for email OTP signing + order polling.

**Architecture:** Backend stops at order creation (no server-side signing). Frontend wraps app in CrossmintProvider, replaces manual login with SDK useAuth(), adds CheckoutView that calls wallet.sendTransaction() for OTP approval then polls order status.

**Tech Stack:** Hono, Effect, Drizzle (backend); React 19, Vite, @crossmint/client-sdk-react-ui (frontend)

**Design doc:** `docs/plans/2026-03-18-async-checkout-otp-design.md`

---

## Task 1: Update CheckoutResult type and service interface

**Files:**
- Modify: `src/services/checkout-service.ts`

**Step 1: Update CheckoutResult to include serializedTransaction**

```typescript
export interface CheckoutResult {
  orderId: string
  crossmintOrderId: string
  phase: string
  serializedTransaction: string
}
```

In `src/services/checkout-service.ts`, change the `CheckoutResult` interface to add the `serializedTransaction` field.

**Step 2: Remove CheckoutPaymentError from the error union**

The checkout service no longer signs transactions, so `CheckoutPaymentError` is no longer possible. Remove it from the `checkout` method's error type union and the import.

Updated `CheckoutServiceShape`:
```typescript
export interface CheckoutServiceShape {
  checkout(userId: string, cartItemId: string): Effect.Effect<
    CheckoutResult,
    | CartItemNotFoundError
    | CheckoutNoWalletError
    | CheckoutMissingAddressError
    | InsufficientFundsError
    | CheckoutOrderCreationError
    | DatabaseError
  >
}
```

**Step 3: Verify types compile**

Run: `cd /Users/s6klabs/Documents/dev/comagent && bun run tsc --noEmit`
Expected: May show errors in checkout-service-live.ts (fixed in Task 2)

**Step 4: Commit**

```bash
git add src/services/checkout-service.ts
git commit -m "refactor: update CheckoutResult to include serializedTransaction, drop CheckoutPaymentError"
```

---

## Task 2: Simplify checkout-service-live.ts — remove signing

**Files:**
- Modify: `src/services/checkout-service-live.ts`

**Step 1: Remove signCrossmintTransaction import**

In `src/services/checkout-service-live.ts`, change the import from:
```typescript
import {
  createCrossmintOrder,
  signCrossmintTransaction,
} from "../lib/crossmint-client.js"
```
to:
```typescript
import { createCrossmintOrder } from "../lib/crossmint-client.js"
```

**Step 2: Remove the signing step (step 7) and return serializedTransaction**

Replace the current steps 7-9 and return block. After the insufficient funds check (step 6), the code should:
1. Validate `serializedTx` exists (keep existing check)
2. Skip `signCrossmintTransaction()` call entirely
3. Insert local order
4. Delete cart item
5. Return `{ orderId, crossmintOrderId, phase: "awaiting-approval", serializedTransaction }`

Updated code after step 6 (insufficient funds check):

```typescript
      // 7. Extract serialized transaction
      const serializedTx = crossmintOrder.payment.preparation?.serializedTransaction
      if (!serializedTx) {
        logger.error({ orderId: crossmintOrder.orderId, payment: crossmintOrder.payment }, "No serialized transaction in Crossmint response")
        return yield* Effect.fail(new InsufficientFundsError({ orderId: crossmintOrder.orderId }))
      }

      // 8. Insert local order record
      const localOrder = yield* Effect.tryPromise({
        try: () =>
          db
            .insert(orders)
            .values({
              userId,
              crossmintOrderId: crossmintOrder.orderId,
            })
            .returning()
            .then((rows) => rows[0]),
        catch: dbError,
      })

      // 9. Delete cart item
      yield* Effect.tryPromise({
        try: () =>
          db
            .delete(cartItems)
            .where(eq(cartItems.id, cartItemId)),
        catch: dbError,
      })

      logger.info(
        { userId, orderId: localOrder.id, crossmintOrderId: crossmintOrder.orderId },
        "Checkout order created — awaiting frontend approval"
      )

      return {
        orderId: localOrder.id,
        crossmintOrderId: crossmintOrder.orderId,
        phase: "awaiting-approval",
        serializedTransaction: serializedTx,
      }
```

**Step 3: Verify types compile**

Run: `cd /Users/s6klabs/Documents/dev/comagent && bun run tsc --noEmit`
Expected: PASS (or errors in checkout.ts route — fixed in Task 3)

**Step 4: Commit**

```bash
git add src/services/checkout-service-live.ts
git commit -m "refactor: remove server-side signing from checkout, return serializedTransaction"
```

---

## Task 3: Update checkout route response schema

**Files:**
- Modify: `src/lib/openapi-schemas.ts`
- Modify: `src/routes/checkout.ts`

**Step 1: Add serializedTransaction to CheckoutResponseSchema**

In `src/lib/openapi-schemas.ts`, update `CheckoutResponseSchema`:

```typescript
export const CheckoutResponseSchema = z
  .object({
    orderId: z.string().uuid().openapi({ example: "d1e2f3a4-b5c6-7890-defg-234567890123" }),
    crossmintOrderId: z.string().openapi({ example: "ed34a579-7fbc-4509-b8d8-9e61954cd555" }),
    phase: z.string().openapi({ example: "awaiting-approval" }),
    serializedTransaction: z.string().openapi({ example: "0x..." }),
  })
  .openapi("CheckoutResponse")
```

**Step 2: Remove CheckoutPaymentError from route error mapping**

In `src/routes/checkout.ts`, remove the `CheckoutPaymentError` case from `checkoutErrorToStatus`:

```typescript
function checkoutErrorToStatus(tag: string): 400 | 404 | 422 | 502 | 500 {
  if (tag === "CartItemNotFoundError") return 404
  if (tag === "CheckoutNoWalletError") return 400
  if (tag === "CheckoutMissingAddressError") return 400
  if (tag === "InsufficientFundsError") return 422
  if (tag === "CheckoutOrderCreationError") return 502
  return 500
}
```

**Step 3: Verify types compile**

Run: `cd /Users/s6klabs/Documents/dev/comagent && bun run tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/lib/openapi-schemas.ts src/routes/checkout.ts
git commit -m "refactor: update checkout response schema with serializedTransaction"
```

---

## Task 4: Clean up dead code in crossmint-client.ts

**Files:**
- Modify: `src/lib/crossmint-client.ts`

**Step 1: Delete signCrossmintTransaction function and its type**

In `src/lib/crossmint-client.ts`:
1. Delete the `CrossmintTransactionResponse` interface (lines 52-59)
2. Delete the entire `signCrossmintTransaction` function (lines 124-159)
3. Remove the `CheckoutPaymentError` import from `"./errors.js"` (keep `CheckoutOrderCreationError`)

The import should become:
```typescript
import { CheckoutOrderCreationError } from "./errors.js"
```

**Step 2: Verify no other code references signCrossmintTransaction**

Run: `cd /Users/s6klabs/Documents/dev/comagent && grep -r "signCrossmintTransaction" src/`
Expected: No matches

**Step 3: Verify types compile**

Run: `cd /Users/s6klabs/Documents/dev/comagent && bun run tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/lib/crossmint-client.ts
git commit -m "chore: remove dead signCrossmintTransaction code"
```

---

## Task 5: Install @crossmint/client-sdk-react-ui in test-app

**Files:**
- Modify: `test-app/package.json`

**Step 1: Install the package**

```bash
cd /Users/s6klabs/Documents/dev/comagent/test-app && bun add @crossmint/client-sdk-react-ui
```

**Step 2: Verify installation**

```bash
cd /Users/s6klabs/Documents/dev/comagent/test-app && bun run build
```
Expected: Build succeeds (no usage yet, just confirming package resolves)

**Step 3: Commit**

```bash
git add test-app/package.json test-app/bun.lockb
git commit -m "feat: add @crossmint/client-sdk-react-ui dependency"
```

---

## Task 6: Add checkout API helper to frontend

**Files:**
- Modify: `test-app/src/lib/cart-api.ts`

**Step 1: Add CheckoutResponse type and checkout function**

Append to `test-app/src/lib/cart-api.ts`:

```typescript
export interface CheckoutResponse {
  orderId: string
  crossmintOrderId: string
  phase: string
  serializedTransaction: string
}

export async function checkout(cartItemId: string): Promise<CheckoutResponse> {
  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cartItemId }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const code = body?.code ?? ""
    if (code === "CheckoutNoWalletError") throw new Error("Complete onboarding first — wallet required")
    if (code === "CheckoutMissingAddressError") throw new Error("Complete onboarding first — address required")
    if (code === "InsufficientFundsError") throw new Error("Insufficient USDC balance")
    throw new Error(body?.error ?? `Checkout failed: ${res.status}`)
  }
  return res.json()
}
```

**Step 2: Add order polling helper**

Also append to `test-app/src/lib/cart-api.ts`:

```typescript
export interface OrderStatus {
  orderId: string
  crossmintOrderId: string
  phase: string
  lineItems: unknown[]
  payment: { status: string; currency: string }
  quote?: { totalPrice?: { amount: string; currency: string } }
  createdAt: string
}

export async function getOrder(orderId: string): Promise<OrderStatus> {
  const res = await fetch(`/api/orders/${orderId}`)
  if (!res.ok) throw new Error(`Failed to fetch order: ${res.status}`)
  return res.json()
}
```

**Step 3: Commit**

```bash
git add test-app/src/lib/cart-api.ts
git commit -m "feat: add checkout and order polling API helpers"
```

---

## Task 7: Create CheckoutView component

**Files:**
- Create: `test-app/src/components/CheckoutView.tsx`

**Step 1: Create the component**

Create `test-app/src/components/CheckoutView.tsx`:

```tsx
import { useState, useEffect, useCallback, useRef } from "react"
import { useWallet } from "@crossmint/client-sdk-react-ui"
import { checkout, getOrder, type CheckoutResponse, type OrderStatus } from "../lib/cart-api"

type CheckoutStep = "preparing" | "approving" | "processing" | "completed" | "failed"

interface CheckoutViewProps {
  cartItemId: string
  onDone: () => void
  onBack: () => void
}

export function CheckoutView({ cartItemId, onDone, onBack }: CheckoutViewProps) {
  const { wallet } = useWallet()
  const [step, setStep] = useState<CheckoutStep>("preparing")
  const [error, setError] = useState<string | null>(null)
  const [orderData, setOrderData] = useState<CheckoutResponse | null>(null)
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cleanup = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  useEffect(() => cleanup, [cleanup])

  const startPolling = useCallback((orderId: string) => {
    setStep("processing")
    pollingRef.current = setInterval(async () => {
      try {
        const status = await getOrder(orderId)
        setOrderStatus(status)
        if (status.phase === "completed") {
          cleanup()
          setStep("completed")
        } else if (status.phase === "failed") {
          cleanup()
          setStep("failed")
          setError("Order failed")
        }
      } catch {
        // keep polling on transient errors
      }
    }, 2500)

    timeoutRef.current = setTimeout(() => {
      cleanup()
      setStep("failed")
      setError("Taking longer than expected. Check order history.")
    }, 60_000)
  }, [cleanup])

  const handleCheckout = useCallback(async () => {
    setError(null)
    setStep("preparing")

    try {
      // 1. Create order on backend
      const data = await checkout(cartItemId)
      setOrderData(data)

      // 2. Sign with wallet SDK (triggers email OTP)
      setStep("approving")
      if (!wallet) {
        setError("Wallet not initialized. Try refreshing.")
        setStep("failed")
        return
      }
      await wallet.sendTransaction({
        calls: [{ transaction: data.serializedTransaction }],
        chain: "base-sepolia",
      })

      // 3. Poll for completion
      startPolling(data.orderId)
    } catch (err: any) {
      setStep("failed")
      setError(err.message ?? "Checkout failed")
    }
  }, [cartItemId, wallet, startPolling])

  // Auto-start checkout on mount
  useEffect(() => {
    handleCheckout()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", flex: 1, padding: 32, gap: 16,
    }}>
      <div style={{
        background: "#16213e", borderRadius: 12, padding: 32,
        width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 16,
      }}>
        <h2 style={{ margin: 0, fontSize: 20, textAlign: "center" }}>Checkout</h2>

        {step === "preparing" && (
          <div style={{ textAlign: "center", color: "#aaa", padding: 16 }}>
            Creating order...
          </div>
        )}

        {step === "approving" && (
          <div style={{ textAlign: "center", color: "#fbbf24", padding: 16 }}>
            Check your email for the OTP code to approve this transaction.
          </div>
        )}

        {step === "processing" && (
          <div style={{ textAlign: "center", color: "#60a5fa", padding: 16 }}>
            Transaction approved! Processing order...
          </div>
        )}

        {step === "completed" && (
          <div style={{ textAlign: "center", padding: 16 }}>
            <div style={{ color: "#4ade80", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Order Complete!
            </div>
            {orderStatus?.quote?.totalPrice && (
              <div style={{ color: "#aaa", fontSize: 14 }}>
                Total: ${orderStatus.quote.totalPrice.amount} {orderStatus.quote.totalPrice.currency.toUpperCase()}
              </div>
            )}
            <button onClick={onDone} style={btnStyle}>
              Back to Cart
            </button>
          </div>
        )}

        {step === "failed" && (
          <div style={{ textAlign: "center", padding: 16 }}>
            <div style={{ color: "#f87171", fontSize: 14, marginBottom: 12 }}>
              {error ?? "Something went wrong"}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              {orderData && (
                <button
                  onClick={() => {
                    setError(null)
                    setStep("approving")
                    wallet?.sendTransaction({
                      calls: [{ transaction: orderData.serializedTransaction }],
                      chain: "base-sepolia",
                    }).then(() => startPolling(orderData.orderId))
                      .catch((err: any) => { setError(err.message); setStep("failed") })
                  }}
                  style={btnStyle}
                >
                  Retry Approval
                </button>
              )}
              <button onClick={onBack} style={{ ...btnStyle, background: "#333" }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: "#e94560",
  border: "none",
  color: "#fff",
  padding: "10px 14px",
  borderRadius: 8,
  fontSize: 14,
  cursor: "pointer",
  fontWeight: 600,
  marginTop: 8,
}
```

**Step 2: Commit**

```bash
git add test-app/src/components/CheckoutView.tsx
git commit -m "feat: add CheckoutView component with OTP approval and order polling"
```

---

## Task 8: Add Checkout button to CartPanel

**Files:**
- Modify: `test-app/src/components/CartPanel.tsx`

**Step 1: Add onCheckout prop and checkout button**

Update the `CartPanelProps` interface and component:

```typescript
interface CartPanelProps {
  items: CartItemResponse[]
  loading: boolean
  onRemove: (itemId: string) => void
  onCheckout: (itemId: string) => void
  onClose: () => void
}
```

Add `onCheckout` to the destructured props:
```typescript
export function CartPanel({ items, loading, onRemove, onCheckout, onClose }: CartPanelProps) {
```

Add a checkout button inside each cart item card, after the remove button. Replace the remove `<button>` block with:

```tsx
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignSelf: "flex-start" }}>
              <button
                onClick={() => onCheckout(item.id)}
                title="Checkout"
                style={{
                  background: "#4ade80", border: "none", color: "#000",
                  cursor: "pointer", fontSize: 11, padding: "4px 8px",
                  borderRadius: 4, fontWeight: 600,
                }}
              >
                Buy
              </button>
              <button
                onClick={() => onRemove(item.id)}
                title="Remove"
                style={{
                  background: "none", border: "none", color: "#f87171",
                  cursor: "pointer", fontSize: 16, padding: "0 4px",
                }}
              >
                &times;
              </button>
            </div>
```

**Step 2: Commit**

```bash
git add test-app/src/components/CartPanel.tsx
git commit -m "feat: add checkout button to cart items"
```

---

## Task 9: Replace LoginPanel manual OTP with Crossmint SDK auth

**Files:**
- Modify: `test-app/src/components/LoginPanel.tsx`

**Step 1: Rewrite LoginPanel to use useAuth()**

Replace the entire contents of `test-app/src/components/LoginPanel.tsx`:

```tsx
import { useState, useCallback } from "react"
import { useAuth } from "@crossmint/client-sdk-react-ui"

interface LoginPanelProps {
  onLoggedIn: () => void
}

type Step = "email" | "otp" | "loading"

export function LoginPanel({ onLoggedIn }: LoginPanelProps) {
  const { login, loginWithOtp } = useAuth()
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [error, setError] = useState<string | null>(null)

  const sendOtp = useCallback(async () => {
    if (!email.trim()) return
    setError(null)
    setStep("loading")
    try {
      await login(email.trim())
      setStep("otp")
    } catch (err: any) {
      setError(err.message ?? "Failed to send OTP")
      setStep("email")
    }
  }, [email, login])

  const verifyOtp = useCallback(async () => {
    if (!otp.trim()) return
    setError(null)
    setStep("loading")
    try {
      // 1. Verify OTP via SDK — returns JWT
      const result = await loginWithOtp(otp.trim())
      const jwt = result?.jwt ?? (result as any)?.token

      if (!jwt) {
        setError("OTP verification failed — no JWT returned")
        setStep("otp")
        return
      }

      // 2. Exchange JWT with backend for httpOnly cookie session
      const sessionRes = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jwt,
          refreshToken: result?.refreshToken?.secret ?? "",
          email: email.trim(),
        }),
      })
      if (!sessionRes.ok) {
        const data = await sessionRes.json().catch(() => null)
        setError(data?.error ?? `Session setup failed (${sessionRes.status})`)
        setStep("otp")
        return
      }

      onLoggedIn()
    } catch (err: any) {
      setError(err.message ?? "OTP verification failed")
      setStep("otp")
    }
  }, [otp, email, loginWithOtp, onLoggedIn])

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", flex: 1, gap: 16, padding: 32,
    }}>
      <div style={{
        background: "#16213e", borderRadius: 12, padding: 32,
        width: "100%", maxWidth: 400,
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        <h2 style={{ margin: 0, fontSize: 20, textAlign: "center" }}>Sign In</h2>

        {step === "email" && (
          <>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendOtp() }}
              placeholder="you@example.com"
              autoFocus
              style={inputStyle}
            />
            <button onClick={sendOtp} style={btnStyle}>Send OTP</button>
          </>
        )}

        {step === "otp" && (
          <>
            <div style={{ fontSize: 13, color: "#aaa", textAlign: "center" }}>
              OTP sent to <strong style={{ color: "#eee" }}>{email}</strong>
            </div>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") verifyOtp() }}
              placeholder="Enter 6-digit code"
              autoFocus
              style={inputStyle}
            />
            <button onClick={verifyOtp} style={btnStyle}>Verify</button>
            <button
              onClick={() => { setStep("email"); setOtp(""); setError(null) }}
              style={{ ...btnStyle, background: "#333" }}
            >
              Back
            </button>
          </>
        )}

        {step === "loading" && (
          <div style={{ textAlign: "center", color: "#aaa", padding: 16 }}>Loading...</div>
        )}

        {error && (
          <div style={{ fontSize: 13, color: "#f87171", textAlign: "center" }}>{error}</div>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: "#0f3460", border: "1px solid #444", color: "#eee",
  padding: "10px 14px", borderRadius: 8, fontSize: 14,
  outline: "none", width: "100%", boxSizing: "border-box",
}

const btnStyle: React.CSSProperties = {
  background: "#e94560", border: "none", color: "#fff",
  padding: "10px 14px", borderRadius: 8, fontSize: 14,
  cursor: "pointer", fontWeight: 600,
}
```

> **NOTE:** The exact `useAuth()` API (method names like `login`, `loginWithOtp`) may differ from the SDK version installed. After installation (Task 5), check `node_modules/@crossmint/client-sdk-react-ui` exports and adjust method names accordingly. The key pattern is: SDK sends OTP → SDK verifies OTP → returns JWT → exchange with backend.

**Step 2: Commit**

```bash
git add test-app/src/components/LoginPanel.tsx
git commit -m "refactor: replace manual Crossmint OTP with SDK useAuth()"
```

---

## Task 10: Wrap App in CrossmintProvider and wire checkout flow

**Files:**
- Modify: `test-app/src/App.tsx`

**Step 1: Add CrossmintProvider wrapper and checkout state**

At the top of `test-app/src/App.tsx`, add the import:
```typescript
import { CrossmintProvider } from "@crossmint/client-sdk-react-ui"
import { CheckoutView } from "./components/CheckoutView"
```

Add the client API key constant (same one currently in LoginPanel):
```typescript
const CROSSMINT_CLIENT_API_KEY =
  "ck_staging_65yxv1FqmiT7gVyKPQzUa3bJ4qYcUPuKdkJ5wovyVDFzS9X7S2jPhJBNuRwXp4Mbg398b3wDRx38GZBvfh7QZQ3JvSnEz2DLPqrvbsFQ5DyXcZyCFoQR2UjnmDmKxWrmpnxuH162RjhyyWNYQtXx3rDBaQYZgGFKpiFkHd98WMPZ7TTczvjmczFmFyBDA18fkztm1PefDtjJAMoabC2wEsnq"
```

Add checkout state inside the `App` component:
```typescript
const [checkoutItemId, setCheckoutItemId] = useState<string | null>(null)
```

**Step 2: Add checkout handlers**

Add these callbacks inside the `App` component:
```typescript
const handleCheckout = useCallback((itemId: string) => {
  setCheckoutItemId(itemId)
}, [])

const handleCheckoutDone = useCallback(() => {
  setCheckoutItemId(null)
  loadCart() // refresh cart after purchase
}, [loadCart])

const handleCheckoutBack = useCallback(() => {
  setCheckoutItemId(null)
}, [])
```

**Step 3: Wrap the entire return in CrossmintProvider**

Wrap both the logged-out and logged-in views in the provider. The full component return becomes:

```tsx
return (
  <CrossmintProvider apiKey={CROSSMINT_CLIENT_API_KEY}>
    {/* ... existing content, but with checkout view logic */}
  </CrossmintProvider>
)
```

For the logged-out state, keep `LoginPanel` as-is (it now uses `useAuth()` from the provider).

For the logged-in state, add conditional rendering: if `checkoutItemId` is set, show `CheckoutView` instead of the chat area:

```tsx
{checkoutItemId ? (
  <CheckoutView
    cartItemId={checkoutItemId}
    onDone={handleCheckoutDone}
    onBack={handleCheckoutBack}
  />
) : (
  <>
    {/* existing chat area */}
  </>
)}
```

**Step 4: Pass onCheckout to CartPanel**

Update the CartPanel usage:
```tsx
<CartPanel
  items={cartItems}
  loading={cartLoading}
  onRemove={handleRemoveFromCart}
  onCheckout={handleCheckout}
  onClose={() => setCartOpen(false)}
/>
```

**Step 5: Verify build**

Run: `cd /Users/s6klabs/Documents/dev/comagent/test-app && bun run build`
Expected: PASS

**Step 6: Commit**

```bash
git add test-app/src/App.tsx
git commit -m "feat: wrap app in CrossmintProvider, wire checkout flow with CheckoutView"
```

---

## Task 11: Integration test — manual end-to-end verification

**Step 1: Start the backend**

```bash
cd /Users/s6klabs/Documents/dev/comagent && bun run dev
```

**Step 2: Start the frontend**

```bash
cd /Users/s6klabs/Documents/dev/comagent/test-app && bun run dev
```

**Step 3: Manual test flow**

1. Open browser to `http://localhost:5173`
2. Login with email OTP (verify SDK auth flow works)
3. Use chat to search for a product and add to cart
4. Open cart panel, click "Buy" on an item
5. Verify CheckoutView shows "Creating order..."
6. Verify email OTP prompt appears (from SDK)
7. Enter OTP code
8. Verify "Processing order..." appears
9. Verify "Order Complete!" appears (or timeout message)
10. Verify cart refreshes after completion

**Step 4: Verify edge cases**

- Try checkout with insufficient funds → should show error
- Try closing OTP modal → should show "Retry Approval" option
- Try checkout on already-deleted cart item → should show 404 error

**Step 5: Fix any issues found, commit**

```bash
git add -A
git commit -m "fix: address integration test findings"
```

---

## Task 12: Adjust SDK API if needed

> **IMPORTANT:** This is a catch-all task. The `@crossmint/client-sdk-react-ui` SDK API may differ from what's documented above. After installing (Task 5), check the actual exports:

**Step 1: Inspect SDK exports**

```bash
cd /Users/s6klabs/Documents/dev/comagent/test-app
grep -r "export" node_modules/@crossmint/client-sdk-react-ui/dist/ | head -30
```

Or check the SDK's TypeScript definitions:
```bash
cat node_modules/@crossmint/client-sdk-react-ui/dist/index.d.ts | head -50
```

**Step 2: Verify these exports exist and match plan assumptions**

- `CrossmintProvider` — wraps app with API key
- `useAuth()` — returns `{ login, loginWithOtp }` or similar
- `useWallet()` — returns `{ wallet, getOrCreateWallet }` where wallet has `sendTransaction()`

**Step 3: If API differs, adjust LoginPanel and CheckoutView accordingly**

Common adjustments:
- `useAuth()` might be `useCrossmintAuth()` or have different method names
- `wallet.sendTransaction()` params may differ — check if it takes `{ calls, chain }` or `{ transaction, chain }`
- `CrossmintProvider` may need additional props like `environment: "staging"`

**Step 4: Commit any adjustments**

```bash
git add test-app/src/
git commit -m "fix: adjust SDK API calls to match actual @crossmint/client-sdk-react-ui exports"
```
