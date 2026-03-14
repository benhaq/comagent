import { Effect, Layer } from "effect"
import type { ToolSet } from "ai"
import { z } from "zod"
import { ProductService } from "./product-service.js"
import type { ProductDetail, ProductSearchResult } from "../types/product.js"

// ---------------------------------------------------------------------------
// Parameter schemas
// ---------------------------------------------------------------------------

const searchParamsSchema = z.object({
  query: z.string().describe("Search query derived from the conversation context"),
  category: z.string().optional().describe("Product category (e.g., 'Running Shoes')"),
  minPrice: z.number().optional().describe("Minimum price in USD dollars"),
  maxPrice: z.number().optional().describe("Maximum price in USD dollars"),
  size: z.string().optional().describe("Size preference (e.g., '10', 'M', 'Large')"),
  color: z.string().optional().describe("Color preference (e.g., 'black', 'blue')"),
})

const detailParamsSchema = z.object({
  productId: z.string().describe("Product ID to retrieve details for"),
})

type SearchToolParams = z.infer<typeof searchParamsSchema>
type DetailToolParams = z.infer<typeof detailParamsSchema>

// ---------------------------------------------------------------------------
// Factory: bind product tools to a specific ProductService layer
// ---------------------------------------------------------------------------

export function makeProductTools(layer: Layer.Layer<ProductService>): ToolSet {
  /**
   * Run an Effect requiring ProductService; typed errors become defects
   * so the AI SDK execute handler receives a rejected Promise on failure.
   */
  const run = <A>(effect: Effect.Effect<A, never, ProductService>): Promise<A> => {
    // Effect.provide narrows the requirement to never — cast needed due to generic inference limit
    const provided = effect.pipe(Effect.provide(layer)) as unknown as Effect.Effect<A, never, never>
    return Effect.runPromise(provided)
  }

  // Tool() helper's TypeScript overloads conflict with complex Effect return types.
  // Constructing tool objects directly; AI SDK reads { description, parameters, execute } at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {
    searchProducts: {
      description:
        "Search for products matching the user's requirements. Use this to find products based on " +
        "search terms, category, price range, size, or color preferences.",
      parameters: searchParamsSchema,
      execute: async (params: SearchToolParams): Promise<ProductSearchResult> =>
        run(
          ProductService.pipe(
            Effect.flatMap((s) => s.search(params)),
            Effect.orDie
          )
        ),
    },
    getProductDetails: {
      description:
        "Get detailed information about a specific product by its ID. Use this when the user wants " +
        "more details about a product returned from searchProducts.",
      parameters: detailParamsSchema,
      execute: async ({ productId }: DetailToolParams): Promise<ProductDetail | null> =>
        run(
          ProductService.pipe(
            Effect.flatMap((s) => s.getDetails(productId)),
            Effect.catchTag("ProductNotFound", () => Effect.succeed(null)),
            Effect.orDie
          )
        ),
    },
  }

  return tools as ToolSet
}
