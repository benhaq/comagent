# Polkadot Deposit → Base USDC Funding — Design

**Date:** 2026-03-18
**Status:** Approved
**Purpose:** Let users deposit PAS on Polkadot Hub testnet (Paseo) and receive USDC (USDXM) on Base Sepolia in their Crossmint wallet, enabling checkout via existing Headless Checkout flow.

---

## System Overview

```
┌──────────────────────┐         ┌──────────────────┐        ┌────────────┐
│  External Service     │         │     COMAGENT      │        │  CROSSMINT │
│  (Polkadot Payment)   │         │                   │        │            │
│                        │  POST   │ /api/deposit/     │  POST  │ Fund       │
│  User pays PAS on  ───│────────→│ {userId}/confirm   │──────→│ Wallet API │
│  Paseo testnet        │ webhook │                   │        │ (staging)  │
│                        │ +secret │ 1. Find user      │        │            │
│  Verifies on-chain    │         │ 2. PAS → USDC     │        │ Mints      │
│                        │  ←──────│ 3. Fund wallet    │  ←─────│ USDXM     │
│                        │  200/err│ 4. Save order     │        │            │
└──────────────────────┘         └──────────────────┘        └────────────┘
```

### User Journey

1. User initiates deposit in app (amount in PAS)
2. External service creates Polkadot payment request on Paseo
3. User sends PAS to the payment address on Paseo
4. External service handler verifies on-chain settlement
5. External service calls comagent webhook `POST /api/deposit/{userId}/confirm`
6. Comagent funds user's Crossmint wallet via Fund Wallet API
7. User now has USDC balance → can checkout via existing flow

### Deposit State Machine

```
External: User pays PAS → pending → verified (on-chain confirmed)
                                        │
                                        ▼ webhook call
Comagent:                            funding
                                     ╱       ╲
                                funded      fund_failed
                                  │
                                  ▼
External:                      settled (via 200 response from webhook)
```

---

## External Service API Contract

The external Polkadot payment service must implement:

### 1. Create Payment Request (called by frontend or comagent)

```
POST /payment-requests
{
  "userId": "uuid",
  "amountPAS": 100
}

Response 201:
{
  "id": "uuid",
  "paymentAddress": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
  "amountPAS": 100,
  "status": "pending",
  "expiresAt": "2026-03-18T13:00:00Z"
}
```

### 2. Verify + Confirm Deposit (called by external service → comagent)

```
POST /api/deposit/{userId}/confirm   ← comagent webhook endpoint
Headers: X-Webhook-Secret: <shared_secret>
{
  "amountPAS": 100,
  "transactionHash": "0xabc123...polkadot_tx_hash"
}

Response 201 (success):
{
  "orderId": "uuid",
  "amountUSDC": "10.00",
  "crossmintFundingStatus": "funded"
}

Response 401: { "error": "Unauthorized", "code": "UNAUTHORIZED" }
Response 404: { "error": "User not found", "code": "UserNotFoundError" }
Response 409: { "error": "Duplicate transaction", "code": "DepositDuplicateError" }
Response 502: { "error": "Wallet funding failed", "code": "DepositFundingError" }
```

### 3. Get Payment Request Status (optional, for frontend polling)

```
GET /payment-requests/{id}

Response 200:
{
  "id": "uuid",
  "userId": "uuid",
  "amountPAS": 100,
  "status": "pending" | "verified" | "settled" | "expired",
  "transactionHash": "0x..." | null
}
```

---

## Comagent Changes

### Orders Table Schema Changes

Add columns to support multiple order types (deposit, checkout, refund):

```sql
ALTER TABLE orders ADD COLUMN type varchar(20) NOT NULL DEFAULT 'checkout';
ALTER TABLE orders ADD COLUMN amount_pas numeric;
ALTER TABLE orders ADD COLUMN amount_usdc numeric;
ALTER TABLE orders ADD COLUMN polkadot_tx_hash varchar(255);
ALTER TABLE orders ALTER COLUMN crossmint_order_id DROP NOT NULL;
CREATE UNIQUE INDEX idx_orders_polkadot_tx_hash ON orders (polkadot_tx_hash) WHERE polkadot_tx_hash IS NOT NULL;
```

