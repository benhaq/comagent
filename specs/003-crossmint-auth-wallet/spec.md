# Feature Specification: Auth Service & Wallet Association via Crossmint

**Feature Branch**: `003-crossmint-auth-wallet`
**Created**: 2026-03-12
**Updated**: 2026-03-12
**Status**: Revised (post-Crossmint MCP research)
**Input**: User description: "using crossmint mcp, build an auth service and auth middleware for user, then when after auth associate user with a wallet keypair for later checkout"

## Research Amendments (2026-03-12)

The following assumptions from the original spec were revised after querying the Crossmint docs via MCP:

| Original assumption | Correction |
|---|---|
| Build `POST /api/auth/otp/send` + `/verify` on Hono | **Removed** — Crossmint's client SDK (`@crossmint/client-sdk-react-ui`) owns the full OTP flow client-side. No server-side OTP endpoints are exposed by Crossmint. |
| Issue our own session tokens (24h TTL stored in Redis or PostgreSQL) | **Removed** — Crossmint issues JWTs stored in browser cookies (`crossmint-jwt`, `crossmint-refresh-token`). Server validates via `@crossmint/server-sdk` `CrossmintAuth.getSession()`. |
| Add a `sessions` table in PostgreSQL | **Removed** — no custom session storage needed; Crossmint owns session state. |
| Wallet provisioned on Polkadot Hub (EVM parachain) | **Revised** — Polkadot Hub is **not in Crossmint's supported chain list**. Using **Base** (EVM, `chainType: "evm"`) which has full support for Wallets + Checkout + Onramp + Tokenization. |
| Wallet provisioning is atomic with OTP verification | **Revised** — provisioning is lazy: on the first authenticated request, backend checks if user has a wallet in our DB; if not, calls Crossmint Wallets REST API to provision, then stores the address. |
| Auth middleware validates our own tokens | **Replaced** — middleware wraps `CrossmintAuth.getSession(req, res)` from `@crossmint/server-sdk`, which auto-refreshes expired JWTs. |

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - New User Authenticates via Email OTP and Gets a Wallet (Priority: P1)

A new user visits the app. On the frontend, the `@crossmint/client-sdk-react-ui` renders a login form that sends an OTP to the user's email and verifies it — entirely managed by Crossmint. Upon successful verification, Crossmint sets `crossmint-jwt` and `crossmint-refresh-token` cookies. On the user's first API call to any protected endpoint, our backend validates the JWT, creates a `users` record if one does not exist, and provisions an EVM smart wallet on Base via the Crossmint Wallets REST API.

**Why this priority**: Entry point for all users. Without auth and wallet provisioning, checkout and order history are inaccessible.

**Independent Test**: Simulate an authenticated request by setting valid Crossmint JWT cookies in a test client. Confirm: user row created in `users` table, wallet provisioned and address stored, subsequent requests reuse the same wallet.

**Acceptance Scenarios**:

1. **Given** a user who has never used the app, **When** they make their first authenticated request, **Then** a `users` row is created, a Base EVM smart wallet is provisioned via Crossmint, and the wallet address is stored on the user record
2. **Given** a new user's wallet is provisioned, **When** they query their profile, **Then** the response includes a Base EVM wallet address in `0x` format
3. **Given** a new user, **When** wallet provisioning fails during first login, **Then** the request returns a 503 and the user row is **not** persisted (atomicity preserved)

---

### User Story 2 - Returning User's Session Is Validated and Wallet Is Preserved (Priority: P2)

A returning user makes an authenticated request. The backend calls `CrossmintAuth.getSession()`, which validates the JWT and auto-refreshes it if expired. The user's existing Base wallet address is looked up from the `users` table — no new wallet is provisioned.

**Why this priority**: Users need to access their account, cart, and order history across sessions.

**Independent Test**: Authenticate twice with the same Crossmint `userId`. Confirm the wallet address in the `users` table is identical on both requests.

**Acceptance Scenarios**:

1. **Given** a previously registered user, **When** they make an authenticated request, **Then** session validation succeeds and their existing wallet address is returned unchanged
2. **Given** an expired JWT with a valid refresh token, **When** the user makes a request, **Then** `getSession()` auto-refreshes the JWT, sets new cookies, and the request proceeds normally
3. **Given** an invalid or tampered JWT, **When** the user makes a request, **Then** middleware rejects with 401

---

### User Story 3 - Protected Routes Enforce Authentication (Priority: P3)

All endpoints that access user-specific resources (chat, cart, orders, profile) require a valid Crossmint JWT. Unauthenticated requests are rejected before reaching business logic.

**Why this priority**: Security prerequisite for all protected features.

**Independent Test**: Send requests to `GET /api/auth/profile` with no cookies, invalid cookies, and valid cookies — only the valid-cookie request succeeds.

**Acceptance Scenarios**:

1. **Given** any protected endpoint, **When** a request arrives without `crossmint-jwt` cookies, **Then** request is rejected with 401 before reaching route logic
2. **Given** a protected endpoint, **When** a request carries a valid JWT, **Then** the authenticated `userId` is available to the route handler as `c.get("userId")`
3. **Given** an expired JWT with no valid refresh token, **When** a user makes a request, **Then** 401 is returned

---

### User Story 4 - Wallet Address Available at Checkout (Priority: P4)

When a logged-in user initiates checkout, the backend retrieves their Base EVM wallet address from the `users` table.

