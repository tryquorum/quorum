// 사람별 작업 대기열 시험(결정적 시계, 메모리 DB).
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createQueue } from "./queue"

function q(clock = { t: 1000 }) {
  const db = new Database(":memory:")
  const reports: { id: string; ok: boolean }[] = []
  const queue = createQueue(db, { now: () => clock.t, leaseMs: 1000, maxLeases: 3 })
  queue.onReport((task, ok) => { reports.push({ id: task.id, ok }) })
  return { db, queue, clock, reports }
}
const browser = (ref: string) => ({ kind: "browser" as const, ref, title: "read page", prompt: "read it", executor: "aside", runId: "r1", proposalId: "p1", request: "req" })

describe("task queue", () => {
  test("enqueue is idempotent by ref", () => {
    const { queue } = q()
    const a = queue.enqueue(browser("quorum:r1:p1"))
    const b = queue.enqueue(browser("quorum:r1:p1"))
    expect(b.id).toBe(a.id)
    expect(queue.counts().queued).toBe(1)
  })

  test("opinions are leased first; a leased task is not handed out again until its lease runs out", async () => {
    const { queue, clock } = q()
    queue.enqueue(browser("b1"))
    const op = queue.enqueue({ kind: "opinion", ref: "opinion:r1:bot:ceo", title: "ceo", prompt: "{}", actor: "bot:ceo", runId: "r1" })
    const waiting = queue.waitFor(op.id, 60_000)
    const first = queue.lease({})!
    expect(first.task.kind).toBe("opinion")
    const second = queue.lease({})!
    expect(second.task.kind).toBe("browser")
    expect(queue.lease({})).toBeNull()
    clock.t += 1001
    const again = queue.lease({})!
    expect(again.task.id).toBe(first.task.id)
    expect(again.leaseId).not.toBe(first.leaseId)
    // 옛 리스로 보고하면 거절, 새 리스로 보고하면 기록
    expect(queue.report({ taskId: first.task.id, leaseId: first.leaseId, ok: true, text: "{}" }).status).toBe(409)
    expect(queue.report({ taskId: again.task.id, leaseId: again.leaseId, ok: true, text: '{"critiques":[]}' }).status).toBe(200)
    expect(await waiting).toBe('{"critiques":[]}')
  })

  test("kinds filter: a browser agent can skip code tasks", () => {
    const { queue } = q()
    queue.enqueue({ ...browser("c1"), kind: "code", executor: "codex" })
    expect(queue.lease({ kinds: ["opinion", "browser"] })).toBeNull()
    expect(queue.lease({ kinds: ["code"] })!.task.kind).toBe("code")
  })

  test("report is idempotent: the same lease reporting twice records once", () => {
    const { queue, reports } = q()
    queue.enqueue(browser("b1"))
    const l = queue.lease({})!
    const a = queue.report({ taskId: l.task.id, leaseId: l.leaseId, ok: true, text: "done https://x" })
    const b = queue.report({ taskId: l.task.id, leaseId: l.leaseId, ok: true, text: "done https://x" })
    expect(a).toMatchObject({ status: 200, recorded: "new" })
    expect(b).toMatchObject({ status: 200, recorded: "duplicate" })
    expect(reports).toEqual([{ id: l.task.id, ok: true }])
    expect(queue.report({ taskId: l.task.id, leaseId: "other", ok: false, text: "x" }).status).toBe(409)
    expect(queue.report({ taskId: "nope", leaseId: l.leaseId, ok: true, text: "x" }).status).toBe(404)
  })

  test("an opinion leased too many times without a report fails instead of looping", async () => {
    const { queue, clock } = q()
    const op = queue.enqueue({ kind: "opinion", ref: "opinion:r9:bot:qa", title: "qa", prompt: "{}", actor: "bot:qa", runId: "r9" })
    const waiting = queue.waitFor(op.id, 60_000)
    for (let i = 0; i < 3; i++) { expect(queue.lease({})).not.toBeNull(); clock.t += 1001 }
    expect(queue.lease({})).toBeNull()
    expect(queue.counts().failed).toBe(1)
    await expect(waiting).rejects.toThrow("without a report")
  })

  test("an opinion nobody answers in time is expired and the council sees an error", async () => {
    const { queue } = q()
    const op = queue.enqueue({ kind: "opinion", ref: "opinion:r2:bot:qa", title: "qa", prompt: "{}", actor: "bot:qa", runId: "r2" })
    await expect(queue.waitFor(op.id, 5)).rejects.toThrow("did not answer")
    expect(queue.get(op.id)!.status).toBe("expired")
    expect(queue.lease({})).toBeNull()
  })

  test("opinions left from before a restart are expired and never leased", () => {
    const { db, clock } = q()
    const first = createQueue(db, { now: () => clock.t })
    first.enqueue({ kind: "opinion", ref: "opinion:r3:bot:qa", title: "qa", prompt: "{}", actor: "bot:qa", runId: "r3" })
    first.enqueue(browser("b-keep"))
    const restarted = createQueue(db, { now: () => clock.t })
    expect(restarted.lease({})!.task.ref).toBe("b-keep")
    expect(restarted.lease({})).toBeNull()
  })

  test("a failed report rejects the waiting opinion; results over the limit are refused, not cut", async () => {
    const { queue } = q()
    const op = queue.enqueue({ kind: "opinion", ref: "opinion:r4:bot:cso", title: "cso", prompt: "{}", actor: "bot:cso", runId: "r4" })
    const waiting = queue.waitFor(op.id, 60_000)
    const l = queue.lease({})!
    expect(queue.report({ taskId: l.task.id, leaseId: l.leaseId, ok: false, text: "x".repeat(30_000) }).status).toBe(413)
    queue.report({ taskId: l.task.id, leaseId: l.leaseId, ok: false, text: "could not answer" })
    await expect(waiting).rejects.toThrow()
    expect(queue.get(op.id)!.result).toBe("could not answer")
  })

  test("waitForWork wakes up when a task arrives", async () => {
    const { queue } = q()
    const woke = queue.waitForWork(1000)
    queue.enqueue(browser("late"))
    expect(await woke).toBe(true)
    expect(await queue.waitForWork(5)).toBe(false)
  })
})
