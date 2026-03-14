# Chat API Specification

## Document Information

| Field | Value |
|-------|-------|
| **Version** | 3.0 |
| **Date** | March 12, 2026 |
| **Status** | Draft |
| **Purpose** | Backend chat API spec — Hono routes, Effect services, Drizzle schema, chat sessions |

---

## 1. Overview

### 1.1 Purpose

Server-side chat API powering the AI shopping assistant. Built on **Bun + Hono + Drizzle ORM + Effect** with PostgreSQL persistence. Supports multi-session chat (create, list, switch, delete, rename) and streams responses via SSE using Vercel AI SDK's `toUIMessageStreamResponse()`. GPT-4o acts as a shopping concierge using the ReAct pattern (ADR-0001), calling tools to search products and return structured results.

### 1.2 Scope

This spec covers backend only:
- Hono route handlers — chat streaming, session CRUD
- Tool definitions (`searchProducts`, `getProductDetails`) with Zod schemas
- Effect service layer — `ProductService`, `ChatSessionService` with typed errors
- Drizzle ORM schema — `chat_sessions`, `chat_messages` tables
- System prompt requirements for shopping concierge behavior
- TypeScript type definitions for products, sessions, and search params
- Environment configuration for Bun runtime

**Out of scope:** All frontend components, UI rendering, state management, theme system, styling.

### 1.3 How Frontend Consumes This API

Frontend uses `useChat` from `@ai-sdk/react` pointed at `/api/chat`. The hook handles:
- Sending `UIMessage[]` to the API with a `sessionId` header/param
- Receiving SSE stream with text parts and tool-invocation parts
- Frontend renders `message.parts[]` — text via markdown, tool results as product cards

Session management endpoints (`/api/sessions/*`) are consumed via standard fetch/REST.

---

## 2. Architecture

### 2.1 Three-Layer Backend Architecture

```
┌─────────────────────────────────────────────────┐
│  ROUTE LAYER (Hono on Bun)                      │
│  POST /api/chat                                 │
│  /api/sessions/* (CRUD)                         │
│  Middleware: auth, rate-limit, error handler     │
├─────────────────────────────────────────────────┤
│  SERVICE LAYER (Effect)                         │
│  ChatSessionService — session CRUD, auto-title  │
│  ProductService — search, details               │
│  Typed errors: ProductNotFound, SessionNotFound  │
├─────────────────────────────────────────────────┤
│  DATA LAYER (Drizzle ORM + PostgreSQL)          │
│  chat_sessions, chat_messages tables            │
│  Migrations via drizzle-kit                     │
└─────────────────────────────────────────────────┘
```

### 2.2 Request/Response Flow

```
Frontend: POST /api/chat { messages, sessionId }
  │
  ▼
Hono Route Handler:
  1. Validate sessionId — resolve or create session
  2. convertToModelMessages(messages) → ModelMessage[]
  3. streamText({
       model: openai("gpt-4o"),
       system: SHOPPING_CONCIERGE_PROMPT,
       messages,
       tools: { searchProducts, getProductDetails },
       stopWhen: stepCountIs(3)
     })
  4. GPT-4o reasons → optionally calls tools (ReAct loop, up to 3 steps)
  5. Tool execute() → ProductService.search() / .getDetails() (via Effect)
  6. Persist assistant message to chat_messages
  7. return result.toUIMessageStreamResponse()
  │
  ▼
Frontend receives SSE stream:
  - text parts (token-by-token)
  - tool-invocation parts (state: "call" → "result" with product data)
```

### 2.3 ADR-0001 Alignment

| ADR Decision | Implementation |
|-------------|----------------|
| **Decision 1: ReAct pattern** | `streamText` + `tool()` + `stepCountIs(3)` — single agent, tool-augmented |
| **Decision 2: Scraping service** | `ScrapingProductService` implementing `ProductService` interface via Effect layer |
| **Decision 3: SSE streaming** | `toUIMessageStreamResponse()` from Vercel AI SDK, delivered through Hono |
| **Decision 4: Session-scoped context** | Messages sent per request within session; no cross-session memory; user prefs injected via system prompt |

