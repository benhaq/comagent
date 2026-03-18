import { useState, useEffect, useCallback } from "react"
import { listOrders, type OrderStatus, type OrderListResponse } from "../lib/cart-api"

interface OrdersPanelProps {
  onClose: () => void
}

const LIMIT = 5

export function OrdersPanel({ onClose }: OrdersPanelProps) {
  const [data, setData] = useState<OrderListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState("")
  const [phaseFilter, setPhaseFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listOrders({
        page,
        limit: LIMIT,
        type: typeFilter || undefined,
        phase: phaseFilter || undefined,
        status: statusFilter || undefined,
      })
      setData(res)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [page, typeFilter, phaseFilter, statusFilter])

  useEffect(() => { load() }, [load])

  // Reset to page 1 when filters change
  const applyFilter = useCallback((setter: (v: string) => void, value: string) => {
    setter(value)
    setPage(1)
  }, [])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1

  return (
    <div style={{
      width: 380, background: "#16213e", borderLeft: "1px solid #333",
      display: "flex", flexDirection: "column", height: "100%",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px", borderBottom: "1px solid #333",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Orders</span>
        <button onClick={onClose} style={closeBtnStyle}>&times;</button>
      </div>

      {/* Filters */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #333", display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select
          value={typeFilter}
          onChange={(e) => applyFilter(setTypeFilter, e.target.value)}
          style={selectStyle}
        >
          <option value="">All types</option>
          <option value="checkout">Checkout</option>
          <option value="deposit">Deposit</option>
        </select>
        <select
          value={phaseFilter}
          onChange={(e) => applyFilter(setPhaseFilter, e.target.value)}
          style={selectStyle}
        >
          <option value="">All phases</option>
          <option value="completed">Completed</option>
          <option value="payment">Payment</option>
          <option value="quote">Quote</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => applyFilter(setStatusFilter, e.target.value)}
          style={selectStyle}
        >
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="awaiting-payment">Awaiting payment</option>
          <option value="requires-quote">Requires quote</option>
        </select>
      </div>

      {/* Orders list */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {loading && <div style={{ color: "#888", fontSize: 13, textAlign: "center", padding: 20 }}>Loading...</div>}
        {!loading && data && data.orders.length === 0 && (
          <div style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 20 }}>No orders found</div>
        )}
        {!loading && data?.orders.map((order) => (
          <OrderCard key={order.orderId} order={order} />
        ))}
      </div>

      {/* Pagination */}
      {data && data.total > LIMIT && (
        <div style={{
          padding: "10px 16px", borderTop: "1px solid #333",
          display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13,
        }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{ ...pageBtnStyle, opacity: page <= 1 ? 0.4 : 1 }}
          >
            Prev
          </button>
          <span style={{ color: "#aaa" }}>
            {page} / {totalPages} ({data.total} total)
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={{ ...pageBtnStyle, opacity: page >= totalPages ? 0.4 : 1 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

function OrderCard({ order }: { order: OrderStatus }) {
  const productName = (order.lineItems?.[0] as any)?.metadata?.name ?? "—"
  const price = order.quote?.totalPrice
    ? `$${order.quote.totalPrice.amount}`
    : "—"

  return (
    <div style={{
      background: "#1a1a2e", borderRadius: 8, padding: 10,
      border: "1px solid #333", fontSize: 13,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{
          fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", maxWidth: 200,
        }}>
          {productName}
        </span>
        <span style={{ color: "#4ade80", fontWeight: 700 }}>{price}</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Tag label={order.type} color="#6366f1" />
        <Tag label={order.phase} color={order.phase === "completed" ? "#22c55e" : "#f59e0b"} />
        <Tag label={order.payment.status} color={order.payment.status === "completed" ? "#22c55e" : "#888"} />
      </div>
      <div style={{ color: "#555", fontSize: 11, marginTop: 4 }}>
        {new Date(order.createdAt).toLocaleString()}
      </div>
    </div>
  )
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      background: `${color}22`, color, border: `1px solid ${color}44`,
      padding: "1px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600,
    }}>
      {label}
    </span>
  )
}

const closeBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "#888",
  cursor: "pointer", fontSize: 18, padding: "2px 6px",
}

const selectStyle: React.CSSProperties = {
  background: "#0f3460", border: "1px solid #444", color: "#eee",
  padding: "4px 8px", borderRadius: 4, fontSize: 12, outline: "none",
}

const pageBtnStyle: React.CSSProperties = {
  background: "#0f3460", border: "1px solid #444", color: "#eee",
  padding: "4px 12px", borderRadius: 4, fontSize: 12, cursor: "pointer",
}
