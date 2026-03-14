# ADR: ReAct Agent Architecture with Vercel AI SDK + OpenRouter

**Status:** Proposed
**Date:** 2026-03-14
**Context:** Design a production-grade ReAct agent for the AI Shopping Assistant using Vercel AI SDK v6.x, OpenRouter, Bun/Hono backend, and NextJS frontend.

---

## 1. What is ReAct and Why It Fits

ReAct (Reason + Act) is the pattern where the LLM alternates between **thinking** (reasoning about what to do) and **acting** (calling tools), then **observing** the results before deciding the next step. This maps perfectly to Vercel AI SDK's `streamText` + tool-calling loop — each "step" is one reason→act→observe cycle.

Key insight from leading frameworks (LangGraph, OpenAI Agents SDK, Anthropic patterns): the best ReAct implementations are **not** custom state machines. They leverage the LLM's native tool-calling capability and let the SDK manage the loop. Your current `chat.ts` already does this with `streamText` + `stopWhen: stepCountIs(3))`. The architecture below extends this foundation.

---

## 2. High-Level System Design

```
┌─────────────────────────────────────────────────────────────┐
│                    NEXTJS FRONTEND                           │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  useChat()   │  │ Tool Result  │  │  Streaming UI     │  │
│  │  (AI SDK     │  │ Renderer     │  │  (product cards,  │  │
│  │   React)     │  │ (ProductCard │  │   thinking dots,  │  │
│  │              │  │  SearchCard) │  │   tool activity)  │  │
│  └──────┬───────┘  └──────────────┘  └───────────────────┘  │
│         │  SSE stream (useChat → /api/chat)                  │
└─────────┼───────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                  HONO API (Bun runtime)                      │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              AGENT ORCHESTRATOR                       │   │
│  │  POST /api/chat                                       │   │
│  │                                                       │   │
│  │  streamText({                                         │   │
│  │    model: openrouter("anthropic/claude-sonnet-4"),│   │
│  │    system: buildSystemPrompt(userCtx),                │   │
│  │    messages: [...history, ...new],                    │   │
│  │    tools: { ...productTools, ...webSearchTools,       │   │
│  │             ...cartTools, ...knowledgeTools },         │   │
│  │    maxSteps: 5,                                       │   │
│  │    onStepFinish: (step) => { log, persist, guard },   │   │
│  │  })                                                   │   │
│  └──────────────────┬───────────────────────────────────┘   │
│                     │                                        │
│  ┌─────────────┐ ┌──┴──────────┐ ┌────────────────────┐    │
│  │  TOOL       │ │  CONTEXT    │ │  GUARDRAILS &      │    │
│  │  REGISTRY   │ │  MANAGER    │ │  OBSERVABILITY     │    │
│  │             │ │             │ │                     │    │
│  │ searchProd  │ │ User prefs  │ │ Token budget        │    │
│  │ getDetails  │ │ Chat hist   │ │ Rate limiting       │    │
│  │ webSearch   │ │ Session ctx │ │ Step counting       │    │
│  │ addToCart   │ │ Redis cache │ │ Pino structured log │    │
│  │ getCart     │ │             │ │ Cost tracking        │    │
│  └──────┬──────┘ └──────┬──────┘ └────────────────────┘    │
│         │               │                                    │
└─────────┼───────────────┼────────────────────────────────────┘
          │               │
          ▼               ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐
│  EXTERNAL    │  │  DATA LAYER  │  │  WEB SEARCH SERVICE  │
│  LLM         │  │              │  │                       │
│  (OpenRouter) │  │  Neon (PG)   │  │  Your existing       │
│  → Claude     │  │  + Drizzle   │  │  search API for      │
│  → GPT-4o     │  │              │  │  latest news &       │
│  → Llama      │  │  Redis       │  │  knowledge grounding │
│  (failover)   │  │  (ioredis)   │  │                       │
└──────────────┘  └──────────────┘  └──────────────────────┘
```

---

## 3. Core Components

### 3.1 OpenRouter as LLM Provider

OpenRouter provides a single OpenAI-compatible endpoint that routes to 500+ models. Vercel AI SDK's `@ai-sdk/openai` provider works with OpenRouter by changing the base URL.

```typescript
// src/lib/llm-provider.ts
import { createOpenAI } from "@ai-sdk/openai"

export const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": env.APP_URL,       // required by OpenRouter
    "X-Title": "AI Shopping Assistant", // shows in OpenRouter dashboard
  },
})

// Usage — swap models without code changes
const model = openrouter("anthropic/claude-sonnet-4")
// or: openrouter("openai/gpt-4o")
// or: openrouter("meta-llama/llama-3.1-405b-instruct")
```

