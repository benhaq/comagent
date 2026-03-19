// test-app/src/App.tsx
import { useState, useRef, useCallback, useEffect } from "react"
import { CrossmintProvider, CrossmintWalletProvider } from "@crossmint/client-sdk-react-ui"
import { Renderer, JSONUIProvider } from "@json-render/react"
import { buildProductGridSpec, buildProductDetailSpec } from "@backend/lib/product-spec-builders"
import type { ProductSearchResult, ProductDetail } from "@backend/types/product"
import type { ProductCardProps } from "@backend/lib/product-catalog"
import { sendChat, type ChatMessage, type SSEEvent } from "./lib/sse-chat"
import { fetchCart, addToCart, removeFromCart, type CartItemResponse } from "./lib/cart-api"
import { registry, CartContext } from "./registry"
import { CartPanel } from "./components/CartPanel"
import { LoginPanel } from "./components/LoginPanel"
import { CheckoutView } from "./components/CheckoutView"
import { CrossmintJwtSync } from "./components/CrossmintJwtSync"
import { OrdersPanel } from "./components/OrdersPanel"
import { CROSSMINT_CLIENT_API_KEY } from "./lib/crossmint-config"

// ─── Types ──────────────────────────────────────────────────────────────────

interface DisplayMessage {
  id: number
  role: "user" | "assistant" | "tool" | "error" | "system"
  content: string
  spec?: { root: string; elements: Record<string, unknown> }
}

let msgId = 0
function nextId() { return ++msgId }

// ─── Utilities ───────────────────────────────────────────────────────────────

function extractSuggestions(text: string): { text: string; suggestions: string[] } {
  const pattern = /\*\*Suggestions:\*\*\s*\r?\n((?:\s*[-*]\s*.+\r?\n?)+)/i
  const match = text.match(pattern)
  if (!match) return { text, suggestions: [] }
  const suggestions = match[1]
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean)
  return { text: text.slice(0, match.index).trimEnd(), suggestions }
}

// ─── App ────────────────────────────────────────────────────────────────────

