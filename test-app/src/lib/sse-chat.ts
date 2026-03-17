// test-app/src/lib/sse-chat.ts
//
// SSE client for AI SDK v6 UI Message Stream v1 protocol.
// Event types: start, text-start, text-delta, text-end,
//   tool-call-start, tool-call-delta, tool-call-end,
//   tool-result, finish-step, finish, error

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

export type SSEEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: string; result: unknown }
  | { type: "error"; error: string }
  | { type: "finish" }
  | { type: "start"; messageId: string }
  | { type: "unknown"; raw: unknown }

export interface SendChatOptions {
  url: string
  jwt: string
  refreshToken?: string
  messages: ChatMessage[]
  sessionId?: string
  onEvent: (event: SSEEvent) => void
  onSessionId: (id: string) => void
}

export async function sendChat(opts: SendChatOptions): Promise<void> {
  const body: Record<string, unknown> = { messages: opts.messages }
  if (opts.sessionId) body.sessionId = opts.sessionId

  const res = await fetch(opts.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const sid = res.headers.get("X-Session-Id")
  if (sid) opts.onSessionId(sid)

  if (!res.ok) {
    const text = await res.text()
    opts.onEvent({ type: "error", error: `HTTP ${res.status}: ${text}` })
    return
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  // Track toolCallId → toolName since tool-output-available lacks toolName
  const toolNameMap = new Map<string, string>()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop()!

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const raw = line.slice(6).trim()
      if (!raw || raw === "[DONE]") continue

      try {
        const evt = JSON.parse(raw)
        // Debug: log all SSE events to console
        console.debug("[SSE]", evt.type, evt)

        switch (evt.type) {
          // ── Text ────────────────────────────────────────────
          case "text-delta":
            opts.onEvent({ type: "text-delta", delta: evt.delta ?? "" })
            break

          // ── Tool call ─────────────────────────────────────
          case "tool-call":
          case "tool-call-end":
          case "tool-input-available": {
            const callId = evt.toolCallId ?? evt.id ?? ""
            const toolName = evt.toolName ?? ""
            if (callId && toolName) toolNameMap.set(callId, toolName)
            opts.onEvent({
              type: "tool-call",
              toolCallId: callId,
              toolName,
              args: evt.args ?? evt.input,
            })
            break
          }

          // ── Tool result ────────────────────────────────────
          case "tool-result":
          case "tool-output-available": {
            const resultCallId = evt.toolCallId ?? evt.id ?? ""
            const resultToolName = evt.toolName ?? toolNameMap.get(resultCallId) ?? ""
            opts.onEvent({
              type: "tool-result",
              toolCallId: resultCallId,
              toolName: resultToolName,
              result: evt.result ?? evt.output,
            })
            break
          }

          // ── Lifecycle ──────────────────────────────────────
          case "error":
            opts.onEvent({ type: "error", error: evt.errorText ?? JSON.stringify(evt) })
            break
          case "finish":
          case "finish-step":
            opts.onEvent({ type: "finish" })
            break
          case "start":
            opts.onEvent({ type: "start", messageId: evt.messageId ?? "" })
            break

          // ── Ignored (noise) ────────────────────────────────
          case "text-start":
          case "text-end":
          case "tool-call-start":
          case "tool-call-delta":
          case "start-step":
          case "reasoning-start":
          case "reasoning-delta":
          case "reasoning-end":
          case "source":
            break

          default:
            console.warn("[SSE] unhandled event type:", evt.type, evt)
            opts.onEvent({ type: "unknown", raw: evt })
            break
        }
      } catch {
        // skip unparseable lines
      }
    }
  }
}
