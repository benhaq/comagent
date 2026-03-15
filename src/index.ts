import { Hono } from "hono"
import { env } from "./lib/env.js"
import logger from "./lib/logger.js"
import { authMiddleware } from "./middleware/auth.js"
import { errorHandler } from "./middleware/error-handler.js"
import { healthRoute } from "./routes/health.js"
import { createChatRoute } from "./routes/chat.js"
import { authRoute } from "./routes/auth.js"
import { MockProductServiceLive } from "./services/mock-product-service.js"

// Phase 6 will wire ScrapingProductServiceLive when PRODUCT_SERVICE=scraping
const productServiceLayer = MockProductServiceLive

const app = new Hono()

// CORS — allow specific origins; credentials:true requires explicit origin echo, never wildcard
const ALLOWED_ORIGINS = new Set([
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
])

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin") ?? ""
  if (c.req.method === "OPTIONS" && ALLOWED_ORIGINS.has(origin)) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,Cookie",
        "Vary": "Origin",
      },
    })
  }
  await next()
  // Append CORS headers to the final response (covers 401s, 503s, etc.)
  if (ALLOWED_ORIGINS.has(origin)) {
    c.res.headers.set("Access-Control-Allow-Origin", origin)
    c.res.headers.set("Access-Control-Allow-Credentials", "true")
    c.res.headers.set("Vary", "Origin")
  }
})

// Pino HTTP request logger — replaces hono/logger so all logs share the same transport
app.use("*", async (c, next) => {
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  const status = c.res.status
  const logFn = status >= 500 ? "error" : status >= 400 ? "warn" : "info"
  logger[logFn](
    { method: c.req.method, path: c.req.path, status, ms },
    `${c.req.method} ${c.req.path} ${status} ${ms}ms`
  )
})

// Global error handler
app.onError(errorHandler)

// Public routes (no auth required)
app.route("/health", healthRoute)

// Auth middleware for all protected routes
app.use("/api/*", authMiddleware)

// Protected API routes
app.route("/api/auth", authRoute)
app.route("/api/chat", createChatRoute(productServiceLayer))

// Start server
const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
})

logger.info(
  {
    port: env.PORT,
    productService: env.PRODUCT_SERVICE,
    nodeEnv: env.NODE_ENV,
  },
  `Hono server listening on port ${env.PORT}`
)

export { app }
export type AppServer = typeof server
