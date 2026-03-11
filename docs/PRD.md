# AI Shopping Assistant - Product Requirements Document

## Document Information

| Field            | Value                                      |
|------------------|--------------------------------------------|
| **Version**      | 1.0                                        |
| **Date**         | March 9, 2026                              |
| **Status**       | Draft                                      |
| **Target**       | Q2 2026                                    |

---

## 1) Overview

### 1.1 Product Summary

AI-powered shopping assistant enabling users to discover products through conversational chat and purchase with USDC cryptocurrency on Sui blockchain.

### 1.2 Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, React 18, Tailwind CSS |
| State | Zustand |
| Blockchain | Sui Network |
| Wallet | @mysten/wallet-adapter |
| AI | OpenAI GPT-4 (configurable) |
| Database | PostgreSQL |
| Cache | Redis |

---

## 2) Features

### 2.1 Authentication & Wallet

**Requirements:**
- Wallet-based authentication using Sui address
- Support @mysten/wallet-adapter (Sui Wallet, Ethos, Suiet)
- JWT session tokens with 24-hour expiry
- Auto-session persistence via localStorage

**API Endpoints:**
```
POST /api/auth/connect     # Connect wallet, create session
POST /api/auth/disconnect  # Disconnect wallet, clear session
GET  /api/auth/me          # Get current user
```

### 2.2 Onboarding

**Requirements:**
- Multi-step form after first wallet connect
- Must complete before accessing main app

**Form Fields:**

| Step | Field | Type | Required | Validation |
|------|-------|------|----------|------------|
| 1 | first_name | string | yes | min 1, max 50 |
| 1 | last_name | string | yes | min 1, max 50 |
| 2 | street | string | yes | min 5, max 200 |
| 2 | apt | string | no | max 50 |
| 2 | city | string | yes | min 2, max 100 |
| 2 | state | string | no | max 100 |
| 2 | zip | string | yes | regex: ^\d{5}(-\d{4})?$ |
| 2 | country | string | yes | ISO 3166-1 alpha-2 |
| 3 | tops_size | enum | yes | XXS, XS, S, M, L, XL, XXL |
| 3 | bottoms_size | string | yes | 26-38 |
| 3 | footwear_size | string | yes | 5-13 |

**API Endpoints:**
```
POST /api/onboarding   # Submit onboarding data
GET  /api/onboarding   # Get onboarding status
```

### 2.3 AI Product Search (CHAT)

**Requirements:**
- Conversational interface with message history
- AI asks clarifying questions (use case, size, color, budget)
- Returns 3-5 curated product recommendations
- Product cards with image, name, price, size options
- One-click "Add to Cart" from product card

**Chat Message Types:**

| Type | Direction | Content |
|------|-----------|---------|
| user | client→server | Raw text message |
| ai_question | server→client | AI clarifying question |
| ai_products | server→client | Product recommendations |
| system | server→client | Errors, notices |

**Product Card Schema:**
```typescript
interface ProductCard {
  id: string;
  name: string;
  image: string;
  price: number;        // in cents
  currency: "USD";
  sizes: string[];      // available sizes
  colors: ColorOption[];
  retailer: string;
  product_url: string;
}

interface ColorOption {
  name: string;
  hex: string;
}
```

**API Endpoints:**
```
POST /api/chat         # Send message, get AI response
GET  /api/chat/history # Get chat history
DELETE /api/chat/:id   # Delete chat session
```

### 2.4 Shopping Cart

**Requirements:**
- Persistent cart (survives page refresh)
- Cart sidebar/drawer UI
- Add/remove items
- Quantity adjustment (1-10)
- Item details: product_id, name, image, price, size, color, quantity
- Subtotal calculation
- Cart indicator badge on header

**Cart Item Schema:**
```typescript
interface CartItem {
  id: string;
  product_id: string;
  name: string;
  image: string;
  price: number;      // cents
  size: string;
  color: string;
  quantity: number;
  added_at: timestamp;
}
```

