# AI Shopping Assistant - Frontend Product Requirements Document

## Document Information

| Field | Value |
|-------|-------|
| **Version** | 1.0 |
| **Date** | March 9, 2026 |
| **Status** | Draft |
| **Purpose** | UI/UX specifications for frontend developers |

---

## 1. Overview

### 1.1 Purpose

This document provides frontend-specific UI/UX requirements for building the AI Shopping Assistant web application. It complements the main PRD (`docs/PRD.md`) and System Design (`docs/SYSTEM_DESIGN.md`) by focusing on visual design, component specifications, and user interface details.

### 1.2 Design Source

Design extracted from Purch.xyz reference screenshots:
- Login/Wallet Connect page
- Onboarding multi-step flow
- Main app with CHAT and QUICK BUY tabs
- Cart sidebar
- Checkout flow
- Order History
- Addresses management

---

## 2. Visual Design System

### 2.1 Color Palette

| Color | Hex Code | Usage |
|-------|----------|-------|
| **Primary** | `#5B4DF4` | Buttons, active states, links, accents |
| **Primary Hover** | `#4A3DD9` | Button hover states |
| **Primary Light** | `#8B80FB` | Secondary accents, highlights |
| **Background** | `#0F0F12` | Main app background (dark theme) |
| **Surface** | `#1A1A21` | Cards, sidebar, modals |
| **Surface Elevated** | `#24242E` | Elevated cards, input fields |
| **Border** | `#2D2D3A` | Dividers, borders |
| **Text Primary** | `#FFFFFF` | Headings, primary text |
| **Text Secondary** | `#9CA3AF` | Secondary text, labels |
| **Text Muted** | `#6B7280` | Placeholder text, disabled |
| **Success** | `#22C55E` | Success states, confirmations |
| **Warning** | `#F59E0B` | Warnings, pending states |
| **Error** | `#EF4444` | Errors, destructive actions |

### 2.2 Typography

| Element | Font | Weight | Size |
|---------|------|--------|------|
| **App Title** | Inter | 700 | 24px |
| **Page Heading** | Inter | 600 | 20px |
| **Section Heading** | Inter | 600 | 16px |
| **Body** | Inter | 400 | 14px |
| **Caption** | Inter | 400 | 12px |
| **Button** | Inter | 500 | 14px |
| **Input** | Inter | 400 | 14px |

### 2.3 Spacing System

| Token | Value |
|-------|-------|
| `xs` | 4px |
| `sm` | 8px |
| `md` | 12px |
| `lg` | 16px |
| `xl` | 24px |
| `2xl` | 32px |
| `3xl` | 48px |

### 2.4 Border Radius

| Token | Value |
|-------|-------|
| `sm` | 6px |
| `md` | 8px |
| `lg` | 12px |
| `xl` | 16px |
| `full` | 9999px |

### 2.5 Responsive Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| **Mobile** | < 640px | Single column, stacked navigation |
| **Tablet** | 640px - 1024px | Two column where appropriate |
| **Desktop** | > 1024px | Full layout with sidebar |

---

## 3. Page Layouts

### 3.1 Login/Wallet Connect Page

**Route:** `/login`

**Layout:**
```
┌─────────────────────────────────────┐
│                                     │
│           [Logo]                    │
│      AI Shopping Assistant          │
│                                     │
│    ┌───────────────────────┐        │
│    │   Connect Wallet     │        │
│    └───────────────────────┘        │
│                                     │
│    ┌───────────────────────┐        │
│    │   Sui Wallet         │        │
│    │   Ethos Wallet       │        │
│    │   Suiet Wallet       │        │
│    └───────────────────────┘        │
│                                     │
│     Powered by Sui Network          │
│                                     │
└─────────────────────────────────────┘
```

**Component Details:**
- Full viewport height, centered content
- Logo at top (placeholder: purple gradient circle)
- "Connect Wallet" primary CTA button
- Wallet options list below with icons
- Footer text at bottom

### 3.2 Onboarding Flow

**Route:** `/onboarding` (guarded route, shown after first wallet connect)

**Layout:** Multi-step form with progress indicator

