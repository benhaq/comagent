# Research: ReAct Chat Agents Codebase Setup with DDD

**Branch**: `002-react-agents-ddd-setup` | **Date**: 2026-03-12

## Decision 1: Runtime & HTTP Framework

**Decision**: Bun runtime + Hono HTTP framework
**Rationale**: Per ADR-0002. Bun provides native TS execution, fast startup, built-in test runner. Hono is lightweight (~14KB), ultrafast routing, middleware-first, native Bun support, built-in Zod validation via `@hono/zod-validator`.

## Decision 2: ORM & Database

**Decision**: Drizzle ORM with postgres.js driver on PostgreSQL
**Rationale**: Per ADR-0002. SQL-first type-safe queries, minimal runtime overhead, schema-as-code with push/migrate workflows.
**Key findings**:
- postgres.js works well on Bun via `drizzle-orm/postgres-js`
- Connection pool: `max: 20`, `idle_timeout: 30` for main client
- Migration client MUST use `max: 1` to avoid deadlocks
- Use `drizzle-kit generate` (not `push`) for production migrations
- Migrations stored in `src/db/migrations/` directory
**Alternatives considered**: Prisma (heavy engine, slower startup), Kysely (no migrations/relations), raw SQL (no type safety).

## Decision 3: Service Layer & DI

**Decision**: Effect for typed errors, DI via Layers/Services, structured concurrency
**Rationale**: Per ADR-0002. Typed error channels make failure modes explicit. DI via Layers enables testable service boundaries without class hierarchies.
**Key findings**:
- Service pattern: `Context.Tag` → `Layer.succeed/effect` → `Effect.provide`
- Effect services compose via `Layer.merge()` at startup
- Hono route handlers run effects with `Effect.runPromise()`
- Errors wrapped in `Data.TaggedError` classes
- Testing uses `Layer.succeed()` for mock implementations
- Learning curve is steep but front-loaded
**Alternatives considered**: Manual try/catch (no typed errors), fp-ts (abandoned), neverthrow (Result type only).

## Decision 4: Streaming & AI SDK

**Decision**: Vercel AI SDK `streamText` + `toUIMessageStreamResponse()` for SSE
**Rationale**: Per ADR-0001. Native ReAct pattern implementation with tool definitions and step counting.
**Key findings**:
- CRITICAL: Must call `toUIMessageStreamResponse()` on streamText result — raw stream incompatible with frontend AI SDK
- Tool definitions use Zod schemas with `execute` async handlers
- `stepCountIs(3)` caps tool-call chains per ADR-0001
- Response must be wrapped in `new Response()` with SSE headers for Hono
- Tool invocations stream as discrete events (call → result)
**Alternatives considered**: WebSocket (over-engineered for this), HTTP long polling (poor UX for streaming), batch response (terrible UX).

## Decision 5: Validation Layer

**Decision**: Zod with `@hono/zod-validator` middleware
**Rationale**: Per ADR-0002 continuation. Already adopted for tool parameter schemas.
**Key findings**:
- `zValidator('json', schema)` middleware validates request body inline
- `c.req.valid('json')` returns type-safe validated data
- Supports multiple targets: json, query, header, param, cookie, form
- Custom error responses via callback second parameter
**Alternatives considered**: None — Zod is already standardized.

## Decision 6: Structured Logging

**Decision**: Pino for structured JSON logging
**Rationale**: Per clarification session. Lightweight, outputs NDJSON by default, works well on Bun.
**Key findings**:
- Pino outputs structured JSON natively (no configuration needed for JSON format)
- `pino-pretty` for development (colorized human-readable output)
- HTTP request logging via middleware (method, path, status, duration_ms)
- Consistent fields: timestamp, level, service name, requestId
- Effect also has `Logger.structured` but Pino is more battle-tested
**Alternatives considered**: console.log (unstructured), consola (less JSON-native), Effect Logger (less ecosystem support).

## Decision 7: Redis Cache

**Decision**: ioredis client, standalone mode, wrapped in Effect CacheService
**Rationale**: User requirement for caching layer. ioredis is mature, proven, stable for self-hosted Redis.
**Key findings**:
- ioredis is the recommended client for self-hosted standalone Redis on Bun
- CacheService as Effect service with typed errors (CacheError, CacheNotFound)
- Operations: get, set (with TTL), delete, health check
- Standalone configuration (no cluster, no sentinel)
- Connect at startup, health check endpoint, graceful shutdown
- Main pool: `maxRetriesPerRequest: 3`, `lazyConnect: true`
**Alternatives considered**: @upstash/redis (serverless-oriented), Bun native client (experimental).

## Decision 8: Docker Multi-Stage Build

**Decision**: 3-stage Dockerfile using `oven/bun:1.1-alpine` base image
**Rationale**: User requirement for production optimization.
**Key findings**:
- Stage 1 (deps): Install dependencies only (cached layer)
- Stage 2 (build): Bundle/compile with `bun build --compile --minify`
- Stage 3 (runtime): Alpine base, non-root user (bun:bun), health check
- Final image size: 80-120 MB (vs 150+ MB with Node)
- Docker Compose for local dev: App + PostgreSQL + Redis with health checks
- Migrations run as separate Docker Compose service with `service_completed_successfully` condition
- `.dockerignore` reduces build context by ~95%
**Alternatives considered**: Single-stage (large image), Node.js base image (slower, larger).

## Decision 9: Database Migrations

**Decision**: drizzle-kit CLI for migration generation and application
**Rationale**: User requirement. Drizzle-kit is the native migration tool for Drizzle ORM.
**Key findings**:
- `drizzle.config.ts` configures PostgreSQL connection, migration directory, schema location
- `bunx drizzle-kit generate` creates SQL migration files from schema diffs
- `bunx drizzle-kit migrate` applies pending migrations
- Migration client MUST use separate connection with `max: 1`
- In Docker: separate migration container runs before app starts
- For development: migrations can run programmatically at app startup via `migrate()` function
- Migration files stored in `src/db/migrations/` with `meta/` directory for tracking
**Alternatives considered**: Manual SQL files (error-prone), Prisma migrate (wrong ORM), knex (separate tool).

## Unresolved Questions (Deferred to Implementation)

1. **Single global Effect runtime vs per-request?** — Start with per-request `Effect.runPromise()` in Hono handlers; optimize to global runtime if needed.
2. **Drizzle cache interaction with postgres.js pooling?** — Let postgres.js handle connection pooling; Drizzle adds no caching layer.
3. **Partial tool execution in streamText?** — `stepCountIs(3)` handles this; partial results stream as they complete.
4. **Redis key naming convention?** — Use `{entity}:{id}` pattern (e.g., `session:abc123`, `products:query:hash`).
5. **Migration in CI/CD?** — Run migrations as separate step before deployment; not in-scope for initial setup.
