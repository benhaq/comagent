# API Contracts: ReAct Chat Agents Backend

**Branch**: `002-react-agents-ddd-setup` | **Date**: 2026-03-12

## Authentication

All endpoints (except `GET /health`) require:
```
Authorization: Bearer <STATIC_TOKEN>
```
Stub auth: validates a known static token from env `AUTH_TOKEN`, injects hardcoded `userId` into request context. Returns `401 Unauthorized` if missing/invalid.

## Endpoints

### `GET /health`

**Description**: Service readiness check (no auth required)

**Response** `200 OK`:
```json
{
  "status": "ok",
  "uptime": 12345
}
```

---

### `POST /api/chat`

**Description**: Send a message and receive streaming ReAct agent response via SSE

**Request**:
```json
{
  "messages": [
    {
      "role": "user",
      "content": "find me running shoes under $100"
    }
  ],
  "sessionId": "uuid-optional"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | `UIMessage[]` | Yes | Full session message history |
| `sessionId` | `string (uuid)` | No | Existing session ID. Omit to auto-create. |

**Response** `200 OK` — SSE stream (`Content-Type: text/event-stream`):

Text part event:
```
data: {"type":"text","text":"Let me search for "}
```

Tool invocation call event:
```
data: {"type":"tool-invocation","toolName":"searchProducts","state":"call","input":{"query":"running shoes","maxPrice":100}}
```

Tool invocation result event:
```
data: {"type":"tool-invocation","toolName":"searchProducts","state":"result","output":{"products":[...],"totalResults":15,"query":"running shoes"}}
```

**Errors**:

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid request body |
| 401 | `UNAUTHORIZED` | Missing/invalid auth token |
| 502 | `AI_SERVICE_ERROR` | OpenAI API failure |
| 500 | `INTERNAL_ERROR` | Unhandled server error |

---

### `POST /api/sessions`

**Description**: Create a new chat session

**Request**:
```json
{
  "title": "Optional custom title"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | No | Custom title (max 100 chars). Auto-generated if omitted. |

**Response** `201 Created`:
```json
{
  "id": "uuid",
  "title": null,
  "createdAt": "2026-03-12T10:00:00Z",
  "updatedAt": "2026-03-12T10:00:00Z"
}
```

---

### `GET /api/sessions`

**Description**: List user's chat sessions (most recent first)

**Query Parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | `number` | 20 | Max sessions to return |
| `offset` | `number` | 0 | Pagination offset |

**Response** `200 OK`:
```json
{
  "sessions": [
    {
      "id": "uuid",
      "title": "Running shoes under $100",
      "createdAt": "2026-03-12T10:00:00Z",
      "updatedAt": "2026-03-12T10:05:00Z"
    }
  ],
  "total": 42
}
```

---

### `GET /api/sessions/:id`

**Description**: Get session with all messages

**Response** `200 OK`:
```json
{
  "session": {
    "id": "uuid",
    "title": "Running shoes under $100",
    "createdAt": "2026-03-12T10:00:00Z",
    "updatedAt": "2026-03-12T10:05:00Z"
  },
  "messages": [
    {
      "id": "uuid",
      "role": "user",
      "content": [{ "type": "text", "text": "find me running shoes" }],
      "createdAt": "2026-03-12T10:00:00Z"
    },
    {
      "id": "uuid",
      "role": "assistant",
      "content": [
        { "type": "text", "text": "Here are some options..." },
        { "type": "tool-invocation", "toolName": "searchProducts", "state": "result", "output": {} }
      ],
      "createdAt": "2026-03-12T10:00:03Z"
    }
  ]
}
```

**Errors**:

| Status | Code | Description |
|--------|------|-------------|
| 404 | `SESSION_NOT_FOUND` | Session doesn't exist or wrong user |

---

### `DELETE /api/sessions/:id`

**Description**: Delete session and all messages (cascade)

**Response**: `204 No Content`

**Errors**:

| Status | Code | Description |
|--------|------|-------------|
| 404 | `SESSION_NOT_FOUND` | Session doesn't exist or wrong user |

---

## Error Response Shape (all endpoints)

```json
{
  "error": "Human-readable message (sanitized, no internals)",
  "code": "MACHINE_READABLE_CODE"
}
```

## Tool Schemas (AI SDK)

### `searchProducts`

**Input** (Zod):
```typescript
z.object({
  query: z.string().describe("Search query from conversation context"),
  category: z.string().optional().describe("Product category"),
  minPrice: z.number().optional().describe("Min price in USD dollars"),
  maxPrice: z.number().optional().describe("Max price in USD dollars"),
  size: z.string().optional().describe("Size preference"),
  color: z.string().optional().describe("Color preference"),
})
```

**Output**: `ProductSearchResult`

### `getProductDetails`

**Input** (Zod):
```typescript
z.object({
  productId: z.string().describe("Product ID to retrieve details for"),
})
```

**Output**: `ProductDetail | null`
