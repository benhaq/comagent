import type { ProductSearchResult, ProductDetail } from "../types/product.js"

// ---------------------------------------------------------------------------
// Spec types — minimal json-render element tree structure
// ---------------------------------------------------------------------------

interface SpecElement {
  type: string
  props: Record<string, unknown>
  children?: SpecElement[]
}

export interface Spec {
  root: SpecElement
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Build a ProductGrid spec from a searchProducts tool result.
 * Frontend calls this when it intercepts a `tool-result` event
 * with toolName === "searchProducts".
 */
export function buildProductGridSpec(result: ProductSearchResult): Spec {
  return {
    root: {
      type: "ProductGrid",
      props: {
        query: result.query,
        totalResults: result.totalResults,
      },
      children: result.products.map((product) => ({
        type: "ProductCard",
        props: product as unknown as Record<string, unknown>,
      })),
    },
  }
}

/**
 * Build a ProductDetailCard spec from a getProductDetails tool result.
 * Frontend calls this when it intercepts a `tool-result` event
 * with toolName === "getProductDetails" and result is non-null.
 */
export function buildProductDetailSpec(detail: ProductDetail): Spec {
  return {
    root: {
      type: "ProductDetailCard",
      props: detail as unknown as Record<string, unknown>,
    },
  }
}
