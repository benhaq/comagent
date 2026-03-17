// test-app/src/App.tsx
import { useState, useRef, useCallback } from "react"
import { Renderer, JSONUIProvider } from "@json-render/react"
import { buildProductGridSpec, buildProductDetailSpec } from "@backend/lib/product-spec-builders"
import type { ProductSearchResult, ProductDetail } from "@backend/types/product"
import { sendChat, type ChatMessage, type SSEEvent } from "./lib/sse-chat"
import { registry } from "./registry"

// ─── Types ──────────────────────────────────────────────────────────────────

interface DisplayMessage {
  id: number
  role: "user" | "assistant" | "tool" | "error" | "system"
  content: string
  spec?: { root: string; elements: Record<string, unknown> }
}

let msgId = 0
function nextId() { return ++msgId }

// ─── App ────────────────────────────────────────────────────────────────────

export function App() {
  const [jwt, setJwt] = useState("")
  const [refreshToken, setRefreshToken] = useState("")
  const [apiUrl, setApiUrl] = useState("http://localhost:3001/api/chat")
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [sending, setSending] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)

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

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || !jwt) return

    setInput("")
    setSending(true)
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
          // Check if this is a product tool → build spec → render via Renderer
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
        case "finish":
          if (assistantAccRef.current) {
            conversationRef.current.push({ role: "assistant", content: assistantAccRef.current })
          }
          break
      }
    }

    try {
      await sendChat({
        url: apiUrl,
        jwt,
        refreshToken: refreshToken || undefined,
        messages: conversationRef.current,
        sessionId: sessionId ?? undefined,
        onEvent,
        onSessionId: (id) => {
          setSessionId(id)
          addMessage({ role: "system", content: `Session: ${id}` })
        },
      })
    } catch (err: any) {
      addMessage({ role: "error", content: `Fetch error: ${err.message}` })
    }

    setSending(false)
  }, [input, jwt, refreshToken, apiUrl, sessionId, addMessage, updateLastAssistant])

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      background: "#1a1a2e", color: "#eee", fontFamily: "system-ui, sans-serif",
    }}>
      {/* Config bar */}
      <div style={{
        padding: "10px 16px", background: "#16213e",
        borderBottom: "1px solid #333", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      }}>
        <label style={{ fontSize: 13, color: "#aaa" }}>API:</label>
        <input
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          style={{ width: 280, background: "#0f3460", border: "1px solid #444", color: "#eee", padding: "6px 10px", borderRadius: 4, fontSize: 13 }}
        />
        <label style={{ fontSize: 13, color: "#aaa" }}>JWT:</label>
        <input
          value={jwt}
          onChange={(e) => setJwt(e.target.value)}
          placeholder="Paste crossmint-jwt here"
          style={{ flex: 1, minWidth: 200, background: "#0f3460", border: "1px solid #444", color: "#eee", padding: "6px 10px", borderRadius: 4, fontSize: 13 }}
        />
        <label style={{ fontSize: 13, color: "#aaa" }}>Refresh:</label>
        <input
          value={refreshToken}
          onChange={(e) => setRefreshToken(e.target.value)}
          placeholder="refresh token (optional)"
          style={{ width: 260, background: "#0f3460", border: "1px solid #444", color: "#eee", padding: "6px 10px", borderRadius: 4, fontSize: 13 }}
        />
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((msg) => {
          // Render json-render spec via <Renderer>
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
        <div ref={messagesEndRef} />
      </div>

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
            border: "none", padding: "10px 20px", borderRadius: 8, cursor: sending ? "not-allowed" : "pointer", fontSize: 14,
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