Column usage by order type:

| Field | checkout | deposit | refund (future) |
|---|---|---|---|
| type | `"checkout"` | `"deposit"` | `"refund"` |
| userId | user UUID | user UUID | user UUID |
| crossmintOrderId | Crossmint ID | `null` | Crossmint ID |
| amountPAS | `null` | PAS deposited | `null` |
| amountUSDC | `null` | USDC funded | USDC refunded |
| polkadotTxHash | `null` | Polkadot tx hash | `null` |

### Conversion Rate

```
USDC = amountPAS × PAS_TO_USDC_RATE
```

`PAS_TO_USDC_RATE` stored in env var (e.g. `0.1` → 100 PAS = 10 USDC).

### Crossmint Fund Wallet API Integration

```
POST https://staging.crossmint.com/api/v1-alpha2/wallets/{walletLocator}/balances
{
  "amount": <usdc_amount>,
  "token": "usdxm",
  "chain": "base-sepolia"
}
```

Wallet locator format: `email:{user.email}:evm` or direct wallet address.
API scope required: `wallets.fund`.
Staging only — mints USDXM (test USDC) directly.

### Webhook Security

- `X-Webhook-Secret` header validated against `DEPOSIT_WEBHOOK_SECRET` env var
- Returns 401 if missing or mismatched
- Implemented as Hono middleware on deposit routes only

### Idempotency

- `polkadotTxHash` has a unique partial index (WHERE NOT NULL)
- Duplicate txHash → 409 Conflict with existing order returned
- Prevents double-funding from webhook retries

### Error Handling

| Scenario | HTTP | Behavior |
|---|---|---|
| Invalid/missing webhook secret | 401 | Reject immediately |
| User not found | 404 | External service should alert |
| User has no wallet | 400 | CheckoutNoWalletError |
| Duplicate txHash | 409 | Return existing deposit order |
| Crossmint Fund API fails | 502 | Don't save order, external retries |
| Invalid amountPAS (≤0) | 400 | Validation error |

---

## New Environment Variables

```
PAS_TO_USDC_RATE=0.1          # 1 PAS = 0.1 USDC
DEPOSIT_WEBHOOK_SECRET=secret  # Shared secret for webhook auth
```

---

## Files Changed/Created

| File | Change |
|---|---|
| `src/db/schema/orders.ts` | Add `type`, `amountPas`, `amountUsdc`, `polkadotTxHash` columns |
| `src/db/migrations/` | New migration for orders table changes |
| `src/lib/env.ts` | Add `PAS_TO_USDC_RATE`, `DEPOSIT_WEBHOOK_SECRET` |
| `src/lib/crossmint-client.ts` | Add `fundCrossmintWallet()` |
| `src/lib/openapi-schemas.ts` | Add deposit webhook schemas |
| `src/lib/errors.ts` | Add `DepositDuplicateError`, `DepositFundingError` |
| `src/routes/deposit.ts` | New route with webhook auth |
| `src/services/deposit-service.ts` | Effect tag + interface |
| `src/services/deposit-service-live.ts` | Implementation |
| `src/middleware/webhook-auth.ts` | Webhook secret validation |
| `src/index.ts` | Wire up `/api/deposit` route (no onboarding gate, no auth — webhook-only) |

---

## Impact on Existing Code

- **OrderServiceLive** `listOrders` / `getOrder` — must handle orders without `crossmintOrderId` (deposit type). For deposits, return local data only (no Crossmint fetch).
- **OpenAPI schemas** — `OrderSummarySchema` needs `type` field and optional Crossmint fields.
- **Checkout flow** — unchanged. User's wallet now has USDC from deposit, checkout proceeds as before.

---

## Out of Scope

- Frontend deposit UI (separate task)
- Production funding (treasury wallet transfers)
- Real PAS/USD conversion rate oracle
- Refund flow
- Balance checking endpoint (Crossmint wallet balance API)