**API Endpoints:**
```
GET    /api/cart              # Get cart
POST   /api/cart/items       # Add item
PATCH  /api/cart/items/:id   # Update quantity
DELETE /api/cart/items/:id   # Remove item
DELETE /api/cart             # Clear cart
```

### 2.5 Checkout

**Requirements:**
- "Checkout with USDC" button
- Order summary display (items, quantities, sizes, colors, prices)
- Pre-filled shipping address from profile
- Wallet balance check before checkout
- "Insufficient USDC balance" warning
- Transaction signing via wallet adapter
- Order confirmation with tx_hash

**Checkout Flow:**
1. User clicks "Checkout with USDC"
2. Backend fetches user's USDC balance from Sui
3. If balance < order total → show warning, disable checkout
4. If sufficient → display order summary
5. User confirms → wallet signs transaction
6. Backend submits to Sui, creates order record
7. Return order confirmation

**Order Schema:**
```typescript
interface Order {
  id: string;
  user_id: string;
  status: OrderStatus;
  items: OrderItem[];
  shipping_address: Address;
  subtotal: number;     // cents
  total: number;        // cents
  currency: "USD";
  tx_hash: string | null;
  created_at: timestamp;
  updated_at: timestamp;
}

type OrderStatus = "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled";
```

**API Endpoints:**
```
POST /api/checkout/prepare   # Get order summary, balance check
POST /api/checkout/complete  # Submit transaction
GET  /api/checkout/:id      # Get order details
```

### 2.6 Address Book

**Requirements:**
- Multiple addresses per user
- Set default address
- Add/edit/delete addresses
- Select address at checkout
- Address form validation

**Address Schema:**
```typescript
interface Address {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  street: string;
  apt: string | null;
  city: string;
  state: string | null;
  zip: string;
  country: string;        // ISO 3166-1 alpha-2
  is_default: boolean;
  created_at: timestamp;
}
```

**API Endpoints:**
```
GET    /api/addresses           # List addresses
POST   /api/addresses           # Create address
GET    /api/addresses/:id       # Get address
PATCH  /api/addresses/:id       # Update address
DELETE /api/addresses/:id      # Delete address
POST   /api/addresses/:id/set-default  # Set default
```

### 2.7 Order History

**Requirements:**
- List past orders with status
- "No orders yet" empty state
- Reorder functionality (add all items to cart)
- Order details view

**API Endpoints:**
```
GET  /api/orders            # List orders
GET  /api/orders/:id        # Get order details
POST /api/orders/:id/reorder  # Add items to cart
```

### 2.8 User Profile

**Requirements:**
- Display username, wallet address (truncated)
- Edit profile (name)
- View PURCH token balance
- Add USDC (link to wallet/funding)
- Logout

**API Endpoints:**
```
GET  /api/profile           # Get profile
PATCH /api/profile          # Update profile
GET  /api/profile/balance  # Get token balances
```

### 2.9 Chat History

**Requirements:**
- List past chat sessions
- Search chat history
- Delete chat session
- Edit chat title

---

## 3) Data Model

### 3.1 Database Schema

```sql
-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address VARCHAR(66) UNIQUE NOT NULL,
    username VARCHAR(50),
    purch_token_balance DECIMAL(20, 8) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- User preferences (sizes)
CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    tops_size VARCHAR(10),
    bottoms_size VARCHAR(10),
    footwear_size VARCHAR(10),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Addresses
CREATE TABLE addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    street VARCHAR(200) NOT NULL,
    apt VARCHAR(50),
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100),
    zip VARCHAR(20) NOT NULL,
    country VARCHAR(2) NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Orders
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    address_id UUID REFERENCES addresses(id),
    status VARCHAR(20) DEFAULT 'pending',
    subtotal INTEGER NOT NULL,  -- cents
    total INTEGER NOT NULL,     -- cents
    tx_hash VARCHAR(66),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Order items
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    product_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    image VARCHAR(500),
    price INTEGER NOT NULL,  -- cents
    size VARCHAR(20),
    color VARCHAR(50),
    quantity INTEGER NOT NULL DEFAULT 1
);

-- Cart (Redis-backed preferred)
-- Cart items stored in Redis with TTL of 30 days

-- Chat sessions
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Chat messages
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(10) NOT NULL,  -- 'user' | 'ai' | 'system'
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 3.2 Redis Keys

```
cart:{user_id}          # Hash of cart items, TTL 30 days
session:{token}         # JWT session, TTL 24 hours
```

---

## 4) API Contracts

### 4.1 Authentication

```typescript
// POST /api/auth/connect
Request: { wallet_address: string }
Response: { token: string, user: User }

