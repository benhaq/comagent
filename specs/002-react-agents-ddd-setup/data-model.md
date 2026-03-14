# Data Model: ReAct Chat Agents Codebase Setup

**Branch**: `002-react-agents-ddd-setup` | **Date**: 2026-03-12

## Database: PostgreSQL

### Table: `chat_sessions`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Session identifier |
| `user_id` | `uuid` | NOT NULL, INDEX | Owning user (stub: hardcoded UUID) |
| `title` | `varchar(100)` | Nullable | Session title (auto-generated or user-set) |
| `created_at` | `timestamp` | NOT NULL, default `NOW()` | Creation time |
| `updated_at` | `timestamp` | NOT NULL, default `NOW()`, INDEX | Last activity time |

**Indexes**:
- `idx_chat_sessions_user_id` on `user_id` — fast session listing per user
- `idx_chat_sessions_updated_at` on `updated_at` — ordering sessions by recency

### Table: `chat_messages`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Message identifier |
| `session_id` | `uuid` | FK → `chat_sessions(id)` ON DELETE CASCADE, INDEX | Parent session |
| `role` | `varchar(10)` | NOT NULL, CHECK IN ('user', 'assistant', 'system') | Sender role |
| `content` | `jsonb` | NOT NULL | Entire `message.parts[]` array as JSONB |
| `created_at` | `timestamp` | NOT NULL, default `NOW()` | Message timestamp |

**Indexes**:
- `idx_chat_messages_session_id` on `session_id` — fast message retrieval per session

**JSONB content structure** (all message types stored uniformly):
```json
[
  { "type": "text", "text": "Here are some running shoes..." },
  { "type": "tool-invocation", "toolName": "searchProducts", "state": "result", "output": { "products": [...] } }
]
```

## Cache: Redis (Standalone)

### Key Patterns

| Pattern | Type | TTL | Description |
|---------|------|-----|-------------|
| `session:{sessionId}` | JSON string | 1 hour | Cached session metadata |
| `products:search:{queryHash}` | JSON string | 15 min | Cached product search results |
| `products:detail:{productId}` | JSON string | 30 min | Cached product detail |
| `health:redis` | string | — | Health check key (set/get) |

### Connection Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Mode | Standalone | Single instance, no cluster |
| `maxRetriesPerRequest` | 3 | Retry on transient failures |
| `lazyConnect` | true | Connect on first use, not import |
| `enableReadyCheck` | true | Verify connection before operations |

## Domain Types (TypeScript — not persisted)

### ProductCard

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique product identifier (ASIN) |
| `name` | `string` | Yes | Product name |
| `image` | `string` | Yes | Primary image URL |
| `images` | `string[]` | No | Additional image URLs |
| `price` | `number` | Yes | Price in cents |
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

### ProductDetail (extends ProductCard)

| Field | Type | Description |
|-------|------|-------------|
| `fullDescription` | `string` | Complete product description |
| `specifications` | `Record<string, string>` | Key-value specifications |
| `images` | `string[]` | All product images (required) |
| `availability` | `"in_stock" \| "limited" \| "out_of_stock"` | Stock status |

### ColorOption

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Color name |
| `hex` | `string` | Hex color code |

### ProductSearchParams

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | `string` | Yes | Search query |
| `category` | `string` | No | Category filter |
| `minPrice` | `number` | No | Min price in USD dollars |
| `maxPrice` | `number` | No | Max price in USD dollars |
| `size` | `string` | No | Size filter |
| `color` | `string` | No | Color filter |
| `limit` | `number` | No | Max results (default 5) |

### ProductSearchResult

| Field | Type | Description |
|-------|------|-------------|
| `products` | `ProductCard[]` | Matching products |
| `totalResults` | `number` | Total matches found |
| `query` | `string` | Search query used |

## Entity Relationships

```
User (stub: hardcoded UUID)
  └── has many ChatSession
        └── has many ChatMessage (cascade delete)

ProductService (Effect service interface)
  ├── MockProductService (dev/test)
  ├── ScrapingProductService (production)
  └── AmazonProductService (future)

CacheService (Effect service interface)
  └── RedisCacheService (ioredis standalone)
```

## Effect Error Types

| Error Type | Service | HTTP Status | Description |
|------------|---------|-------------|-------------|
| `ProductNotFound` | ProductService | 404 | Product ID does not exist |
| `ScrapingServiceUnavailable` | ProductService | 503 | Scraping service down/timeout |
| `SessionNotFound` | ChatSessionService | 404 | Session ID missing or wrong user |
| `AIServiceError` | Chat route | 502 | OpenAI API failure |
| `DatabaseError` | All DB operations | 500 | Drizzle/PostgreSQL failure |
| `ValidationError` | Route layer | 400 | Zod validation failure |
| `CacheError` | CacheService | — (logged, not returned) | Redis operation failure |
| `CacheNotFound` | CacheService | — (cache miss, not error) | Key not in cache |
