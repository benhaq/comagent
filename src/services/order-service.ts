import { Context, Effect } from "effect"
import type {
  DatabaseError,
  OrderNotFoundError,
  CheckoutOrderCreationError,
} from "../lib/errors.js"

export interface OrderSummary {
  orderId: string
  type: string
  crossmintOrderId: string | null
  phase: string
  lineItems: unknown[]
  payment: { status: string; currency: string }
  quote?: { totalPrice?: { amount: string; currency: string } }
  amountPas?: string | null
  amountUsdc?: string | null
  polkadotTxHash?: string | null
  createdAt: string
}

export interface OrderServiceShape {
  listOrders(userId: string): Effect.Effect<
    OrderSummary[],
    DatabaseError | CheckoutOrderCreationError
  >

  getOrder(userId: string, orderId: string): Effect.Effect<
    OrderSummary,
    OrderNotFoundError | DatabaseError | CheckoutOrderCreationError
  >
}

export class OrderService extends Context.Tag("OrderService")<
  OrderService,
  OrderServiceShape
>() {}