// GET /api/auth/me
Headers: Authorization: Bearer {token}
Response: { user: User }
```

### 4.2 Cart

```typescript
// GET /api/cart
Headers: Authorization: Bearer {token}
Response: { items: CartItem[], subtotal: number }

// POST /api/cart/items
Headers: Authorization: Bearer {token}
Request: { product_id: string, name: string, image: string, price: number, size: string, color: string, quantity: number }
Response: { item: CartItem }
```

### 4.3 Checkout

```typescript
// POST /api/checkout/prepare
Headers: Authorization: Bearer {token}
Response: {
  order_id: string,
  items: CartItem[],
  subtotal: number,
  shipping_address: Address,
  usdc_balance: string,
  can_checkout: boolean
}

// POST /api/checkout/complete
Headers: Authorization: Bearer {token}
Request: { tx_signature: string }
Response: { order: Order }
```

---

## 5) Error Handling

### 5.1 HTTP Status Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request - invalid input |
| 401 | Unauthorized - invalid/missing token |
| 403 | Forbidden - insufficient permissions |
| 404 | Not Found - resource doesn't exist |
| 422 | Unprocessable - business logic error |
| 500 | Internal Server Error |

### 5.2 Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  }
}
```

### 5.3 Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| INSUFFICIENT_BALANCE | 422 | USDC balance < order total |
| CART_ITEM_NOT_FOUND | 404 | Cart item doesn't exist |
| ADDRESS_NOT_FOUND | 404 | Address doesn't exist |
| ORDER_NOT_FOUND | 404 | Order doesn't exist |
| INVALID_WALLET | 400 | Wallet address invalid |
| TRANSACTION_FAILED | 500 | Blockchain transaction failed |
| AI_SERVICE_UNAVAILABLE | 503 | LLM service down |

---

## 6) Security

| Requirement | Implementation |
|-------------|----------------|
| Authentication | JWT tokens, wallet signature verification |
| Input Validation | Zod schemas on all endpoints |
| Rate Limiting | 100 req/min IP, 30 req/min authenticated |
| SQL Injection | Parameterized queries, Prisma/DB ORM |
| XSS | React auto-escaping, Content-Security-Policy |
| CSRF | Same-origin policy, CSRF tokens |

---

## 7) Out of Scope

| Feature | Reason |
|---------|--------|
| Outfit Preview | Not core to purchase flow |
| Gift Hunter | Can be added as future feature |
| AI Generator | Requires additional ML infrastructure |
| Fiat Payments | USDC-only for v1 |
| Mobile Apps | Web-first for v1 |
| Product Reviews | Requires marketplace features |
| Social Features | Wishlists, sharing later |

---

## 8) Open Points

| Point | Options |
|-------|---------|
| Product Data | (A) Affiliate API, (B) Direct retailer API, (C) Web scraping |
| AI Provider | (A) OpenAI GPT-4, (B) Anthropic Claude, (C) Self-hosted |
| Revenue Model | (A) Affiliate commissions, (B) Transaction fee, (C) Subscriptions |

---

## 9) Dependencies

| Service | Purpose |
|---------|---------|
| Sui Network | Blockchain, USDC transfers |
| @mysten/wallet-adapter | Wallet connection |
| OpenAI/Anthropic | AI chat |
| Product Data Provider | Product listings |

---

*Document created: March 9, 2026*
*Last updated: March 9, 2026*
