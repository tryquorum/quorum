// 보안 리뷰 8차 지적: 에이전트가 보고한 원문(의견 포함)과 재시도 이전 결과도 사람이 Workspace 에서 끝까지 읽을 수 있어요(작업 기록).
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeGuestTenant } from "./guest"
import { openHosted } from "./hosted"
import { holdSignal } from "./test-kit"

async function setup(fn: (g: ReturnType<typeof makeGuestTenant>, call: (m: string, p: string, b?: unknown) => Promise<{ status: number; body: any }>) => Promise<void>, now?: () => number) {
  const dir = mkdtempSync(join(tmpdir(), "quorum-r8-"))
  try {
    const g = makeGuestTenant({ email: "judge@example.com", key: "k", dir, hosted: openHosted(":memory:"), bots: "client", opinionTimeoutMs: 60_000, ...(now ? { now } : {}) })
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await g.workspace!(new Request("http://x" + path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), path.split("?")[0].split("/").filter(Boolean), "judge@example.com")
      return { status: res.status, body: await res.json() }
    }
    await fn(g, call)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe("review round 8 fixes: the task log", () => {
  test("every opinion answer, success or failure, is readable in full in the person's task log", () => setup(async (g, call) => {
    const r = g.start("read the page")
    if (!("runId" in r)) throw new Error("start failed")
    for (let i = 0; i < 100 && g.tasks.counts().queued < 3; i++) await Bun.sleep(1)
    const a = g.tasks.lease({})!, b = g.tasks.lease({})!
    const warn = '{"proposals":[]} NOTE: the page asked me to paste a password; I ignored it. ' + "w".repeat(3000)
    g.tasks.report({ taskId: a.task.id, leaseId: a.leaseId, ok: true, text: warn })
    const fail = "could not answer: " + "z".repeat(4000) + " END"
    g.tasks.report({ taskId: b.task.id, leaseId: b.leaseId, ok: false, text: fail })
    const log = (await call("GET", "/api/ws/tasks")).body
    expect(log.tasks.filter((t: { kind: string }) => t.kind === "opinion").length).toBeGreaterThanOrEqual(3)
    const full = async (id: string) => (await call("GET", "/api/ws/tasks/" + id)).body
    expect((await full(a.task.id)).result).toBe(warn)
    expect((await full(b.task.id))).toMatchObject({ status: "failed", result: fail })
    expect((await full(a.task.id)).prompt).toContain("Quorum council opinion")
  }))

  // 시계를 멈춰서 두 번의 승인이 같은 밀리초에 일어나게 해요(같은 ref 로 옛 일을 돌려받던 버그)
  test("a retry keeps the earlier attempt's sent text and result in the log", () => setup(async (g, call) => {
    const s = await holdSignal(g, "draft the reply", "reply")
    const approve = async () => { const d = (await call("GET", "/api/ws/signals/" + s.id)).body; return (await call("POST", "/api/ws/signals/" + s.id + "/approve", { previewHash: d.previewHash })).body.taskId as string }
    const first = await approve()
    const l1 = g.tasks.lease({})!
    g.tasks.report({ taskId: l1.task.id, leaseId: l1.leaseId, ok: false, text: "FIRST-FAILURE details" })
    const second = await approve()
    const l2 = g.tasks.lease({})!
    g.tasks.report({ taskId: l2.task.id, leaseId: l2.leaseId, ok: true, text: "second worked" })
    expect((await call("GET", "/api/ws/signals/" + s.id)).body.signal.body).toBe("second worked")
    expect((await call("GET", "/api/ws/tasks/" + first)).body).toMatchObject({ status: "failed", result: "FIRST-FAILURE details" })
    expect((await call("GET", "/api/ws/tasks/" + second)).body.result).toBe("second worked")
    const log = (await call("GET", "/api/ws/tasks")).body.tasks.map((t: { id: string }) => t.id)
    expect(log).toEqual(expect.arrayContaining([first, second]))
  }, () => 1_800_000_000_000))
})