**Why this priority**: Payoff for wallet provisioning — enables seamless checkout.

**Independent Test**: Authenticate a user and call `GET /api/auth/profile`. Confirm the response contains a `walletAddress` field in `0x` format on the Base chain.

**Acceptance Scenarios**:

1. **Given** a logged-in user, **When** checkout is initiated, **Then** the backend can retrieve the user's Base EVM wallet address for use in the transaction

---

### Edge Cases

- What if `CrossmintAuth.getSession()` throws? Middleware returns 401 — error is logged but not exposed to client.
- What if Crossmint Wallets API times out during wallet provisioning? Return 503, do not persist user row (atomicity).
- What if two concurrent requests for a new user arrive simultaneously? Use `INSERT ... ON CONFLICT DO NOTHING` plus a unique constraint on `crossmint_user_id` to prevent duplicate user rows.
- What if `getSession()` auto-refreshes and sets new cookies but the response is a streaming SSE? Cookie header must be set before streaming starts.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST validate all protected requests using `CrossmintAuth.getSession()` from `@crossmint/server-sdk`
- **FR-002**: System MUST reject unauthenticated or invalidly-authenticated requests to protected routes with a 401 response
- **FR-003**: System MUST make the authenticated `userId` (internal `users.id` UUID) and `userEmail` available to downstream route handlers via Hono context. The Crossmint user ID is stored on the `users` row as `crossmint_user_id` but is NOT the value exposed on context — internal UUID is used for DB FK compatibility with `chat_sessions.user_id`
- **FR-004**: System MUST, on the first authenticated request for a `userId`, create a `users` row in PostgreSQL
- **FR-005**: System MUST, on the first authenticated request for a new user, provision an EVM smart wallet on Base via Crossmint Wallets REST API (`POST /api/2025-06-09/wallets`) with `linkedUser: "email:<user-email>"` and `chainType: "evm"`
- **FR-006**: System MUST store the Crossmint wallet address (`0x` format) and Crossmint wallet ID on the `users` row
- **FR-007**: System MUST NOT create a new wallet if the user already has a `wallet_address` in the `users` table
- **FR-008**: System MUST treat user row creation and wallet provisioning as atomic — if either fails, neither is persisted
- **FR-009**: System MUST expose `GET /api/auth/profile` returning the authenticated user's email and `walletAddress`
- **FR-010**: System MUST expose `POST /api/auth/logout` delegating to `crossmintAuth.logout(req, res)`
- **FR-011**: System MUST replace the existing stub `src/middleware/auth.ts` with the new Crossmint-backed middleware
- **FR-012**: System MUST log all auth validation events (success, failure, refresh) with `userId` and timestamp

### Removed Requirements (from original spec — no longer applicable)

- ~~Build OTP send/verify routes~~ — Crossmint client SDK owns this entirely
- ~~Issue our own session tokens~~ — Crossmint issues JWTs; we do not issue tokens
- ~~Session table / Redis session storage~~ — handled by Crossmint cookie-based JWT

### Key Entities

- **User**: A registered account first seen by our backend after successful Crossmint auth. Attributes: `id` (uuid), `crossmint_user_id` (string, unique), `email`, `wallet_address` (Base `0x`), `crossmint_wallet_id`, `wallet_status` (pending | active | failed), `created_at`.
- **AuthContext**: Runtime-only. Set on `c.set("userId", ...)` and `c.set("userEmail", ...)` by auth middleware. Not persisted.

### New Dependencies

- `@crossmint/server-sdk` — `CrossmintAuth.getSession()`, `CrossmintAuth.getUser()`, `CrossmintAuth.logout()`

---

## Success Criteria *(mandatory)*

- **SC-001**: A new user's wallet is provisioned on their first authenticated request (within 10s, excluding Crossmint API latency)
- **SC-002**: 100% of requests to protected endpoints without valid JWT cookies are rejected with 401
- **SC-003**: All previously protected endpoints (chat, cart, orders, profile) continue to function after the stub auth middleware is replaced
- **SC-004**: Wallet provisioning succeeds for 99% of new users under normal conditions
- **SC-005**: Zero plaintext credentials or JWT values appear in application logs

---

## Assumptions

- Crossmint's client SDK (`@crossmint/client-sdk-react-ui`) handles the OTP email flow on the frontend — this backend spec does not implement OTP routes
- Wallet chain is **Base** (EVM), as Polkadot Hub is not in Crossmint's supported chain list; staging uses `base-sepolia`
- Wallet type is **EVM smart wallet** (`type: "smart"`)
- The existing stub auth middleware in `src/middleware/auth.ts` is replaced entirely
- No custom `sessions` table — Crossmint owns session state via JWT cookies
- The `users` table is new, added via a new Drizzle migration

## Clarifications

### Session 2026-03-12

- Q: Which EVM chain/network? → A (revised): **Base** (`base` mainnet / `base-sepolia` staging). Polkadot Hub not supported by Crossmint.
- Q: Wallet provisioning failure mode? → A: Atomic — user row not persisted, 503 returned, user retries.
- Q: Session storage (Redis / PostgreSQL / both)? → A: **Neither** — Crossmint manages session state via JWT cookies. Only `users` row in PostgreSQL.
- Q: OTP flow REST or SDK? → A: **SDK-based, client-side only**. No server-side OTP endpoints. `@crossmint/server-sdk` handles only session validation and user profile.