---

## 3. File Structure

All files kebab-case, under 200 lines each.

```
src/
├── routes/
│   ├── chat.ts                          # POST /api/chat — streaming handler
│   └── sessions.ts                      # /api/sessions/* — CRUD routes
├── services/
│   ├── product-service.ts               # ProductService Effect service definition
│   ├── mock-product-service.ts          # Mock implementation (dev/test)
│   ├── scraping-product-service.ts      # External scraping service (production)
│   ├── product-tools.ts                 # AI SDK tool definitions
│   └── chat-session-service.ts          # ChatSessionService Effect service
├── db/
│   ├── index.ts                         # Drizzle client initialization
│   └── schema/
│       ├── chat-sessions.ts             # chat_sessions table schema
│       └── chat-messages.ts             # chat_messages table schema
├── types/
│   └── product.ts                       # Product, search, and session types
├── lib/
│   ├── chat-system-prompt.ts            # System prompt string
│   └── errors.ts                        # Effect error type definitions
├── middleware/
│   ├── auth.ts                          # Authentication middleware
│   ├── rate-limit.ts                    # Rate limiting middleware
│   └── error-handler.ts                 # Global error handler
└── index.ts                             # Bun + Hono server entry point
```

---

## 4. Chat Route (`POST /api/chat`)

### 4.1 Route Behavior

**File:** `src/routes/chat.ts`

| Behavior | Detail |
|----------|--------|
| **Endpoint** | `POST /api/chat` |
| **Input** | JSON body: `{ messages: UIMessage[], sessionId?: string }` |
| **Streaming** | SSE via `toUIMessageStreamResponse()` — tokens stream in real-time |
| **Multi-step** | `stopWhen: stepCountIs(3)` — up to 3 tool calls per request (search → refine → detail) |
| **Session resolution** | If `sessionId` provided, validate it exists; if omitted, create a new session |
| **Message persistence** | User message persisted on receipt; assistant message persisted after stream completes |
| **Timeout** | 30-second maximum response time |
| **Error handling** | Effect-based typed errors; sanitized error message returned to client, never exposes internals |

### 4.2 Response Format

The API returns an SSE stream. Frontend receives `message.parts[]` with these types:

| Part Type | Shape | Description |
|-----------|-------|-------------|
| `text` | `{ type: "text", text: string }` | AI's conversational response, streamed token-by-token |
| `tool-invocation` (call) | `{ type: "tool-invocation", toolName: string, state: "call", input: object }` | Tool call initiated by the model |
| `tool-invocation` (result) | `{ type: "tool-invocation", toolName: string, state: "result", output: object }` | Tool execution result with product data |

A single message can contain multiple parts in sequence: text → tool-invocation → text → tool-invocation → text.

---

## 5. System Prompt

**File:** `src/lib/chat-system-prompt.ts`

### 5.1 Prompt Requirements

The system prompt instructs GPT-4o to:

1. **Role:** Act as a personal shopping concierge for an AI-powered shopping assistant
2. **Clarify before searching:** Ask 1-2 clarifying questions (use case, size, color, budget, brand) before calling `searchProducts` — don't search on vague first messages
3. **Use preferences:** Reference user's saved size preferences (tops, bottoms, footwear) when available in conversation context (injected from DB into system prompt)
4. **Tool usage:**
   - Call `searchProducts` when enough context is gathered
   - Call `getProductDetails` when user asks for more info about a specific product
   - Never fabricate product data — only return data from tool results
5. **Response format:**
   - Use markdown: bold for product names, bullet lists for comparisons
   - After tool results, provide brief rationale per product (why it fits their needs)
   - Recommend 3-5 products per search
