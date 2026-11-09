import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Copied from board/apps/web/vite.config.ts. Quorum differences:
// - two pages: index.html (landing, served at /) and app.html (council console, served at /app)
// - the build writes straight into site/ so src/server.ts serves it with no build step at runtime
// - vite dev (5173) proxies /api to the Quorum server (4317 or QUORUM_PORT)
const root = import.meta.dirname
const apiPort = process.env.QUORUM_PORT ?? "4317"
export default defineConfig({
  root,
  base: process.env.QUORUM_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(root, "./src") } },
  build: {
    outDir: process.env.QUORUM_OUT ? resolve(process.env.QUORUM_OUT) : resolve(root, ".."),
    emptyOutDir: Boolean(process.env.QUORUM_OUT),
    rollupOptions: { input: { index: resolve(root, "index.html"), app: resolve(root, "app.html"), workspace: resolve(root, "workspace.html") } },
  },
  server: { port: 5173, proxy: { "/api": `http://127.0.0.1:${apiPort}` } },
})
