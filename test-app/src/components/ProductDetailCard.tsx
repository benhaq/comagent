import type { ProductDetailCardProps } from "@backend/lib/product-catalog"

const availabilityColors: Record<string, string> = {
  in_stock: "#4ade80",
  limited: "#facc15",
  out_of_stock: "#f87171",
}

export function ProductDetailCard({ props }: { props: ProductDetailCardProps }) {
  const price = (props.price / 100).toFixed(2)
  return (
    <div style={{
      border: "1px solid #333",
      borderRadius: 8,
      padding: 16,
      background: "#1e1e2e",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      maxWidth: 600,
    }}>
      <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
        {props.images.map((img, i) => (
          <img
            key={i}
            src={img}
            alt={`${props.name} ${i + 1}`}
            style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
          />
        ))}
      </div>
      <div style={{ fontWeight: 700, fontSize: 18 }}>{props.name}</div>
      {props.brand && <div style={{ fontSize: 13, color: "#888" }}>{props.brand}</div>}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: "#4ade80" }}>${price}</span>
        <span style={{
          fontSize: 12, padding: "2px 8px", borderRadius: 4,
          background: "#333",
          color: availabilityColors[props.availability] ?? "#ccc",
        }}>
          {props.availability.replace("_", " ")}
        </span>
      </div>
      {props.rating != null && (
        <div style={{ fontSize: 13 }}>
          {"★".repeat(Math.round(props.rating))} {props.rating.toFixed(1)}
          {props.reviewCount != null && <span style={{ color: "#666" }}> ({props.reviewCount} reviews)</span>}
        </div>
      )}
      <p style={{ fontSize: 13, color: "#ccc", lineHeight: 1.5 }}>{props.fullDescription}</p>
      {Object.keys(props.specifications).length > 0 && (
        <table style={{ fontSize: 12, borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            {Object.entries(props.specifications).map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: "4px 8px", color: "#888", borderBottom: "1px solid #333" }}>{k}</td>
                <td style={{ padding: "4px 8px", borderBottom: "1px solid #333" }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <a
        href={props.product_url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: 13, color: "#60a5fa", textDecoration: "none" }}
      >
        View product →
      </a>
    </div>
  )
}
