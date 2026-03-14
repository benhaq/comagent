# Tasks: ReAct Chat Agents Codebase Setup with DDD

**Input**: Design documents from `/specs/002-react-agents-ddd-setup/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/api-endpoints.md, quickstart.md

**Tests**: Tests are included as Phase 7 (spec FR-017 requires zero untyped catches; constitution mandates integration tests cover service contracts).

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, dependency installation, config files

- [x] T001 Initialize Bun project with `bun init` and configure `package.json` with scripts (dev, start, test, db:generate, db:migrate) and all dependencies (hono, drizzle-orm, drizzle-kit, postgres, effect, ai, @ai-sdk/openai, zod, @hono/zod-validator, ioredis, pino, pino-pretty)
- [x] T002 Create `tsconfig.json` with strict mode, Bun types, path aliases
- [x] T003 [P] Create `.env.example` with all env vars documented (DATABASE_URL, OPENAI_API_KEY, AUTH_TOKEN, PORT, PRODUCT_SERVICE, REDIS_URL, SCRAPING_SERVICE_URL, SCRAPING_SERVICE_API_KEY, RATE_LIMIT_RPM, LOG_LEVEL)
- [x] T004 [P] Create `.gitignore` for Bun project (node_modules, .env, dist, *.log, drizzle/meta)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Implement Zod env validation with fail-fast startup in `src/lib/env.ts` — validate DATABASE_URL, OPENAI_API_KEY (required), PORT, PRODUCT_SERVICE, REDIS_URL, AUTH_TOKEN, LOG_LEVEL (optional with defaults)
- [x] T006 [P] Implement Pino structured JSON logger in `src/lib/logger.ts` — factory function with service name, requestId support, pino-pretty for dev
- [x] T007 [P] Define all Effect tagged error types in `src/lib/errors.ts` — ProductNotFound, ScrapingServiceUnavailable, SessionNotFound, AIServiceError, DatabaseError, ValidationError, CacheError, CacheNotFound
- [x] T008 [P] Define TypeScript types in `src/types/product.ts` — ProductCard, ProductDetail, ColorOption, ProductSearchParams, ProductSearchResult
- [x] T009 Initialize Drizzle client with postgres.js in `src/db/client.ts` — main pool (max: 20, idle_timeout: 30) and migration client (max: 1)
- [x] T010 [P] Define `chat_sessions` Drizzle table schema in `src/db/schema/chat-sessions.ts` — uuid PK, user_id, title, created_at, updated_at with indexes
- [x] T011 [P] Define `chat_messages` Drizzle table schema in `src/db/schema/chat-messages.ts` — uuid PK, session_id FK (cascade delete), role, JSONB content, created_at with session_id index
- [x] T012 Create `drizzle.config.ts` at project root — postgres.js driver, schema path `src/db/schema/*`, migrations dir `src/db/migrations`
- [x] T013 Create programmatic migration runner in `src/db/migrate.ts` — uses migration client (max: 1), runs pending migrations, logs results
- [x] T014 Implement stub bearer token auth middleware in `src/middleware/auth.ts` — validate AUTH_TOKEN from Authorization header, inject hardcoded userId, return 401 if invalid
- [x] T015 [P] Implement Effect error-to-HTTP mapper in `src/middleware/error-handler.ts` — map each Effect error tag to HTTP status code, return `{ error, code }` shape, never expose internals
- [x] T016 [P] Implement CacheService Effect service in `src/services/cache-service.ts` — Context.Tag, ioredis standalone client, get/set(TTL)/del/health operations, typed CacheError/CacheNotFound errors, Layer definition
- [x] T017 Implement GET /health route in `src/routes/health.ts` — check PostgreSQL connectivity (Drizzle), Redis connectivity (CacheService.health), report ProductService provider name, uptime
- [x] T018 Create Hono server entry point in `src/index.ts` — create Hono app, mount logger middleware (requestId + request logging), mount auth middleware, mount error handler, mount health route, compose Effect layers (CacheService), start Bun server on configured port, log startup confirmation

**Checkpoint**: `bun run dev` → server starts → `GET /health` returns 200 with database + redis status

---

## Phase 3: User Story 1 — Developer Starts Backend Service (Priority: P1) MVP

**Goal**: Bootable Hono server with Drizzle DB + Effect DI wiring. Verified by health endpoint.

**Independent Test**: Run `bun run dev`, hit `GET /health`, confirm 200 with service readiness status.

### Implementation for User Story 1

- [x] T019 [US1] Run `bunx drizzle-kit generate` to create initial migration SQL from chat_sessions + chat_messages schemas
- [x] T020 [US1] Run `bunx drizzle-kit migrate` to apply initial migration to local PostgreSQL
- [x] T021 [US1] Verify end-to-end: `bun run dev` → startup logs show Drizzle connected + Redis connected + Effect layers initialized → `GET /health` returns 200 with `{ status: "ok", services: { database: "connected", redis: "connected", productService: "mock" } }`

**Checkpoint**: Server boots, health check passes, all infrastructure verified. MVP complete.

---

## Phase 4: User Story 2 — Streaming Chat with ReAct Agent (Priority: P2)

**Goal**: Working chat endpoint with ReAct agent, tool definitions, streaming SSE, mock product service.

**Independent Test**: `curl -N POST /api/chat` with "find me running shoes" → SSE stream with text tokens + tool-invocation events.

### Implementation for User Story 2

- [x] T022 [P] [US2] Implement ProductService Effect service interface in `src/services/product-service.ts` — Context.Tag with `search(params)` and `getDetails(productId)` operations, typed errors (ProductNotFound, ScrapingServiceUnavailable)
- [x] T023 [P] [US2] Implement MockProductService in `src/services/mock-product-service.ts` — hardcoded product data (5+ products), simulated 300-800ms latency via `Effect.sleep`, Layer definition implementing ProductService tag
- [x] T024 [US2] Define AI SDK tool schemas in `src/services/product-tools.ts` — `searchProducts` tool (Zod input: query, category?, minPrice?, maxPrice?, size?, color?; execute calls ProductService.search) and `getProductDetails` tool (Zod input: productId; execute calls ProductService.getDetails)
- [x] T025 [P] [US2] Write shopping concierge system prompt in `src/lib/chat-system-prompt.ts` — role as shopping concierge, clarify before searching (1-2 questions), use preferences, markdown formatting, 3-5 products, boundaries (shopping only)
- [x] T026 [US2] Implement POST /api/chat route in `src/routes/chat.ts` — validate request body with Zod (messages + optional sessionId), convertToModelMessages, streamText with openai("gpt-4o") + tools + stopWhen(stepCountIs(3)), return toUIMessageStreamResponse() wrapped in Hono Response with SSE headers
- [x] T027 [US2] Update `src/index.ts` — add ProductService layer (MockProductService default, based on PRODUCT_SERVICE env), mount chat route

**Checkpoint**: Chat endpoint streams SSE response. ReAct agent calls tools for product queries. Mock data returned.

---

## Phase 5: User Story 3 — Session Management (Priority: P3)

**Goal**: Full CRUD sessions + message persistence + auto-titling.

**Independent Test**: Create session → send chat → list sessions → verify messages persisted → verify auto-title.

### Implementation for User Story 3

- [ ] T028 [US3] Implement ChatSessionService Effect service in `src/services/chat-session-service.ts` — Context.Tag with create, list, getWithMessages, rename, delete, addMessage, autoTitle operations. Drizzle queries wrapped in Effect.tryPromise. Typed errors: SessionNotFound, DatabaseError, AIServiceError (for autoTitle).
- [ ] T029 [US3] Implement session CRUD routes in `src/routes/sessions.ts` — POST /api/sessions (create), GET /api/sessions (list with pagination), GET /api/sessions/:id (get with messages), PATCH /api/sessions/:id (rename), DELETE /api/sessions/:id (204). All with Zod validation via zValidator.
- [ ] T030 [US3] Implement rate limiting middleware in `src/middleware/rate-limit.ts` — in-memory store, 30 req/min per userId (from auth context), return 429 with `{ error, code }` when exceeded
- [ ] T031 [US3] Update POST /api/chat in `src/routes/chat.ts` — integrate session resolution (auto-create if no sessionId via ChatSessionService.create), persist user message on receipt (ChatSessionService.addMessage), persist assistant message after stream completes, trigger autoTitle after first exchange
- [ ] T032 [US3] Update `src/index.ts` — add ChatSessionService layer, mount session routes, add rate-limit middleware

**Checkpoint**: Session CRUD works. Chat messages persist to sessions. Auto-title generates after first exchange.

---

## Phase 6: User Story 4 — External Scraping Service (Priority: P4)

**Goal**: Production product data via external scraping microservice with resilience.

**Independent Test**: Set `PRODUCT_SERVICE=scraping` → chat query returns real Amazon data → kill scraping service → verify graceful fallback.

### Implementation for User Story 4

- [ ] T033 [US4] Implement ScrapingProductService in `src/services/scraping-product-service.ts` — HTTP calls to external scraping API, map ScrapingProduct response to internal ProductCard/ProductDetail types, retry logic (3 attempts with exponential backoff via Effect.retry), circuit breaker pattern, fallback to CacheService for cached results on failure. Layer definition implementing ProductService tag.
- [ ] T034 [US4] Update `src/index.ts` — add ScrapingProductService layer option in provider switch logic (PRODUCT_SERVICE=scraping resolves ScrapingProductService layer, wired with CacheService dependency)

**Checkpoint**: Scraping service returns real Amazon products. Graceful fallback on failure. Cache populated on successful queries.

---

## Phase 7: Docker + Migrations + Production Readiness

**Purpose**: Containerized deployment with multi-stage build, migration automation.

- [ ] T035 [P] Create `.dockerignore` — exclude node_modules, .git, specs/, docs/, tests/, *.md, .env
- [ ] T036 [P] Create `Dockerfile` with 3-stage build — Stage 1 (deps): `oven/bun:1.1-alpine`, copy package.json + bun.lock, `bun install --frozen-lockfile`. Stage 2 (build): copy src, `bun build --compile --minify src/index.ts --outfile server`. Stage 3 (runtime): alpine base, copy binary, non-root user (bun:bun), HEALTHCHECK, EXPOSE, CMD.
- [ ] T037 [P] Create `Dockerfile.migrations` — single stage, `oven/bun:1.1-alpine`, install deps, copy src/db, run `bun run src/db/migrate.ts`, exit on completion.
- [ ] T038 Create `docker-compose.yml` — services: postgres (postgres:16-alpine, healthcheck pg_isready, volume), redis (redis:7-alpine, healthcheck redis-cli ping), migrations (Dockerfile.migrations, depends_on postgres healthy, condition service_completed_successfully), app (Dockerfile, depends_on migrations completed + redis healthy, port mapping, env vars)

**Checkpoint**: `docker compose up` → all services healthy → `curl /health` returns 200 → full functionality works in containers.

---

## Phase 8: Tests

**Purpose**: Unit and integration test coverage for core services and routes.

- [ ] T039 [P] Create test fixtures in `tests/fixtures/mock-products.ts` — shared ProductCard and ProductDetail test data
- [ ] T040 [P] Write unit tests for env validation in `tests/unit/lib/env.test.ts` — valid env passes, missing required vars throws, defaults apply for optional vars
- [ ] T041 [P] Write unit tests for MockProductService in `tests/unit/services/mock-product-service.test.ts` — search returns products, getDetails returns detail, respects latency simulation
- [ ] T042 [P] Write unit tests for ChatSessionService in `tests/unit/services/chat-session-service.test.ts` — CRUD operations with Effect test layers (Layer.succeed for DB mock), typed errors for not-found cases
- [ ] T043 [P] Write unit tests for CacheService in `tests/unit/services/cache-service.test.ts` — get/set/del operations with mock ioredis, typed errors on failure
- [ ] T044 [P] Write integration test for health endpoint in `tests/integration/health.test.ts` — returns 200 with correct service status shape
- [ ] T045 Write integration test for chat endpoint in `tests/integration/chat.test.ts` — sends message, receives SSE stream, tool invocations present for product queries
- [ ] T046 Write integration test for session CRUD in `tests/integration/sessions.test.ts` — create, list, get with messages, rename, delete, cascade delete messages, 401 without auth

**Checkpoint**: `bun test` → all tests pass. Zero untyped catches in service layer (SC-005).

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, documentation, cleanup.

- [ ] T047 [P] Verify all source files under 200 lines (SC-006) — run line count check across `src/`
- [ ] T048 [P] Verify PRODUCT_SERVICE env var switch works without code changes (SC-007) — test mock ↔ scraping toggle
- [ ] T049 [P] Verify all error responses return `{ error, code }` shape (SC-008) — test validation errors, auth errors, not-found errors
- [ ] T050 Run quickstart.md validation — fresh clone → bun install → configure .env → docker compose up → health check → create session → send chat → verify end-to-end (SC-001: under 5 minutes)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US1)**: Depends on Phase 2 — runs migrations, verifies boot
- **Phase 4 (US2)**: Depends on Phase 2 — can start in parallel with US1 after T018
- **Phase 5 (US3)**: Depends on Phase 4 (US2) — integrates with chat route
- **Phase 6 (US4)**: Depends on Phase 2 — can start in parallel with US2/US3
- **Phase 7 (Docker)**: Depends on all user stories — containerizes full app
- **Phase 8 (Tests)**: Depends on all user stories — tests full functionality
- **Phase 9 (Polish)**: Depends on Phases 7 + 8

### User Story Dependencies

- **US1 (P1)**: After Phase 2 → run migrations, verify boot. No other story dependency.
- **US2 (P2)**: After Phase 2 → standalone chat endpoint. No US1 dependency (session optional).
- **US3 (P3)**: After US2 → integrates session management into chat route.
- **US4 (P4)**: After Phase 2 → standalone scraping service. No US2/US3 dependency.

### Within Each User Story

- Types/models before services
- Services before routes
- Core implementation before integration
- Story complete before dependent stories

### Parallel Opportunities

**Phase 2 parallelism** (6 tasks can run simultaneously):
- T006 (logger), T007 (errors), T008 (types), T010 (chat_sessions schema), T011 (chat_messages schema), T015 (error handler), T016 (cache service)

**Cross-story parallelism** (after Phase 2):
- US2 and US4 can be developed in parallel (both depend only on Phase 2)
- US1 is a verification phase, not blocking US2

**Phase 8 parallelism** (5 unit tests can run simultaneously):
- T039, T040, T041, T042, T043 are all independent

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Launch all independent foundational tasks together:
Task: "Implement Pino structured JSON logger in src/lib/logger.ts"
Task: "Define all Effect tagged error types in src/lib/errors.ts"
Task: "Define TypeScript types in src/types/product.ts"
Task: "Define chat_sessions Drizzle schema in src/db/schema/chat-sessions.ts"
Task: "Define chat_messages Drizzle schema in src/db/schema/chat-messages.ts"
Task: "Implement Effect error-to-HTTP mapper in src/middleware/error-handler.ts"
Task: "Implement CacheService Effect service in src/services/cache-service.ts"
```

## Parallel Example: User Story 2

```bash
# Launch independent US2 tasks together:
Task: "Implement ProductService Effect interface in src/services/product-service.ts"
Task: "Implement MockProductService in src/services/mock-product-service.ts"
Task: "Write shopping concierge system prompt in src/lib/chat-system-prompt.ts"
# Then sequentially:
Task: "Define AI SDK tool schemas in src/services/product-tools.ts" (depends on ProductService)
Task: "Implement POST /api/chat route in src/routes/chat.ts" (depends on tools + prompt)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 (run migrations, verify boot)
4. **STOP and VALIDATE**: `bun run dev` → `GET /health` → 200

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 → Verify boot → **MVP!**
3. Add US2 → Chat works with mock products → **Core value!**
4. Add US3 → Sessions persist, auto-title → **Full UX!**
5. Add US4 → Real product data → **Production-ready!**
6. Docker + Tests + Polish → **Ship it!**

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- All files MUST be kebab-case and under 200 lines (constitution V)
- Effect typed errors everywhere — no thrown exceptions in services (constitution I)
