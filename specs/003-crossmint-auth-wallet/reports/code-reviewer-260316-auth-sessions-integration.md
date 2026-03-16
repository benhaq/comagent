# Code Review Summary

## Scope
- Files reviewed: `src/lib/errors.ts`, `src/middleware/error-handler.ts`, `src/middleware/auth.ts`, `src/middleware/auth-provision.ts`, `src/db/schema/chat-sessions.ts`, `src/db/schema/chat-messages.ts`, `src/db/schema/relations.ts`, `src/db/client.ts`, `src/services/chat-session-service.ts`, `src/services/chat-session-service-live.ts`, `src/routes/sessions.ts`, `src/routes/chat.ts`, `src/routes/auth.ts`, `src/index.ts`, `tests/integration/sessions.test.ts`, `tests/integration/chat-session.test.ts`
- Lines of code analyzed: ~800 source + ~700 test
- Review focus: Auth + Chat Sessions Integration (003-crossmint-auth-wallet + session routes)

## Overall Assessment

Solid implementation. Auth middleware is correctly split into validation (`auth.ts`) and provisioning (`auth-provision.ts`). Ownership enforcement uses `assertOwnership` consistently across all mutation paths. Effect integration follows existing patterns. Three issues warrant immediate attention — one **critical** (TOCTOU race in ownership), one **high** (silent rename result), one **high** (NaN pagination param). The rest are low.

---

## Critical Issues

### 1. TOCTOU Race in `rename` — ownership check and UPDATE use separate queries

**File**: `src/services/chat-session-service-live.ts` L85-98

`assertOwnership` fetches the session, then `rename` does a separate `UPDATE WHERE id=... AND userId=...`. Between the two queries another concurrent request could delete the session, causing the UPDATE to silently return 0 rows — `rows[0]` would be `undefined`, and `rename` returns `undefined` cast as `ChatSession`.

```ts
// current — two round trips, silent undefined on race
assertOwnership(sessionId, userId).pipe(
  Effect.flatMap(() =>
    db.update(chatSessions)
      .set(...)
      .where(and(eq(...id), eq(...userId)))
      .returning()
      .then((rows) => rows[0]),   // <-- undefined if concurrent delete wins
  )
)
```

**Fix**: Check `rows[0]` after the UPDATE and fail with `SessionNotFound` if undefined:

```ts
.then((rows) => {
  if (!rows[0]) throw new SessionNotFound({ sessionId })
  return rows[0]
})
```

Or collapse ownership check and update into a single `UPDATE ... WHERE id=? AND userId=? RETURNING *` — on 0 rows, check existence to distinguish 403 vs 404.

---

## High Priority Findings

### 2. `rename` service returns `ChatSession` typed but can return `undefined`

**File**: `src/services/chat-session-service-live.ts` L94

The `.then((rows) => rows[0])` expression has type `ChatSession | undefined` but the Effect return type is `Effect<ChatSession, ...>`. TypeScript does not catch this because `rows[0]` from Drizzle is typed as `ChatSession` (not `ChatSession | undefined`) on some versions. At runtime, a concurrent delete would cause routes to respond `200` with `undefined` body serialized as `{}`. See fix above (issue 1).

### 3. Pagination `limit`/`offset` — `parseInt` of non-numeric string produces `NaN`, `Math.max(1, NaN)` returns `NaN`

**File**: `src/routes/sessions.ts` L74-75

```ts
const limit = rawLimit ? Math.max(1, Math.min(100, parseInt(rawLimit, 10))) : 20
const offset = rawOffset ? Math.max(0, parseInt(rawOffset, 10)) : 0
```

`parseInt("abc", 10)` → `NaN`. `Math.max(1, NaN)` → `NaN`. Drizzle passes `NaN` to the DB driver which throws or returns unexpected results.

**Fix**:
```ts
const parsedLimit = rawLimit ? parseInt(rawLimit, 10) : NaN
const parsedOffset = rawOffset ? parseInt(rawOffset, 10) : NaN
const limit = isNaN(parsedLimit) ? 20 : Math.max(1, Math.min(100, parsedLimit))
const offset = isNaN(parsedOffset) ? 0 : Math.max(0, parsedOffset)
```

---

## Medium Priority Improvements

### 4. `provisionNewUser` — wallet provisioning failure deletes user row unconditionally

**File**: `src/middleware/auth-provision.ts` L59-61

The rollback `db.delete(users).where(eq(users.id, internalUserId))` silently swallows DB errors. If the delete fails, the user row remains with `wallet_status: "pending"` and no wallet, yet the function returns 503. On the next request the `existingUser` query in `auth.ts` will find the user and set `userId` — skipping provisioning permanently. The user is stuck in `pending` state.

Options:
- On next auth for a `pending` user, re-attempt provisioning instead of treating them as fully provisioned.
- Or at minimum log the delete failure so it can be detected.

### 5. `addMessage` — `sessionId` FK not validated before insert

**File**: `src/services/chat-session-service-live.ts` L115-129

