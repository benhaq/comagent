# Chat API Specification

## Document Information

| Field | Value |
|-------|-------|
| **Version** | 2.0 |
| **Date** | March 11, 2026 |
| **Status** | Draft |
| **Purpose** | Backend chat API spec — route handler, tools, product service |

---

## 1. Overview

### 1.1 Purpose

Server-side chat API that powers the AI shopping assistant. Frontend calls `POST /api/chat` with messages, receives a streaming response via Vercel AI SDK's `toUIMessageStreamResponse()`. GPT-4o acts as a shopping concierge, calling tools to search Amazon products and return structured results.

### 1.2 Scope

This spec covers backend only:
- API route (`POST /api/chat`) — streaming with `streamText`
- Tool definitions (`searchProducts`, `getProductDetails`) with Zod schemas
- Product service layer (interface, mock implementation, future Amazon PA-API)
- System prompt for shopping concierge behavior
- TypeScript types for products and search params
- Environment configuration

**Out of scope:** All frontend components, UI rendering, state management, theme system, styling.

### 1.3 How Frontend Consumes This API

Frontend uses `useChat` from `@ai-sdk/react` pointed at `/api/chat`. The hook handles:
- Sending `UIMessage[]` to the API
- Receiving SSE stream with text parts and tool-invocation parts
- Frontend renders `message.parts[]` — text via markdown, tool results as product cards

This API is designed to be consumed by any AI SDK-compatible client.

---

## 2. Architecture

### 2.1 Two-Layer Backend Architecture

```
┌─────────────────────────────────────────────────┐
│  API LAYER (Next.js Route Handler)              │
│  POST /api/chat                                 │
│  streamText + tool definitions                  │
│  convertToModelMessages → toUIMessageStreamResponse │
├─────────────────────────────────────────────────┤
│  SERVICE LAYER (Product Data)                   │
│  AmazonProductService (interface)               │
│  MockProductService → real PA-API 5.0 later     │
└─────────────────────────────────────────────────┘
```

### 2.2 Request/Response Flow

```
Frontend: POST /api/chat { messages: UIMessage[] }
  │
  ▼
Route Handler:
  1. Parse request body → extract messages
  2. convertToModelMessages(messages) → ModelMessage[]
  3. streamText({
       model: openai("gpt-4o"),
       system: SHOPPING_CONCIERGE_PROMPT,
       messages,
       tools: { searchProducts, getProductDetails },
       stopWhen: stepCountIs(3)
     })
  4. GPT-4o generates text and/or invokes tools
  5. Tool execute() → ProductService.search() / .getDetails()
  6. return result.toUIMessageStreamResponse()
  │
  ▼
Frontend receives SSE stream:
  - text parts (token-by-token)
  - tool-invocation parts (state: "call" → "result" with product data)
```

---

## 3. File Structure

All files kebab-case, under 200 lines each.

```
src/
├── app/
│   └── api/
│       └── chat/
│           └── route.ts                    # POST handler (~80 lines)
├── services/
│   ├── product-service.ts                  # Interface + factory (~60 lines)
│   ├── mock-product-service.ts             # Mock implementation (~150 lines)
│   └── product-tools.ts                    # AI SDK tool definitions (~80 lines)
├── types/
│   └── product.ts                          # Product types (~50 lines)
└── lib/
    └── chat-system-prompt.ts               # System prompt string (~40 lines)
```

---

## 4. API Route (`POST /api/chat`)

### 4.1 Route Handler

**File:** `src/app/api/chat/route.ts`

```typescript
import { convertToModelMessages, streamText, UIMessage, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { searchProductsTool, getProductDetailsTool } from "@/services/product-tools";
import { SHOPPING_CONCIERGE_SYSTEM_PROMPT } from "@/lib/chat-system-prompt";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: openai("gpt-4o"),
    system: SHOPPING_CONCIERGE_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: {
      searchProducts: searchProductsTool,
      getProductDetails: getProductDetailsTool,
    },
    stopWhen: stepCountIs(3),
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      if (error instanceof Error) return error.message;
      return "An error occurred while processing your request.";
    },
  });
}
```

### 4.2 Key API Behaviors