6. **Tone:** Conversational, concise, friendly — not corporate
7. **Boundaries:** Only assist with shopping; politely redirect off-topic queries

---

## 6. Tool Definitions

**File:** `src/services/product-tools.ts`

### 6.1 `searchProducts`

| Field | Value |
|-------|-------|
| **Description** | Search Amazon for products matching the user's criteria. Call this when you have enough context about what the user wants (after clarifying questions). |

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | Yes | Search query derived from conversation context |
| `category` | `string` | No | Product category (e.g., shoes, electronics, clothing) |
| `minPrice` | `number` | No | Minimum price in USD dollars (not cents) |
| `maxPrice` | `number` | No | Maximum price in USD dollars (not cents) |
| `size` | `string` | No | Size preference if applicable |
| `color` | `string` | No | Color preference if applicable |

**Output Shape:**

| Field | Type | Description |
|-------|------|-------------|
| `products` | `ProductCard[]` | 3-5 matching products |
| `totalResults` | `number` | Total matches found |
| `query` | `string` | The search query used |

### 6.2 `getProductDetails`

| Field | Value |
|-------|-------|
| **Description** | Get detailed information about a specific product by its ID. Call this when the user asks for more details, specifications, or additional images. |

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `productId` | `string` | Yes | The product ID to retrieve details for |

**Output Shape:** `ProductDetail | null` — null if product not found.

---

## 7. Product Service

### 7.1 Interface Contract

**File:** `src/services/product-service.ts`

`ProductService` is an Effect service with two operations:

| Method | Input | Output | Errors |
|--------|-------|--------|--------|
| `search` | `ProductSearchParams` | `ProductSearchResult` | `ScrapingServiceUnavailable` |
| `getDetails` | `productId: string` | `ProductDetail \| null` | `ProductNotFound`, `ScrapingServiceUnavailable` |

### 7.2 Provider Swap Strategy

Provider selection via `PRODUCT_SERVICE` env var, resolved through Effect layers at startup (not per-request factory calls):

| Provider | Env Value | Description |
|----------|-----------|-------------|
| `MockProductService` | `mock` (default) | Hardcoded products for dev/test; simulates 300-800ms latency |
| `ScrapingProductService` | `scraping` | External Amazon scraping microservice (ADR-0001 Decision 2) |
| `AmazonProductService` | `amazon` | Future PA-API 5.0 integration |

### 7.3 ScrapingProductService (per ADR-0001)

Maps external scraping API response to internal `ProductCard`/`ProductDetail` types.

**External scraping response shape:**

| Field | Type | Description |
|-------|------|-------------|
| `asin` | `string` | Amazon Standard Identification Number |
| `title` | `string` | Product title |
| `price` | `{ current: number, currency: string }` | Price object |
| `rating` | `{ score: number, count: number }` | Rating and review count |
| `images` | `string[]` | Product image URLs |
| `features` | `string[]` | Bullet-point features |
| `specifications` | `Record<string, string>` | Technical specifications |
| `availability` | `string` | Stock status |
| `url` | `string` | Amazon product URL |
| `brand` | `string?` | Brand name |
| `category` | `string?` | Product category |

**Requirements:**
- Retry logic with circuit breaker for scraping service failures
- Fallback to cached results when scraping service is unavailable
- Response mapping layer must handle schema changes from the scraping service
- Mock service remains default for local development

### 7.4 Types

**File:** `src/types/product.ts`

**ProductCard:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique product identifier |
| `name` | `string` | Yes | Product name |
| `image` | `string` | Yes | Primary image URL |
| `images` | `string[]` | No | Additional image URLs |
| `price` | `number` | Yes | Price in cents (per PRD) |
| `currency` | `"USD"` | Yes | Currency code |
| `sizes` | `string[]` | Yes | Available sizes |
| `colors` | `ColorOption[]` | Yes | Available colors |
| `retailer` | `string` | Yes | Retailer name ("Amazon") |
| `product_url` | `string` | Yes | Product page URL |
| `rating` | `number` | No | Rating 1-5 scale |
| `reviewCount` | `number` | No | Number of reviews |
| `brand` | `string` | No | Brand name |
| `description` | `string` | No | Short description |
| `category` | `string` | No | Product category |

