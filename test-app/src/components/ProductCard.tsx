import type { ProductCardProps } from "@backend/lib/product-catalog"

export function ProductCard({ props }: { props: ProductCardProps }) {
  const price = (props.price / 100).toFixed(2)
  return (
    <div style={{
      border: "1px solid #333",
      borderRadius: 8,
      padding: 12,
      background: "#1e1e2e",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      <img
        src={props.image}
        alt={props.name}
        style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 4 }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
      />
      <div style={{ fontWeight: 600, fontSize: 14 }}>{props.name}</div>
      {props.brand && <div style={{ fontSize: 12, color: "#888" }}>{props.brand}</div>}
      <div style={{ fontSize: 16, fontWeight: 700, color: "#4ade80" }}>${price}</div>
      <div style={{ fontSize: 12, color: "#aaa" }}>{props.retailer}</div>
      {props.rating != null && (
        <div style={{ fontSize: 12 }}>
          {"★".repeat(Math.round(props.rating))} {props.rating.toFixed(1)}
          {props.reviewCount != null && <span style={{ color: "#666" }}> ({props.reviewCount})</span>}
        </div>
      )}
      {props.colors.length > 0 && (
        <div style={{ display: "flex", gap: 4 }}>
          {props.colors.map((c) => (
            <span
              key={c.hex}
              title={c.name}
              style={{
                width: 16, height: 16, borderRadius: "50%",
                background: c.hex, border: "1px solid #555",
              }}
            />
          ))}
        </div>
      )}
      {props.sizes.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {props.sizes.map((s) => (
            <span key={s} style={{
              fontSize: 11, padding: "2px 6px", borderRadius: 4,
              background: "#333", color: "#ccc",
            }}>{s}</span>
          ))}
        </div>
      )}
      <a
        href={props.product_url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: 12, color: "#60a5fa", textDecoration: "none" }}
      >
        View product →
      </a>
    </div>
  )
}
