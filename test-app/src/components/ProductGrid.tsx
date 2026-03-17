import type { ProductGridProps } from "@backend/lib/product-catalog"
import type { ReactNode } from "react"

export function ProductGrid({ props, children }: { props: ProductGridProps; children?: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: "#aaa", marginBottom: 8 }}>
        Results for "{props.query}" — {props.totalResults} found
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 12,
      }}>
        {children}
      </div>
    </div>
  )
}
