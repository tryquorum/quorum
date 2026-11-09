import { PORT } from "./contract";
import { join, normalize } from "node:path";

const siteRoot = join(import.meta.dir, "..", "site");

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : pathname === "/app" ? "app.html" : pathname.slice(1);
  const full = normalize(join(siteRoot, rel));
  if (!full.startsWith(siteRoot)) return new Response("forbidden", { status: 403 });
  const file = Bun.file(full);
  return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/health") return Response.json({ ok: true, version: "0.0.1" });
    if (url.pathname.startsWith("/api/")) return Response.json({ error: "not implemented yet", path: url.pathname }, { status: 501 });
    return serveStatic(url.pathname);
  },
});
console.log(`quorum on http://localhost:${PORT}`);
