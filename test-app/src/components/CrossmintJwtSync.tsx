import { useEffect } from "react"
import { useCrossmint } from "@crossmint/client-sdk-react-ui"

interface CrossmintJwtSyncProps {
  jwt: string | null
}

// Syncs our auth JWT to the Crossmint SDK so wallet operations work.
// Must be rendered inside CrossmintProvider.
export function CrossmintJwtSync({ jwt }: CrossmintJwtSyncProps) {
  const { setJwt } = useCrossmint()

  useEffect(() => {
    if (jwt) {
      setJwt(jwt)
    }
  }, [jwt, setJwt])

  return null
}
