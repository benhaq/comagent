# Feature Specification: ReAct Chat Agents Codebase Setup with DDD

**Feature Branch**: `002-react-agents-ddd-setup`
**Created**: 2026-03-12
**Status**: Draft
**Input**: User description: "Setting up codebase for ReAct chat agents with domain driven design with the tech stacks specified in docs/adrs/0002-backend-services-stack.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Starts Backend Service (Priority: P1)

A developer clones the repository, runs `bun install`, and starts the Hono backend server on Bun. The server boots with health check endpoint responding, Drizzle ORM connected to PostgreSQL, and Effect services wired via dependency injection layers. The developer can verify the stack is operational without any external dependencies (mock product service is default).

**Why this priority**: Foundation for all other work. Without a running server with DI wiring, no feature can be built or tested. This is the skeleton that everything else hangs on.

**Independent Test**: Can be fully tested by running `bun run dev`, hitting the health endpoint, and confirming a 200 response with service status. Delivers a bootable backend ready for feature development.

**Acceptance Scenarios**:

1. **Given** a fresh clone with `.env` configured (DATABASE_URL, PORT), **When** the developer runs `bun run dev`, **Then** the Hono server starts on the configured port and responds to `GET /health` with service readiness status
2. **Given** the server is running, **When** the developer inspects startup logs, **Then** logs confirm Drizzle connection to PostgreSQL and Effect service layers initialized
3. **Given** no PRODUCT_SERVICE env var is set, **When** the server starts, **Then** the mock product service is loaded by default

---

### User Story 2 - Developer Sends a Chat Message and Receives Streaming Response (Priority: P2)

A developer sends a POST request to the chat endpoint with a user message. The ReAct agent processes the message via GPT-4o, optionally calls tools (product search), and streams the response back via SSE. The developer sees tokens arriving incrementally and tool invocations with structured product data.

**Why this priority**: Validates the core ReAct agent loop — the primary value proposition. Without streaming chat, the product is just an empty API shell.

**Independent Test**: Can be tested by sending a `curl` POST to `/api/chat` with a message like "find me running shoes under $100" and observing SSE tokens and tool-invocation events in the response stream. Delivers proof that the ReAct agent pattern works end-to-end.

**Acceptance Scenarios**:

1. **Given** the server is running with mock product service, **When** the developer sends a chat message, **Then** the response streams back as SSE with text parts arriving token-by-token
2. **Given** a user message requesting product search, **When** the ReAct agent decides to call `searchProducts`, **Then** the SSE stream includes tool-invocation parts with state transitions (call -> result) containing structured product data
3. **Given** a multi-step conversation, **When** the agent reasons it needs more info, **Then** it asks clarifying questions instead of immediately calling tools

---

### User Story 3 - Developer Manages Chat Sessions (Priority: P3)

A developer creates, lists, retrieves, renames, and deletes chat sessions via REST endpoints. Sessions persist to PostgreSQL via Drizzle ORM, and messages within a session are stored and retrievable. Session auto-titling generates a short summary after the first exchange.

**Why this priority**: Multi-session support is essential for a ChatGPT-like UX, but the core chat functionality (P2) must work first. Sessions add persistence and organization on top of the working agent.

**Independent Test**: Can be tested by creating a session via `POST /api/sessions`, sending chat messages to it, listing sessions, and verifying messages persist and sessions are titled. Delivers full CRUD session management.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they POST to `/api/sessions`, **Then** a new session is created and returned with id and timestamps
2. **Given** a session with chat messages, **When** the user GETs `/api/sessions/:id`, **Then** the session is returned with all associated messages ordered chronologically
3. **Given** a session with its first exchange complete, **When** auto-titling runs, **Then** the session title is updated to a concise summary (50 chars or less) of the conversation topic

---

### User Story 4 - Developer Integrates External Product Scraping Service (Priority: P4)

