// 보안 리뷰 6차 지적: 결과는 노트가 가득 차도 사건에서 전부 보이고, 닫은(Dismiss·처리함) 대기열 일은 아직 안 가져갔으면 실행되지 않아요.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeGuestTenant } from "./guest"
import { openHosted } from "./hosted"
import { holdSignal } from "./test-kit"

async function setup(fn: (g: ReturnType<typeof makeGuestTenant>, call: (m: string, p: string, b?: unknown) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "quorum-r6-"))
  try {
    const g = makeGuestTenant({ email: "judge@example.com", key: "k", dir, hosted: openHosted(":memory:"), bots: "client" })
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await g.workspace!(new Request("http://x" + path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), path.split("?")[0].split("/").filter(Boolean), "judge@example.com")
      return { status: res.status, body: await res.json() }
    }
    await fn(g, call)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
async function approved(g: ReturnType<typeof makeGuestTenant>, call: (m: string, p: string, b?: unknown) => Promise<{ status: number; body: any }>) {
  const s = await holdSignal(g, "draft the reply", "reply")
  const d = (await call("GET", "/api/ws/signals/" + s.id)).body
  const ap = await call("POST", "/api/ws/signals/" + s.id + "/approve", { previewHash: d.previewHash })
  expect(ap.status).toBe(202)
  return { id: s.id, taskId: ap.body.taskId as string }
}

describe("review round 6 fixes", () => {
  test("a full note does not hide the result: the signal body carries all of it", () => setup(async (g, call) => {
    const { id } = await approved(g, call)
    // 노트를 거의 가득 채워요(사람이 긴 글을 써 둔 경우)
    await call("PUT", "/api/ws/notes?ref=signal:" + id, { md: "n".repeat(49_000) })
    const l = g.tasks.lease({})!
    const long = "r".repeat(15_000) + " TAIL https://example.com/tail"
    expect(g.tasks.report({ taskId: l.task.id, leaseId: l.leaseId, ok: true, text: long }).status).toBe(200)
    const s = (await call("GET", "/api/ws/signals/" + id)).body.signal
    expect(s.lane).toBe("review")
    expect(s.body).toBe(long)
  }))

  test("review 7: a failure report is also fully visible on the signal when the note is full", () => setup(async (g, call) => {
    const { id } = await approved(g, call)
    await call("PUT", "/api/ws/notes?ref=signal:" + id, { md: "n".repeat(49_000) })
    const l = g.tasks.lease({})!
    const long = "f".repeat(5_000) + " WHY-IT-FAILED https://example.com/why"
    expect(g.tasks.report({ taskId: l.task.id, leaseId: l.leaseId, ok: false, text: long }).status).toBe(200)
    const s = (await call("GET", "/api/ws/signals/" + id)).body.signal
    expect(s.lane).toBe("decide")
    expect(s.body).toBe(long)
  }))

  test("dismissing work your Aside has not picked up cancels it", () => setup(async (g, call) => {
    const { id, taskId } = await approved(g, call)
    expect((await call("POST", "/api/ws/signals/" + id + "/reject", { why: "changed my mind" })).status).toBe(200)
    expect(g.tasks.get(taskId)!.status).toBe("cancelled")
    expect(g.tasks.lease({})).toBeNull()
    expect((await call("GET", "/api/ws/signals/" + id)).body.note.md).toContain("will not run")
  }))

  test("dismissing work your Aside already took says so, and its result still comes back to Review", () => setup(async (g, call) => {
    const { id, taskId } = await approved(g, call)
    const l = g.tasks.lease({})!
    expect((await call("POST", "/api/ws/signals/" + id + "/reject", {})).status).toBe(200)
    expect(g.tasks.get(taskId)!.status).toBe("leased")
    expect((await call("GET", "/api/ws/signals/" + id)).body.note.md).toContain("already took this task")
    g.tasks.report({ taskId: l.task.id, leaseId: l.leaseId, ok: true, text: "done" })
    expect((await call("GET", "/api/ws/signals/" + id)).body.signal.lane).toBe("review")
  }))

  test("outside signals cannot set taskId, and a padded quorum: ref is still reserved", () => setup(async (_g, call) => {
    const s = await call("POST", "/api/ws/signals", { kind: "info", title: "x", ref: "mine:1", meta: { taskId: "t1", note: "ok" } })
    expect(s.body.meta.taskId).toBeUndefined()
    expect((await call("POST", "/api/ws/signals", { kind: "info", title: "x", ref: "  quorum:r1:p1" })).status).toBe(400)
  }))
})