**ColorOption:** `{ name: string, hex: string }`

**ProductDetail** extends ProductCard with:

| Field | Type | Description |
|-------|------|-------------|
| `fullDescription` | `string` | Complete product description |
| `specifications` | `Record<string, string>` | Key-value specifications |
| `images` | `string[]` | All product images (required) |
| `availability` | `"in_stock" \| "limited" \| "out_of_stock"` | Stock status |

**ProductSearchParams:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | `string` | Yes | Search query |
| `category` | `string` | No | Category filter |
| `minPrice` | `number` | No | Min price in USD dollars |
| `maxPrice` | `number` | No | Max price in USD dollars |
| `size` | `string` | No | Size filter |
| `color` | `string` | No | Color filter |
| `limit` | `number` | No | Max results (default 5) |

**ProductSearchResult:** `{ products: ProductCard[], totalResults: number, query: string }`

---

## 8. Chat Sessions

Multi-session management — users can have multiple concurrent chat sessions, similar to ChatGPT/Claude.

### 8.1 Database Schema (Drizzle)

**File:** `src/db/schema/chat-sessions.ts`

**`chat_sessions` table** (aligned with PRD §3.1):

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Session identifier |
| `user_id` | `uuid` | FK → `users(id)`, ON DELETE CASCADE | Owning user |
| `title` | `varchar(100)` | Nullable | Session title (auto-generated or user-set) |
| `created_at` | `timestamp` | Default `NOW()` | Creation time |
| `updated_at` | `timestamp` | Default `NOW()` | Last activity time |

**File:** `src/db/schema/chat-messages.ts`

**`chat_messages` table** (aligned with PRD §3.1):

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Message identifier |
| `session_id` | `uuid` | FK → `chat_sessions(id)`, ON DELETE CASCADE | Parent session |
| `role` | `varchar(10)` | NOT NULL | `'user'`, `'assistant'`, or `'system'` |
| `content` | `text` | NOT NULL | Message content (JSON-serialized for tool parts) |
| `created_at` | `timestamp` | Default `NOW()` | Message timestamp |

**Indexes:**
- `chat_messages.session_id` — fast message retrieval per session
- `chat_sessions.user_id` — fast session listing per user
- `chat_sessions.updated_at` — ordering sessions by recency

### 8.2 Session Endpoints

**File:** `src/routes/sessions.ts`

| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| `POST` | `/api/sessions` | Create new session | `{ title?: string }` | `{ id, title, createdAt }` |
| `GET` | `/api/sessions` | List user's sessions | Query: `?limit=20&offset=0` | `{ sessions: Session[], total: number }` |
| `GET` | `/api/sessions/:id` | Get session with messages | — | `{ session: Session, messages: Message[] }` |
| `PATCH` | `/api/sessions/:id` | Rename session | `{ title: string }` | `{ id, title, updatedAt }` |
| `DELETE` | `/api/sessions/:id` | Delete session + messages | — | `204 No Content` |

All endpoints require authentication. Users can only access their own sessions.

### 8.3 Session Behaviors

| Behavior | Detail |
|----------|--------|
| **Auto-creation** | If `POST /api/chat` is called without `sessionId`, a new session is created automatically |
| **Auto-titling** | After the first assistant response, generate a short title from the conversation (e.g., "Running shoes under $150"). Use the LLM to summarize the first exchange into a ≤50 char title. |
| **Ordering** | Sessions listed by `updated_at` descending (most recent first) |
| **Context scope** | Per ADR-0001 Decision 4: messages within a session are sent to the model; no cross-session context. User preferences (sizes) injected via system prompt regardless of session. |
| **Cascade delete** | Deleting a session deletes all associated messages (FK cascade) |
| **Updated timestamp** | `updated_at` refreshed on every new message in the session |
| **Default limit** | Session list returns 20 sessions by default, paginated |