A developer configures `PRODUCT_SERVICE=scraping` with scraping service URL and API key. The system switches from mock data to live Amazon product data via the external scraping microservice. The developer verifies real product results flow through the ReAct agent's tool calls.

**Why this priority**: Real product data is needed before shipping to users, but mock data suffices for all development and testing workflows. This is a deployment-readiness concern.

**Independent Test**: Can be tested by setting scraping env vars, sending a product search query via chat, and verifying real Amazon product data (ASINs, prices, images) appears in tool-invocation results. Delivers production-ready product search.

**Acceptance Scenarios**:

1. **Given** `PRODUCT_SERVICE=scraping` with valid credentials, **When** the agent calls `searchProducts`, **Then** real Amazon product data is returned mapped to internal ProductCard types
2. **Given** the scraping service is unavailable, **When** the agent calls `searchProducts`, **Then** the system falls back gracefully with a user-friendly error or cached results
3. **Given** the scraping API response schema changes in a minor way, **When** the mapping layer processes the response, **Then** it handles missing optional fields without crashing

---

### Edge Cases

- What happens when PostgreSQL is unreachable at startup? Server should fail fast with a clear error message, not hang.
- What happens when OpenAI API key is invalid or rate-limited? Chat endpoint should return a clear error, not expose internals.
- What happens when the ReAct agent exceeds 3 tool-call steps? The step limit should cap execution and return whatever results are available.
- What happens when a session is deleted while a chat stream is in progress? The stream should complete gracefully; the session deletion takes effect after.
- What happens when two concurrent requests hit the same session? Messages should be persisted in order without data corruption.
- What happens when the scraping service returns malformed data? The mapping layer should reject invalid responses with typed errors, not crash the server.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST start a Hono HTTP server on Bun runtime with configurable port
- **FR-002**: System MUST connect to PostgreSQL via Drizzle ORM at startup and verify connectivity
- **FR-003**: System MUST wire all services (ProductService, ChatSessionService) via Effect dependency injection layers at startup
- **FR-004**: System MUST expose a `POST /api/chat` endpoint that accepts messages and streams responses via SSE using Vercel AI SDK's `toUIMessageStreamResponse()`
- **FR-005**: System MUST implement the ReAct agent pattern via `streamText` with `tool()` definitions and `stepCountIs(3)` step limit
- **FR-006**: System MUST define `searchProducts` and `getProductDetails` tools with Zod-validated input schemas
- **FR-007**: System MUST implement `ProductService` as an Effect service with `search` and `getDetails` operations and typed error channels
- **FR-008**: System MUST provide a `MockProductService` implementation as default for development/testing with simulated latency (300-800ms)
- **FR-009**: System MUST provide a `ScrapingProductService` implementation that maps external scraping API responses to internal types
- **FR-010**: System MUST implement `ChatSessionService` as an Effect service with CRUD operations (create, list, getWithMessages, rename, delete, addMessage, autoTitle)
- **FR-011**: System MUST define Drizzle ORM schemas for `chat_sessions` and `chat_messages` tables with appropriate indexes
- **FR-012**: System MUST expose session CRUD endpoints: `POST /api/sessions`, `GET /api/sessions`, `GET /api/sessions/:id`, `PATCH /api/sessions/:id`, `DELETE /api/sessions/:id`
- **FR-013**: System MUST auto-create a session when `POST /api/chat` is called without a sessionId
- **FR-014**: System MUST auto-generate session titles from the first conversation exchange
- **FR-015**: System MUST persist user and assistant messages to the `chat_messages` table per session
- **FR-016**: System MUST validate all request bodies using Zod schemas via `@hono/zod-validator` middleware
- **FR-017**: System MUST use typed Effect errors (ProductNotFound, ScrapingServiceUnavailable, SessionNotFound, AIServiceError, DatabaseError, ValidationError) — no thrown exceptions in the service layer
- **FR-018**: System MUST return consistent error responses with `{ error, code }` shape, never exposing internal details
- **FR-019**: System MUST include a system prompt that instructs GPT-4o to act as a shopping concierge, clarify before searching, and use markdown formatting
- **FR-020**: System MUST select ProductService provider based on `PRODUCT_SERVICE` environment variable (mock, scraping, amazon) resolved via Effect layers at startup
- **FR-021**: System MUST validate required environment variables (OPENAI_API_KEY, DATABASE_URL) at startup using Zod and fail fast if missing
- **FR-022**: System MUST expose a `GET /health` endpoint returning service readiness status
- **FR-023**: System MUST organize code following domain-driven design with clear separation: routes (presentation), services (domain), db/schema (data), types (shared), lib (cross-cutting), middleware (infrastructure)
- **FR-024**: System MUST keep all source files under 200 lines using kebab-case naming
- **FR-025**: System MUST use structured JSON logging across all services with consistent fields (timestamp, level, service name, requestId) — no raw `console.log` in production code

