# ADR-0002: Backend Services Stack — Hono + Drizzle + Effect on Bun

**Status:** accepted
**Date:** 2026-03-12
**Last updated:** 2026-03-12

This ADR formalizes the backend services stack decisions, separating backend concerns from the Next.js frontend layer. Four new technology choices plus two continuations (Zod, PostgreSQL) define how backend services are built, composed, and deployed.

---

## Decision 1: Bun Runtime

**Chose:** Bun over Node.js, Deno
**Rationale:** Faster startup, native TypeScript execution without build step, built-in test runner, significantly faster package installs. Pairs naturally with Hono and the modern TypeScript-first tooling in this stack.

### Alternatives Considered

| Alternative | Benefits | Drawbacks | Why Rejected |
|-------------|----------|-----------|--------------|
| **Node.js** | Mature ecosystem, universal hosting support, battle-tested in production | Slower startup, requires TS compilation step, slower `npm install` | Performance gap matters for service cold starts; TS compilation adds friction |
| **Deno** | Strong security model (permissions), built-in TS, standard library | Smaller ecosystem for this stack, npm compat still evolving, fewer Hono deployment examples | Bun has better Hono integration and larger community momentum for this combination |

### Consequences

- All backend services run on Bun — `bun run`, `bun test`, `bun install`
- Some Node.js-specific packages may need compatibility checks
- Docker images use `oven/bun` base image instead of `node`
- Frontend (Next.js) remains on Node.js — Bun is backend-only

---

## Decision 2: Hono HTTP Framework

**Chose:** Hono over Next.js API routes, Express, Fastify, Elysia
**Rationale:** Lightweight (~14KB), ultrafast routing, middleware-first design, native Bun support, built-in Zod validation via `@hono/zod-validator`. Decouples backend services from Next.js frontend deployment, enabling independent scaling and deployment.

### Coexistence with Next.js

Next.js and Hono serve distinct roles:

| Concern | Handler | Why |
|---------|---------|-----|
| SSR / static pages | Next.js | App Router, React Server Components |
| Chat UI streaming | Next.js `POST /api/chat` | Vercel AI SDK `toUIMessageStreamResponse()` tightly coupled to Next.js response handling (see ADR-0001) |
| Auth service | Hono | Standalone service, no SSR dependency |
| Order/cart management | Hono | Business logic services, independent deployment |
| Product/scraping integration | Hono | Backend service calling external scraping API (ADR-0001 Decision 2) |

Frontend calls Hono APIs via typed client (`hc<AppType>`) or standard fetch.

### Alternatives Considered

| Alternative | Benefits | Drawbacks | Why Rejected |
|-------------|----------|-----------|--------------|
| **Next.js API routes** | Zero additional infrastructure, same deployment | Couples backend to Vercel, mixes frontend/backend concerns, no middleware composition, cold starts on serverless | Can't scale backend independently; business logic shouldn't live in a frontend framework |
| **Express** | Largest ecosystem, most tutorials, universal familiarity | No native TS support, legacy middleware pattern, slower than alternatives, no built-in validation | Legacy architecture; Hono does everything Express does but faster and type-safe |
| **Fastify** | Good performance, schema validation, plugin system | Heavier than Hono, less Bun-native, more boilerplate for middleware chains | Good option but Hono is lighter and has better Bun/edge support |
| **Elysia** | Bun-native, excellent performance, end-to-end type safety | Smaller community than Hono, less middleware ecosystem, tighter Bun coupling limits portability | Community size and middleware ecosystem tip the balance toward Hono |

### Consequences

- Two deployable units: Next.js frontend (Vercel) + Hono backend (Bun on Docker/VPS/Fly.io)
- Backend services are independently scalable and testable
- CORS configuration needed between frontend and backend origins
- Chat API route stays in Next.js for Vercel AI SDK compatibility (ADR-0001 constraint)

---

## Decision 3: Drizzle ORM

**Chose:** Drizzle over Prisma, Kysely, raw SQL
**Rationale:** SQL-first approach — writes type-safe TypeScript that maps directly to SQL, no query abstraction layer. Minimal runtime overhead (no engine binary like Prisma), schema-as-code with push/migrate workflows, excellent PostgreSQL support including JSON operators. Pairs well with Bun's fast startup (no Prisma engine to load).

### Alternatives Considered

| Alternative | Benefits | Drawbacks | Why Rejected |
|-------------|----------|-----------|--------------|
| **Prisma** | Largest ORM ecosystem, great DX for simple queries, Prisma Studio | Heavy runtime engine (~5-15MB), slower queries (query engine overhead), code generation step, struggles with complex SQL | Runtime weight contradicts Bun's fast-startup philosophy; query engine adds latency |
| **Kysely** | Type-safe query builder, lightweight, composable | Less ORM features (no schema migrations, no relations API), manual migration setup | Good query builder but Drizzle offers migrations + relations + query builder in one |
| **Raw SQL** | Full control, no abstraction overhead | No type safety, manual migration management, SQL injection risk if misused, maintenance burden | Type safety is non-negotiable for a service layer handling orders and payments |

### Consequences

