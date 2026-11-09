// Seeds the demo workspace for the final film on the isolated demo server (video/final/demo-env.sh, port 4331).
// Everything here is fictional demo data: no real people, addresses or accounts. Usage: bun video/final/seed.ts
const BASE = process.env.QVF_BASE || "http://127.0.0.1:4331"
export const DEMO_REQUEST = "Shortlist YC's Requests for Startups (ycombinator.com/rfs) that fit Quorum, and draft a reply to Northwind's pricing email — don't send it"
const today = new Date().toISOString().slice(0, 10)
const items = [
  { text: DEMO_REQUEST, clientKey: "qvf-demo-1", due: today },
  { text: "Book the Friday demo room", clientKey: "qvf-demo-2", due: today },
  { text: "Record the 90-second demo video", clientKey: "qvf-demo-3", due: today },
  { text: "Answer Northwind about pilot pricing", clientKey: "qvf-demo-4" },
  { text: "Clean up the README screenshots", clientKey: "qvf-demo-5" },
]
const signals = [
  { kind: "question", source: "gmail", title: "Northwind · Re: pilot pricing — can we start Monday?", body: "Hi! We'd like to start a two-week pilot on Monday. What does pricing look like for 10 seats? — Dana, Northwind (example)" },
]
async function post(path: string, body: unknown) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const t = await r.text()
  if (!r.ok) throw new Error(path + " " + r.status + " " + t.slice(0, 200))
  return JSON.parse(t)
}
if (import.meta.main) {
  const out: unknown[] = []
  for (const it of items) out.push(await post("/api/ws/items", it))
  for (const s of signals) out.push(await post("/api/ws/signals", s))
  console.log(JSON.stringify(out.map((o: any) => ({ id: o.item?.id ?? o.id ?? o.signal?.id, text: o.item?.text ?? o.title ?? o.signal?.title, existed: o.existed })), null, 1))
}