| Behavior | Detail |
|----------|--------|
| **Streaming** | SSE via `toUIMessageStreamResponse()` — tokens stream to client in real-time |
| **Multi-step** | `stopWhen: stepCountIs(3)` — GPT-4o can chain up to 3 tool calls per request (e.g., search → refine → detail) |
| **Timeout** | `maxDuration = 30` — Vercel function timeout of 30 seconds |
| **Error handling** | `onError` returns sanitized error message to client, never exposes internals |

### 4.3 Response Format

The API returns an SSE stream. Frontend receives `message.parts[]` with these types:

```typescript
// Text part — AI's conversational response
{ type: "text", text: "Here are some great running shoes..." }

// Tool invocation part — transitions through states
{ type: "tool-invocation", toolName: "searchProducts", state: "call", input: { query: "running shoes" } }
{ type: "tool-invocation", toolName: "searchProducts", state: "result", output: { products: [...], totalResults: 5, query: "running shoes" } }
```

A single message can contain multiple parts in sequence: text → tool-invocation → text → tool-invocation → text.

---

## 5. System Prompt

**File:** `src/lib/chat-system-prompt.ts`

### 5.1 Prompt Requirements

The system prompt instructs GPT-4o to:

1. **Role:** Act as a personal shopping concierge for an AI-powered shopping assistant
2. **Clarify before searching:** Ask 1-2 clarifying questions (use case, size, color, budget, brand) before calling `searchProducts` — don't search on vague first messages
3. **Use preferences:** Reference user's saved size preferences (tops, bottoms, footwear) when available in conversation context
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

### 5.2 Prompt Template

```typescript
export const SHOPPING_CONCIERGE_SYSTEM_PROMPT = `You are a personal shopping concierge for an AI-powered shopping assistant.

Your goal is to help users discover and purchase products from Amazon.

## Behavior
- When a user first describes what they want, ask 1-2 brief clarifying questions about their preferences (size, color, budget, use case, brand preference) before searching.
- Once you have enough context, call the searchProducts tool to find matching products.
- After receiving search results, present them with a brief rationale for each recommendation.
- If the user asks for more details about a specific product, call getProductDetails.
- Never make up product information. Only present data returned by tools.

## Formatting
- Use markdown formatting in your responses.
- Bold product names when referencing them.
- Use bullet points for comparisons or feature lists.
- Keep responses concise — 2-3 sentences of commentary per search result set.

## Scope
- Only assist with product discovery and shopping.
- If asked about unrelated topics, politely redirect to shopping.
- Do not provide medical, legal, or financial advice.
`;
```

---

## 6. Tool Definitions

**File:** `src/services/product-tools.ts`

### 6.1 `searchProducts` Tool

```typescript
import { tool } from "ai";
import { z } from "zod";
import { getProductService } from "./product-service";

export const searchProductsTool = tool({
  description:
    "Search Amazon for products matching the user's criteria. Call this when you have enough context about what the user wants (after clarifying questions).",
  inputSchema: z.object({
    query: z.string().describe("Search query derived from conversation context"),
    category: z
      .string()
      .optional()
      .describe("Product category (e.g., shoes, electronics, clothing)"),
    minPrice: z
      .number()
      .optional()
      .describe("Minimum price in USD dollars (not cents)"),
    maxPrice: z
      .number()
      .optional()
      .describe("Maximum price in USD dollars (not cents)"),
    size: z.string().optional().describe("Size preference if applicable"),
    color: z.string().optional().describe("Color preference if applicable"),
  }),
  execute: async (params) => {
    const service = getProductService();
    return service.search(params);
  },
});
```

### 6.2 `getProductDetails` Tool

```typescript
export const getProductDetailsTool = tool({
  description:
    "Get detailed information about a specific product by its ID. Call this when the user asks for more details, specifications, or additional images for a product.",
  inputSchema: z.object({
    productId: z.string().describe("The product ID to retrieve details for"),
  }),
  execute: async ({ productId }) => {
    const service = getProductService();
    return service.getDetails(productId);
  },
});
```

### 6.3 Tool Output Shapes

