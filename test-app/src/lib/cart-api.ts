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

function cartBase(apiUrl: string): string {
  // apiUrl is like "http://localhost:3001/api/chat" → replace /chat with /cart
  return apiUrl.replace(/\/chat\/?$/, "/cart")
}

/** Set the crossmint-jwt cookie so fetch with credentials: "include" picks it up. */
function ensureCookie(jwt: string): void {
  if (!document.cookie.includes("crossmint-jwt=")) {
    document.cookie = `crossmint-jwt=${jwt}; path=/`
  }
}

export async function fetchCart(
  apiUrl: string,
  jwt: string,
): Promise<CartItemResponse[]> {
  ensureCookie(jwt)
  const res = await fetch(cartBase(apiUrl), { credentials: "include" })
  if (!res.ok) throw new Error(`Failed to fetch cart: ${res.status}`)
  const data = await res.json()
  return data.items
}

export async function addToCart(
  apiUrl: string,
  jwt: string,
  item: AddToCartPayload,
): Promise<CartItemResponse> {
  ensureCookie(jwt)
  const res = await fetch(cartBase(apiUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
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

export async function removeFromCart(
  apiUrl: string,
  jwt: string,
  itemId: string,
): Promise<void> {
  ensureCookie(jwt)
  const res = await fetch(`${cartBase(apiUrl)}/${itemId}`, {
    method: "DELETE",
    credentials: "include",
  })
  if (!res.ok) throw new Error(`Failed to remove item: ${res.status}`)
}
