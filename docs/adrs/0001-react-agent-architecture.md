# ADR-0001: Agentic Architecture — ReAct Pattern with External Scraping

**Status:** accepted
**Date:** 2026-03-11
**Last updated:** 2026-03-11

This ADR formalizes four tightly coupled architectural decisions governing the AI shopping assistant's conversational agent, product data source, response delivery, and context management.

---

## Decision 1: ReAct Agent Pattern

**Chose:** ReAct (Reason + Act + Observe) via Vercel AI SDK `streamText` + `tool()` + `stepCountIs()`
**Over:** Multi-agent orchestration, Plan-and-Execute, Hierarchical Orchestrator, State Machine Agent, Router/Dispatcher
**Rationale:** Shopping queries are reactive dialogues — user asks, agent clarifies, searches, presents. No multi-step planning or inter-agent coordination needed. Single agent with tools matches the scope. Vercel AI SDK implements ReAct natively: the model reasons about what tool to call, executes it, observes the result, and decides whether to respond or call another tool (up to `stepCountIs(3)` steps).

### Alternatives Considered

| Alternative | Benefits | Drawbacks | Why Rejected |
|-------------|----------|-----------|--------------|
| **Multi-agent (CrewAI/Swarm)** | Specialized agents per domain (search, payment, support) | Orchestration overhead, inter-agent communication complexity, harder to debug streaming | Over-engineered for single-domain shopping queries; no clear agent boundaries |
| **Plan-and-Execute** | Good for multi-step tasks with dependencies | Adds latency (planning phase before execution); shopping is reactive, not planned | Users expect immediate responses to "find me shoes"; planning phase hurts UX |
| **Hierarchical Orchestrator** | Scales to many sub-tasks | Complex routing logic, harder to maintain, higher latency | Single conversation thread doesn't need hierarchical delegation |
| **State Machine Agent** | Predictable flow, easy to test | Rigid; can't handle freeform conversation well | Shopping dialogue is open-ended — state machines force unnatural conversation paths |
| **Router/Dispatcher** | Clean separation of concerns | Adds indirection; router must understand intent before dispatching | Two tools (`searchProducts`, `getProductDetails`) don't warrant a routing layer |

### Consequences

- Tools are the extension point — new capabilities (cart, checkout, recommendations) become new `tool()` definitions
- `stepCountIs(3)` caps tool-call chains, preventing runaway loops while allowing search → refine → detail flows
- Debugging is straightforward: each step is a model turn with clear input/output
- Future migration to multi-agent is possible by splitting tools into specialized agents if scope grows significantly

---

## Decision 2: External Amazon Scraping Service for Product Data

**Chose:** External Amazon scraping microservice implementing `ProductService` interface
**Over:** Amazon PA-API 5.0, mock-only, self-hosted catalog with pgvector
**Rationale:** No Amazon Associates approval required (removes multi-week blocker). Richer data than PA-API: ASIN, features, specs, customer Q&A, fulfillment info, real-time availability. Trade-off: dependency on external service reliability and potential TOS concerns.

### Integration Architecture

New `ScrapingProductService` class implementing the existing `ProductService` interface from `chat-component-spec.md`. Maps external scraping response to internal `ProductCard`/`ProductDetail` types. Swappable via `PRODUCT_SERVICE=scraping` env var through the existing factory function.

```
ProductService (interface)
├── MockProductService        (PRODUCT_SERVICE=mock)
├── ScrapingProductService    (PRODUCT_SERVICE=scraping)  ← new
└── AmazonProductService      (PRODUCT_SERVICE=amazon)    ← future PA-API
```

### Scraping Response Schema (External Service)

The external service returns product data in this shape, which `ScrapingProductService` maps to internal types:

```typescript
// External scraping API response
interface ScrapingProduct {
  asin: string;
  title: string;
  price: { current: number; currency: string };
  rating: { score: number; count: number };
  images: string[];
  features: string[];
  specifications: Record<string, string>;
  availability: string;
  url: string;
  brand?: string;
  category?: string;
}
```

### Alternatives Considered

| Alternative | Benefits | Drawbacks | Why Rejected |
|-------------|----------|-----------|--------------|
| **Amazon PA-API 5.0** | Official API, TOS-compliant, stable | Requires Associates approval (weeks), limited data fields, 1 req/sec rate limit, must display Amazon attribution | Approval blocker; rate limits constrain real-time search UX |
| **Mock-only** | Zero dependencies, instant dev setup | No real products, can't validate real-world UX | Useful for dev only; can't ship to users |
| **Self-hosted catalog + pgvector** | Full control, semantic search, no external deps | Must ingest/maintain catalog, stale data, massive upfront effort | Not viable for v1; no catalog data source without PA-API or scraping |

### Consequences

- External service is a single point of failure — need retry logic, circuit breaker, fallback to cached results
- Response mapping layer must handle schema changes from the scraping service
- Mock service remains for local development and testing
- Must monitor scraping service uptime and response latency

---