What GPT-4o sees after tool execution (returned to the model as tool results, and streamed to the frontend as `tool-invocation` part with `state: "result"`):

**`searchProducts` output:**
```typescript
{
  products: ProductCard[],  // 3-5 products
  totalResults: number,
  query: string
}
```

**`getProductDetails` output:**
```typescript
ProductDetail | null  // null if product not found
```

---

## 7. Product Service

### 7.1 Interface

**File:** `src/services/product-service.ts`

```typescript
import { ProductCard, ProductDetail, ProductSearchParams, ProductSearchResult } from "@/types/product";

export interface ProductService {
  search(params: ProductSearchParams): Promise<ProductSearchResult>;
  getDetails(productId: string): Promise<ProductDetail | null>;
}

// Factory — swap implementation via env var
export function getProductService(): ProductService {
  const provider = process.env.PRODUCT_SERVICE ?? "mock";

  switch (provider) {
    case "amazon":
      // Future: return new AmazonProductService();
      throw new Error("Amazon PA-API service not yet implemented");
    case "mock":
    default:
      return new MockProductService();
  }
}
```

### 7.2 Types

**File:** `src/types/product.ts`

```typescript
// Aligned with PRD ProductCard schema (docs/PRD.md line 99-115)
export interface ProductCard {
  id: string;
  name: string;
  image: string;
  images?: string[];
  price: number;              // in cents (per PRD)
  currency: "USD";
  sizes: string[];
  colors: ColorOption[];
  retailer: string;           // "Amazon"
  product_url: string;
  rating?: number;            // 1-5 scale
  reviewCount?: number;
  brand?: string;
  description?: string;
  category?: string;
}

export interface ColorOption {
  name: string;
  hex: string;
}

export interface ProductDetail extends ProductCard {
  fullDescription: string;
  specifications: Record<string, string>;
  images: string[];
  availability: "in_stock" | "limited" | "out_of_stock";
}

export interface ProductSearchParams {
  query: string;
  category?: string;
  minPrice?: number;          // USD dollars (tool input)
  maxPrice?: number;          // USD dollars (tool input)
  size?: string;
  color?: string;
  limit?: number;             // default 5
}

export interface ProductSearchResult {
  products: ProductCard[];
  totalResults: number;
  query: string;
}
```

### 7.3 Mock Product Service

**File:** `src/services/mock-product-service.ts`

