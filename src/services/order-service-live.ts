import { Effect, Layer } from "effect"
import { eq, desc } from "drizzle-orm"
import { db } from "../db/client.js"
import { orders } from "../db/schema/orders.js"
import {
  DatabaseError,
  OrderNotFoundError,
} from "../lib/errors.js"
import { getCrossmintOrder } from "../lib/crossmint-client.js"
import { OrderService } from "./order-service.js"
import type { OrderServiceShape, OrderSummary } from "./order-service.js"

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
    type: "checkout",
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
  listOrders: (userId) =>
    Effect.gen(function* () {
      const localOrders = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(orders)
            .where(eq(orders.userId, userId))
            .orderBy(desc(orders.createdAt)),
        catch: dbError,
      })

      const results: OrderSummary[] = []

      for (const local of localOrders) {
        if (local.type === "deposit") {
          results.push({
            orderId: local.id,
            type: "deposit",
            crossmintOrderId: null,
            phase: "completed",
            lineItems: [],
            payment: { status: "funded", currency: "usdc" },
            amountPas: local.amountPas,
            amountUsdc: local.amountUsdc,
            polkadotTxHash: local.polkadotTxHash,
            createdAt: local.createdAt.toISOString(),
          })
          continue
        }

        const crossmintOrder = yield* getCrossmintOrder(local.crossmintOrderId!).pipe(
          Effect.catchAll(() => Effect.succeed(null))
        )

        if (crossmintOrder) {
          results.push(
            mapCrossmintOrder(
              local.id,
              local.crossmintOrderId!,
              crossmintOrder,
              local.createdAt.toISOString()
            )
          )
        } else {
          // Crossmint fetch failed — return minimal local data
          results.push({
            orderId: local.id,
            type: "checkout",
            crossmintOrderId: local.crossmintOrderId,
            phase: "unknown",
            lineItems: [],
            payment: { status: "unknown", currency: "usdc" },
            createdAt: local.createdAt.toISOString(),
          })
        }
      }

      return results
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

      if (local.type === "deposit") {
        return {
          orderId: local.id,
          type: "deposit",
          crossmintOrderId: null,
          phase: "completed",
          lineItems: [],
          payment: { status: "funded", currency: "usdc" },
          amountPas: local.amountPas,
          amountUsdc: local.amountUsdc,
          polkadotTxHash: local.polkadotTxHash,
          createdAt: local.createdAt.toISOString(),
        }
      }

      const crossmintOrder = yield* getCrossmintOrder(local.crossmintOrderId!)

      return mapCrossmintOrder(
        local.id,
        local.crossmintOrderId!,
        crossmintOrder,
        local.createdAt.toISOString()
      )
    }),
}

export const OrderServiceLive = Layer.succeed(OrderService, impl)
