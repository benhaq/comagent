# Quickstart: Auth Service & Wallet Association

## Prerequisites

1. Crossmint account with a **staging** project
2. Server-side API key with scopes: `wallets.create`, `users.read`
3. PostgreSQL database (Neon) accessible via `DATABASE_URL`

## Environment Setup

Add to `.env`:

```env
CROSSMINT_SERVER_API_KEY=sk_staging_...
CROSSMINT_API_URL=https://staging.crossmint.com  # optional, defaults to staging
```

Remove (no longer needed):
```env
# AUTH_TOKEN=...  ← replaced by Crossmint JWT auth
```

## Install Dependencies

```bash
bun add @crossmint/server-sdk
```

## Run Migration

```bash
bun run db:generate
bun run db:migrate
```

## Verify

1. Start the server: `bun run dev`
2. Without cookies → `GET /api/auth/profile` returns 401
3. With valid Crossmint JWT cookie → returns profile with wallet address

## Testing with Crossmint Staging

To get valid JWT cookies for testing:
1. Set up `@crossmint/client-sdk-react-ui` on a frontend (or use Crossmint's test tools)
2. Complete OTP flow — browser receives `crossmint-jwt` and `crossmint-refresh-token` cookies
3. Forward these cookies to your backend API

## Key Files

| File | Purpose |
|------|---------|
| `src/middleware/auth.ts` | Crossmint JWT validation + user/wallet provisioning |
| `src/db/schema/users.ts` | Users table schema (Drizzle) |
| `src/routes/auth.ts` | `/api/auth/profile` and `/api/auth/logout` |
| `src/services/wallet-service.ts` | Crossmint wallet provisioning logic |
| `src/lib/crossmint.ts` | Crossmint SDK initialization |