**Responsibilities:**
- Implements `ProductService` interface
- Contains 15-20 hardcoded products across categories: shoes, electronics, clothing, accessories, home
- `search()` — filters by keyword match on name/description/category, price range (convert tool's USD dollars to cents for comparison), category match, returns up to `limit` results (default 5)
- `getDetails()` — returns full `ProductDetail` by ID, or `null` if not found
- Simulates 300-800ms async delay to mimic real API latency
- Mock data uses realistic Amazon-style product names, prices, image placeholder URLs

**Mock data example (one product):**
```typescript
{
  id: "mock-001",
  name: "Nike Air Zoom Pegasus 41 Running Shoes",
  image: "https://placehold.co/400x400/1a1a21/ffffff?text=Nike+Pegasus",
  images: [
    "https://placehold.co/400x400/1a1a21/ffffff?text=Nike+Pegasus+1",
    "https://placehold.co/400x400/1a1a21/ffffff?text=Nike+Pegasus+2",
  ],
  price: 12995,  // $129.95
  currency: "USD",
  sizes: ["8", "8.5", "9", "9.5", "10", "10.5", "11", "12"],
  colors: [
    { name: "Black", hex: "#000000" },
    { name: "White", hex: "#FFFFFF" },
    { name: "Blue", hex: "#1E40AF" },
  ],
  retailer: "Amazon",
  product_url: "https://amazon.com/dp/MOCK001",
  rating: 4.5,
  reviewCount: 2847,
  brand: "Nike",
  description: "Responsive cushioning for everyday runs",
  category: "shoes",
}
```

---

## 8. Environment Configuration

### 8.1 Required Environment Variables

```env
# OpenAI — required
OPENAI_API_KEY=sk-...

# Product service provider — optional, defaults to "mock"
PRODUCT_SERVICE=mock
```

### 8.2 Future Environment Variables (Amazon PA-API)

```env
PRODUCT_SERVICE=amazon
AMAZON_ACCESS_KEY=...
AMAZON_SECRET_KEY=...
AMAZON_PARTNER_TAG=...
AMAZON_MARKETPLACE=www.amazon.com
```

---

## 9. Future: Amazon PA-API 5.0 Integration

When replacing mock with real Amazon data:

1. Create `src/services/amazon-product-service.ts` implementing `ProductService` interface
2. Use PA-API 5.0 operations:
   - `SearchItems` → maps to `search()`
   - `GetItems` → maps to `getDetails()`
3. **Requirements:** Approved Amazon Associates account + PA-API access
4. **Rate limits:** 1 req/sec sustained, burst up to 10
5. **Response mapping:** Map PA-API `Item` fields to `ProductCard`/`ProductDetail` types
6. **Caching:** Cache search results in Redis (TTL 1 hour) to minimize API calls and stay within rate limits
7. **Swap:** Set `PRODUCT_SERVICE=amazon` in env — factory function handles the rest

---

## 10. Implementation Sequence

| Step | Task | Depends On | File |
|------|------|------------|------|
| 1 | Define product types | — | `src/types/product.ts` |
| 2 | Create product service interface + factory | Step 1 | `src/services/product-service.ts` |
| 3 | Implement mock product service | Step 2 | `src/services/mock-product-service.ts` |
| 4 | Write system prompt | — | `src/lib/chat-system-prompt.ts` |
| 5 | Define tool schemas + execute functions | Steps 2, 3 | `src/services/product-tools.ts` |
| 6 | Create API route handler | Steps 4, 5 | `src/app/api/chat/route.ts` |
| 7 | Test with curl / AI SDK client | Step 6 | Manual testing |

---

## 11. Testing the API

### 11.1 Curl Test

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "id": "1",
        "role": "user",
        "parts": [{ "type": "text", "text": "Find me running shoes under $150" }]
      }
    ]
  }'
```

Response: SSE stream with text tokens and tool invocation events.

### 11.2 Expected Conversation Flow

1. **User:** "I need new shoes"
2. **AI (text):** "What kind of shoes? Running, casual, formal? Any budget or color preference?"
3. **User:** "Running shoes, black, under $150"
4. **AI (tool call):** `searchProducts({ query: "black running shoes", maxPrice: 150, color: "black", category: "shoes" })`
5. **AI (tool result):** `{ products: [...], totalResults: 4, query: "black running shoes" }`
6. **AI (text):** "Here are some great options: **Nike Air Zoom Pegasus 41** — great all-rounder at $129.95..."

---

## 12. Dependencies (Backend Only)

| Package | Version | Purpose |
|---------|---------|---------|
| `ai` | `^5.x` | Vercel AI SDK core (`streamText`, `tool`, `UIMessage`, `stepCountIs`, `convertToModelMessages`) |
| `@ai-sdk/openai` | `^1.x` | OpenAI provider for AI SDK |
| `zod` | `^3.x` | Tool input schema validation |

---

## 13. Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | **Amazon Associates account approval** | Blocks real product data; mock service covers dev |
| 2 | **Chat history persistence** | PRD defines `chat_sessions` + `chat_messages` tables; API needs session endpoints (separate spec) |
| 3 | **Rate limiting on `/api/chat`** | GPT-4o costs ~$5/1M input tokens; need per-user limits (PRD: 30 req/min authenticated) |
| 4 | **Authentication middleware** | Should `/api/chat` require JWT auth? PRD says yes; needs auth middleware integration |
| 5 | **Image proxy for Amazon images** | PA-API images may need proxying to avoid CORS/hotlinking issues |

---

## Related Documents

| Document | Path |
|----------|------|
| PRD | `docs/PRD.md` |
| System Design | `docs/SYSTEM_DESIGN.md` |
| Frontend PRD | `docs/frontend-PRD.md` |
| Development Rules | `.claude/workflows/development-rules.md` |

---

*Document created: March 10, 2026*
*Last updated: March 11, 2026 — Refined to backend API only, removed all frontend/UI specs*
