import { rmSync } from "node:fs"
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Copied from board/apps/web/vite.config.ts. Quorum differences:
// - two pages: index.html (landing, served at /) and app.html (council console, served at /app)
// - default build writes straight into site/ so src/server.ts serves it with no build step at runtime
// - QUORUM_OUT (GitHub Pages) writes a clean separate folder instead; QUORUM_BASE sets the URL base
// - vite dev (5173) proxies /api to the Quorum server (4317 or QUORUM_PORT)
const root = import.meta.dirname
const apiPort = process.env.QUORUM_PORT ?? "4317"
const out = process.env.QUORUM_OUT ? resolve(process.env.QUORUM_OUT) : resolve(root, "..")
export default defineConfig(({ command }) => {
  // site/ also holds web/ sources, so it cannot be emptied; drop only the old hashed assets.
  // Never touch site/assets when building elsewhere (QUORUM_OUT).
  if (command === "build" && !process.env.QUORUM_OUT) rmSync(resolve(out, "assets"), { recursive: true, force: true })
  return {
    root,
    base: process.env.QUORUM_BASE ?? "/",
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": resolve(root, "./src") } },
    build: {
      outDir: out,
      emptyOutDir: Boolean(process.env.QUORUM_OUT),
      rollupOptions: { input: { index: resolve(root, "index.html"), app: resolve(root, "app.html"), workspace: resolve(root, "workspace.html") } },
    },
    server: { port: 5173, proxy: { "/api": `http://127.0.0.1:${apiPort}` } },
  }
})
