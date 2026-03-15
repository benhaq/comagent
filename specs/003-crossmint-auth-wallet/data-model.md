# Data Model: Auth Service & Wallet Association via Crossmint

**Feature**: 003-crossmint-auth-wallet
**Date**: 2026-03-15

## Entities

### users

New table — stores authenticated users and their Crossmint wallets.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Internal user ID |
| `crossmint_user_id` | `varchar(255)` | UNIQUE, NOT NULL | Crossmint's user ID from `getSession()` |
| `email` | `varchar(320)` | NOT NULL | User email from Crossmint profile |
| `wallet_address` | `varchar(42)` | nullable | Base EVM wallet address (`0x...`) |
| `crossmint_wallet_id` | `varchar(255)` | nullable | Crossmint internal wallet ID |
| `wallet_status` | `varchar(20)` | NOT NULL, default `'none'` | `none` / `pending` / `active` / `failed` |
| `created_at` | `timestamp` | NOT NULL, default `now()` | Row creation time |
| `updated_at` | `timestamp` | NOT NULL, default `now()` | Last update time |

**Indexes**:
- `idx_users_crossmint_user_id` on `crossmint_user_id` (unique)
- `idx_users_email` on `email`

**Relationships**:
- `chat_sessions.user_id` will reference `users.id` (future migration — not in this feature scope, existing sessions use hardcoded UUID)

### State Transitions: wallet_status

```
none → pending → active
               → failed → pending (retry on next request)
```

- `none`: User created, wallet not yet requested
- `pending`: Crossmint wallet API called, awaiting response
- `active`: Wallet provisioned, `wallet_address` populated
- `failed`: Provisioning failed, can retry

## Validation Rules

- `crossmint_user_id`: Must be non-empty string, unique per row
- `email`: Must be valid email format (validated by Crossmint, not re-validated)
- `wallet_address`: Must match `^0x[a-fA-F0-9]{40}$` when present
- `wallet_status`: Must be one of `none`, `pending`, `active`, `failed`

## Runtime-Only (Not Persisted)

### AuthContext (Hono Variables)

Set by auth middleware on `c.set()`:

| Variable | Type | Source |
|----------|------|--------|
| `userId` | `string` | `crossmintAuth.getSession()` → `userId` |
| `userEmail` | `string` | `crossmintAuth.getUser(userId)` → `email` |

## Migration Notes

- New migration file: `src/db/migrations/XXXX_add_users_table.sql`
- Generated via `bunx drizzle-kit generate`
- Schema file: `src/db/schema/users.ts`
- Must be added to `db/client.ts` schema imports
