# Implementation Plan: ReAct Chat Agents Codebase Setup with DDD

**Branch**: `002-react-agents-ddd-setup` | **Date**: 2026-03-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-react-agents-ddd-setup/spec.md`

## Summary

Set up a production-ready backend codebase for a ReAct chat agent (AI shopping assistant) using Bun + Hono + Drizzle ORM + Effect with domain-driven design. Includes Redis caching, Docker multi-stage builds, database migrations, structured JSON logging, and stub authentication. The ReAct agent streams responses via SSE using Vercel AI SDK with tool-augmented product search.

## Technical Context

**Language/Version**: TypeScript (native execution on Bun 1.x+, no build step for dev)
**Primary Dependencies**: Hono ^4.x, Drizzle ORM ^0.3x, Effect ^3.x, Vercel AI SDK ^5.x, @ai-sdk/openai ^1.x, Zod ^3.x, ioredis, Pino
**Storage**: PostgreSQL (postgres.js ^3.x driver), Redis standalone (ioredis)
**Testing**: Bun test runner (`bun test`)
**Target Platform**: Bun runtime on Docker (oven/bun:1.1-alpine), deployable to VPS/Fly.io
**Project Type**: Web service (REST API + SSE streaming)
**Performance Goals**: First SSE token within 2 seconds (mock service), health check < 50ms
**Constraints**: All files < 200 lines, kebab-case naming, Effect typed errors only (no thrown exceptions in services)
**Scale/Scope**: Single developer setup, 25 functional requirements, ~20 source files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Effect-First Error Handling | PASS | All services use Effect typed errors per FR-017. Error types defined in data-model.md |
| II. Streaming-Native Responses | PASS | SSE via `toUIMessageStreamResponse()` per FR-004, FR-005 |
| III. Provider-Swappable Services | PASS | ProductService via Effect layers, env var switch per FR-007, FR-020 |
| IV. Session-Scoped Context | PASS | Per-session messages, no cross-session memory per FR-013, FR-015 |
| V. Simplicity & File Discipline | PASS | All files < 200 lines, kebab-case per FR-024 |
| Technology Constraints | PASS | All technologies match constitution table. Redis (ioredis) and Pino are additions — not prohibited by constitution (only Express/Fastify/Prisma/tRPC are). |
| Development Workflow | PASS | Conventional commits, linting, no secrets in code |

**Post-design re-check**: PASS — Redis CacheService follows same Effect service pattern as ProductService. Docker and migrations are infrastructure, not stack additions.

## Project Structure

### Documentation (this feature)

```text
specs/002-react-agents-ddd-setup/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0: technology research
├── data-model.md        # Phase 1: entity definitions
├── quickstart.md        # Phase 1: developer onboarding
├── contracts/
│   └── api-endpoints.md # Phase 1: API contract definitions
└── tasks.md             # Phase 2: task breakdown (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── index.ts                          # Bun + Hono server entry point, layer composition
├── routes/
│   ├── chat.ts                       # POST /api/chat — ReAct streaming handler
│   ├── sessions.ts                   # /api/sessions/* — CRUD routes
│   └── health.ts                     # GET /health — readiness check
├── services/
│   ├── product-service.ts            # ProductService Effect service definition (interface + tag)
│   ├── mock-product-service.ts       # Mock implementation (dev/test)
│   ├── scraping-product-service.ts   # External scraping service (production)
│   ├── product-tools.ts              # AI SDK tool definitions (searchProducts, getProductDetails)
│   ├── chat-session-service.ts       # ChatSessionService Effect service
│   └── cache-service.ts             # CacheService Effect service (Redis)
├── db/
│   ├── client.ts                     # Drizzle client init + postgres.js connection
│   ├── migrate.ts                    # Programmatic migration runner
│   ├── schema/
│   │   ├── chat-sessions.ts          # chat_sessions table schema
│   │   └── chat-messages.ts          # chat_messages table schema
│   └── migrations/                   # Generated SQL migration files
│       └── meta/                     # drizzle-kit migration metadata
├── types/
│   └── product.ts                    # Product, search, and session types
├── lib/
│   ├── chat-system-prompt.ts         # System prompt string
│   ├── errors.ts                     # Effect error type definitions
│   ├── logger.ts                     # Pino structured JSON logger
│   └── env.ts                        # Zod env validation
├── middleware/
│   ├── auth.ts                       # Stub bearer token auth
│   ├── rate-limit.ts                 # Rate limiting middleware
│   └── error-handler.ts              # Global Effect error → HTTP response mapper

