<!--
=== Sync Impact Report ===
Version change: 0.0.0 (template) → 1.0.0
Modified principles: N/A (initial population)
Added sections:
  - 5 Core Principles (Effect-First, Streaming-Native, Provider-Swappable,
    Session-Scoped Context, Simplicity & File Discipline)
  - Technology Constraints
  - Development Workflow
  - Governance
Removed sections: None
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no update needed (Constitution Check
    is generic, filled at plan time)
  - .specify/templates/spec-template.md ✅ no update needed
  - .specify/templates/tasks-template.md ✅ no update needed
Follow-up TODOs: None
-->

# ComAgent Constitution

## Core Principles

### I. Effect-First Error Handling

All service-layer code MUST use Effect typed errors. Thrown exceptions
are prohibited in services. Every failure mode MUST be represented as a
tagged error type (`ProductNotFound`, `SessionNotFound`,
`ScrapingServiceUnavailable`, `AIServiceError`, `DatabaseError`,
`ValidationError`). Hono route handlers catch Effect failures and map
them to HTTP status codes. SSE stream errors use `onError` callback
from `toUIMessageStreamResponse()`.

**Rationale:** Typed errors make failure modes explicit, testable, and
self-documenting. No hidden exception paths.

### II. Streaming-Native Responses

The chat endpoint MUST stream responses via SSE using Vercel AI SDK's
`toUIMessageStreamResponse()`. The ReAct loop uses `streamText` +
`tool()` + `stepCountIs(3)` per ADR-0001. Frontend receives
`message.parts[]` containing text and tool-invocation parts.

**Rationale:** Token-by-token streaming is critical for perceived
latency in a conversational shopping UX. The 3-step cap prevents
runaway tool chains while allowing search-refine-detail flows.

### III. Provider-Swappable Services

`ProductService` MUST be an Effect service interface with swappable
providers resolved via Effect layers at startup (not per-request
factory). Provider selection uses `PRODUCT_SERVICE` env var:
- `mock` (default) — hardcoded products, simulated latency
- `scraping` — external Amazon scraping microservice
- `amazon` — future PA-API 5.0

New product data sources MUST implement the same `ProductService`
interface. No provider-specific logic may leak into route handlers.

**Rationale:** Decouples business logic from data source. Enables
local dev (mock), production (scraping), and future migration
(PA-API) without code changes.

### IV. Session-Scoped Context

Per ADR-0001 Decision 4: chat context is scoped to a single session.
Messages within a session are sent to the model; there is NO
cross-session memory. User preferences (sizes, etc.) are injected via
system prompt regardless of session. Sessions support full CRUD
(create, list, switch, rename, delete) with cascade-delete on
messages.

**Rationale:** Keeps prompt size bounded and predictable. Avoids
unbounded context accumulation across conversations.

### V. Simplicity & File Discipline

- All source files MUST be kebab-case and under 200 lines
- YAGNI: do not implement features not yet specified
- KISS: prefer the simplest solution that meets requirements
- DRY: extract shared logic only when used in 3+ places
- Tools are the extension point — new capabilities become new
  `tool()` definitions, not new agent architectures

**Rationale:** Small files improve LLM context management and code
review. Premature abstraction creates maintenance burden.

## Technology Constraints

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Bun | latest |
| HTTP | Hono | ^4.x |
| ORM | Drizzle ORM + drizzle-kit | ^0.3x |
| DB | PostgreSQL (postgres driver) | ^3.x |
| Service layer | Effect | ^3.x |
| AI SDK | Vercel AI SDK (`ai`) | ^5.x |
| LLM provider | @ai-sdk/openai (GPT-4o) | ^1.x |
| Validation | Zod | ^3.x |
| Frontend consumption | @ai-sdk/react `useChat` | — |

Stack changes require a new ADR. No additional frameworks (Express,
Fastify, Prisma, tRPC) may be introduced without documented
justification and constitution amendment.

## Development Workflow

- **Commits:** Conventional commit format. Run linting before commit,
  tests before push. Never commit secrets or dotenv files.
- **Code quality:** Functionality and readability over strict style.
  Syntax errors and non-compilable code are blocking defects.
- **Error handling:** Use try-catch at route boundaries; Effect typed
  errors in service layer. Cover OWASP top-10 security standards.
- **File structure:** Follow `src/` layout from the chat service spec
  (routes/, services/, db/, types/, lib/, middleware/).
- **Testing:** Tests MUST NOT be mocked to pass. Failed tests block
  push. Integration tests cover service contracts and session CRUD.
- **Implementation:** Always implement real code, never simulate or
  stub unless building a designated mock provider.

## Governance

This constitution is the highest-authority document for architectural
and process decisions. All PRs and code reviews MUST verify compliance
with these principles.

**Amendment procedure:**
1. Propose change via PR with rationale
2. Update constitution version per semver (MAJOR: principle
   removal/redefinition, MINOR: new principle/section, PATCH:
   clarifications)
3. Update Sync Impact Report at top of this file
4. Propagate changes to dependent templates and docs

**Compliance review:** Every implementation plan MUST include a
Constitution Check gate (see plan template). Violations MUST be
documented in the Complexity Tracking table with justification.

**Version**: 1.0.0 | **Ratified**: 2026-03-12 | **Last Amended**: 2026-03-12
