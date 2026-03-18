import { useState } from "react"
import { CROSSMINT_CLIENT_API_KEY, CROSSMINT_AUTH_URL } from "../lib/crossmint-config"

interface LoginPanelProps {
  onLoggedIn: (email: string, crossmintJwt: string) => void
}

type Step = "email" | "otp" | "loading"

export function LoginPanel({ onLoggedIn }: LoginPanelProps) {
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [emailId, setEmailId] = useState("")
  const [error, setError] = useState<string | null>(null)

  const sendOtp = async () => {
    if (!email.trim()) return
    setError(null)
    setStep("loading")

    try {
      const res = await fetch(`${CROSSMINT_AUTH_URL}/otps/send`, {
        method: "POST",
        headers: {
          "x-api-key": CROSSMINT_CLIENT_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? `OTP send failed (${res.status})`)
        setStep("email")
        return
      }
      setEmailId(data.emailId)
      setStep("otp")
    } catch (err: any) {
      setError(err.message)
      setStep("email")
    }
  }

  const verifyOtp = async () => {
    if (!otp.trim()) return
    setError(null)
    setStep("loading")

    try {
      // 1. Authenticate with OTP
      const params = new URLSearchParams({
        email,
        signinAuthenticationMethod: "email",
        token: otp.trim(),
        locale: "en",
        state: emailId,
        callbackUrl: `${CROSSMINT_AUTH_URL}/callback`,
      })
      const authRes = await fetch(`${CROSSMINT_AUTH_URL}/authenticate?${params}`, {
        method: "POST",
        headers: {
          "x-api-key": CROSSMINT_CLIENT_API_KEY,
          "content-type": "application/json",
        },
      })
      const authData = await authRes.json()
      if (!authRes.ok || !authData.oneTimeSecret) {
        setError(authData.message ?? "OTP verification failed")
        setStep("otp")
        return
      }

      // 2. Exchange oneTimeSecret for JWT
      const refreshRes = await fetch(`${CROSSMINT_AUTH_URL}/refresh`, {
        method: "POST",
        headers: {
          "x-api-key": CROSSMINT_CLIENT_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({ refresh: authData.oneTimeSecret }),
      })
      const refreshData = await refreshRes.json()
      if (!refreshRes.ok || !refreshData.jwt) {
        setError("Failed to get JWT")
        setStep("otp")
        return
      }

      // 3. Send JWT to backend to set httpOnly cookie session
      const sessionRes = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jwt: refreshData.jwt,
          refreshToken: refreshData.refresh?.secret ?? "",
          email: email.trim(),
        }),
      })
      if (!sessionRes.ok) {
        const sessionData = await sessionRes.json().catch(() => null)
        setError(sessionData?.error ?? `Session setup failed (${sessionRes.status})`)
        setStep("otp")
        return
      }

      onLoggedIn(email.trim(), refreshData.jwt)
    } catch (err: any) {
      setError(err.message)
      setStep("otp")
    }
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", flex: 1, gap: 16, padding: 32,
    }}>
      <div style={{
        background: "#16213e", borderRadius: 12, padding: 32,
        width: "100%", maxWidth: 400,
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        <h2 style={{ margin: 0, fontSize: 20, textAlign: "center" }}>Sign In</h2>

        {step === "email" && (
          <>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendOtp() }}
              placeholder="you@example.com"
              autoFocus
              style={inputStyle}
            />
            <button onClick={sendOtp} style={btnStyle}>Send OTP</button>
          </>
        )}

        {step === "otp" && (
          <>
            <div style={{ fontSize: 13, color: "#aaa", textAlign: "center" }}>
              OTP sent to <strong style={{ color: "#eee" }}>{email}</strong>
            </div>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") verifyOtp() }}
              placeholder="Enter 6-digit code"
              autoFocus
              style={inputStyle}
            />
            <button onClick={verifyOtp} style={btnStyle}>Verify</button>
            <button
              onClick={() => { setStep("email"); setOtp(""); setError(null) }}
              style={{ ...btnStyle, background: "#333" }}
            >
              Back
            </button>
          </>
        )}

        {step === "loading" && (
          <div style={{ textAlign: "center", color: "#aaa", padding: 16 }}>Loading...</div>
        )}

        {error && (
          <div style={{ fontSize: 13, color: "#f87171", textAlign: "center" }}>{error}</div>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: "#0f3460", border: "1px solid #444", color: "#eee",
  padding: "10px 14px", borderRadius: 8, fontSize: 14,
  outline: "none", width: "100%", boxSizing: "border-box",
}

const btnStyle: React.CSSProperties = {
  background: "#e94560", border: "none", color: "#fff",
  padding: "10px 14px", borderRadius: 8, fontSize: 14,
  cursor: "pointer", fontWeight: 600,
}