**Step 1 - Personal Info:**
```
┌─────────────────────────────────────┐
│  ● ○ ○        Step 1 of 3          │
│                                     │
│     What's your name?               │
│                                     │
│    ┌───────────────────────┐        │
│    │   First Name          │        │
│    └───────────────────────┘        │
│                                     │
│    ┌───────────────────────┐        │
│    │   Surname            │        │
│    └───────────────────────┘        │
│                                     │
│    ┌───────────────────────┐        │
│    │      Continue        →│        │
│    └───────────────────────┘        │
│                                     │
└─────────────────────────────────────┘
```

**Step 2 - Address:**
```
┌─────────────────────────────────────┐
│  ○ ● ○        Step 2 of 3          │
│                                     │
│     Where should we send           │
│     your orders?                   │
│                                     │
│    ┌───────────────────────┐        │
│    │   Street Address      │        │
│    └───────────────────────┘        │
│    ┌────────────┐ ┌────────────┐    │
│    │   Apt     │ │    City    │    │
│    └────────────┘ └────────────┘    │
│    ┌────────────┐ ┌────────────┐    │
│    │   State   │ │    ZIP     │    │
│    └────────────┘ └────────────┘    │
│    ┌───────────────────────┐        │
│    │   Country    [▼]     │        │
│    └───────────────────────┘        │
│                                     │
│    ☐ Set as default address        │
│                                     │
│    ┌───────────────────────┐        │
│    │      Continue        →│        │
│    └───────────────────────┘        │
│                                     │
└─────────────────────────────────────┘
```

**Step 3 - Size Preferences:**
```
┌─────────────────────────────────────┐
│  ○ ○ ●        Step 3 of 3          │
│                                     │
│     What's your size?               │
│                                     │
│    ┌────────────┐ ┌────────────┐    │
│    │   Tops    │ │  Bottoms   │    │
│    │  [M ▼]    │ │  [32 ▼]   │    │
│    └────────────┘ └────────────┘    │
│                                     │
│    ┌───────────────────────┐        │
│    │     Footwear          │        │
│    │      [9 ▼]            │        │
│    └───────────────────────┘        │
│                                     │
│    ┌───────────────────────┐        │
│    │      Complete         │        │
│    └───────────────────────┘        │
│                                     │
└─────────────────────────────────────┘
```

### 3.3 Main App Layout

**Route:** `/` (authenticated)

**Structure:**
```
┌─────────────────────────────────────────────────────────┐
│  [Logo]  AI Shopping    [Cart Badge]  [Profile ▼]     │
├─────────────────────────────────────────────────────────┤
│  [CHAT]  [QUICK BUY]                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                    Content Area                         │
│                  (Tab-dependent)                        │
│                                                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Header:**
- Logo on left
- App title centered
- Cart icon with badge (item count) on right
- Profile dropdown on far right

**Tab Navigation:**
- Two tabs: CHAT | QUICK BUY
- Active tab: primary color underline
- Inactive tab: muted text

### 3.4 CHAT Tab

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  [Logo]  AI Shopping    [Cart]  [Profile ▼]          │
├─────────────────────────────────────────────────────────┤
│  [CHAT]  [QUICK BUY]                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Hi! I'm your personal shopping assistant.      │   │
│  │ What are you looking for today?                │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 👋 Hi, I'm looking for running shoes           │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Great! What size do you wear?                  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  [Product Cards...]                            │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  [Message input...]                          [Send]    │
└─────────────────────────────────────────────────────────┘
```

**AI Response Bubble:**
- Surface background color
- Rounded corners (left-aligned)
- Avatar/icon on left

**User Message Bubble:**
- Primary color background
- Rounded corners (right-aligned)

**Product Cards:**
- Grid layout (1-2 columns depending on screen)
- Card: Surface elevated background
- Image on top (square, object-fit: cover)
- Product name below image
- Price in primary color
- "Add to Cart" button

**Message Input:**
- Full width input field
- Placeholder: "Ask me anything..."
- Send button on right (primary color)

