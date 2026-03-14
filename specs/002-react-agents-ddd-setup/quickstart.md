# Quickstart: ReAct Chat Agents Backend

**Branch**: `002-react-agents-ddd-setup` | **Date**: 2026-03-12

## Prerequisites

- Bun 1.x+ installed (`curl -fsSL https://bun.sh/install | bash`)
- Docker & Docker Compose (for PostgreSQL + Redis)
- OpenAI API key with GPT-4o access

## 1. Clone & Install

```bash
git clone <repo-url> && cd comagent
git checkout 002-react-agents-ddd-setup
bun install
```

## 2. Environment Setup

```bash
cp .env.example .env
```

Edit `.env`:
```bash
# Required
DATABASE_URL=postgresql://comagent:comagent@localhost:5432/comagent
OPENAI_API_KEY=sk-your-key-here
AUTH_TOKEN=dev-token-change-in-production

# Optional
PORT=3000
PRODUCT_SERVICE=mock
REDIS_URL=redis://localhost:6379
LOG_LEVEL=info
```

## 3. Start Infrastructure

```bash
docker compose up -d postgres redis
```

Wait for health checks:
```bash
docker compose ps  # Both should show "healthy"
```

## 4. Run Database Migrations

```bash
bunx drizzle-kit generate   # Generate migration SQL from schema
bunx drizzle-kit migrate    # Apply migrations to PostgreSQL
```

## 5. Start the Server

```bash
bun run dev
```

Expected output:
```
{"level":"info","service":"comagent","msg":"Drizzle connected to PostgreSQL"}
{"level":"info","service":"comagent","msg":"Redis connected (standalone)"}
{"level":"info","service":"comagent","msg":"Effect layers initialized: ProductService(mock), ChatSessionService, CacheService"}
{"level":"info","service":"comagent","msg":"Hono server listening on port 3000"}
```

## 6. Verify

```bash
# Health check
curl http://localhost:3000/health

# Create a session
curl -X POST http://localhost:3000/api/sessions \
  -H "Authorization: Bearer dev-token-change-in-production" \
  -H "Content-Type: application/json"

# Send a chat message (SSE stream)
curl -N -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer dev-token-change-in-production" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "find me running shoes under $100"}]}'
```

## Docker (Full Stack)

Run everything in Docker:
```bash
docker compose up
```

This starts: PostgreSQL + Redis + migrations + app server.

## Common Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server |
| `bun test` | Run test suite |
| `bunx drizzle-kit generate` | Generate migration from schema changes |
| `bunx drizzle-kit migrate` | Apply pending migrations |
| `bunx drizzle-kit studio` | Open Drizzle Studio (DB browser) |
| `docker compose up -d` | Start all services (background) |
| `docker compose down` | Stop all services |
| `docker compose logs -f app` | Tail app logs |

## Switching Product Service

```bash
# Mock (default — no external deps)
PRODUCT_SERVICE=mock bun run dev

# Scraping (requires external service)
PRODUCT_SERVICE=scraping SCRAPING_SERVICE_URL=https://... SCRAPING_SERVICE_API_KEY=... bun run dev
```
