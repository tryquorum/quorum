// 보안 리뷰 3차 지적: 사람이 먼저 닫은 사건에도 에이전트 결과가 보이는 곳(Review·Needs you)에 와야 해요.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeGuestTenant } from "./guest"
import { openHosted } from "./hosted"

const fakeModel = (async (_u: string, init: RequestInit) => {
  const prompt = JSON.parse(String(init.body)).messages[1].content as string
  const content = prompt.includes("정찰병") ? JSON.stringify({ proposals: [{ title: "Read the page", executor: "aside", why: "w", task: "read", risk: [] }] })
    : prompt.includes("제안 봇") ? JSON.stringify({ proposals: [] }) : JSON.stringify({ critiques: [{ proposalId: "p1", stance: "keep", reason: "ok" }] })
  return Response.json({ choices: [{ message: { content } }] })
}) as unknown as typeof fetch

async function passedTask(clock: { t: number }) {
  const dir = mkdtempSync(join(tmpdir(), "quorum-r3-"))
  const g = makeGuestTenant({ email: "judge@example.com", key: "k", dir, hosted: openHosted(":memory:"), bots: "api", model: { url: "https://m/v1", key: "k", model: "m", fetch: fakeModel }, now: () => clock.t, leaseMs: 1000 })
  const r = g.start("read the page")
  if (!("runId" in r)) throw new Error("start failed")
  for (let i = 0; i < 300 && g.store.getRun(r.runId)?.status !== "done"; i++) await Bun.sleep(1)
  const call = async (method: string, path: string) => (await g.workspace!(new Request("http://x" + path, { method }), path.split("?")[0].split("/").filter(Boolean), "judge@example.com")).json() as Promise<any>
  const running = (await call("GET", "/api/ws/now")).running[0]
  expect(running.title).toBe("Read the page")
  // Aside 가 일을 가져간 뒤, 끝내기 전에 사람이 "Mark handled" 로 닫아요(가져가기 전에 닫으면 취소돼요: review-r6)
  const lease = g.tasks.lease({})!
  expect((await call("POST", "/api/ws/signals/" + running.id + "/resolve")).signal.status).toBe("resolved")
  return { g, call, id: running.id, lease, done: () => rmSync(dir, { recursive: true, force: true }) }
}

describe("review round 3 fix", () => {
  test("a result for a signal the person already closed reopens it in Review", async () => {
    const clock = { t: Date.now() }
    const s = await passedTask(clock)
    try {
      const l = s.lease
      expect(s.g.tasks.report({ taskId: l.task.id, leaseId: l.leaseId, ok: true, text: "done https://x" }).status).toBe(200)
      const now = await s.call("GET", "/api/ws/now")
      expect(now.review.map((x: { id: string; body: string }) => [x.id, x.body])).toEqual([[s.id, "done https://x"]])
    } finally { s.done() }
  })
  test("an expired task for a closed signal shows up under Needs you", async () => {
    const clock = { t: Date.now() }
    const s = await passedTask(clock)
    try {
      clock.t += 31 * 60_000
      s.g.tasks.sweep()
      const now = await s.call("GET", "/api/ws/now")
      expect(now.needsYou.map((x: { id: string }) => x.id)).toEqual([s.id])
    } finally { s.done() }
  })
})