### 3.5 QUICK BUY Tab

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  [Logo]  AI Shopping    [Cart]  [Profile ▼]          │
├─────────────────────────────────────────────────────────┤
│  [CHAT]  [QUICK BUY]                                   │
├─────────────────────────────────────────────────────────┤
│  Search for products...                    [Search]    │
├─────────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                  │
│  │ Product │ │ Product │ │ Product │                  │
│  │  Card   │ │  Card   │ │  Card   │                  │
│  └─────────┘ └─────────┘ └─────────┘                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                  │
│  │ Product │ │ Product │ │ Product │                  │
│  │  Card   │ │  Card   │ │  Card   │                  │
│  └─────────┘ └─────────┘ └─────────┘                  │
└─────────────────────────────────────────────────────────┘
```

**Search Bar:**
- Full width input
- Search icon on right
- Placeholder: "Search for products..."

**Product Grid:**
- Responsive grid: 2 cols mobile, 3 cols tablet, 4 cols desktop
- Same product card component as CHAT tab

### 3.6 Cart Sidebar

**Trigger:** Click cart icon in header

**Layout (Slide from right):**
```
┌────────────────────────────┐
│ Your Cart         [X]     │
│ 3 items                  │
├────────────────────────────┤
│ ┌──────────────────────┐  │
│ │ [Img] Product Name   │  │
│ │ Size: M  Color: Black│  │
│ │ Qty: [- 1 +]  $XX.XX│  │
│ │               [Remove]│  │
│ └──────────────────────┘  │
│                            │
│ (More items...)            │
│                            │
├────────────────────────────┤
│ Subtotal: $XX.XX           │
│                            │
│ ┌──────────────────────┐  │
│ │  Checkout with USDC │  │
│ └──────────────────────┘  │
└────────────────────────────┘
```

**Cart Item Row:**
- Product thumbnail (48x48)
- Product name (truncate if long)
- Size and color labels
- Quantity selector (-, count, +)
- Price
- Remove button (text link)

**Cart Header:**
- Item count
- Close button (X)

**Cart Footer:**
- Subtotal
- Checkout CTA button

### 3.7 Checkout Flow

**Route:** `/checkout`

**Step 1 - Order Summary:**
```
┌─────────────────────────────────────────────────────────┐
│  ← Back                                      Step 1/3  │
│                                                         │
│  Order Summary                                         │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ [Img] Product Name                    $XX.XX    │   │
│  │ Size: M  Color: Black  Qty: 1                   │   │
│  ├─────────────────────────────────────────────────┤   │
│  │ [Img] Product Name                    $XX.XX    │   │
│  │ Size: L  Color: Blue   Qty: 2                   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Subtotal:                                     $XX.XX  │
│                                                         │
│  ─────────────────────────────────────────────────     │
│                                                         │
│  Shipping Address                                      │
│                                                         │
│  John Doe                                              │
│  123 Main St                                           │
│  Apt 4B                                                │
│  New York, NY 10001                                    │
│  United States                                         │
│                                    [Change]            │
│                                                         │
│  ─────────────────────────────────────────────────     │
│                                                         │
│  Wallet Balance                                        │
│                                                         │
│  USDC: $XX.XX (sufficient)                            │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │            Confirm Order                        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Step 2 - Confirm with Wallet:**
```
┌─────────────────────────────────────────────────────────┐
│  ← Back                                      Step 2/3  │
│                                                         │
│                                                         │
│                    Confirm Order                        │
│                                                         │
│              ⏳ Confirm in wallet...                    │
│                                                         │
│              Total: $XX.XX USDC                         │
│                                                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Step 3 - Processing/Confirmation:**
```
┌─────────────────────────────────────────────────────────┐
│  ← Back                                      Step 3/3  │
│                                                         │
│                                                         │
│                   Order Confirmed!                      │
│                                                         │
│                   ✅                                    │
│                                                         │
│              Order #XXXXXX                              │
│                                                         │
│              Total: $XX.XX USDC                        │
│                                                         │
│              tx: 0x1234...5678                         │
│                                                         │
│              [View Order]  [Continue Shopping]         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.8 Order History

**Route:** `/orders`

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  [←]  Order History                    [Profile ▼]    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Active Orders                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Order #XXXXXX          Mar 5, 2026              │   │
│  │ 2 items                      $XX.XX            │   │
│  │ Status: Shipped                               │   │
│  │                           [View] [Reorder]     │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Past Orders                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Order #XXXXXX          Jan 15, 2026              │   │
│  │ 1 item                       $XX.XX             │   │
│  │ Status: Delivered                            │   │
│  │                           [View] [Reorder]     │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Empty State:**
- Icon (shopping bag)
- "No orders yet"
- "Start shopping to see your orders here"

### 3.9 Addresses

