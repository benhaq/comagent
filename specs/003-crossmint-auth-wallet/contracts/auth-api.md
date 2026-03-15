# API Contract: Auth Endpoints

**Feature**: 003-crossmint-auth-wallet
**Base Path**: `/api/auth`

---

## GET /api/auth/profile

Returns the authenticated user's profile including wallet info.

**Auth**: Required (Crossmint JWT cookie)

**Response 200**:
```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
  "walletStatus": "active"
}
```

**Response 401**:
```json
{
  "error": "Unauthorized",
  "code": "UNAUTHORIZED"
}
```

---

## POST /api/auth/logout

Logs out the user by clearing Crossmint JWT cookies.

**Auth**: Required (Crossmint JWT cookie)

**Response 200**:
```json
{
  "success": true
}
```

**Response 401**:
```json
{
  "error": "Unauthorized",
  "code": "UNAUTHORIZED"
}
```

---

## Auth Middleware Contract

Applied to all `/api/*` routes.

**Input**: Reads `crossmint-jwt` and `crossmint-refresh-token` cookies from request.

**Behavior**:
1. Extract cookies → call `crossmintAuth.getSession({ jwt, refreshToken })`
2. On success: set `c.set("userId", userId)`, `c.set("userEmail", email)`
3. On JWT refresh: set updated `Set-Cookie` headers
4. On first-time user: create `users` row + provision Crossmint wallet
5. On failure: return 401

**Hono Variables Set**:
| Variable | Type | Description |
|----------|------|-------------|
| `userId` | `string` | Internal `users.id` (UUID) |
| `userEmail` | `string` | User's email address |

---

## External API Dependencies

### Crossmint Auth (server-sdk)

- `crossmintAuth.getSession({ jwt, refreshToken })` → `{ jwt, refreshToken, userId }`
- `crossmintAuth.getUser(userId)` → `{ email, ... }`
- `crossmintAuth.logout(req, res)` — clears cookies

### Crossmint Wallets REST API

- `POST https://{CROSSMINT_API_URL}/api/2025-06-09/wallets`
- Headers: `X-API-KEY: {CROSSMINT_SERVER_API_KEY}`
- Body: `{ chainType: "evm", linkedUser: "email:<email>", config: { adminSigner: { type: "evm-fireblocks-custodial" } } }`
- Response: `{ address: "0x...", ... }`
