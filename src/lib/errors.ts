import { Data } from "effect"

/**
 * Raised when a product lookup returns no result.
 */
export class ProductNotFound extends Data.TaggedError("ProductNotFound")<{
  productId: string
}> {}

/**
 * Raised when the external scraping service is down or unreachable.
 */
export class ScrapingServiceUnavailable extends Data.TaggedError(
  "ScrapingServiceUnavailable"
)<{
  cause?: unknown
}> {}

/**
 * Raised when a chat session cannot be found in storage.
 */
export class SessionNotFound extends Data.TaggedError("SessionNotFound")<{
  sessionId: string
}> {}

/**
 * Raised when the AI (LLM) provider returns an error or times out.
 */
export class AIServiceError extends Data.TaggedError("AIServiceError")<{
  cause?: unknown
}> {}

/**
 * Raised on unrecoverable database operation failures.
 */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  cause?: unknown
}> {}

/**
 * Raised when input fails schema or business-rule validation.
 */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  message: string
}> {}

/**
 * Raised on unexpected cache read/write failures.
 */
export class CacheError extends Data.TaggedError("CacheError")<{
  cause?: unknown
}> {}

/**
 * Raised when a cache key lookup yields no result (cache miss).
 */
export class CacheNotFound extends Data.TaggedError("CacheNotFound")<{
  key: string
}> {}

/**
 * Raised when Crossmint JWT validation fails or session cannot be established.
 */
export class AuthenticationError extends Data.TaggedError(
  "AuthenticationError"
)<{
  cause?: unknown
}> {}

/**
 * Raised when Crossmint wallet provisioning fails or times out.
 */
export class WalletProvisioningError extends Data.TaggedError(
  "WalletProvisioningError"
)<{
  cause?: unknown
}> {}