**Route:** `/addresses`

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  [←]  Addresses                      [+ Add New]       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ John Doe                        [Default]       │   │
│  │ 123 Main St                                      │   │
│  │ Apt 4B                                          │   │
│  │ New York, NY 10001                              │   │
│  │ United States                                   │   │
│  │                              [Edit] [Delete]   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Jane Smith                                      │   │
│  │ 456 Oak Ave                                     │   │
│  │ San Francisco, CA 94102                        │   │
│  │ United States                                   │   │
│  │                              [Edit] [Delete]   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Address Card:**
- Name on top
- Full address below
- "Default" badge if applicable
- Edit and Delete action links

### 3.10 Add/Edit Address Form

**Route:** `/addresses/new` or `/addresses/:id/edit`

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  [←]  Add Address                                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  First Name *                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │                                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Last Name *                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │                                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Street Address *                                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │                                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Apt/Suite                                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │                                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  City *              State                            │
│  ┌──────────────┐   ┌──────────────┐                  │
│  │              │   │              │                  │
│  └──────────────┘   └──────────────┘                  │
│                                                         │
│  ZIP Code *           Country *                        │
│  ┌──────────────┐   ┌──────────────┐                  │
│  │              │   │    [▼]      │                  │
│  └──────────────┘   └──────────────┘                  │
│                                                         │
│  ☐ Set as default address                              │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Save Address                        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.11 Profile Menu

**Trigger:** Click profile icon in header

**Dropdown:**
```
┌─────────────────────────┐
│  Wallet: 0x1234...abcd │
│  ─────────────────────  │
│  Order History     →    │
│  Addresses        →    │
│  ─────────────────────  │
│  Logout                │
└─────────────────────────┘
```

---

## 4. Component Specifications

### 4.1 Button

| Variant | Background | Text | Border |
|---------|------------|------|--------|
| **Primary** | `#5B4DF4` | `#FFFFFF` | none |
| **Primary Hover** | `#4A3DD9` | `#FFFFFF` | none |
| **Secondary** | transparent | `#5B4DF4` | `#5B4DF4` |
| **Ghost** | transparent | `#9CA3AF` | none |
| **Ghost Hover** | `#24242E` | `#FFFFFF` | none |
| **Danger** | `#EF4444` | `#FFFFFF` | none |

**Sizes:**
- `sm`: height 32px, padding 12px
- `md`: height 40px, padding 16px
- `lg`: height 48px, padding 24px

**States:**
- Default: As specified above
- Hover: Darken background 10%
- Active: Darken background 15%
- Disabled: opacity 0.5, cursor not-allowed

### 4.2 Input

| State | Background | Border | Text |
|-------|------------|--------|------|
| **Default** | `#24242E` | `#2D2D3A` | `#FFFFFF` |
| **Focus** | `#24242E` | `#5B4DF4` | `#FFFFFF` |
| **Error** | `#24242E` | `#EF4444` | `#FFFFFF` |
| **Disabled** | `#1A1A21` | `#2D2D3A` | `#6B7280` |

### 4.3 Select/Dropdown

- Same styling as Input
- Chevron icon on right
- Dropdown menu: Surface background, 1px border
- Option hover: Surface elevated background
- Selected option: Primary color checkmark

### 4.4 Card

- Background: `#1A1A21`
- Border: 1px solid `#2D2D3A`
- Border radius: 12px
- Padding: 16px
- Hover: Border color `#5B4DF4` (for interactive cards)

### 4.5 Badge

| Variant | Background | Text |
|---------|------------|------|
| **Default** | `#24242E` | `#9CA3AF` |
| **Primary** | `#5B4DF4` | `#FFFFFF` |
| **Success** | `#22C55E` | `#FFFFFF` |
| **Warning** | `#F59E0B` | `#FFFFFF` |
| **Error** | `#EF4444` | `#FFFFFF` |

### 4.6 Tab

| State | Text | Indicator |
|-------|------|-----------|
| **Active** | `#5B4DF4` | 2px bottom border, primary color |
| **Inactive** | `#9CA3AF` | none |
| **Hover** | `#FFFFFF` | none |

### 4.7 Product Card

