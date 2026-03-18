import type { CartItemResponse } from "../lib/cart-api"

interface CartPanelProps {
  items: CartItemResponse[]
  loading: boolean
  onRemove: (itemId: string) => void
  onCheckout: (itemId: string) => void
  onClose: () => void
}

export function CartPanel({ items, loading, onRemove, onCheckout, onClose }: CartPanelProps) {
  const total = items.reduce((sum, i) => sum + i.price, 0)

  return (
    <div style={{
      width: 320,
      background: "#16213e",
      borderLeft: "1px solid #333",
      display: "flex",
      flexDirection: "column",
      height: "100%",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px",
        borderBottom: "1px solid #333",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Cart ({items.length})</span>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", color: "#888",
            cursor: "pointer", fontSize: 18, padding: "2px 6px",
          }}
        >
          &times;
        </button>
      </div>

      {/* Items */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {loading && <div style={{ color: "#888", fontSize: 13, textAlign: "center", padding: 20 }}>Loading...</div>}
        {!loading && items.length === 0 && (
          <div style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 20 }}>Cart is empty</div>
        )}
        {items.map((item) => (
          <div key={item.id} style={{
            display: "flex", gap: 10, background: "#1a1a2e",
            borderRadius: 8, padding: 10, border: "1px solid #333",
          }}>
            <img
              src={item.image}
              alt={item.productName}
              style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 600,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {item.productName}
              </div>
              <div style={{ fontSize: 11, color: "#888" }}>
                {item.size} / {item.color}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#4ade80", marginTop: 2 }}>
                ${(item.price / 100).toFixed(2)}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignSelf: "flex-start" }}>
              <button
                onClick={() => onCheckout(item.id)}
                title="Checkout"
                style={{
                  background: "#4ade80", border: "none", color: "#000",
                  cursor: "pointer", fontSize: 11, padding: "4px 8px",
                  borderRadius: 4, fontWeight: 600,
                }}
              >
                Buy
              </button>
              <button
                onClick={() => onRemove(item.id)}
                title="Remove"
                style={{
                  background: "none", border: "none", color: "#f87171",
                  cursor: "pointer", fontSize: 16, padding: "0 4px",
                }}
              >
                &times;
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Total */}
      {items.length > 0 && (
        <div style={{
          padding: "12px 16px", borderTop: "1px solid #333",
          display: "flex", justifyContent: "space-between", fontSize: 14,
        }}>
          <span style={{ color: "#aaa" }}>Total</span>
          <span style={{ fontWeight: 700, color: "#4ade80" }}>
            ${(total / 100).toFixed(2)}
          </span>
        </div>
      )}
    </div>
  )
}
