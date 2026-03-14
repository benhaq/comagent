export interface ColorOption {
  name: string
  hex: string
}

export interface ProductCard {
  id: string
  name: string
  image: string
  images?: string[]
  /** Price in cents */
  price: number
  currency: "USD"
  sizes: string[]
  colors: ColorOption[]
  retailer: string
  product_url: string
  rating?: number
  reviewCount?: number
  brand?: string
  description?: string
  category?: string
}

export interface ProductDetail extends ProductCard {
  fullDescription: string
  specifications: Record<string, string>
  /** Required in detail view; overrides optional field from ProductCard */
  images: string[]
  availability: "in_stock" | "limited" | "out_of_stock"
}

export interface ProductSearchParams {
  query: string
  category?: string
  /** Minimum price in USD dollars */
  minPrice?: number
  /** Maximum price in USD dollars */
  maxPrice?: number
  size?: string
  color?: string
  /** Defaults to 5 */
  limit?: number
}

export interface ProductSearchResult {
  products: ProductCard[]
  totalResults: number
  query: string
}