```
┌─────────────────────────┐
│                         │
│      [Image]            │
│      200x200            │
│                         │
├─────────────────────────┤
│ Product Name            │
│ $XX.XX                  │
│                         │
│ [Size: M ▼]             │
│                         │
│ ┌─────────────────────┐│
│ │    Add to Cart      ││
│ └─────────────────────┘│
└─────────────────────────┘
```

- Image aspect ratio: 1:1
- Name: 14px, truncate 2 lines
- Price: 16px, bold, primary color
- Size selector: dropdown (if size options exist)
- Add to Cart: full width, primary button

### 4.8 Chat Bubble

| Type | Background | Alignment |
|------|------------|-----------|
| **AI** | `#1A1A21` | left |
| **User** | `#5B4DF4` | right |
| **System** | transparent | center |

### 4.9 Loading States

**Skeleton for Product Card:**
```
┌─────────────────────────┐
│ ┌─────────────────────┐ │
│ │    (shimmer)        │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │   ████████          │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │    ████████         │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │  ████████████████   │ │
│ └─────────────────────┘ │
└─────────────────────────┘
```

**Skeleton for Chat:**
- AI bubble: left-aligned, shimmer animation
- User bubble: right-aligned, shimmer animation

**Spinner:**
- Primary color
- 24px size
- Rotation animation

### 4.10 Empty States

- Centered content
- Icon at top (48px, muted color)
- Title: 16px, semibold
- Description: 14px, muted, optional
- CTA button if applicable

---

## 5. State Management

### 5.1 Client State (Zustand)

**Stores:**

```typescript
// Cart Store
interface CartStore {
  items: CartItem[];
  isOpen: boolean;
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  toggleCart: () => void;
  clearCart: () => void;
}

// Auth Store
interface AuthStore {
  user: User | null;
  isConnected: boolean;
  connect: (wallet: Wallet) => void;
  disconnect: () => void;
}

// UI Store
interface UIStore {
  activeTab: 'chat' | 'quickbuy';
  isProfileOpen: boolean;
  setActiveTab: (tab: 'chat' | 'quickbuy') => void;
  toggleProfile: () => void;
}
```

### 5.2 Server State (TanStack Query)

**Queries:**
- `useCart()` - GET /api/cart
- `useOrders()` - GET /api/orders
- `useAddresses()` - GET /api/addresses
- `useProfile()` - GET /api/profile

**Mutations:**
- `useAddToCart()`
- `useRemoveFromCart()`
- `useUpdateQuantity()`
- `useCreateOrder()`
- `useAddAddress()`

### 5.3 Form State

- Use React Hook Form for all forms
- Zod for validation schemas (match backend)
- Field-level validation feedback
- Form-level error display

---

## 6. User Flows

### 6.1 Authentication Flow

1. User lands on `/login`
2. Clicks "Connect Wallet"
3. Wallet modal opens (Sui Wallet/Ethos/Suiet)
4. User approves connection
5. Backend creates session, returns JWT
6. Check if user has completed onboarding
   - If no: redirect to `/onboarding`
   - If yes: redirect to `/`

### 6.2 Onboarding Flow

1. User sees Step 1 (Personal Info)
2. Fills name, clicks Continue
3. Sees Step 2 (Address), fills details
4. Clicks Continue
5. Sees Step 3 (Sizes), selects sizes
6. Clicks Complete
7. Backend saves profile
8. Redirect to `/`

### 6.3 Shopping Flow (Chat)

1. User types message in chat input
2. Message appears in chat (user bubble)
3. Loading indicator shows
4. AI responds with question or products
5. If products: display product cards
6. User clicks "Add to Cart" on card
7. Cart badge updates
8. User can continue chatting or checkout

### 6.4 Quick Buy Flow

1. User types in search bar
2. Presses Enter or clicks search
3. Loading skeleton shows
4. Products grid appears
5. User selects size, clicks Add to Cart
6. Cart updates, can continue shopping or checkout

### 6.5 Checkout Flow

1. User opens cart sidebar
2. Reviews items, clicks "Checkout with USDC"
3. Navigates to `/checkout` step 1
4. Reviews order summary
5. Clicks "Confirm Order"
6. Wallet prompts for transaction approval
7. Step 2 shows "Confirm in wallet..."
8. Transaction confirmed → Step 3 shows success
9. Order created, cart cleared

---

## 7. Error Handling

### 7.1 Error States

