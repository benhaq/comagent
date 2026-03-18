# Async Checkout with Email OTP Approval — Design

**Date:** 2026-03-18
**Status:** Approved
**Purpose:** Refactor checkout to async flow where backend creates Crossmint order + returns serializedTransaction, frontend uses `@crossmint/client-sdk-react-ui` for email OTP approval and order polling.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  FRONTEND (test-app)                                     │
│                                                          │
│  CrossmintProvider (apiKey, auth via JWT)                │
│  ├── LoginPanel: useAuth() — SDK handles email OTP login│
│  ├── CartPanel: "Checkout" button per item               │
│  └── CheckoutView: useWallet() — sends tx, handles OTP  │
│       └── polls GET /api/orders/{id} for status          │
└──────────────┬───────────────────────────────────────────┘
               │ POST /api/checkout {cartItemId}
               │ GET /api/orders/{orderId}
               ▼
┌──────────────────────────────────────────────────────────┐
│  BACKEND (Hono)                                          │
│                                                          │
│  POST /api/checkout:                                     │
│    1. Validate user, wallet, address, cart item           │
│    2. Create Crossmint order (Headless Checkout API)     │
│    3. Extract serializedTransaction from response         │
│    4. Save local order (status: awaiting-approval)       │
│    5. Return {orderId, crossmintOrderId,                 │
│              serializedTransaction}                      │
│    ← NO wallet tx creation, NO signing                   │
│                                                          │
│  GET /api/orders/{id}: unchanged (polls Crossmint)       │
└──────────────────────────────────────────────────────────┘
```

Key change: backend stops after creating Crossmint order. No longer calls `signCrossmintTransaction()`. Frontend handles signing via SDK `useWallet()` which triggers email OTP automatically.

---

## Backend Changes

### checkout-service-live.ts — Simplified flow
1. Validate user has wallet + address
2. Fetch cart item from DB
3. Create Crossmint order via Headless Checkout API (existing `createCrossmintOrder()`)
4. Extract `serializedTransaction` from `order.payment.preparation`
5. Check for insufficient funds (`payment.status === "crypto-payer-insufficient-funds"`)
6. Insert local order record
7. Delete cart item
8. Return `{ orderId, crossmintOrderId, serializedTransaction }`

### Removed
- `signCrossmintTransaction()` call removed from checkout flow
- `signCrossmintTransaction()` function in `crossmint-client.ts` can be deleted (dead code)

### checkout.ts route
- Response schema adds `serializedTransaction: string`
- Phase returned as `"awaiting-approval"`

### No new endpoints
- Existing `GET /api/orders/{orderId}` already fetches live Crossmint status

### No schema changes
- Existing `crossmintOrderId` tracks the order; status from Crossmint via GET

---

## Frontend Changes

### Package additions
- `@crossmint/client-sdk-react-ui` — provides `CrossmintProvider`, `useAuth()`, `useWallet()`

### App.tsx
- Wrap app in `CrossmintProvider` with client API key
- Remove manual auth state management, let SDK handle it

### LoginPanel.tsx — Replace manual OTP with SDK
- Replace manual fetch calls to Crossmint auth API with SDK's `useAuth()` hook
- SDK handles send OTP → verify OTP → JWT internally
- After SDK auth, exchange JWT with backend `POST /api/auth/session` (keep — backend needs to provision users)

### New CheckoutView.tsx
- Receives `cartItemId` from CartPanel
- Calls `POST /api/checkout` → gets `{ orderId, serializedTransaction }`
- Uses `useWallet()` to get wallet, calls `wallet.sendTransaction()` with serialized tx
- SDK automatically triggers email OTP modal for approval
- On success, polls `GET /api/orders/{orderId}` every 2.5s (Crossmint recommended interval)
- Shows states: `preparing` → `approve (OTP)` → `processing` → `completed` / `failed`
- 60s timeout on polling

### CartPanel.tsx
- Add "Checkout" button per cart item
- Click navigates to CheckoutView with item ID

### State flow
```
Cart → click Checkout → CheckoutView
  → POST /api/checkout (loading spinner)
  → SDK OTP modal (user enters code from email)
  → polling (processing animation)
  → success/failure screen
  → back to cart
```

---

## Error Handling

| Scenario | Where | UX |
|---|---|---|
| No wallet / no address | Backend 400 | Error message, link to onboarding |
| Cart item not found | Backend 404 | Toast error, return to cart |
| Insufficient funds | Backend 422 | "Insufficient USDC balance" |
| Crossmint order creation fails | Backend 502 | "Checkout failed, try again" + retry |
| User cancels OTP / closes modal | Frontend | "Approval cancelled" + retry (order still valid) |
| OTP timeout / wrong code | SDK | SDK shows own error UI, user retries |
| Polling timeout (60s) | Frontend | "Taking longer than expected" |
| Order fails after approval | Polling | "Order failed" with details |

### Retry on cancelled OTP
Crossmint order + `serializedTransaction` remain valid. Frontend can call `wallet.sendTransaction()` again without creating new order. Only re-create if original expires.

---

## Risks

1. **SDK auth ↔ backend session sync** — SDK handles Crossmint auth, backend needs its own session. Must ensure SDK JWT exchanges for backend session seamlessly (LoginPanel already does this exchange).
2. **serializedTransaction expiry** — Order quotes expire ~30s. If user is slow on OTP, tx may be stale. Mitigation: show countdown, re-create order if expired.
3. **SDK version compatibility** — `@crossmint/client-sdk-react-ui` moves fast. Pin version, test against staging.
4. **Double-checkout prevention** — Cart item deleted before response, so second call gets 404.

---

## Out of Scope
- Order history page UI
- Multiple item checkout (single item only)
- Production currency (stays `credit`/USDXM for staging)
- Deposit flow (separate design doc)

---

## Files Changed/Created

| File | Change |
|---|---|
| `src/services/checkout-service-live.ts` | Remove signing, return serializedTransaction |
| `src/routes/checkout.ts` | Update response schema |
| `src/lib/crossmint-client.ts` | Delete `signCrossmintTransaction()` |
| `src/lib/openapi-schemas.ts` | Update checkout response schema |
| `test-app/package.json` | Add `@crossmint/client-sdk-react-ui` |
| `test-app/src/App.tsx` | Wrap in CrossmintProvider, replace auth state |
| `test-app/src/components/LoginPanel.tsx` | Replace manual OTP with useAuth() |
| `test-app/src/components/CartPanel.tsx` | Add Checkout button |
| `test-app/src/components/CheckoutView.tsx` | New — checkout flow + OTP + polling |
