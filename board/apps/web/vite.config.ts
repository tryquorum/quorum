import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// 빌드 결과(dist)는 Bun 서버(3070)가 그대로 서빙한다. vite dev(5173)로 볼 때는 API와 옛 보드를 3070으로 넘긴다.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3070", "/legacy": "http://127.0.0.1:3070" },
  },
})