**Why OpenRouter over direct provider SDKs:**
- Single API key, single billing, single integration
- Model failover (if Claude is down, route to GPT-4o)
- Cost tracking per-model in OpenRouter dashboard
- Same tool-calling format across all providers (OpenAI-compatible)

**Caveat:** Some models on OpenRouter have weaker tool-calling support. Stick to Claude Sonnet/Opus or GPT-4o for reliable multi-step ReAct loops.

### 3.2 Agent Orchestrator (The ReAct Loop)

The Vercel AI SDK v6.x `streamText` function **already implements ReAct** when you provide tools. Each "step" is one reason→act→observe cycle. The SDK manages the loop internally.

```typescript
// src/services/agent-orchestrator.ts
import { streamText, type ToolSet, type StepResult } from "ai"
import { openrouter } from "../lib/llm-provider.js"

interface AgentConfig {
  model: string
  tools: ToolSet
  systemPrompt: string
  maxSteps: number              // max ReAct loops (recommend 5-8)
  maxTokens?: number            // per-step token budget
  onStepFinish?: (step: StepResult<ToolSet>) => void | Promise<void>
}

export function createAgentStream(
  config: AgentConfig,
  messages: CoreMessage[],
) {
  return streamText({
    model: openrouter(config.model),
    system: config.systemPrompt,
    messages,
    tools: config.tools,
    maxSteps: config.maxSteps,
    maxTokens: config.maxTokens,

    // Called after each reason→act→observe cycle
    onStepFinish: async (step) => {
      // 1. Log tool calls for observability
      // 2. Track token usage for cost control
      // 3. Persist intermediate results if needed
      await config.onStepFinish?.(step)
    },
  })
}
```

**The ReAct loop in practice:**
1. User: "Find me black running shoes under $150"
2. **Step 1 — Reason:** LLM decides to call `searchProducts`
3. **Step 1 — Act:** SDK executes `searchProducts({ query: "running shoes", color: "black", maxPrice: 150 })`
4. **Step 1 — Observe:** Results returned to LLM
5. **Step 2 — Reason:** LLM sees 5 results, decides to get details on top 2
6. **Step 2 — Act:** SDK executes `getProductDetails` (parallel tool calls supported in v6)
7. **Step 2 — Observe:** Details returned
8. **Step 3 — Reason:** LLM has enough info, generates final response
9. **Done** — streamed to user

### 3.3 Tool Registry Pattern

Organize tools by domain. Each tool module exports a `ToolSet` fragment; the orchestrator merges them.

```
src/services/tools/
├── product-tools.ts      # searchProducts, getProductDetails
├── cart-tools.ts         # addToCart, getCart, removeFromCart
├── web-search-tools.ts   # webSearch (calls your search service)
├── knowledge-tools.ts    # lookupPolicy, getFAQ
└── index.ts              # merges all tool sets
```

```typescript
// src/services/tools/web-search-tools.ts
import { z } from "zod"
import type { ToolSet } from "ai"

export function makeWebSearchTools(searchServiceUrl: string): ToolSet {
  return {
    webSearch: {
      description:
        "Search the web for latest information when you are uncertain " +
        "about product availability, pricing, current trends, or any " +
        "factual claim. Use this to ground your responses in real data.",
      parameters: z.object({
        query: z.string().describe("Search query"),
        maxResults: z.number().optional().default(5),
      }),
      execute: async ({ query, maxResults }) => {
        const res = await fetch(`${searchServiceUrl}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, maxResults }),
        })
        return res.json()
      },
    },
  }
}
```

```typescript
// src/services/tools/index.ts
import type { ToolSet } from "ai"

export function buildToolSet(deps: ToolDependencies): ToolSet {
  return {
    ...makeProductTools(deps.productServiceLayer),
    ...makeCartTools(deps.cartServiceLayer),
    ...makeWebSearchTools(deps.searchServiceUrl),
    ...makeKnowledgeTools(deps.knowledgeServiceLayer),
  }
}
```

### 3.4 Context Manager (Memory & State)

The agent needs context beyond raw chat history: user preferences, cart state, session metadata.

```typescript
// src/services/context-manager.ts
interface AgentContext {
  userId: string
  sessionId: string
  userPreferences: { sizes: SizePrefs; defaultAddress?: Address }
  cartSummary: { itemCount: number; total: number }
  conversationSummary?: string  // compressed history for long chats
}