export function App() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [sending, setSending] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Array<{ id: string; title: string | null; updatedAt: string }>>([])
  const [suggestions, setSuggestions] = useState<string[]>([])

  // Cart state
  const [cartItems, setCartItems] = useState<CartItemResponse[]>([])
  const [cartLoading, setCartLoading] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)

  // Orders / history panel state
  const [ordersOpen, setOrdersOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  // Checkout state
  const [checkoutItemId, setCheckoutItemId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState("")
  const [crossmintJwt, setCrossmintJwt] = useState<string | null>(null)

  const conversationRef = useRef<ChatMessage[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const assistantAccRef = useRef("")

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  const addMessage = useCallback((msg: Omit<DisplayMessage, "id">) => {
    setMessages((prev) => [...prev, { ...msg, id: nextId() }])
    setTimeout(scrollToBottom, 50)
    return msgId
  }, [scrollToBottom])

  const updateLastAssistant = useCallback((text: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === "assistant" && !last.spec) {
        return [...prev.slice(0, -1), { ...last, content: text }]
      }
      return [...prev, { id: nextId(), role: "assistant", content: text }]
    })
    setTimeout(scrollToBottom, 50)
  }, [scrollToBottom])

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions?limit=10")
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions ?? [])
      }
    } catch {}
  }, [])

  const loadSession = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/sessions/${sid}`)
      if (!res.ok) return
      const data = await res.json()

      const displayMsgs: DisplayMessage[] = []
      const contextMsgs: ChatMessage[] = []

      for (const msg of data.messages) {
        if (!Array.isArray(msg.parts)) {
          displayMsgs.push({ id: nextId(), role: msg.role, content: String(msg.parts) })
          if (msg.role === "user" || msg.role === "assistant") {
            contextMsgs.push({ role: msg.role, content: String(msg.parts) })
          }
          continue
        }

        for (const part of msg.parts) {
          if (part.type === "text" && part.text) {
            displayMsgs.push({ id: nextId(), role: msg.role, content: part.text })
            if (msg.role === "user" || msg.role === "assistant") {
              contextMsgs.push({ role: msg.role, content: part.text })
            }
          } else if (part.type === "tool-searchProducts" && part.output) {
            const spec = buildProductGridSpec(part.output as ProductSearchResult)
            displayMsgs.push({ id: nextId(), role: "assistant", content: "", spec: spec as any })
          } else if (part.type === "tool-getProductDetails" && part.output) {
            const spec = buildProductDetailSpec(part.output as ProductDetail)
            displayMsgs.push({ id: nextId(), role: "assistant", content: "", spec: spec as any })
          }
        }
      }

      setMessages(displayMsgs)
      conversationRef.current = contextMsgs
      setSessionId(sid)
    } catch (err) {
      console.error("Failed to load session", err)
    }
  }, [])

  const handleNewChat = useCallback(() => {
    setMessages([])
    setSessionId(null)
    setSuggestions([])
    conversationRef.current = []
    assistantAccRef.current = ""
  }, [])

  const loadCart = useCallback(() => {
    setCartLoading(true)
    fetchCart()
      .then(setCartItems)
      .catch(() => {})
      .finally(() => setCartLoading(false))
  }, [])

  // Check if already logged in on mount
  useEffect(() => {
    fetch("/api/auth/profile").then(async (res) => {
      if (res.ok) {
        const data = await res.json()
        setUserEmail(data.email ?? "")
        // Restore Crossmint JWT from sessionStorage if available
        const storedJwt = sessionStorage.getItem("crossmint_jwt")
        if (storedJwt) setCrossmintJwt(storedJwt)
        setLoggedIn(true)
        loadCart()
        loadSessions()
      }
    }).catch(() => {})
  }, [loadCart, loadSessions])

  const handleLoggedIn = useCallback((email: string, jwt: string) => {
    setUserEmail(email)
    setCrossmintJwt(jwt)
    sessionStorage.setItem("crossmint_jwt", jwt)
    setLoggedIn(true)
    loadCart()
    loadSessions()
  }, [loadCart, loadSessions])

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
    setLoggedIn(false)
    setCartItems([])
    setMessages([])
    setSessionId(null)
    setSessions([])
    setSuggestions([])
    setCheckoutItemId(null)
    setHistoryOpen(false)
    setCrossmintJwt(null)
    sessionStorage.removeItem("crossmint_jwt")
    conversationRef.current = []
  }, [])

  const handleAddToCart = useCallback(async (product: ProductCardProps) => {
    try {
      const item = await addToCart({
        productId: product.id,
        productName: product.name,
        price: product.price,
        image: product.image,
        size: product.sizes[0] ?? "One Size",
        color: product.colors[0]?.name ?? "Default",
        productUrl: product.product_url,
        retailer: product.retailer,
      })
      setCartItems((prev) => [item, ...prev])
    } catch (err: any) {
      throw err
    }
  }, [])

  const handleRemoveFromCart = useCallback(async (itemId: string) => {
    try {
      await removeFromCart(itemId)
      setCartItems((prev) => prev.filter((i) => i.id !== itemId))
    } catch {
      // ignore
    }
  }, [])

  const handleCheckout = useCallback((itemId: string) => {
    setCheckoutItemId(itemId)
  }, [])

  const handleCheckoutDone = useCallback(() => {
    setCheckoutItemId(null)
    loadCart()
  }, [loadCart])

  const handleCheckoutBack = useCallback(() => {
    setCheckoutItemId(null)
  }, [])

  // Core send logic shared by handleSend and handleSuggestionClick
  const doSend = useCallback(async (text: string) => {
    setSending(true)
    setSuggestions([])
    addMessage({ role: "user", content: text })
    conversationRef.current.push({ role: "user", content: text })
    assistantAccRef.current = ""

    const onEvent = (evt: SSEEvent) => {
      switch (evt.type) {
        case "text-delta":
          assistantAccRef.current += evt.delta
          updateLastAssistant(assistantAccRef.current)
          break
        case "tool-call":
          addMessage({
            role: "tool",
            content: `Tool: ${evt.toolName}\n${JSON.stringify(evt.args, null, 2)}`,
          })
          break
        case "tool-result": {
          if (evt.toolName === "searchProducts") {
            const spec = buildProductGridSpec(evt.result as ProductSearchResult)
            addMessage({ role: "assistant", content: "", spec: spec as any })
          } else if (evt.toolName === "getProductDetails" && evt.result) {
            const spec = buildProductDetailSpec(evt.result as ProductDetail)
            addMessage({ role: "assistant", content: "", spec: spec as any })
          } else {
            const preview = JSON.stringify(evt.result, null, 2)
            addMessage({
              role: "tool",
              content: `Result (${evt.toolName}):\n${preview}`,
            })
          }
          break
        }
        case "error":
          addMessage({ role: "error", content: evt.error })
          break
        case "finish": {
          if (assistantAccRef.current) {
            const { text: cleanText, suggestions: parsed } = extractSuggestions(assistantAccRef.current)
            updateLastAssistant(cleanText)
            setSuggestions(parsed)
            // Push original text so LLM sees its own suggestions in history
            conversationRef.current.push({ role: "assistant", content: assistantAccRef.current })
          }
          break
        }
      }
    }

    try {
      await sendChat({
        url: "/api/chat",
        jwt: "",  // unused — auth via httpOnly cookie
        messages: conversationRef.current,
        sessionId: sessionId ?? undefined,
        onEvent,
        onSessionId: (id) => {
          setSessionId(id)
        },
      })
    } catch (err: any) {
      addMessage({ role: "error", content: `Fetch error: ${err.message}` })
    }

    setSending(false)
    // Refresh session list only when a new session was created or on first message
    if (!sessionId) loadSessions()
  }, [sessionId, addMessage, updateLastAssistant, loadSessions])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text) return
    setInput("")
    await doSend(text)
  }, [input, doSend])

  const handleSuggestionClick = useCallback((text: string) => {
    void doSend(text)
  }, [doSend])

  if (!loggedIn) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", height: "100vh",
        background: "#1a1a2e", color: "#eee", fontFamily: "system-ui, sans-serif",
      }}>
        <LoginPanel onLoggedIn={handleLoggedIn} />
      </div>
    )
  }

  return (
    <CrossmintProvider apiKey={CROSSMINT_CLIENT_API_KEY}>
      <CrossmintWalletProvider>
        <CrossmintJwtSync jwt={crossmintJwt} />
            <div style={{
              display: "flex", flexDirection: "column", height: "100vh",
              background: "#1a1a2e", color: "#eee", fontFamily: "system-ui, sans-serif",
            }}>
              {/* Top bar */}
              <div style={{
                padding: "10px 16px", background: "#16213e",
                borderBottom: "1px solid #333", display: "flex", gap: 8, alignItems: "center",
              }}>
                <span style={{ fontSize: 13, color: "#4ade80" }}>Logged in</span>
                <button
                  onClick={handleLogout}
                  style={{
                    background: "#333", border: "1px solid #444", color: "#f87171",
                    padding: "6px 14px", borderRadius: 4, fontSize: 13, cursor: "pointer",
                  }}
                >
                  Logout
                </button>
                <button
                  onClick={handleNewChat}
                  style={{
                    background: "#0f3460", border: "1px solid #444", color: "#4ade80",
                    padding: "6px 14px", borderRadius: 4, fontSize: 13, cursor: "pointer",
                  }}
                >
                  + New Chat
                </button>
                <button
                  onClick={() => { setHistoryOpen(!historyOpen); if (!historyOpen) { setCartOpen(false); setOrdersOpen(false) } }}
                  style={{
                    background: historyOpen ? "#1e40af" : "#0f3460", border: "1px solid #444", color: "#eee",
                    padding: "6px 14px", borderRadius: 4, fontSize: 13, cursor: "pointer",
                  }}
                >
                  History ({sessions.length})
                </button>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => { setOrdersOpen(!ordersOpen); if (!ordersOpen) setCartOpen(false) }}
                  style={{
                    background: ordersOpen ? "#1e40af" : "#0f3460", border: "1px solid #444", color: "#eee",
                    padding: "6px 14px", borderRadius: 4, fontSize: 13, cursor: "pointer",
                  }}
                >
                  Orders
                </button>
                <button
                  onClick={() => { setCartOpen(!cartOpen); if (!cartOpen) setOrdersOpen(false) }}
                  style={{
                    background: cartOpen ? "#1e40af" : "#0f3460", border: "1px solid #444", color: "#eee",
                    padding: "6px 14px", borderRadius: 4, fontSize: 13, cursor: "pointer",
                  }}
                >
                  Cart ({cartItems.length})
                </button>
              </div>

              {/* Main area: chat/checkout + optional cart panel */}
              <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
                {/* Chat or Checkout area */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  {checkoutItemId ? (
                    <CheckoutView
                      cartItemId={checkoutItemId}
                      userEmail={userEmail}
                      onDone={handleCheckoutDone}
                      onBack={handleCheckoutBack}
                    />
                  ) : (
                    <>
                      {/* Messages */}
                      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                        <CartContext.Provider value={{ onAddToCart: handleAddToCart }}>
                          {messages.map((msg) => {
                            if (msg.spec) {
                              return (
                                <div key={msg.id} style={{ alignSelf: "flex-start", maxWidth: "90%" }}>
                                  <JSONUIProvider registry={registry}>
                                    <Renderer spec={msg.spec as any} registry={registry} />
                                  </JSONUIProvider>
                                </div>
                              )
                            }

                            const styles: Record<string, React.CSSProperties> = {
                              user: { background: "#0f3460", alignSelf: "flex-end" },
                              assistant: { background: "#222", alignSelf: "flex-start", border: "1px solid #333" },
                              tool: { background: "#1a2a1a", alignSelf: "flex-start", border: "1px solid #2a4a2a", fontFamily: "monospace", fontSize: 12 },
                              error: { background: "#3a1a1a", border: "1px solid #4a2a2a", alignSelf: "center", color: "#f88" },
                              system: { background: "transparent", alignSelf: "center", color: "#888", fontSize: 12 },
                            }

                            return (
                              <div
                                key={msg.id}
                                style={{
                                  maxWidth: "80%", padding: "10px 14px", borderRadius: 12,
                                  fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
                                  ...styles[msg.role],
                                }}
                              >
                                {msg.content}
                              </div>
                            )
                          })}
                        </CartContext.Provider>
                        <div ref={messagesEndRef} />
                      </div>

                      {/* Suggestion chips */}
                      {suggestions.length > 0 && !sending && (
                        <div style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                          padding: "8px 16px",
                          alignSelf: "flex-start",
                        }}>
                          {suggestions.map((s, i) => (
                            <button
                              key={i}
                              onClick={() => handleSuggestionClick(s)}
                              style={{
                                background: "#1e293b",
                                border: "1px solid #334155",
                                borderRadius: 20,
                                padding: "6px 14px",
                                color: "#94a3b8",
                                cursor: "pointer",
                                fontSize: 13,
                                fontFamily: "inherit",
                                transition: "background 0.15s",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "#334155")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "#1e293b")}
                            >
                              ↳ {s}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Input bar */}
                      <div style={{
                        padding: "12px 16px", background: "#16213e",
                        borderTop: "1px solid #333", display: "flex", gap: 8,
                      }}>
                        <input
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !sending) handleSend() }}
                          placeholder="Type a message..."
                          autoFocus
                          style={{
                            flex: 1, background: "#0f3460", border: "1px solid #444",
                            color: "#eee", padding: "10px 14px", borderRadius: 8, fontSize: 14, outline: "none",
                          }}
                        />
                        <button
                          onClick={handleSend}
                          disabled={sending}
                          style={{
                            background: sending ? "#555" : "#e94560", color: "#fff",
                            border: "none", padding: "10px 20px", borderRadius: 8,
                            cursor: sending ? "not-allowed" : "pointer", fontSize: 14,
                          }}
                        >
                          Send
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Side panels */}
                {cartOpen && (
                  <CartPanel
                    items={cartItems}
                    loading={cartLoading}
                    onRemove={handleRemoveFromCart}
                    onCheckout={handleCheckout}
                    onClose={() => setCartOpen(false)}
                  />
                )}
                {ordersOpen && (
                  <OrdersPanel onClose={() => setOrdersOpen(false)} />
                )}
                {historyOpen && (
                  <div style={{
                    width: 300, borderLeft: "1px solid #333", background: "#16213e",
                    overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>Chat History</span>
                      <button onClick={() => setHistoryOpen(false)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 16 }}>×</button>
                    </div>
                    {sessions.length === 0 && <span style={{ color: "#666", fontSize: 13 }}>No sessions yet</span>}
                    {sessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => { loadSession(s.id); setHistoryOpen(false) }}
                        style={{
                          background: s.id === sessionId ? "#1e40af" : "#0f3460",
                          border: s.id === sessionId ? "1px solid #3b82f6" : "1px solid #333",
                          color: "#eee", padding: "10px 12px", borderRadius: 8,
                          cursor: "pointer", textAlign: "left", width: "100%",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                          {s.title ?? `Chat ${s.id.slice(0, 8)}...`}
                        </div>
                        <div style={{ fontSize: 11, color: "#888" }}>
                          {new Date(s.updatedAt).toLocaleString()}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
      </CrossmintWalletProvider>
    </CrossmintProvider>
  )
}
