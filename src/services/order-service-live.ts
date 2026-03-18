import { Effect, Layer } from "effect"
import { eq, desc, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import { orders } from "../db/schema/orders.js"
import {
  DatabaseError,
  OrderNotFoundError,
} from "../lib/errors.js"
import { getCrossmintOrder } from "../lib/crossmint-client.js"
import { OrderService } from "./order-service.js"
import type { OrderServiceShape, OrderSummary, ListOrdersParams } from "./order-service.js"

const dbError = (cause: unknown) => new DatabaseError({ cause })

function mapCrossmintOrder(
  localOrderId: string,
  crossmintOrderId: string,
  crossmintOrder: {
    phase: string
    lineItems?: unknown[]
    payment?: { status?: string; currency?: string }
    quote?: { totalPrice?: { amount: string; currency: string } }
  },
  createdAt: string
): OrderSummary {
  return {
    orderId: localOrderId,
    crossmintOrderId,
    phase: crossmintOrder.phase,
    lineItems: crossmintOrder.lineItems ?? [],
    payment: {
      status: crossmintOrder.payment?.status ?? "unknown",
      currency: crossmintOrder.payment?.currency ?? "usdc",
    },
    quote: crossmintOrder.quote
      ? { totalPrice: crossmintOrder.quote.totalPrice }
      : undefined,
    createdAt,
  }
}

const impl: OrderServiceShape = {
  listOrders: (userId, params?: ListOrdersParams) =>
    Effect.gen(function* () {
      const page = Math.max(1, params?.page ?? 1)
      const limit = Math.min(100, Math.max(1, params?.limit ?? 20))
      const offset = (page - 1) * limit

      // Count total orders for this user
      const totalRows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(orders)
            .where(eq(orders.userId, userId))
            .then((rows) => rows[0]?.count ?? 0),
        catch: dbError,
      })

      // Fetch paginated orders
      const localOrders = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(orders)
            .where(eq(orders.userId, userId))
            .orderBy(desc(orders.createdAt))
            .limit(limit)
            .offset(offset),
        catch: dbError,
      })

      const results: OrderSummary[] = []

      for (const local of localOrders) {
        const crossmintOrder = yield* getCrossmintOrder(local.crossmintOrderId).pipe(
          Effect.catchAll(() => Effect.succeed(null))
        )

        if (crossmintOrder) {
          results.push(
            mapCrossmintOrder(
              local.id,
              local.crossmintOrderId,
              crossmintOrder,
              local.createdAt.toISOString()
            )
          )
        } else {
          results.push({
            orderId: local.id,
            crossmintOrderId: local.crossmintOrderId,
            phase: "unknown",
            lineItems: [],
            payment: { status: "unknown", currency: "usdc" },
            createdAt: local.createdAt.toISOString(),
          })
        }
      }

      // Apply post-fetch filters (phase/status come from Crossmint, not DB)
      let filtered = results
      if (params?.phase) {
        filtered = filtered.filter((o) => o.phase === params.phase)
      }
      if (params?.status) {
        filtered = filtered.filter((o) => o.payment.status === params.status)
      }

      return { orders: filtered, total: totalRows, page, limit }
    }),

  getOrder: (userId, orderId) =>
    Effect.gen(function* () {
      const local = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(orders)
            .where(eq(orders.id, orderId))
            .then((rows) => rows[0] ?? null),
        catch: dbError,
      })

      if (!local || local.userId !== userId) {
        return yield* Effect.fail(new OrderNotFoundError({ orderId }))
      }

      const crossmintOrder = yield* getCrossmintOrder(local.crossmintOrderId)

      return mapCrossmintOrder(
        local.id,
        local.crossmintOrderId,
        crossmintOrder,
        local.createdAt.toISOString()
      )
    }),
}

export const OrderServiceLive = Layer.succeed(OrderService, impl)
