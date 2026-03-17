import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

// Backend target — override with VITE_API_TARGET env var for remote testing
// e.g. VITE_API_TARGET=https://comagent-backend-dev.up.railway.app bun run dev
const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:3001"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@backend": path.resolve(__dirname, "../src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