| Scenario | UI Response |
|----------|--------------|
| Wallet not connected | Show connect prompt, disable checkout |
| Insufficient USDC | Warning banner, disable checkout button |
| Transaction failed | Error toast, "Try Again" button |
| Network error | Toast with retry option |
| API error | Inline error message, form validation |

### 7.2 Toast Notifications

- Position: top-right
- Auto-dismiss: 5 seconds
- Types: success, error, warning, info
- Close button on each toast

---

## 8. Third-Party Libraries

### 8.1 UI Components (shadcn/ui)

Recommended components:
- Button
- Input
- Select/Dropdown
- Dialog/Modal
- Sheet (for cart sidebar)
- Tabs
- Card
- Form + FormField
- Label
- Badge
- Skeleton
- Toast

### 8.2 Styling

- **Tailwind CSS** for all styling
- Custom theme in `tailwind.config.js`
- CSS variables for colors (match design system)

### 8.3 Additional Dependencies

- `@mysten/wallet-adapter` - Wallet connection
- `zustand` - Client state
- `@tanstack/react-query` - Server state
- `react-hook-form` - Form handling
- `zod` - Validation
- `lucide-react` - Icons
- `clsx` / `tailwind-merge` - Class utilities

---

## 9. File Structure

```
app/
├── (auth)/
│   ├── login/
│   │   └── page.tsx
│   └── onboarding/
│       └── page.tsx
├── (main)/
│   ├── page.tsx              # Main app with tabs
│   ├── orders/
│   │   └── page.tsx
│   ├── addresses/
│   │   ├── page.tsx
│   │   ├── new/
│   │   │   └── page.tsx
│   │   └── [id]/
│   │       └── edit/
│   │           └── page.tsx
│   └── checkout/
│       └── page.tsx
├── components/
│   ├── ui/                   # shadcn components
│   ├── layout/
│   │   ├── header.tsx
│   │   ├── sidebar.tsx
│   │   └── tabs.tsx
│   ├── chat/
│   │   ├── chat-container.tsx
│   │   ├── chat-input.tsx
│   │   ├── message-bubble.tsx
│   │   └── product-card.tsx
│   ├── cart/
│   │   ├── cart-sidebar.tsx
│   │   └── cart-item.tsx
│   ├── checkout/
│   │   ├── order-summary.tsx
│   │   └── checkout-form.tsx
│   └── common/
│       ├── button.tsx
│       ├── input.tsx
│       └── select.tsx
├── stores/
│   ├── cart-store.ts
│   ├── auth-store.ts
│   └── ui-store.ts
├── hooks/
│   ├── use-cart.ts
│   ├── use-auth.ts
│   └── use-query.ts
├── lib/
│   ├── api.ts
│   ├── utils.ts
│   └── constants.ts
└── types/
    └── index.ts
```

---

## 10. Acceptance Criteria

### 10.1 Authentication
- [ ] Wallet connect modal works with Sui Wallet, Ethos, Suiet
- [ ] Session persists across page refreshes
- [ ] Unauthenticated users redirected to `/login`

### 10.2 Onboarding
- [ ] Multi-step form with progress indicator
- [ ] Form validation on each step
- [ ] Cannot skip steps, must complete all 3
- [ ] Redirects to `/` on completion

### 10.3 Chat
- [ ] Messages appear in real-time
- [ ] Loading state while waiting for AI
- [ ] Product cards display correctly
- [ ] Add to cart works from product card

### 10.4 Quick Buy
- [ ] Search returns product results
- [ ] Products display in responsive grid
- [ ] Add to cart with size selection

### 10.5 Cart
- [ ] Sidebar opens/closes smoothly
- [ ] Items can be added/removed
- [ ] Quantity can be updated
- [ ] Subtotal calculates correctly

### 10.6 Checkout
- [ ] Order summary displays correctly
- [ ] Wallet balance check works
- [ ] Transaction signing works
- [ ] Order confirmation shows tx hash

### 10.7 Responsive
- [ ] Mobile: Single column layout
- [ ] Tablet: Two column where appropriate
- [ ] Desktop: Full layout

---

## 11. Related Documents

| Document | Path |
|----------|------|
| Main PRD | `docs/PRD.md` |
| System Design | `docs/SYSTEM_DESIGN.md` |
| API Specs | `docs/api/` (to be created) |

---

*Document created: March 9, 2026*
