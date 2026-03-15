# Tasks: Auth Service & Wallet Association via Crossmint

**Input**: Design documents from `/specs/003-crossmint-auth-wallet/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/auth-api.md

**Tests**: Not explicitly requested in spec. Test tasks omitted.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Install dependency and configure environment

- [x] T001 Install `@crossmint/server-sdk` via `bun add @crossmint/server-sdk`
- [x] T002 Update env schema to add `CROSSMINT_SERVER_API_KEY` (required) and `CROSSMINT_API_URL` (optional, default staging) and make `AUTH_TOKEN` optional in `src/lib/env.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Create `users` table schema with Drizzle in `src/db/schema/users.ts` — columns: `id` (uuid PK), `crossmint_user_id` (varchar unique), `email` (varchar), `wallet_address` (varchar nullable), `crossmint_wallet_id` (varchar nullable), `wallet_status` (varchar default `'none'`), `created_at`, `updated_at`. Indexes on `crossmint_user_id` (unique) and `email`
- [x] T004 Register users schema in `src/db/client.ts` — import `usersSchema` and spread into drizzle schema object
- [x] T005 Generate and apply DB migration via `bunx drizzle-kit generate` for the new users table
- [x] T006 [P] Add `AuthenticationError` and `WalletProvisioningError` tagged errors to `src/lib/errors.ts` following existing Effect `Data.TaggedError` pattern
- [x] T007 [P] Create Crossmint SDK initialization module in `src/lib/crossmint.ts` — export `crossmintAuth` instance via `createCrossmint({ apiKey })` + `CrossmintAuth.from(crossmint)`. Read API key from `env.CROSSMINT_SERVER_API_KEY`

**Checkpoint**: Foundation ready — users table exists, SDK initialized, error types defined

---

## Phase 3: User Story 1 — New User Authenticates & Gets Wallet (Priority: P1) MVP

**Goal**: On first authenticated request, validate Crossmint JWT, create user row, provision Base EVM smart wallet, store wallet address

**Independent Test**: Set valid Crossmint JWT cookies in test client. Confirm: user row created in `users` table, wallet provisioned with `0x` address stored, subsequent requests reuse same wallet

### Implementation for User Story 1

- [x] T008 [US1] Implement wallet provisioning service in `src/services/wallet-service.ts` — Effect service that calls Crossmint REST API `POST /api/2025-06-09/wallets` with `chainType: "evm"`, `linkedUser: "email:<email>"`, `config: { adminSigner: { type: "evm-fireblocks-custodial" } }`. Returns `{ address, walletId }`. Fails with `WalletProvisioningError` on API error or timeout
- [x] T009 [US1] Replace stub auth middleware in `src/middleware/auth.ts` — extract `crossmint-jwt` and `crossmint-refresh-token` cookies via `hono/cookie`, call `crossmintAuth.getSession({ jwt, refreshToken })`, set refreshed cookies on response if tokens changed, set `c.set("userId", ...)` and `c.set("userEmail", ...)`. Return 401 on failure. Log auth events (success/failure/refresh) with Pino
- [x] T010 [US1] Add user provisioning logic to auth middleware in `src/middleware/auth.ts` — after session validation, query `users` table by `crossmint_user_id`. If not found: fetch email via `crossmintAuth.getUser(userId)`, INSERT user with `wallet_status: "pending"`, call wallet service to provision, UPDATE with `wallet_address` + `wallet_status: "active"`. If wallet API fails: DELETE user row (atomicity per FR-008), return 503. Use `INSERT ... ON CONFLICT (crossmint_user_id) DO NOTHING` for concurrent request safety
- [x] T011 [US1] Update `AuthVariables` type in `src/middleware/auth.ts` to include `userEmail: string` alongside existing `userId: string`

**Checkpoint**: New users get a wallet on first request. Returning users are recognized. 401 on invalid/missing JWT.

---

## Phase 4: User Story 2 — Returning User Session Validation (Priority: P2)

**Goal**: Returning user's JWT is validated (and auto-refreshed if expired), existing wallet address reused without re-provisioning

**Independent Test**: Authenticate twice with same Crossmint userId. Confirm wallet address in users table is identical on both requests

### Implementation for User Story 2

- [x] T012 [US2] Ensure auth middleware in `src/middleware/auth.ts` handles returning users — when `users` row exists with `wallet_status: "active"`, skip provisioning, set `userId` to internal `users.id` and `userEmail` from DB row. Verify `getSession()` auto-refresh sets updated cookies via `setCookie()` from `hono/cookie`
- [x] T013 [US2] Handle expired JWT with valid refresh token — verify `getSession({ jwt, refreshToken })` returns new tokens, middleware writes them as `Set-Cookie` headers before `await next()`

**Checkpoint**: Returning users pass through middleware with no wallet re-provisioning. Expired JWTs auto-refresh.

---

## Phase 5: User Story 3 — Protected Routes Enforcement (Priority: P3)