export function buildSystemPrompt(ctx: AgentContext): string {
  return `${baseSystemPrompt}

## User Context
- Sizes: tops ${ctx.userPreferences.sizes.tops}, bottoms ${ctx.userPreferences.sizes.bottoms}, footwear ${ctx.userPreferences.sizes.footwear}
- Cart: ${ctx.cartSummary.itemCount} items ($${ctx.cartSummary.total / 100})
${ctx.userPreferences.defaultAddress ? `- Ships to: ${ctx.userPreferences.defaultAddress.city}, ${ctx.userPreferences.defaultAddress.state}` : ""}
${ctx.conversationSummary ? `\n## Previous Conversation Summary\n${ctx.conversationSummary}` : ""}`
}
```

**Context window management strategy:**
- **Short conversations (< 20 messages):** Send full history
- **Long conversations (> 20 messages):** Summarize older messages, keep last 10 verbatim
- **Cache user preferences in Redis** — inject into system prompt, don't re-fetch every turn

### 3.5 Guardrails & Cost Control

```typescript
// src/middleware/agent-guardrails.ts

// 1. Step budget — prevent runaway loops
const MAX_STEPS = 8  // hard ceiling

// 2. Token budget — per-request ceiling
const MAX_TOKENS_PER_REQUEST = 4096

// 3. Rate limiting — per user
// Use Redis sliding window: max 20 chat requests / minute / user

// 4. Tool call validation — prevent abuse
function validateToolCall(toolName: string, params: unknown): boolean {
  // Ensure tool params are within expected ranges
  // e.g., maxPrice can't be negative, query can't be > 500 chars
  return true
}

// 5. Content filtering — on final output
// Run output through a lightweight classifier or regex
// to catch policy violations before streaming to user
```

---

## 4. Sequence Diagram: Full ReAct Flow

```
User          NextJS          Hono API        OpenRouter       Tools          Neon/Redis
 │              │                │               │               │               │
 │─ message ──▶│                │               │               │               │
 │              │─ POST /api/chat ─▶            │               │               │
 │              │                │─ load ctx ───────────────────────────────────▶│
 │              │                │◀── user prefs, cart summary ────────────────│
 │              │                │               │               │               │
 │              │                │─ streamText ─▶│               │               │
 │              │                │  (system +    │               │               │
 │              │                │   messages +  │               │               │
 │              │                │   tools)      │               │               │
 │              │                │               │               │               │
 │              │                │  ◀── Step 1: tool_call ──────│               │
 │              │                │               │  searchProducts              │
 │              │                │─── execute ──────────────────▶│──── query ──▶│
 │              │                │◀── results ──────────────────│◀── rows ────│
 │              │                │               │               │               │
 │              │                │─── feed results back ────────▶               │
 │              │                │               │               │               │
 │              │                │  ◀── Step 2: tool_call ──────│               │
 │              │                │               │  webSearch (uncertain claim)  │
 │              │                │─── execute ──────────────────▶│              │
 │              │                │◀── search results ───────────│              │
 │              │                │               │               │               │
 │              │                │─── feed results back ────────▶               │
 │              │                │               │               │               │
 │              │                │  ◀── Step 3: final text (streamed) ──────── │
 │  ◀── SSE stream ───────────│◀── stream tokens ────────────│               │
 │              │                │               │               │               │
 │              │                │─── persist messages ─────────────────────────▶│
 │              │                │               │               │               │
```

---

## 5. Key Architectural Decisions

### 5.1 Vercel AI SDK v6 `streamText` vs Custom Loop

**Decision: Use `streamText` with `maxSteps`, not a custom while-loop.**

The SDK handles the full ReAct cycle: tool call detection → execution → result injection → next LLM call. Building a custom loop adds complexity with no benefit. The `onStepFinish` callback provides all the hooks needed for logging, persistence, and guardrails.

**What we learned from other frameworks:**
- LangGraph uses explicit graph nodes — powerful but overkill for a single-agent setup
- OpenAI Agents SDK uses a similar "let the SDK loop" approach — validates this pattern
- Anthropic's agent cookbook shows the same: `while has_tool_calls: execute → feed back`

### 5.2 Model Selection via OpenRouter

**Decision: Default to `anthropic/claude-sonnet-4` for tool-calling, with configurable fallback.**

| Model | Use Case | Cost (approx) |
|-------|----------|---------------|
| `anthropic/claude-sonnet-4` | Primary — best tool-calling reliability | ~$3/$15 per M tokens |
| `openai/gpt-4o` | Fallback if Claude is unavailable | ~$2.5/$10 per M tokens |
| `anthropic/claude-haiku-3.5` | Lightweight tasks (summarization, classification) | ~$0.25/$1.25 per M tokens |

Use a smaller model for pre-processing (intent classification, context summarization) and the larger model for the actual ReAct loop. This is the "router" pattern used by Anthropic and OpenAI in production.

### 5.3 Web Search Integration

**Decision: Expose your existing web search service as a tool the agent can call autonomously.**

The agent's system prompt tells it: "When uncertain about current info (prices, availability, trends), use the `webSearch` tool." This is the core ReAct advantage — the LLM decides when to search rather than the application hardcoding search triggers.

### 5.4 Chat History & Context

**Decision: Store messages in Neon (PostgreSQL), cache active sessions in Redis.**

```
- Active session messages → Redis (fast reads, 24h TTL)
- All messages → Neon (persistent, queryable)
- Context window → Last N messages + compressed summary of older messages
```

### 5.5 Frontend Integration

**Decision: Use `useChat()` from `@ai-sdk/react` with streaming tool result rendering.**

```typescript
// NextJS frontend (simplified)
import { useChat } from "@ai-sdk/react"