## Decision 3: Streaming via Server-Sent Events (SSE)

**Chose:** SSE via Vercel AI SDK `toUIMessageStreamResponse()`
**Over:** WebSocket, HTTP long polling, batch (non-streaming) response
**Rationale:** Native Vercel AI SDK support — zero custom streaming code. Unidirectional (server → client) is sufficient; the client sends new messages via POST. Works with Next.js edge runtime and Vercel's infrastructure. `useChat` hook on the frontend handles SSE parsing automatically.

### Alternatives Considered

| Alternative | Benefits | Drawbacks | Why Rejected |
|-------------|----------|-----------|--------------|
| **WebSocket** | Bidirectional, lower latency for rapid exchanges | Requires persistent connection management, doesn't work on Vercel edge, more complex infrastructure | Over-engineered; chat is request-response with streaming, not truly bidirectional |
| **HTTP long polling** | Simple, works everywhere | Higher latency, more server resources per request, poor UX for token streaming | Tokens must stream character-by-character; polling can't deliver this smoothly |
| **Batch response** | Simplest implementation | User waits 5-15s for full response; terrible UX for conversational AI | Streaming is table stakes for LLM chat interfaces |

### Consequences

- Frontend uses `useChat` hook pointed at `POST /api/chat` — SSE handling is automatic
- Tool invocation states (`call` → `result`) stream as discrete events, enabling progressive UI updates (loading → product cards)
- `maxDuration = 30` on the route handler sets the streaming timeout
- No WebSocket infrastructure to maintain

---

## Decision 4: Session-Scoped Context Only

**Chose:** Context preserved within session only — `messages` array sent per request, no cross-session memory
**Over:** Cross-session vector memory, persistent conversation replay, RAG over history
**Rationale:** Simplifies v1 implementation significantly. User preferences (sizes, address) are already stored in the database and injected via system prompt — the most valuable "memory" is already persistent. Chat history is persisted to PostgreSQL (`chat_messages` table) for display purposes, but not fed back as agent context across sessions.

### What Is and Isn't Preserved

| Data | Persisted? | Fed to Agent? | Mechanism |
|------|-----------|---------------|-----------|
| User sizes/preferences | Yes | Yes (system prompt) | PostgreSQL → injected into system prompt |
| Chat messages (display) | Yes | Within session only | PostgreSQL `chat_messages` table |
| Product search results | No | Within session only | Ephemeral in `messages[]` array |
| Cross-session conversation | Yes (stored) | No | Available for future RAG implementation |

### Alternatives Considered

| Alternative | Benefits | Drawbacks | Why Rejected |
|-------------|----------|-----------|--------------|
| **Cross-session vector memory** | "Remember I like Nike" across sessions | Requires vector DB (pgvector/Pinecone), embedding pipeline, retrieval logic, relevance tuning | Over-complex for v1; size preferences already handle the key use case |
| **Persistent conversation replay** | Full context from previous sessions | Token cost explodes with history length, stale product data, slow first response | 10 past conversations = thousands of tokens; diminishing returns |
| **RAG over purchase history** | Personalized recommendations based on orders | Requires embedding pipeline + retrieval, cold start problem, privacy considerations | Good v2 feature; not needed to validate core shopping flow |

### Consequences

- Each new session starts fresh — agent has no memory of previous conversations
- User preferences (sizes) are the only cross-session personalization vector
- Token costs are predictable and bounded by single-session length
- Architecture leaves the door open for vector memory in v2: stored chat history can be embedded retroactively

---

## Architecture Overview

```
User <-> Chat UI (useChat) <-SSE-> POST /api/chat
                                    |
                                    v
                              streamText (GPT-4o)
                              +--- ReAct Loop ---+
                              | Reason -> Act -> |
                              | Observe -> Respond|
                              +------------------+
                                    | tools
                          +---------+---------+
                          v                   v
                   searchProducts      getProductDetails
                          |                   |
                          v                   v
                   ScrapingProductService (external)
                          |
                          v
                   Amazon Scraping API
```

**Data flow per request:**
1. Frontend sends `POST /api/chat` with `UIMessage[]` array (full session history)
2. Route handler calls `convertToModelMessages()` then `streamText()` with tools
3. GPT-4o reasons about user intent, optionally calls tools (up to 3 steps)
4. Tool `execute()` calls `ScrapingProductService` (or mock in dev)
5. `toUIMessageStreamResponse()` streams text + tool results back as SSE
6. Frontend `useChat` hook parses SSE, updates `message.parts[]` for rendering

---

## Related Documents

| Document | Path | Relevance |
|----------|------|-----------|
| Chat API Spec | `docs/chat-component-spec.md` | Implements these decisions; defines tools, types, route handler |
| System Design | `docs/SYSTEM_DESIGN.md` | High-level architecture context |
| PRD | `docs/PRD.md` | Feature requirements, data models, API endpoints |
| Frontend PRD | `docs/frontend-PRD.md` | Frontend consumption of SSE stream |
