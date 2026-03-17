import { Effect } from "effect"
import { env } from "./env.js"
import { CheckoutOrderCreationError, CheckoutPaymentError, DepositFundingError } from "./errors.js"
import logger from "./logger.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrossmintOrderLineItem {
  productLocator: string
}

export interface CrossmintPhysicalAddress {
  name: string
  line1: string
  line2?: string
  city: string
  state: string
  postalCode: string
  country: string
}

export interface CreateOrderParams {
  email: string
  physicalAddress: CrossmintPhysicalAddress
  payerAddress: string
  lineItems: CrossmintOrderLineItem[]
}

export interface CrossmintOrderResponse {
  clientSecret: string
  order: {
    orderId: string
    phase: string
    lineItems: unknown[]
    quote?: {
      status: string
      totalPrice?: { amount: string; currency: string }
    }
    payment: {
      status: string
      method: string
      currency: string
      preparation?: {
        serializedTransaction?: string
      }
    }
  }
}

export interface CrossmintTransactionResponse {
  id: string
  status: string
  onChain?: {
    txId?: string
    chain?: string
  }
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const baseUrl = () => env.CROSSMINT_API_URL
const apiKey = () => env.CROSSMINT_SERVER_API_KEY

const headers = () => ({
  "X-API-KEY": apiKey(),
  "Content-Type": "application/json",
})

// ---------------------------------------------------------------------------
// Create order via Headless Checkout API
// ---------------------------------------------------------------------------

export const createCrossmintOrder = (
  params: CreateOrderParams
): Effect.Effect<CrossmintOrderResponse, CheckoutOrderCreationError> =>
  Effect.tryPromise({
    try: async () => {
      const url = `${baseUrl()}/api/2022-06-09/orders`
      const body = {
        recipient: {
          email: params.email,
          physicalAddress: params.physicalAddress,
        },
        locale: "en-US",
        payment: {
          receiptEmail: params.email,
          method: "base-sepolia",
          currency: "usdc",
          payerAddress: params.payerAddress,
        },
        lineItems: params.lineItems,
      }

      logger.info({ email: params.email, lineItems: params.lineItems }, "Creating Crossmint order")

      const res = await fetch(url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })

      const data = await res.json()

      if (!res.ok) {
        logger.error({ status: res.status, data }, "Crossmint order creation failed")
        throw new Error(data?.message ?? `Crossmint order failed: ${res.status}`)
      }

      logger.info({ orderId: data.order?.orderId }, "Crossmint order created")
      return data as CrossmintOrderResponse
    },
    catch: (cause) => new CheckoutOrderCreationError({ cause }),
  })

// ---------------------------------------------------------------------------
// Sign transaction via Crossmint Wallets API
// ---------------------------------------------------------------------------

export const signCrossmintTransaction = (
  walletId: string,
  serializedTransaction: string,
  chain: string = "base-sepolia"
): Effect.Effect<CrossmintTransactionResponse, CheckoutPaymentError> =>
  Effect.tryPromise({
    try: async () => {
      const url = `${baseUrl()}/api/2022-06-09/wallets/${walletId}/transactions`
      const body = {
        params: {
          calls: [{ transaction: serializedTransaction }],
          chain,
        },
      }

      logger.info({ walletId, chain }, "Signing Crossmint transaction")

      const res = await fetch(url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })

      const data = await res.json()

      if (!res.ok) {
        logger.error({ status: res.status, data, walletId }, "Crossmint transaction signing failed")
        throw new Error(data?.message ?? `Transaction signing failed: ${res.status}`)
      }

      logger.info({ walletId, txId: data.id }, "Crossmint transaction signed")
      return data as CrossmintTransactionResponse
    },
    catch: (cause) => new CheckoutPaymentError({ cause }),
  })

// ---------------------------------------------------------------------------
// Get order status via Headless Checkout API
// ---------------------------------------------------------------------------

export const getCrossmintOrder = (
  crossmintOrderId: string
): Effect.Effect<CrossmintOrderResponse["order"], CheckoutOrderCreationError> =>
  Effect.tryPromise({
    try: async () => {
      const url = `${baseUrl()}/api/2022-06-09/orders/${crossmintOrderId}`

      const res = await fetch(url, {
        method: "GET",
        headers: headers(),
        signal: AbortSignal.timeout(15_000),
      })

      const data = await res.json()

      if (!res.ok) {
        logger.error({ status: res.status, crossmintOrderId }, "Crossmint get order failed")
        throw new Error(data?.message ?? `Get order failed: ${res.status}`)
      }

      return data.order as CrossmintOrderResponse["order"]
    },
    catch: (cause) => new CheckoutOrderCreationError({ cause }),
  })

// ---------------------------------------------------------------------------
// Fund wallet via staging faucet (USDXM)
// ---------------------------------------------------------------------------

export interface CrossmintFundWalletResponse {
  token: string
  decimals: number
  balances: {
    base?: string
    total: string
  }
}

export const fundCrossmintWallet = (
  walletLocator: string,
  amount: number,
  chain: string = "base-sepolia"
): Effect.Effect<CrossmintFundWalletResponse[], DepositFundingError> =>
  Effect.tryPromise({
    try: async () => {
      const url = `${baseUrl()}/api/v1-alpha2/wallets/${walletLocator}/balances`
      const body = {
        amount,
        token: "usdxm",
        chain,
      }

      logger.info({ walletLocator, amount, chain }, "Funding Crossmint wallet via staging faucet")

      const res = await fetch(url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })

      const data = await res.json()

      if (!res.ok) {
        logger.error({ status: res.status, data, walletLocator }, "Crossmint wallet funding failed")
        throw new Error(data?.message ?? `Wallet funding failed: ${res.status}`)
      }

      logger.info({ walletLocator, amount }, "Crossmint wallet funded")
      return data as CrossmintFundWalletResponse[]
    },
    catch: (cause) => new DepositFundingError({ cause }),
  })
