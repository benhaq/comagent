import { useState, useEffect, useCallback, useRef } from "react"
import { useWallet, EVMWallet } from "@crossmint/client-sdk-react-ui"
import { checkout, getOrder, type CheckoutResponse, type OrderStatus } from "../lib/cart-api"

type CheckoutStep = "preparing" | "approving" | "processing" | "completed" | "failed"

interface CheckoutViewProps {
  cartItemId: string
  userEmail: string
  onDone: () => void
  onBack: () => void
}

export function CheckoutView({ cartItemId, userEmail, onDone, onBack }: CheckoutViewProps) {
  const { wallet, getOrCreateWallet } = useWallet()
  const [step, setStep] = useState<CheckoutStep>("preparing")
  const [error, setError] = useState<string | null>(null)
  const [orderData, setOrderData] = useState<CheckoutResponse | null>(null)
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedRef = useRef(false)

  const cleanup = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  useEffect(() => cleanup, [cleanup])

  const startPolling = useCallback((orderId: string) => {
    setStep("processing")
    pollingRef.current = setInterval(async () => {
      try {
        const status = await getOrder(orderId)
        setOrderStatus(status)
        if (status.phase === "completed") {
          cleanup()
          setStep("completed")
        } else if (status.phase === "failed") {
          cleanup()
          setStep("failed")
          setError("Order failed")
        }
      } catch {
        // keep polling on transient errors
      }
    }, 2500)

    timeoutRef.current = setTimeout(() => {
      cleanup()
      setStep("failed")
      setError("Taking longer than expected. Check order history.")
    }, 60_000)
  }, [cleanup])

  const ensureWallet = useCallback(async (): Promise<EVMWallet> => {
    // Get or create the base wallet, then wrap as EVMWallet
    const baseWallet = wallet ?? await getOrCreateWallet({
      chain: "base-sepolia",
      signer: { type: "email", email: userEmail },
    })
    return EVMWallet.from(baseWallet)
  }, [wallet, getOrCreateWallet, userEmail])

  const handleCheckout = useCallback(async () => {
    setError(null)
    setStep("preparing")

    try {
      // 1. Ensure wallet is initialized
      const w = await ensureWallet()

      // 2. Create order on backend
      const data = await checkout(cartItemId)
      setOrderData(data)

      // 3. Sign with wallet SDK (triggers email OTP)
      setStep("approving")
      await w.sendTransaction({
        calls: [{ transaction: data.serializedTransaction }],
        chain: "base-sepolia",
      })

      // 4. Poll for completion
      startPolling(data.orderId)
    } catch (err: any) {
      setStep("failed")
      setError(err.message ?? "Checkout failed")
    }
  }, [cartItemId, ensureWallet, startPolling])

  // Auto-start checkout on mount — guard against StrictMode double-fire
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    handleCheckout()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", flex: 1, padding: 32, gap: 16,
    }}>
      <div style={{
        background: "#16213e", borderRadius: 12, padding: 32,
        width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 16,
      }}>
        <h2 style={{ margin: 0, fontSize: 20, textAlign: "center" }}>Checkout</h2>

        {step === "preparing" && (
          <div style={{ textAlign: "center", color: "#aaa", padding: 16 }}>
            Creating order...
          </div>
        )}

        {step === "approving" && (
          <div style={{ textAlign: "center", color: "#fbbf24", padding: 16 }}>
            Check your email for the OTP code to approve this transaction.
          </div>
        )}

        {step === "processing" && (
          <div style={{ textAlign: "center", color: "#60a5fa", padding: 16 }}>
            Transaction approved! Processing order...
          </div>
        )}

        {step === "completed" && (
          <div style={{ textAlign: "center", padding: 16 }}>
            <div style={{ color: "#4ade80", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Order Complete!
            </div>
            {orderStatus?.quote?.totalPrice && (
              <div style={{ color: "#aaa", fontSize: 14 }}>
                Total: ${orderStatus.quote.totalPrice.amount} {orderStatus.quote.totalPrice.currency.toUpperCase()}
              </div>
            )}
            <button onClick={onDone} style={btnStyle}>Back to Cart</button>
          </div>
        )}

        {step === "failed" && (
          <div style={{ textAlign: "center", padding: 16 }}>
            <div style={{ color: "#f87171", fontSize: 14, marginBottom: 12 }}>
              {error ?? "Something went wrong"}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              {orderData && (
                <button
                  onClick={async () => {
                    setError(null)
                    setStep("approving")
                    try {
                      const w = await ensureWallet()
                      await w.sendTransaction({
                        calls: [{ transaction: orderData.serializedTransaction }],
                        chain: "base-sepolia",
                      })
                      startPolling(orderData.orderId)
                    } catch (err: any) {
                      setError(err.message)
                      setStep("failed")
                    }
                  }}
                  style={btnStyle}
                >
                  Retry Approval
                </button>
              )}
              <button onClick={onBack} style={{ ...btnStyle, background: "#333" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: "#e94560",
  border: "none",
  color: "#fff",
  padding: "10px 14px",
  borderRadius: 8,
  fontSize: 14,
  cursor: "pointer",
  fontWeight: 600,
  marginTop: 8,
}
