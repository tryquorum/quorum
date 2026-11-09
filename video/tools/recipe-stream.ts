// Streams one real recipe run from the local Quorum server for the demo video.
// Prints event type, actor and data fields with English labels; announcement bodies are never printed.
const base = process.env.QUORUM_URL || "http://127.0.0.1:4330"
const id = process.argv[2] || "luma-blasts"
const vars = { slug: process.argv[3] || "compiled-8lsr" }
const c = { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", magenta: "\x1b[35m", cyan: "\x1b[36m", bold: "\x1b[1m", off: "\x1b[0m" }
const tone: Record<string, string> = { "recipe.run": c.cyan, "recipe.broken": c.red, "recipe.repaired": c.green, recall: c.magenta, "memory.saved": c.magenta, error: c.yellow, "run.end": c.dim, "run.start": c.dim }
const short = (u: unknown) => String(u ?? "").replace(/^[A-Z]+ /, "").replace(/^https?:\/\//, "").replace(/\?.*$/, "")
const why = (d: any) => {
  const r = String(d.reason ?? "")
  if (r.includes("$[")) return "response shape changed (no id field)"
  if (d.status === 401) return "needs sign-in"
  if (d.status === 404) return "not found"
  return d.kind ?? "failed"
}
console.log(c.bold + "POST /api/recipes/" + id + "/run" + c.off)
const res = await fetch(base + "/api/recipes/" + id + "/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vars }) })
const { runId } = await res.json() as { runId: string }
console.log(c.dim + "run " + runId + c.off)
const sse = await fetch(base + "/api/runs/" + runId + "/events")
const reader = sse.body!.getReader()
let buf = ""
const dec = new TextDecoder()
for (;;) {
  const { value, done } = await reader.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  let i
  while ((i = buf.indexOf("\n\n")) >= 0) {
    const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
    if (/^event: done/m.test(chunk)) process.exit(0)
    const line = chunk.split("\n").find((l) => l.startsWith("data: "))
    if (!line) continue
    let e: any
    try { e = JSON.parse(line.slice(6)) } catch { continue }
    const d = e.data || {}
    let msg = ""
    if (e.type === "recipe.run" && d.phase === "discover") msg = "try via " + d.via + "  " + short(d.endpoint) + "  -> " + (d.status ?? "?") + (d.ok ? "  PASS" : "  rejected: " + why(d))
    else if (e.type === "recipe.broken") msg = "BROKEN  " + short(d.endpoint) + "  -> HTTP " + (d.status ?? "?")
    else if (e.type === "recipe.repaired") msg = "REPAIRED  " + short(d.previousEndpoint) + "  =>  " + short(d.endpoint) + "  (via " + d.via + ", " + d.count + " items)"
    else if (e.type === "recipe.run") msg = d.status ? short(d.endpoint) + "  -> HTTP " + d.status + (d.count !== undefined ? ", " + d.count + " item(s)" : "") : "call  " + short(d.endpoint)
    else if (e.type === "recall") msg = (d.hits?.length ?? 0) + " past repair(s) in memory"
    else if (e.type === "memory.saved") msg = (d.duplicate ? "already saved " : "saved ") + d.slug
    else if (e.type === "error") msg = String(d.reason ?? "").includes("후보") ? "no candidate passed verification: nothing saved, v" + d.version + " kept" : why(d)
    else if (e.type === "run.end") msg = String(d.status ?? "")
    const ver = d.version ? "v" + d.version : ""
    console.log((tone[e.type] || "") + e.type.padEnd(16) + c.off + String(e.actor).padEnd(20) + ver.padEnd(4) + msg)
  }
}
