export interface CartItemResponse {
  id: string
  productId: string
  productName: string
  price: number
  image: string
  size: string
  color: string
  productUrl: string
  retailer: string
  createdAt: string
}

export interface AddToCartPayload {
  productId: string
  productName: string
  price: number
  image: string
  size: string
  color: string
  productUrl: string
  retailer: string
}

export async function fetchCart(): Promise<CartItemResponse[]> {
  const res = await fetch("/api/cart")
  if (!res.ok) throw new Error(`Failed to fetch cart: ${res.status}`)
  const data = await res.json()
  return data.items
}

export async function addToCart(
  item: AddToCartPayload,
): Promise<CartItemResponse> {
  const res = await fetch("/api/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const code = body?.code ?? ""
    if (code === "CartDuplicateItemError") throw new Error("Already in cart")
    if (code === "CartFullError") throw new Error("Cart is full (max 10)")
    throw new Error(`Failed to add to cart: ${res.status}`)
  }
  return res.json()
}

export async function removeFromCart(itemId: string): Promise<void> {
  const res = await fetch(`/api/cart/${itemId}`, { method: "DELETE" })
  if (!res.ok) throw new Error(`Failed to remove item: ${res.status}`)
}

export interface CheckoutResponse {
  orderId: string
  crossmintOrderId: string
  phase: string
  serializedTransaction: string
}

export async function checkout(cartItemId: string): Promise<CheckoutResponse> {
  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cartItemId }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const code = body?.code ?? ""
    if (code === "CheckoutNoWalletError") throw new Error("Complete onboarding first — wallet required")
    if (code === "CheckoutMissingAddressError") throw new Error("Complete onboarding first — address required")
    if (code === "InsufficientFundsError") throw new Error("Insufficient USDC balance")
    throw new Error(body?.error ?? `Checkout failed: ${res.status}`)
  }
  return res.json()
}

export interface OrderStatus {
  orderId: string
  crossmintOrderId: string
  phase: string
  lineItems: unknown[]
  payment: { status: string; currency: string }
  quote?: { totalPrice?: { amount: string; currency: string } }
  createdAt: string
}

export async function getOrder(orderId: string): Promise<OrderStatus> {
  const res = await fetch(`/api/orders/${orderId}`)
  if (!res.ok) throw new Error(`Failed to fetch order: ${res.status}`)
  return res.json()
}