**Goal**: All `/api/*` endpoints reject unauthenticated requests with 401 before reaching business logic

**Independent Test**: Send requests to `/api/auth/profile` with no cookies, invalid cookies, and valid cookies — only valid succeeds

### Implementation for User Story 3

- [x] T014 [US3] Create auth routes in `src/routes/auth.ts` — implement `GET /api/auth/profile` returning `{ userId, email, walletAddress, walletStatus }` from `users` table using `c.get("userId")`. Implement `POST /api/auth/logout` delegating to `crossmintAuth.logout()` (or manually clearing `crossmint-jwt` and `crossmint-refresh-token` cookies)
- [x] T015 [US3] Register auth routes in `src/index.ts` — import `authRoute` from `src/routes/auth.ts`, mount at `app.route("/api/auth", authRoute)`. Ensure auth middleware applies to `/api/*` (already configured)
- [x] T016 [US3] Verify 401 rejection for edge cases in auth middleware — handle: missing cookies (both absent), tampered JWT (getSession throws), expired JWT with no refresh token (getSession throws). All return `{ error: "Unauthorized", code: "UNAUTHORIZED" }` with 401 status

**Checkpoint**: All protected endpoints enforce auth. Profile endpoint returns wallet info. Logout clears session.

---

## Phase 6: User Story 4 — Wallet Address Available at Checkout (Priority: P4)

**Goal**: Logged-in user's Base EVM wallet address is retrievable for checkout flow

**Independent Test**: Authenticate a user, call `GET /api/auth/profile`, confirm response contains `walletAddress` in `0x` format

### Implementation for User Story 4

- [x] T017 [US4] Verify `GET /api/auth/profile` response includes `walletAddress` field in `0x` format — this is satisfied by T014 implementation. Validate response schema with Zod: `walletAddress` is `string().regex(/^0x[a-fA-F0-9]{40}$/)` when `walletStatus` is `"active"`, or `null` when pending/failed

**Checkpoint**: Wallet address accessible for downstream checkout integration.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements affecting multiple user stories

- [x] T018 [P] Add auth event logging across middleware — ensure all auth validation events (success, failure, refresh) log `userId` and timestamp per FR-012. Use Pino logger from `src/lib/logger.ts`. Never log JWT values or credentials (SC-005)
- [x] T019 [P] Handle SSE streaming edge case — if `getSession()` auto-refreshes and response is streaming SSE, ensure `Set-Cookie` header is set before streaming starts (check chat route compatibility)
- [ ] T020 Run `quickstart.md` validation — verify setup steps work end-to-end: install dep, run migration, start server, test 401 without cookies, test profile with valid cookies

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Phase 2 — creates auth middleware + wallet service
- **User Story 2 (Phase 4)**: Depends on Phase 3 — extends middleware with returning-user path
- **User Story 3 (Phase 5)**: Depends on Phase 3 — adds routes that use the middleware
- **User Story 4 (Phase 6)**: Depends on Phase 5 — validates profile endpoint output
- **Polish (Phase 7)**: Depends on all user stories complete

### User Story Dependencies

- **US1 (P1)**: After Foundational — no other story dependencies. Creates core middleware + wallet service
- **US2 (P2)**: After US1 — extends the auth middleware created in US1
- **US3 (P3)**: After US1 — adds routes that depend on middleware from US1. Can run parallel with US2
- **US4 (P4)**: After US3 — validates profile endpoint from US3

### Within Each User Story

- Models/schemas before services
- Services before routes/endpoints
- Core implementation before edge case handling

### Parallel Opportunities

- **Phase 2**: T006 and T007 can run in parallel (different files)
- **Phase 5**: T014 and T016 touch different concerns but same file — sequential
- **Phase 7**: T018 and T019 can run in parallel (different files/concerns)
- **US2 and US3**: Can run in parallel after US1 completes (US2 extends middleware, US3 adds routes)

---

## Parallel Example: Foundational Phase

```bash
# These can run in parallel (different files):
Task: "T006 Add AuthenticationError and WalletProvisioningError to src/lib/errors.ts"
Task: "T007 Create Crossmint SDK init in src/lib/crossmint.ts"
```

## Parallel Example: After US1 Complete

```bash
# US2 and US3 can start in parallel:
Task: "T012 [US2] Handle returning users in src/middleware/auth.ts"
Task: "T014 [US3] Create auth routes in src/routes/auth.ts"
# Note: T012 and T014 touch different files, so no conflict
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T007)
3. Complete Phase 3: User Story 1 (T008-T011)
4. **STOP and VALIDATE**: New user gets wallet on first authenticated request
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 → New user auth + wallet provisioning (MVP!)
3. Add US2 → Returning user session handling
4. Add US3 → Protected routes + profile/logout endpoints
5. Add US4 → Wallet address validation for checkout
6. Polish → Logging, SSE edge case, quickstart validation

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story
- US2 depends on US1 because it extends the same middleware
- US3 can parallel with US2 since it creates new route files
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
