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
