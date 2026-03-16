import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { env } from "./lib/env.js";
import logger from "./lib/logger.js";
import { authMiddleware } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { healthRoute } from "./routes/health.js";
import { createChatRoute } from "./routes/chat.js";
import { authRoute } from "./routes/auth.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { MockProductServiceLive } from "./services/mock-product-service.js";
import { ScrapingProductServiceLive } from "./services/scraping-product-service.js";
import { CacheServiceLive } from "./services/cache-service.js";
import { Layer } from "effect";
import { ChatSessionServiceLive } from "./services/chat-session-service-live.js";

const productServiceLayer =
  env.PRODUCT_SERVICE === "scraping"
    ? ScrapingProductServiceLive.pipe(Layer.provide(CacheServiceLive))
    : MockProductServiceLive;

const app = new OpenAPIHono();

// Register cookie auth security scheme for OpenAPI docs
app.openAPIRegistry.registerComponent("securitySchemes", "CookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: "crossmint-jwt",
  description: "Crossmint JWT session cookie",
});

// CORS — allow specific origins; credentials:true requires explicit origin echo, never wildcard
const ALLOWED_ORIGINS = new Set([
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "null", // file:// origin for local test pages
]);

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin") ?? "";
  if (c.req.method === "OPTIONS" && ALLOWED_ORIGINS.has(origin)) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,Cookie,X-Refresh-Token",
        Vary: "Origin",
      },
    });
  }
  await next();
  if (ALLOWED_ORIGINS.has(origin)) {
    c.res.headers.set("Access-Control-Allow-Origin", origin);
    c.res.headers.set("Access-Control-Allow-Credentials", "true");
    c.res.headers.set("Vary", "Origin");
  }
});

// Pino HTTP request logger
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const status = c.res.status;
  const logFn = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  logger[logFn](
    { method: c.req.method, path: c.req.path, status, ms },
    `${c.req.method} ${c.req.path} ${status} ${ms}ms`,
  );
});

// Global error handler
app.onError(errorHandler);

// Public routes (no auth required)
app.route("/health", healthRoute);

// OpenAPI spec + Swagger UI (public)
app.doc("/doc", {
  openapi: "3.1.0",
  info: {
    title: "ComAgent API",
    version: "0.1.0",
    description: "AI Shopping Assistant — ReAct chat agent backend",
  },
});
app.get("/swagger", swaggerUI({ url: "/doc" }));

// Serve test chat page
app.get("/test", async (c) => {
  const file = Bun.file("test-chat.html");
  return new Response(await file.text(), { headers: { "Content-Type": "text/html" } });
});

// Auth middleware for all protected routes
app.use("/api/*", authMiddleware);

// Protected API routes
app.route("/api/auth", authRoute);
app.route(
  "/api/chat",
  createChatRoute(productServiceLayer, ChatSessionServiceLive),
);
app.route("/api/sessions", createSessionRoutes(ChatSessionServiceLive));

// Start server
const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
  idleTimeout: 120, // seconds — LLM streaming + scraping API calls need more than 10s default
});

logger.info(
  {
    port: env.PORT,
    productService: env.PRODUCT_SERVICE,
    nodeEnv: env.NODE_ENV,
  },
  `Hono server listening on port ${env.PORT}`,
);

export { app };
export type AppServer = typeof server;