### 8.4 ChatSessionService (Effect)

**File:** `src/services/chat-session-service.ts`

Effect service with typed errors for all session operations:

| Method | Input | Output | Errors |
|--------|-------|--------|--------|
| `create` | `{ userId, title? }` | `Session` | `DatabaseError` |
| `list` | `{ userId, limit?, offset? }` | `{ sessions, total }` | `DatabaseError` |
| `getWithMessages` | `{ sessionId, userId }` | `{ session, messages }` | `SessionNotFound`, `DatabaseError` |
| `rename` | `{ sessionId, userId, title }` | `Session` | `SessionNotFound`, `DatabaseError` |
| `delete` | `{ sessionId, userId }` | `void` | `SessionNotFound`, `DatabaseError` |
| `addMessage` | `{ sessionId, role, content }` | `Message` | `SessionNotFound`, `DatabaseError` |
| `autoTitle` | `{ sessionId, firstExchange }` | `Session` | `SessionNotFound`, `AIServiceError` |

---

## 9. Error Handling

### 9.1 Effect Error Types

**File:** `src/lib/errors.ts`

All errors are typed Effect failures — no thrown exceptions in the service layer.

| Error Type | Service | Description |
|------------|---------|-------------|
| `ProductNotFound` | `ProductService` | Product ID does not exist |
| `ScrapingServiceUnavailable` | `ProductService` | External scraping service down or timed out |
| `SessionNotFound` | `ChatSessionService` | Session ID does not exist or user doesn't own it |
| `AIServiceError` | Chat route, auto-title | OpenAI API failure (rate limit, timeout, invalid response) |
| `DatabaseError` | All DB operations | Drizzle/PostgreSQL connection or query failure |
| `ValidationError` | Route layer | Invalid request body or params (Zod validation) |

### 9.2 Error Response Shape

All error responses follow a consistent JSON shape:

| Field | Type | Description |
|-------|------|-------------|
| `error` | `string` | Human-readable error message (sanitized, no internals) |
| `code` | `string` | Machine-readable error code (e.g., `SESSION_NOT_FOUND`) |

### 9.3 Error Handling Strategy

- Effect services return typed failures — never throw
- Hono error handler middleware catches unhandled Effect failures and maps to HTTP status codes
- SSE stream errors use `onError` callback from `toUIMessageStreamResponse()` — returns sanitized message
- Scraping service failures trigger circuit breaker; fallback to cached results or graceful degradation

---

## 10. Environment Configuration

### 10.1 Required Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | OpenAI API key for GPT-4o |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `PORT` | No | `3000` | Hono server port |

### 10.2 Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PRODUCT_SERVICE` | `mock` | Product service provider: `mock`, `scraping`, `amazon` |
| `SCRAPING_SERVICE_URL` | — | Base URL for external scraping microservice |
| `SCRAPING_SERVICE_API_KEY` | — | API key for scraping service authentication |
| `RATE_LIMIT_RPM` | `30` | Requests per minute per authenticated user |

### 10.3 Future Environment Variables (Amazon PA-API)

| Variable | Description |
|----------|-------------|
| `AMAZON_ACCESS_KEY` | PA-API access key |
| `AMAZON_SECRET_KEY` | PA-API secret key |
| `AMAZON_PARTNER_TAG` | Associates partner tag |
| `AMAZON_MARKETPLACE` | Marketplace URL (e.g., `www.amazon.com`) |

---

