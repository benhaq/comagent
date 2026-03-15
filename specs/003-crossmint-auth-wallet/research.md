# Research: Auth Service & Wallet Association via Crossmint

**Feature**: 003-crossmint-auth-wallet
**Date**: 2026-03-15

## R1: Crossmint Server SDK — getSession for Hono

**Decision**: Use `@crossmint/server-sdk`'s `CrossmintAuth.getSession(req, res)` with manual cookie extraction, since Hono does not expose Express-compatible `req`/`res` objects.

**Rationale**: Crossmint docs show Express and raw Node.js examples. Both call `getSession(req, res)` which reads cookies `crossmint-jwt` and `crossmint-refresh-token` from the request and writes refreshed tokens back via `Set-Cookie`. Hono's `c.req.raw` is a standard `Request` object, and `c.res` is not directly usable as an Express `res`. However, `getSession` also accepts `{ jwt, refreshToken }` for frameworks without standard req/res (documented for Next.js App Router). We will extract cookies from Hono's `c.req.cookie()` and pass `{ jwt, refreshToken }` directly.

**Alternatives considered**:
- Pass `c.req.raw` and a shimmed `res` — fragile, relies on internal SDK expectations
- Fork the SDK — maintenance overhead

**Implementation note**: When using `{ jwt, refreshToken }`, getSession returns `{ jwt, refreshToken, userId }` but does NOT auto-set cookies. Middleware must manually set cookies on the response via `c.header("Set-Cookie", ...)` after refresh.

---

## R2: Wallet Provisioning via REST API

**Decision**: Use `POST https://staging.crossmint.com/api/2025-06-09/wallets` (v2025-06-09) from server-side with server API key to create EVM smart wallets on Base.

**Rationale**: The spec calls for server-side wallet provisioning on first auth. Crossmint's REST API supports creating wallets with `chainType: "evm"` and linking via `linkedUser: "email:<email>"`. The `getOrCreateWallet` SDK method is client-side only (requires client API key + JWT). For server-side provisioning, the REST API is the documented approach.

**Alternatives considered**:
- `CrossmintWallets.from(crossmint).createWallet()` TypeScript SDK — also valid but REST is simpler with fewer deps
- Client-side `getOrCreateWallet` — not applicable; provisioning must happen server-side on first authenticated request

**Request format**:
```
POST /api/2025-06-09/wallets
Headers: X-API-KEY: <server-api-key>, Content-Type: application/json
Body: {
  "chainType": "evm",
  "linkedUser": "email:<user-email>",
  "config": {
    "adminSigner": { "type": "evm-fireblocks-custodial" }
  }
}
```

**Response**: Returns `{ address: "0x...", ... }` — store `address` as `wallet_address` on user row.

**Idempotency**: Crossmint returns existing wallet when `linkedUser` is the same, so duplicate calls are safe.

---

## R3: Hono Cookie Handling for JWT Refresh

**Decision**: Use `hono/cookie` helpers (`getCookie`, `setCookie`) to extract and set Crossmint JWT cookies.

**Rationale**: Hono has built-in cookie utilities. Since `getSession()` with `{ jwt, refreshToken }` doesn't auto-set cookies, the middleware must read cookies before calling getSession and write refreshed cookies after.

**Cookie names**:
- `crossmint-jwt` — the access JWT
- `crossmint-refresh-token` — the refresh token

---

## R4: Effect-First Error Types for Auth/Wallet

**Decision**: Add `AuthenticationError`, `WalletProvisioningError` tagged errors following the existing pattern in `src/lib/errors.ts`.

**Rationale**: Constitution Principle I requires all service-layer failures be Effect typed errors. Auth middleware catches these at the Hono route boundary and maps to HTTP 401/503.

---

## R5: Atomicity of User + Wallet Creation

**Decision**: Use a database transaction wrapping user INSERT + wallet provisioning. If wallet API fails, rollback the user INSERT.

**Rationale**: FR-008 requires atomicity. Approach: INSERT user with `wallet_status: "pending"`, call Crossmint API, UPDATE with wallet address + `wallet_status: "active"`. If API fails, DELETE the pending row (or rollback transaction).

**Concurrency**: `INSERT ... ON CONFLICT (crossmint_user_id) DO NOTHING` prevents duplicate users from concurrent requests. Second request will find existing user and skip provisioning.

---

## R6: Environment Variables

**Decision**: Add `CROSSMINT_SERVER_API_KEY` (required) and `CROSSMINT_API_URL` (optional, defaults to staging) to env schema.

**Rationale**: Server API key is required for both `CrossmintAuth` and wallet REST API. URL allows switching between staging (`staging.crossmint.com`) and production (`www.crossmint.com`).

---

## R7: AI SDK Version Compatibility

**Decision**: Constitution lists `ai ^5.x` and `@ai-sdk/openai ^1.x`, but CLAUDE.md notes upgrade to `ai ^6.x` and `@ai-sdk/openai ^2.x`. Package.json confirms v6/v2. No conflict — constitution tech table is stale but the actual codebase is the authority.

**Rationale**: This feature does not touch AI SDK code. No impact.