tests/
├── unit/
│   ├── services/
│   │   ├── mock-product-service.test.ts
│   │   ├── chat-session-service.test.ts
│   │   └── cache-service.test.ts
│   └── lib/
│       └── env.test.ts
├── integration/
│   ├── chat.test.ts
│   ├── sessions.test.ts
│   └── health.test.ts
└── fixtures/
    └── mock-products.ts

# Root config files
Dockerfile                            # 3-stage multi-stage build
Dockerfile.migrations                 # Migration runner container
docker-compose.yml                    # PostgreSQL + Redis + migrations + app
.dockerignore                         # Build context optimization
drizzle.config.ts                     # Drizzle-kit configuration
.env.example                          # Environment template
tsconfig.json                         # TypeScript configuration
package.json                          # Dependencies and scripts
```

**Structure Decision**: Single backend service with DDD layered architecture. Routes (presentation) → Services (domain/Effect) → DB/Cache (infrastructure). Frontend is a separate deployable unit (out of scope). File structure follows the chat API spec (`docs/ecommerce-agent-chat-service.md`) with additions for cache, Docker, and migrations.

## Implementation Phases

### Phase 1: Foundation — Server + DB + Config (P1 — User Story 1)

**Goal**: Bootable Hono server on Bun with Drizzle + PostgreSQL, Effect DI wiring, structured logging, env validation, health endpoint.

**Files to create**:
1. `package.json` — dependencies, scripts (`dev`, `start`, `test`, `db:generate`, `db:migrate`)
2. `tsconfig.json` — strict mode, Bun types
3. `.env.example` — all env vars documented
4. `src/lib/env.ts` — Zod schema for env validation, fail-fast at startup
5. `src/lib/logger.ts` — Pino logger with JSON output, service name, requestId
6. `src/lib/errors.ts` — All Effect tagged error types (ProductNotFound, SessionNotFound, etc.)
7. `src/db/client.ts` — Drizzle client init with postgres.js (`max: 20`), migration client (`max: 1`)
8. `src/db/schema/chat-sessions.ts` — Drizzle table definition with indexes
9. `src/db/schema/chat-messages.ts` — Drizzle table definition with JSONB content, indexes
10. `src/db/migrate.ts` — Programmatic migration runner
11. `drizzle.config.ts` — Drizzle-kit config (postgres.js driver, migration dir)
12. `src/types/product.ts` — ProductCard, ProductDetail, ProductSearchParams, ProductSearchResult, ColorOption
13. `src/middleware/auth.ts` — Stub bearer token validation, userId injection
14. `src/middleware/error-handler.ts` — Effect error → HTTP status code mapper
15. `src/routes/health.ts` — GET /health checking DB + Redis connectivity
16. `src/services/cache-service.ts` — CacheService Effect service (ioredis, get/set/del/health)
17. `src/index.ts` — Hono app creation, middleware chain, route mounting, Effect layer composition, server start

**Verification**: `bun run dev` → server starts → `GET /health` returns 200 with service status

**Dependencies**: None (first phase)

---

### Phase 2: ReAct Chat Agent — Streaming + Tools (P2 — User Story 2)

**Goal**: Working chat endpoint with ReAct agent, tool definitions, streaming SSE, mock product service.

**Files to create**:
1. `src/services/product-service.ts` — ProductService Effect service interface (Context.Tag)
2. `src/services/mock-product-service.ts` — Mock implementation with hardcoded products, simulated 300-800ms latency
3. `src/services/product-tools.ts` — AI SDK tool definitions (searchProducts, getProductDetails) with Zod schemas and Effect-based execute handlers
4. `src/lib/chat-system-prompt.ts` — Shopping concierge system prompt (clarify before searching, use preferences, markdown formatting, 3-5 products)
5. `src/routes/chat.ts` — POST /api/chat handler: validate session, convertToModelMessages, streamText with tools + stepCountIs(3), persist messages, toUIMessageStreamResponse()

**Verification**: `curl -N POST /api/chat` with "find me running shoes" → SSE stream with text tokens + tool-invocation events

**Dependencies**: Phase 1 (server, DB, errors, types, middleware)

---

### Phase 3: Session Management — CRUD + Auto-Title (P3 — User Story 3)

**Goal**: Full session CRUD, message persistence, auto-titling.

**Files to create**:
1. `src/services/chat-session-service.ts` — ChatSessionService Effect service (create, list, getWithMessages, rename, delete, addMessage, autoTitle)
2. `src/routes/sessions.ts` — Session CRUD routes with Zod validation
3. `src/middleware/rate-limit.ts` — Simple in-memory rate limiter (30 req/min per user)

**Updates**:
- `src/routes/chat.ts` — Integrate session resolution (auto-create if no sessionId), message persistence via ChatSessionService, auto-title after first exchange
- `src/index.ts` — Mount session routes, add rate-limit middleware

**Verification**: Create session → send chat messages → list sessions → verify messages persisted → verify auto-title generated

**Dependencies**: Phase 1, Phase 2 (chat handler to integrate with sessions)

---

### Phase 4: Scraping Service + Resilience (P4 — User Story 4)

**Goal**: Production product data via external scraping service with retry/circuit-breaker.

**Files to create**:
1. `src/services/scraping-product-service.ts` — ScrapingProductService Effect implementation: API call, response mapping to internal types, retry logic, circuit breaker, fallback to cached results via CacheService

**Updates**:
- `src/index.ts` — Add scraping service layer to Effect composition, switch based on PRODUCT_SERVICE env var

**Verification**: Set `PRODUCT_SERVICE=scraping` → chat query returns real Amazon product data → kill scraping service → verify graceful fallback

**Dependencies**: Phase 1 (cache service), Phase 2 (product service interface)

---

### Phase 5: Docker + Migrations + Production Readiness

**Goal**: Containerized deployment with multi-stage build, migration automation.

**Files to create**:
1. `Dockerfile` — 3-stage build: deps (install) → build (compile with `bun build --compile --minify`) → runtime (alpine, non-root, health check)
2. `Dockerfile.migrations` — Separate migration container
3. `docker-compose.yml` — PostgreSQL + Redis + migrations + app with health checks, volume persistence, proper `depends_on` conditions
4. `.dockerignore` — Exclude node_modules, .git, specs/, docs/, tests/

**Verification**: `docker compose up` → all services healthy → `curl /health` returns 200 → create session + send chat → verify persistence across container restart

**Dependencies**: All previous phases (full app must be functional)

---

### Phase 6: Tests

**Goal**: Unit and integration test coverage for core services and routes.

**Files to create**:
1. `tests/fixtures/mock-products.ts` — Shared test product data
2. `tests/unit/services/mock-product-service.test.ts` — MockProductService returns correct data
3. `tests/unit/services/chat-session-service.test.ts` — Session CRUD operations with Effect test layers
4. `tests/unit/services/cache-service.test.ts` — Cache get/set/del with mock Redis
5. `tests/unit/lib/env.test.ts` — Env validation passes/fails correctly
6. `tests/integration/health.test.ts` — Health endpoint returns correct status
7. `tests/integration/chat.test.ts` — Chat endpoint streams SSE with tool invocations
8. `tests/integration/sessions.test.ts` — Session CRUD + message persistence

**Verification**: `bun test` → all tests pass, zero untyped catches in service layer

**Dependencies**: All previous phases

## Complexity Tracking

No constitution violations. Redis and Pino are new dependencies but don't conflict with any prohibited technologies (Express, Fastify, Prisma, tRPC).

| Addition | Why Needed | Constitution Alignment |
|----------|------------|----------------------|
| ioredis | User-requested caching layer for sessions + product search results | Not prohibited; follows Effect service pattern (CacheService) |
| Pino | Structured JSON logging per clarification | Not prohibited; replaces console.log per FR-025 |
| Docker | User-requested production deployment | Infrastructure, not a framework |