export function ChatUI() {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: "/api/chat",
    // Tool results arrive as parts within assistant messages
    // Render product cards, search results, etc. based on toolName
  })

  return (
    <div>
      {messages.map(m => (
        <MessageBubble key={m.id} message={m} />
        // MessageBubble inspects m.parts for tool invocations/results
        // and renders appropriate UI (ProductCard, SearchingIndicator, etc.)
      ))}
    </div>
  )
}
```

---

## 6. Production Considerations

### 6.1 Observability

- **Structured logging (Pino):** Log every tool call, step count, token usage, latency
- **OpenRouter dashboard:** Model-level cost tracking built-in
- **Trace IDs:** Generate a unique traceId per chat request, propagate through all tool calls
- **Consider Langfuse** for LLM-specific tracing (open-source, self-hostable)

### 6.2 Error Recovery

```typescript
// In tool execute functions:
execute: async (params) => {
  try {
    return await productService.search(params)
  } catch (error) {
    // Return error as data — let the LLM decide how to recover
    // This is a key ReAct pattern: the agent "observes" the error
    // and can try a different approach
    return { error: "Product search temporarily unavailable", suggestion: "Try a broader query" }
  }
}
```

The LLM will see the error in its observation step and can either retry with different params, fall back to web search, or tell the user.

### 6.3 Token Optimization

- Serialize tool results as concise JSON (strip unnecessary fields)
- Use CSV format for tabular data (40-50% smaller than JSON)
- Truncate long product descriptions in search results
- Summarize conversation history beyond 20 messages

### 6.4 Security

- **Clerk auth middleware** validates JWT before reaching the agent
- **Tool params validated** via Zod schemas (already in place)
- **No arbitrary code execution** — tools are a fixed registry, not dynamic
- **Rate limit** chat endpoint: 20 req/min per user via Redis sliding window

---

## 7. Migration Path from Current Code

Your current `chat.ts` is already 80% of the way there. Changes needed:

| Current | Target |
|---------|--------|
| `openai("gpt-4o")` | `openrouter("anthropic/claude-sonnet-4")` |
| `stopWhen: stepCountIs(3)` | `maxSteps: 5` (more room for complex queries) |
| 2 tools (search, details) | Expanded tool registry (+ webSearch, cart, knowledge) |
| Static system prompt | Dynamic prompt with user context injection |
| No persistence | Redis cache + Neon persistence |
| No observability | `onStepFinish` logging + Pino structured logs |

---

## 8. File Structure (Proposed)

```
src/
├── lib/
│   ├── llm-provider.ts          # OpenRouter config
│   ├── env.ts                    # (existing)
│   └── logger.ts                 # (existing)
├── services/
│   ├── agent-orchestrator.ts     # createAgentStream()
│   ├── context-manager.ts        # buildSystemPrompt(), loadContext()
│   └── tools/
│       ├── index.ts              # buildToolSet() — merges all
│       ├── product-tools.ts      # (existing, moved)
│       ├── cart-tools.ts         # addToCart, getCart
│       ├── web-search-tools.ts   # calls your search service
│       └── knowledge-tools.ts    # FAQ, policies
├── middleware/
│   ├── auth.ts                   # (existing) → swap to Clerk
│   ├── rate-limiter.ts           # Redis sliding window
│   └── error-handler.ts          # (existing)
├── routes/
│   └── chat.ts                   # Simplified — delegates to orchestrator
└── db/
    └── schema/
        ├── chat-sessions.ts      # (existing)
        └── chat-messages.ts      # (existing)
```

---

## 9. Open Questions

1. **Multi-agent vs single-agent?** Current design is single-agent with multiple tools. If you later need specialized sub-agents (e.g., a "price comparison agent"), Vercel AI SDK supports nested `generateText` calls within tool execute functions.

2. **Streaming tool results to frontend?** Vercel AI SDK v6 `toUIMessageStreamResponse()` already handles this. Frontend `useChat()` receives tool invocations and results as message parts.

3. **Model routing?** Should different query types (simple FAQ vs complex product search) use different models? OpenRouter supports this, and you could add a lightweight classifier as a pre-step.

4. **Vector search for product discovery?** Currently using keyword search via your product service. Adding pgvector to Neon for semantic search would improve product matching accuracy.

5. **Conversation branching?** If user says "actually, go back to those first shoes" — how to handle context rewinding? Current linear history works for v1; consider tree-structured history for v2.
