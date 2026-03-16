# Onboarding Service Design

## Overview

3-step mandatory onboarding flow for first-time registered users, modeled after app.purch.xyz. Users must complete all steps before accessing protected routes (chat, sessions, etc.). Backend API only — no frontend in this scope.

## Steps

| Step | Title | Fields |
|------|-------|--------|
| 1 | Let's Get to Know You | displayName |
| 2 | Where Should I Ship To? | firstName, lastName, street, apt (opt), country, city, state (opt), zip |
| 3 | What Sizes Fit You | topsSize, bottomsSize, footwearSize |

## Database Schema

Extend existing `users` table with 13 new columns:

```sql
onboarding_step    INTEGER NOT NULL DEFAULT 0
display_name       VARCHAR(100)
first_name         VARCHAR(50)
last_name          VARCHAR(50)
street             VARCHAR(200)
apt                VARCHAR(50)
country            VARCHAR(2)       -- ISO 3166-1 alpha-2
city               VARCHAR(100)
state              VARCHAR(100)
zip                VARCHAR(20)
tops_size          VARCHAR(10)      -- XXS, XS, S, M, L, XL, XXL
bottoms_size       VARCHAR(10)      -- 26-38 or custom
footwear_size      VARCHAR(10)      -- 5-13 or custom
```

Supported countries (initial): US, GB, AU, CA, DE, FR, JP, SG

## API Endpoints

All endpoints require `authMiddleware`.

### POST /api/onboarding/step-1

```typescript
Body: { displayName: string }  // min 1, max 100
Saves: display_name, onboarding_step = 1
Response: { success: true, step: 1 }
```

### POST /api/onboarding/step-2

```typescript
Body: {
  firstName: string,    // min 1, max 50
  lastName: string,     // min 1, max 50
  street: string,       // min 5, max 200
  apt?: string,         // max 50
  country: string,      // enum: US|GB|AU|CA|DE|FR|JP|SG
  city: string,         // min 2, max 100
  state?: string,       // max 100
  zip: string           // min 3, max 20
}
Guards: onboarding_step >= 1
Saves: address fields, onboarding_step = 2
Response: { success: true, step: 2 }
```

### POST /api/onboarding/step-3

```typescript
Body: {
  topsSize: string,     // enum: XXS|XS|S|M|L|XL|XXL
  bottomsSize: string,  // max 10
  footwearSize: string  // max 10
}
Guards: onboarding_step >= 2
Saves: size fields, onboarding_step = 3
Response: { success: true, step: 3 }
```

### GET /api/onboarding/status

```typescript
Response: { step: 0|1|2|3, completed: boolean }
```

## Onboarding Gate Middleware

New `onboardingGate` middleware applied to protected routes — NOT applied to `/api/onboarding/*` or `/api/auth/*`.

```
authMiddleware → onboardingGate → route handler

if user.onboardingStep < 3 → 403 { code: "ONBOARDING_INCOMPLETE", step: N }
else → next()
```

## Profile Extension

`GET /api/auth/profile` response extended with `onboardingStep` field.

## Decisions

- No avatar generation — deferred to future iteration
- No separate tables — all fields on `users` table for simplicity
- Short country list — expandable later
- Step ordering enforced server-side via guards
- All 3 steps mandatory — no skip option
