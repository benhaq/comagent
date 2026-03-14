# Feature Specification: ReAct Chat Service

**Feature Branch**: `001-react-chat-service`
**Created**: 2026-03-12
**Status**: Draft
**Input**: User description: "Build chat service for client chat UI. ReAct architecture using Vercel AI SDK with tools to get products based on user preferences and show to chat UI client."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conversational Product Search (Priority: P1)

A shopper opens the chat UI and asks for product recommendations. The
assistant asks 1-2 clarifying questions (budget, size, color, use case)
before searching. Once enough context is gathered, the assistant calls
the product search tool and returns 3-5 matching products with names,
images, prices, and brief rationale for each recommendation. The shopper
sees product cards inline in the chat.

**Why this priority**: This is the core value proposition — AI-assisted
product discovery through conversation. Without this, there is no
product.

**Independent Test**: Send a chat message like "I need running shoes
under $150" and verify the assistant clarifies preferences, searches,
and returns product cards streamed in real-time.

**Acceptance Scenarios**:

1. **Given** a new chat session, **When** the user sends a vague message like "I need headphones", **Then** the assistant asks 1-2 clarifying questions before searching (use case, budget, brand preference)
2. **Given** the assistant has gathered enough context, **When** it decides to search, **Then** the product search tool is called and 3-5 product cards are returned inline in the chat stream
3. **Given** a product search completes, **When** the assistant responds, **Then** each product includes name, image, price, and a brief rationale explaining why it fits the user's needs
4. **Given** a chat session, **When** the user sends a specific query like "Nike Air Max 90 size 10 in black", **Then** the assistant searches immediately without additional clarifying questions

---

### User Story 2 - Product Detail Drill-Down (Priority: P2)

After seeing product recommendations, the shopper asks for more details
about a specific product ("Tell me more about the second one"). The
assistant calls the product details tool and returns extended
information: full description, specifications, additional images, and
availability status.

**Why this priority**: Natural follow-up to search results. Users need
deeper product info before purchase decisions.

**Independent Test**: After a search returns products, ask about a
specific product and verify detailed information is returned with
specs, images, and availability.

**Acceptance Scenarios**:

1. **Given** product search results are displayed, **When** the user asks for details about a specific product, **Then** the assistant calls the detail tool and returns full description, specs, images, and availability
2. **Given** a product detail request, **When** the product exists, **Then** the response includes all available specifications as key-value pairs
3. **Given** a product detail request, **When** the referenced product is not found, **Then** the assistant informs the user and suggests alternatives or asks for clarification

---

### User Story 3 - Multi-Session Chat Management (Priority: P3)

A returning shopper wants to continue a previous conversation or start
a new one. They can see a list of their past chat sessions (titled
automatically based on the first exchange), switch between sessions,
rename them, or delete old ones. Each session preserves its own message
history.

**Why this priority**: Enables persistent shopping workflows across
visits. Without sessions, every page refresh loses context.

**Independent Test**: Create multiple sessions, verify each retains its
own message history, rename a session, delete one, and confirm messages
are removed.

**Acceptance Scenarios**:

1. **Given** a user starts a chat without specifying a session, **When** the first assistant response completes, **Then** a new session is created and automatically titled based on the conversation topic
2. **Given** a user has multiple sessions, **When** they request the session list, **Then** sessions are returned ordered by most recent activity, paginated (20 per page)
3. **Given** a user selects an existing session, **When** the session loads, **Then** all previous messages (including product cards) are restored
4. **Given** a user deletes a session, **When** deletion completes, **Then** all associated messages are permanently removed

---

### User Story 4 - Streaming Responses (Priority: P1)

The shopper sends a message and sees the assistant's response appear
token-by-token in real-time via server-sent events. Tool calls (product
searches) appear as loading states that resolve into product cards. The
experience feels responsive even when the AI is reasoning through
multiple tool-call steps.

**Why this priority**: Co-equal with US1 — streaming is not optional
for conversational UX. Without it, users see a blank screen for seconds
while the model reasons.

**Independent Test**: Send a message and verify tokens stream
incrementally, tool-invocation parts show call → result transitions,
and the full response completes within 30 seconds.

**Acceptance Scenarios**:

1. **Given** a user sends a message, **When** the assistant responds, **Then** text appears token-by-token as an SSE stream (not a single payload)
2. **Given** the assistant decides to call a tool, **When** the tool call starts, **Then** the client receives a tool-invocation part with state "call", and when it completes, a part with state "result" containing product data
3. **Given** a multi-step ReAct loop (e.g., search then detail), **When** the assistant chains tool calls, **Then** no more than 3 tool-call steps occur per request
4. **Given** any chat request, **When** processing exceeds 30 seconds, **Then** the request times out with a user-friendly error

---

### Edge Cases