`addMessage` does not verify the session exists. If called with a stale/deleted `sessionId` (e.g. from the `onFinish` callback after session is deleted mid-stream), the insert will fail with a FK violation surfaced as `DatabaseError`. The error is already caught and logged (`chat.ts` L108), so it does not crash — but the error message is opaque. This is acceptable given current usage, but worth noting.

### 6. Cookie `httpOnly: false` on JWT cookie

**File**: `src/middleware/auth.ts` L44

```ts
setCookie(c, "crossmint-jwt", newJwt, { httpOnly: false, path: "/" })
```

`httpOnly: false` means the JWT is accessible to JavaScript. This is likely intentional (client-side SDK needs to read it), but it increases XSS surface. If the client SDK does not need to read the raw JWT, set `httpOnly: true`. At minimum, `secure: true` should be set for non-localhost origins.

---

## Low Priority Suggestions

### 7. `role` column is `varchar(10)` — "assistant" has 9 chars, will silently truncate if longer roles added

**File**: `src/db/schema/chat-messages.ts` L11

AI SDK roles include `"data"` and potentially `"tool"` (5-10 chars). Currently fine, but `varchar(10)` is tight. Consider `varchar(20)`.

### 8. `error-handler.ts` — `AuthenticationError` not mapped

**File**: `src/middleware/error-handler.ts`

`AuthenticationError` exists in `errors.ts` and is used in the codebase, but `error-handler.ts` does not have a branch for it. It falls through to the generic 500 handler. Auth failures in the middleware currently return early (not via `throw`), so this may never be hit — but adding the mapping would be consistent and defensive.

### 9. `chat.ts` — `existingMessages` constructed from DB but also appends `lastMsg` from request

**File**: `src/routes/chat.ts` L117-122

When `reqSessionId` is provided, `historyForModel` = DB messages + `lastMsg`. But the DB messages loaded via `getWithMessages` already include all previous messages including the last persisted user message from the prior request. The current user message (from request body) is then appended. This is correct. However, if the client sends the full conversation history (common with AI SDK), `messages` contains the entire history — only `lastMsg` is used for the model context. This diverges from the "client-owns-context" pattern. Low risk as long as clients only send the latest user message, but worth a code comment clarifying the expected client contract.

### 10. Test mock stale ID between `beforeAll` and test runs in `sessions.test.ts`

**File**: `tests/integration/sessions.test.ts` L99-109

`testUserId` is set in `beforeAll`. If the DB insert fails (e.g. unique constraint from a prior failed test run), `testUserId` is `undefined` and all tests silently use an undefined userId. Consider adding `!= null` assertion after `seedUser`. Minor since tests clean up in `afterAll`.

---

## Positive Observations

- `assertOwnership` is a clean, reusable helper that correctly separates 404 (not found) from 403 (wrong owner). All mutation methods use it.
- `ON CONFLICT DO NOTHING` + fallback `findFirst` correctly handles concurrent provisioning.
- Session ID propagated via `X-Session-Id` response header is clean — avoids changing streaming response body format.
- `Effect.either` wrapping at route boundaries is consistent. Tagged errors map to correct HTTP status codes.
- DB cascade configuration (`onDelete: "cascade"`) on `chatMessages.sessionId` → `chatSessions.id` and `chatSessions.userId` → `users.id` is correct and tested.
- Test coverage includes ownership enforcement (403 for cross-user access), cascade delete, pagination, and auto-create session path. Good breadth.
- `auth-provision.ts` extraction cleanly separates concerns from JWT validation in `auth.ts`.

---

## Recommended Actions

1. **[Critical]** Fix `rename` to handle 0-row UPDATE by checking `rows[0]` and failing with `SessionNotFound`.
2. **[High]** Fix NaN pagination: guard `parseInt` result with `isNaN` in `sessions.ts`.
3. **[Medium]** Add re-provisioning path for users stuck in `wallet_status: "pending"` in `auth.ts`, or at minimum log rollback errors in `auth-provision.ts`.
4. **[Low]** Add `secure: true` to `setCookie` calls for non-localhost environments.
5. **[Low]** Widen `role` column to `varchar(20)` and add `AuthenticationError` mapping to `error-handler.ts`.

---

## Metrics

- TypeScript: 0 type errors (`bunx tsc --noEmit` clean)
- Linting issues: Not run (no lint script defined)
- Test coverage: Integration tests cover all routes + ownership enforcement; no unit tests for service layer in isolation
- Plan tasks: 19/20 complete — T020 (quickstart validation) marked incomplete in `tasks.md`

---

## Task Status Update

- T020 `Run quickstart.md validation` — **not yet completed**, marked as such in tasks.md. All other tasks T001–T019 are marked complete.

## Unresolved Questions

1. Are JWT cookies intentionally `httpOnly: false`? If Crossmint's client-side SDK reads them from `document.cookie`, this is required — but `secure: true` should still be enforced for production.
2. What is the expected client contract for `POST /api/chat` — does the client send only the latest message, or the full history? The current implementation only uses `messages[messages.length - 1]` for context building when a session is reused, which will silently discard any history the client sends.