### Key Entities

- **ChatSession**: A conversation thread belonging to a user. Key attributes: unique identifier, owner, title (auto-generated or user-set), creation and last-activity timestamps. A session contains an ordered sequence of messages.
- **ChatMessage**: A single message within a session. Key attributes: unique identifier, parent session, sender role (user/assistant/system), content stored as JSONB (entire `message.parts[]` array for all message types — text, tool-invocations, mixed), timestamp.
- **ProductCard**: A summary representation of a product returned from search. Key attributes: identifier, name, image, price, available sizes, colors, retailer, URL, rating, brand.
- **ProductDetail**: An extended product representation with full description, specifications, all images, and availability status. Extends ProductCard.
- **ProductSearchParams**: Criteria for searching products. Key attributes: query text, optional filters (category, price range, size, color), result limit.
- **ProductSearchResult**: Search response containing matched products, total count, and the query used.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can go from fresh clone to running server in under 5 minutes (install + configure + start)
- **SC-002**: The chat endpoint responds with first SSE token within 2 seconds of receiving a message (mock product service)
- **SC-003**: All 6 session CRUD operations complete successfully with correct data persistence verified via database query
- **SC-004**: The ReAct agent correctly calls tools in at least 80% of product-related queries (measured over 20 test queries with mock service)
- **SC-005**: All Effect service errors are typed — zero instances of untyped `catch(unknown)` in the service layer
- **SC-006**: The codebase passes linting with zero files exceeding 200 lines
- **SC-007**: Switching between mock and scraping product service requires only changing one environment variable — no code changes
- **SC-008**: All request validation errors return structured `{ error, code }` responses — no stack traces or internal details leak to clients

## Clarifications

### Session 2026-03-12

- Q: How should `chat_messages.content` store text and tool-invocation parts? → A: Always as JSONB — entire `message.parts[]` array serialized as JSON for all message types.
- Q: What does the auth stub do? → A: Fixed bearer token — middleware checks for a known static token in `Authorization` header, rejects requests without it. A hardcoded `userId` is associated with the valid token.
- Q: Should structured logging be part of the initial setup? → A: Yes — all services log via a shared structured JSON logger with consistent fields (timestamp, level, service, requestId).

## Assumptions

- PostgreSQL instance is available and accessible (local Docker or cloud-hosted)
- OpenAI API key with GPT-4o access is provided by the developer
- The external Amazon scraping microservice API contract matches the schema defined in ADR-0001 and the chat API spec
- Authentication middleware uses a fixed bearer token stub: middleware validates a known static token from the `Authorization` header and injects a hardcoded `userId` into request context. Requests without a valid token are rejected with 401. Full auth is a separate feature.
- Redis standalone instance is included in this setup for caching (session data, product search results). Runs alongside PostgreSQL in Docker Compose.
- The frontend (Next.js) is a separate deployable unit and not part of this codebase setup
- Bun version 1.x+ is installed on the developer's machine