- What happens when the product service (scraping/mock) is unavailable? The circuit breaker MUST open after repeated failures. The system MUST fall back to cached results if available; if no cache exists, the assistant MUST return a friendly error message suggesting the user try again, without exposing internal details.
- What happens when a user sends an empty or whitespace-only message? The request MUST be rejected with a validation error.
- What happens when a user sends off-topic messages (e.g., "What's the weather?")? The assistant MUST politely redirect to shopping assistance.
- What happens when the session ID in a request refers to a session the user does not own? The request MUST be denied with an authorization error.
- What happens during concurrent requests to the same session? The system MUST handle them gracefully without message ordering corruption.

## Clarifications

### Session 2026-03-12

- Q: How should tool-invocation parts be stored in chat messages? → A: Serialize entire message (text + tool parts) as a single JSON blob in the content column
- Q: How should the system handle external product service failures? → A: Circuit breaker with cached fallback — serve cached results when scraping service is unavailable
- Q: Where do user size preferences come from for system prompt injection? → A: Read from a user profile table in the database (sizes, preferred brands, etc.)
- Q: What model should generate auto-titles for new sessions? → A: Use a lightweight model (e.g., GPT-4o-mini) to reduce cost and latency

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose a streaming chat endpoint that accepts messages and an optional session identifier, and returns an SSE stream of text parts and tool-invocation parts
- **FR-002**: System MUST implement a ReAct loop that allows the AI model to reason, call tools, observe results, and respond — capped at 3 tool-call steps per request
- **FR-003**: System MUST provide a product search tool that accepts query, category, price range, size, and color parameters, returning 3-5 matching products
- **FR-004**: System MUST provide a product detail tool that accepts a product identifier and returns full product information including description, specifications, images, and availability
- **FR-005**: System MUST persist chat messages (user and assistant) to a database, associated with a session
- **FR-006**: System MUST support session CRUD: create, list (paginated), get with messages, rename, and delete (with cascade message removal)
- **FR-007**: System MUST auto-generate a short descriptive title (≤50 characters) for new sessions after the first assistant response, using a lightweight model (e.g., GPT-4o-mini) to minimize cost
- **FR-008**: System MUST enforce that users can only access their own sessions
- **FR-009**: System MUST use a swappable product data provider — a mock provider for development and an external scraping provider for production — selectable via configuration. The scraping provider MUST implement circuit breaker logic and fall back to cached results when the external service is unavailable
- **FR-010**: System MUST include a system prompt that instructs the AI to act as a shopping concierge: clarify before searching, use markdown formatting, recommend 3-5 products, provide rationale, and stay on-topic. The system prompt MUST inject the user's saved preferences (sizes, preferred brands) read from the user profile table
- **FR-011**: System MUST validate all incoming request bodies and parameters, returning structured error responses for invalid input
- **FR-012**: System MUST rate-limit chat requests per authenticated user (default: 30 requests per minute)

### Key Entities

- **Chat Session**: A conversation thread owned by a user. Has a title (auto-generated or user-set), creation time, and last-activity time. Contains ordered messages.
- **Chat Message**: A single message within a session. Has a role (user, assistant, system), content (JSON-serialized blob containing text and tool-invocation parts), and timestamp. The entire message — including tool call/result parts — is stored as a single JSON blob to enable full replay in the chat UI.
- **Product Card**: A summary product representation returned by search. Includes identifier, name, image, price, sizes, colors, retailer, URL, and optional rating/brand/description.
- **Product Detail**: Extended product information for drill-down. Includes everything in Product Card plus full description, specifications, all images, and availability status.
- **User Profile**: Stores user preferences (top/bottom/footwear sizes, preferred brands) read at chat time and injected into the system prompt. Owned by the authenticated user.

## Assumptions

- Authentication middleware already exists or will be provided — this spec assumes authenticated requests with a known user identity
- The frontend client uses a compatible chat SDK (e.g., `useChat` from `@ai-sdk/react`) that handles SSE parsing and message rendering
- Product prices are stored in cents internally but search parameters accept dollar values
- The mock product provider returns hardcoded data with simulated latency (300-800ms) for realistic dev experience
- Session context is per-session only; user preferences (sizes, brands) are read from the user profile table and injected via system prompt, not from cross-session history

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users receive the first streamed token within 2 seconds of sending a message
- **SC-002**: A complete product search response (with product cards) is delivered within 10 seconds
- **SC-003**: The system handles 100 concurrent chat sessions without degradation
- **SC-004**: 90% of product search queries return relevant results on the first attempt (measured by user not immediately re-querying)
- **SC-005**: Session list loads within 500ms for users with up to 50 sessions
- **SC-006**: All chat requests complete or timeout within 30 seconds — no hanging connections
- **SC-007**: Product detail requests resolve within 3 seconds
