import { defineCatalog } from "@json-render/core"
import { schema } from "@json-render/react/schema"
import { defineRegistry } from "@json-render/react"
import {
  productCardProps,
  productGridProps,
  productDetailCardProps,
} from "@backend/lib/product-catalog"
import { ProductCard } from "./components/ProductCard"
import { ProductGrid } from "./components/ProductGrid"
import { ProductDetailCard } from "./components/ProductDetailCard"

// Build a frontend catalog using the React schema (required for <Renderer>)
// Reuses the same Zod prop schemas from the backend catalog
const catalog = defineCatalog(schema, {
  components: {
    ProductCard: {
      props: productCardProps,
      description: "Displays a single product with image, price, rating, and metadata",
    },
    ProductGrid: {
      props: productGridProps,
      description: "Responsive grid container for ProductCard children",
    },
    ProductDetailCard: {
      props: productDetailCardProps,
      description: "Expanded product view with full description, specs, gallery, and availability",
    },
  },
})

const { registry } = defineRegistry(catalog, {
  components: {
    ProductCard: ({ props, children }: any) => <ProductCard props={props} />,
    ProductGrid: ({ props, children }: any) => <ProductGrid props={props}>{children}</ProductGrid>,
    ProductDetailCard: ({ props, children }: any) => <ProductDetailCard props={props} />,
  },
})

export { registry }
