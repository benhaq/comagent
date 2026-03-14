import { Hono } from "hono"
import { logger as honoLogger } from "hono/logger"
import { env } from "./lib/env.js"
import logger from "./lib/logger.js"
import { authMiddleware } from "./middleware/auth.js"
import { errorHandler } from "./middleware/error-handler.js"
import { healthRoute } from "./routes/health.js"
import { createChatRoute } from "./routes/chat.js"
import { MockProductServiceLive } from "./services/mock-product-service.js"

// Phase 6 will wire ScrapingProductServiceLive when PRODUCT_SERVICE=scraping
const productServiceLayer = MockProductServiceLive

const app = new Hono()

// Request logging middleware (before auth so all requests are logged)
app.use("*", honoLogger())

// Global error handler
app.onError(errorHandler)

// Public routes (no auth required)
app.route("/health", healthRoute)

// Auth middleware for all protected routes
app.use("/api/*", authMiddleware)

// Protected API routes
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