- Database schema defined in TypeScript (`drizzle/schema.ts`), migrations via `drizzle-kit`
- Replaces the previously unspecified ORM mentioned in project docs
- All database queries are type-safe at compile time
- Complex queries map closely to SQL — team members reading Drizzle code can reason about the generated SQL
- PostgreSQL-specific features (JSONB, arrays, enums) are first-class in Drizzle

---

## Decision 4: Effect for Service Composition

**Chose:** Effect over manual try/catch, fp-ts, neverthrow
**Rationale:** Typed error channels (`Effect<Success, Error, Requirements>`) make failure modes explicit in function signatures. Dependency injection via Layers/Services enables testable service boundaries without class hierarchies or DI containers. Structured concurrency for parallel service calls (e.g., fetch product + check inventory). Composable pipelines replace nested try/catch chains.

### Trade-off Acknowledgment

Effect has a steep learning curve and smaller community compared to standard TypeScript patterns. This is accepted because:
- Service layer reliability justifies the investment — order processing and payment flows need explicit error handling
- DI via Layers makes services independently testable without mocks-everywhere patterns
- Team ramp-up cost is front-loaded; productivity increases as patterns become familiar

### Alternatives Considered

| Alternative | Benefits | Drawbacks | Why Rejected |
|-------------|----------|-----------|--------------|
| **Manual try/catch** | Zero learning curve, universal understanding | No typed errors (catch is `unknown`), DI is ad-hoc (globals or parameter threading), no structured concurrency | Error handling quality degrades as codebase grows; refactoring DI becomes painful |
| **fp-ts** | Similar functional concepts, established in FP-TS community | Effectively abandoned/unmaintained, verbose syntax, no DI/service layer, steep learning curve without the payoff | Same learning cost as Effect but less capability and no active maintenance |
| **neverthrow** | Simple `Result<T, E>` type, low learning curve | Result type only — no DI, no services, no concurrency, no layers | Solves typed errors but nothing else; still need separate DI and concurrency solutions |

### Consequences

- Service definitions use `Effect.Service` pattern — each service (Auth, Order, Cart, Product) is an Effect service with typed dependencies
- Error types are explicit: `OrderNotFound`, `InsufficientStock`, `PaymentFailed` — not string messages
- Testing uses `Layer.succeed()` to provide mock implementations without test frameworks' mock utilities
- New team members need onboarding on Effect patterns — document common patterns in codebase

---

## Continuation: Zod (Validation Layer)

**Status:** Already in use — formalized as standard

Zod is already adopted for tool parameter schemas in `chat-component-spec.md` (ADR-0001). This ADR formalizes Zod as the validation layer across all backend services:

- **Request validation:** Hono middleware via `@hono/zod-validator`
- **Environment parsing:** `z.object()` schemas for env vars at startup
- **Config schemas:** Type-safe configuration objects
- **API contracts:** Shared Zod schemas define request/response types between frontend and backend

No alternatives evaluation needed — Zod is already adopted and no competing option offers better Hono integration.

---

## Continuation: PostgreSQL (Database)

**Status:** Already chosen — no change

PostgreSQL remains the primary database. The only change is the access pattern: queries now go through Drizzle ORM instead of an unspecified ORM. Redis continues to serve caching and session needs as specified in existing project docs.

---

## Architecture Overview

```
┌─────────────────────────────┐     ┌──────────────────────────────────┐
│  Next.js Frontend (Vercel)  │     │  Hono Backend (Bun Runtime)      │
│                             │     │                                  │
│  - SSR / Static pages       │     │  - REST API services             │
│  - Chat UI (useChat)        │     │  - Auth service (Effect)         │
│  - POST /api/chat (AI SDK)  │────>│  - Order service (Effect)        │
│                             │     │  - Cart service (Effect)         │
│                             │     │  - Product/Scraping service      │
└─────────────────────────────┘     │                                  │
                                    │  Zod ──> Request validation      │
                                    │  Drizzle ORM ──> PostgreSQL      │
                                    │  Effect (DI, typed errors,       │
                                    │          structured concurrency) │
                                    └──────────────────────────────────┘
```

**Request flow (e.g., order creation):**
1. Frontend sends POST to Hono backend with order data
2. `@hono/zod-validator` validates request body against Zod schema
3. Hono route handler calls `OrderService` (Effect service)
4. Effect pipeline: validate stock → create order → process payment → send confirmation
5. Each step has typed errors — `InsufficientStock | PaymentFailed | OrderCreationError`
6. Drizzle executes type-safe SQL against PostgreSQL
7. Typed response returned to frontend

**Chat flow (unchanged from ADR-0001):**
1. Frontend sends POST to Next.js `/api/chat`
2. ReAct agent streams response via SSE
3. Agent tools call Hono backend services (product search, order management) as needed

---

## Related Documents

| Document | Path | Relevance |
|----------|------|-----------|
| ADR-0001 | `docs/adrs/0001-react-agent-architecture.md` | Agent architecture; chat API route stays in Next.js |
| Chat Component Spec | `docs/chat-component-spec.md` | Zod tool schemas, streaming integration |
| System Architecture | `docs/system-architecture.md` | High-level system design context |
| Project Overview PDR | `docs/project-overview-pdr.md` | Product requirements and data models |
