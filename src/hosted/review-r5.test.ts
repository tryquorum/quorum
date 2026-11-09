// 보안 리뷰 5차 지적: 승인 전에 실제로 보낼 글을 보여 주고 그 글에 승인을 묶어요. 넘치는 보고는 자르지 않고 거절하고, 노트는 보낸 글을 자르지 않아요.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeGuestTenant } from "./guest"
import { openHosted } from "./hosted"
import { Store } from "../engine/store"
import { createWorkspace } from "../workspace/api"

const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex")
const withGuest = async (fn: (g: ReturnType<typeof makeGuestTenant>, call: (m: string, p: string, b?: unknown) => Promise<{ status: number; body: any }>) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), "quorum-r5-"))
  try {
    const g = makeGuestTenant({ email: "judge@example.com", key: "k", dir, hosted: openHosted(":memory:"), bots: "client" })
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await g.workspace!(new Request("http://x" + path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), path.split("?")[0].split("/").filter(Boolean), "judge@example.com")
      return { status: res.status, body: await res.json() }
    }
    await fn(g, call)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe("review round 5 fixes", () => {
  test("the exact text is shown before approval and approval is bound to it", () => withGuest(async (g, call) => {
    const s = (await call("POST", "/api/ws/signals", { kind: "approval", title: "Draft a reply", ref: "manual:1", meta: { runId: "r1", proposalId: "p1", executor: "aside", task: "draft the reply", request: "reply to Alex" } })).body
    const detail = (await call("GET", "/api/ws/signals/" + s.id)).body
    expect(detail.send.text).toContain("draft the reply")
    expect(detail.send.hash).toBe(sha(detail.send.text))
    expect((await call("POST", "/api/ws/signals/" + s.id + "/approve")).status).toBe(409)
    expect((await call("POST", "/api/ws/signals/" + s.id + "/approve", { sendHash: "0".repeat(64) })).status).toBe(409)
    const ok = await call("POST", "/api/ws/signals/" + s.id + "/approve", { sendHash: detail.send.hash })
    expect(ok.status).toBe(202)
    expect(g.tasks.get(ok.body.taskId)!.prompt).toBe(detail.send.text)
  }))

  test("a report longer than the limit is refused, not cut; the lease can report a shorter one", () => withGuest(async (g) => {
    const t = g.tasks.enqueue({ kind: "browser", ref: "x", title: "t", prompt: "p" })
    const l = g.tasks.lease({})!
    expect(g.tasks.report({ taskId: t.id, leaseId: l.leaseId, ok: true, text: "x".repeat(20_001) }).status).toBe(413)
    expect(g.tasks.get(t.id)!.status).toBe("leased")
    const out = await g.queue!.report({ taskId: t.id, leaseId: l.leaseId, ok: true, result: "y".repeat(20_001) }) as { error?: string }
    expect(out.error).toContain("20000")
  }))

  test("the note for a passed task keeps the whole sent text", () => {
    const store = new Store(":memory:")
    const ws = createWorkspace({ path: ":memory:", engine: store })
    const sent = "S".repeat(15_000) + " END-OF-RULES"
    store.createRun({ runId: "r1", request: "q", mode: "live", startedAt: new Date().toISOString(), kind: "council" })
    const at = new Date().toISOString()
    store.appendEvent({ runId: "r1", seq: 0, at, mode: "live", type: "proposal", actor: "bot:scout", text: "Read", data: { proposalId: "p1", title: "Read", executor: "aside", task: "read" } })
    store.appendEvent({ runId: "r1", seq: 1, at, mode: "live", type: "verdict", actor: "council", text: "pass · Read", data: { proposalId: "p1", decision: "pass", reason: "ok" } })
    store.appendEvent({ runId: "r1", seq: 2, at, mode: "live", type: "info", actor: "aside", text: "queued", data: { proposalId: "p1", queued: true, taskId: "t1", sent } })
    ws.sync()
    const id = (ws.db.query("SELECT id FROM signals WHERE ref='quorum:r1:p1'").get() as { id: string }).id
    const note = (ws.db.query("SELECT md FROM notes WHERE ref=?").get("signal:" + id) as { md: string }).md
    expect(note).toContain(sent)
  })
})
