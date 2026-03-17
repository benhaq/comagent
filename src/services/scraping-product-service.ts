import { Effect, Layer, Schedule, Duration } from "effect";
import { env } from "../lib/env.js";
import logger from "../lib/logger.js";
import { ProductNotFound, ScrapingServiceUnavailable } from "../lib/errors.js";
import { CacheService } from "./cache-service.js";
import { ProductService, type ProductServiceShape } from "./product-service.js";
import type {
  ProductCard,
  ProductDetail,
  ProductSearchParams,
  ProductSearchResult,
  ScrapingProduct,
  ScrapingProductDetailResponse,
  ScrapingSearchResponse,
} from "../types/product.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 60_000;
const CACHE_TTL_SECONDS = 15 * 60;
const RETRY_SCHEDULE = Schedule.exponential("2 seconds").pipe(
  Schedule.compose(Schedule.recurs(2)),
);

// ---------------------------------------------------------------------------
// Mapper: ScrapingProduct → ProductCard
// ---------------------------------------------------------------------------

function toProductCard(sp: ScrapingProduct): ProductCard {
  return {
    id: sp.asin,
    name: sp.title,
    image: sp.images[0] ?? "",
    images: sp.images,
    price: sp.price != null ? Math.round(sp.price * 100) : 0,
    currency: "USD",
    sizes: [],
    colors: [],
    retailer: "Amazon",
    product_url: sp.productUrl,
    rating: sp.rating ?? undefined,
    brand: sp.brand ?? undefined,
    description: sp.description ?? undefined,
    category: sp.category ?? undefined,
  };
}

function toProductDetail(sp: ScrapingProduct): ProductDetail {
  const card = toProductCard(sp);
  return {
    ...card,
    images: sp.images,
    fullDescription: sp.description ?? sp.title,
    specifications: sp.specifications,
    availability: sp.available ? "in_stock" : "out_of_stock",
  };
}

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

function searchCacheKey(query: string): string {
  return `scraping:search:${query.toLowerCase().trim()}`;
}

function productCacheKey(asin: string): string {
  return `scraping:product:${asin}`;
}

// ---------------------------------------------------------------------------
// Implementation factory (requires CacheService)
// ---------------------------------------------------------------------------

function makeScrapingImpl(cache: {
  get: (key: string) => Effect.Effect<string, any>;
  set: (key: string, value: string, ttl: number) => Effect.Effect<void, any>;
}): ProductServiceShape {
  const baseUrl = env.SCRAPING_SERVICE_URL || "http://localhost:3000";

  const fetchSearch = (
    params: ProductSearchParams,
  ): Effect.Effect<ScrapingSearchResponse, ScrapingServiceUnavailable> =>
    Effect.tryPromise({
      try: async () => {
        // Pass query, brand, maxPrice, pagination to scraping API
        // minPrice/category/rating filters are unreliable server-side — applied client-side instead
        const qs = new URLSearchParams({ q: params.query });
        if (params.limit != null) qs.set("limit", String(Math.min(params.limit * 3, 20))); // fetch extra to compensate for client-side filtering
        if (params.page != null && params.page > 1) qs.set("page", String(params.page));
        if (params.brand) qs.set("brand", params.brand);
        if (params.maxPrice != null) qs.set("maxPrice", String(params.maxPrice));
        const url = `${baseUrl}/api/search/realtime?${qs.toString()}`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok)
          throw new Error(`Scraping API ${res.status}: ${res.statusText}`);
        return (await res.json()) as ScrapingSearchResponse;
      },
      catch: (cause) => new ScrapingServiceUnavailable({ cause }),
    }).pipe(Effect.retry(RETRY_SCHEDULE));

  const fetchProductByAsin = (
    asin: string,
  ): Effect.Effect<ScrapingProduct | null, ScrapingServiceUnavailable> =>
    Effect.tryPromise({
      try: async () => {
        const url = `${baseUrl}/api/search/realtime/product/${encodeURIComponent(asin)}`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok)
          throw new Error(
            `Scraping detail API ${res.status}: ${res.statusText}`,
          );
        const body = (await res.json()) as ScrapingProductDetailResponse;
        return body.data;
      },
      catch: (cause) => new ScrapingServiceUnavailable({ cause }),
    }).pipe(Effect.retry(RETRY_SCHEDULE));

  const search = (
    params: ProductSearchParams,
  ): Effect.Effect<ProductSearchResult, ScrapingServiceUnavailable> =>
    Effect.gen(function* () {
      const searchParams = { ...params, limit: params.limit ?? 5, page: params.page ?? 1 };
      const data = yield* fetchSearch(searchParams);
      let products = data.products.map(toProductCard);

      // Client-side price filtering (scraping backend filters are unreliable)
      if (params.minPrice != null && params.minPrice > 0) {
        products = products.filter((p) => p.price >= params.minPrice! * 100);
      }
      if (params.maxPrice != null) {
        products = products.filter((p) => p.price <= params.maxPrice! * 100);
      }
      products = products.slice(0, params.limit ?? 5);

      // Cache individual products for getDetails lookups
      for (const sp of data.products) {
        yield* cache
          .set(productCacheKey(sp.asin), JSON.stringify(sp), CACHE_TTL_SECONDS)
          .pipe(Effect.catchAll(() => Effect.void));
      }
      // Cache search results
      yield* cache
        .set(
          searchCacheKey(params.query),
          JSON.stringify(data),
          CACHE_TTL_SECONDS,
        )
        .pipe(Effect.catchAll(() => Effect.void));

      logger.debug(
        {
          query: params.query,
          total: data.total,
          returned: products.length,
          execMs: data.executionTime,
        },
        "Scraping search complete",
      );
      return { products, totalResults: data.total, query: params.query };
    });

  const getDetails = (
    productId: string,
  ): Effect.Effect<
    ProductDetail,
    ProductNotFound | ScrapingServiceUnavailable
  > =>
    Effect.gen(function* () {
      // Try cache first
      const cached = yield* cache.get(productCacheKey(productId)).pipe(
        Effect.map((raw) => JSON.parse(raw) as ScrapingProduct),
        Effect.catchAll(() => Effect.succeed(null)),
      );
      if (cached) return toProductDetail(cached);

      // Cache miss — fetch from realtime detail endpoint
      const product = yield* fetchProductByAsin(productId);
      if (!product)
        return yield* Effect.fail(new ProductNotFound({ productId }));

      // Cache for future lookups
      yield* cache
        .set(
          productCacheKey(product.asin),
          JSON.stringify(product),
          CACHE_TTL_SECONDS,
        )
        .pipe(Effect.catchAll(() => Effect.void));

      return toProductDetail(product);
    });

  return { search, getDetails };
}

// ---------------------------------------------------------------------------
// Layer: requires CacheService
// ---------------------------------------------------------------------------

export const ScrapingProductServiceLive = Layer.effect(
  ProductService,
  CacheService.pipe(Effect.map((cache) => makeScrapingImpl(cache))),
);