## 11. Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `hono` | `^4.x` | HTTP framework (routes, middleware, SSE support) |
| `drizzle-orm` | `^0.3x` | Type-safe ORM for PostgreSQL |
| `drizzle-kit` | `^0.3x` | Migration generation and management |
| `postgres` | `^3.x` | PostgreSQL driver (`drizzle-orm/postgres-js`) |
| `effect` | `^3.x` | Typed error handling, service layer, dependency injection |
| `ai` | `^5.x` | Vercel AI SDK core (`streamText`, `tool`, `UIMessage`, `stepCountIs`, `convertToModelMessages`) |
| `@ai-sdk/openai` | `^1.x` | OpenAI provider for AI SDK |
| `zod` | `^3.x` | Schema validation (tool inputs, request bodies) |

**Runtime:** Bun (native TypeScript execution, no build step for dev)

---

## 12. Implementation Sequence

| Step | Task | Depends On | Files |
|------|------|------------|-------|
| 1 | Set up Bun + Hono server entry point | — | `src/index.ts` |
| 2 | Configure Drizzle ORM + PostgreSQL connection | Step 1 | `src/db/index.ts`, `drizzle.config.ts` |
| 3 | Define DB schema (sessions + messages) | Step 2 | `src/db/schema/chat-sessions.ts`, `src/db/schema/chat-messages.ts` |
| 4 | Run initial migration | Step 3 | `drizzle-kit generate` + `drizzle-kit migrate` |
| 5 | Define Effect error types | — | `src/lib/errors.ts` |
| 6 | Define product types | — | `src/types/product.ts` |
| 7 | Implement `ProductService` (Effect service + mock) | Steps 5, 6 | `src/services/product-service.ts`, `src/services/mock-product-service.ts` |
| 8 | Define AI SDK tool schemas | Step 7 | `src/services/product-tools.ts` |
| 9 | Write system prompt | — | `src/lib/chat-system-prompt.ts` |
| 10 | Implement `ChatSessionService` (Effect) | Steps 3, 5 | `src/services/chat-session-service.ts` |
| 11 | Create session CRUD routes | Step 10 | `src/routes/sessions.ts` |
| 12 | Create chat streaming route | Steps 8, 9, 10 | `src/routes/chat.ts` |
| 13 | Add middleware (auth, rate-limit, error handler) | Step 1 | `src/middleware/*.ts` |
| 14 | Implement `ScrapingProductService` | Step 7 | `src/services/scraping-product-service.ts` |
| 15 | Test with curl / AI SDK client | Step 12 | Manual testing |

---

## 13. Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | **Effect learning curve** | Team may need ramp-up time on Effect's service/layer/error patterns; consider pairing sessions |
| 2 | **Hono + AI SDK SSE compatibility** | Verify `toUIMessageStreamResponse()` works correctly with Hono's response handling — may need adapter |
| 3 | **Rate limiting on `/api/chat`** | GPT-4o costs ~$5/1M input tokens; per-user limits needed (PRD: 30 req/min authenticated) |
| 4 | **Authentication middleware** | Which auth system? JWT, session-based, or third-party (Better Auth)? Needs decision before middleware impl |
| 5 | **Auto-title generation** | Should auto-title use a separate lightweight model (e.g., GPT-4o-mini) to reduce cost, or piggyback on main response? |
| 6 | **Message content serialization** | Tool-invocation parts are complex objects — decide on JSON serialization strategy for `chat_messages.content` column |

---

## Related Documents

| Document | Path |
|----------|------|
| PRD | `docs/PRD.md` |
| ADR-0001: ReAct Architecture | `docs/adrs/0001-react-agent-architecture.md` |
| System Design | `docs/SYSTEM_DESIGN.md` |
| Frontend PRD | `docs/frontend-PRD.md` |
| Development Rules | `.claude/workflows/development-rules.md` |

---

*Document created: March 10, 2026*
*Last updated: March 12, 2026 — v3.0: Bun/Hono/Drizzle/Effect stack, chat sessions, removed code snippets*
