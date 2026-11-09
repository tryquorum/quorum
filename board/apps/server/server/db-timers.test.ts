import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
process.env.ASIDE_ACCOUNT = "u_db_timers_test_no_account"
const { everyWhileOpen, laterWhileOpen } = await import("./db-timers.ts")
const { initRuns } = await import("./runs.ts")
const { initOps, startOpsScheduler } = await import("./ops.ts")
const { startDocsRefresh } = await import("./docs/index.ts")

// 서버의 주기 작업(1분 틱)은 그 DB 가 열려 있는 동안만 돌아요. 시험이 DB 를 닫은 뒤 남은 틱이 닫힌 DB 를 건드려
// 루트 한 프로세스 bun test 가 60초를 넘기면 그때 돌던 다른 시험이 실패하던 문제(PR #43 리뷰 5·6)를 막아요.
// 실제 60초를 기다리지 않고, 만든 타이머를 잡아 두었다가 닫은 뒤에 지워졌는지·그 틱을 돌려도 던지지 않는지 봐요.
type Caught = { fn: () => unknown; id: number; cleared: boolean }
function catchTimers<T>(run: () => T): { result: T; timers: Caught[]; restore: () => void } {
  const timers: Caught[] = []
  const realInterval = globalThis.setInterval, realTimeout = globalThis.setTimeout, realClearI = globalThis.clearInterval, realClearT = globalThis.clearTimeout
  let next = 1000
  const make = ((fn: () => unknown) => { const t: Caught = { fn, id: next++, cleared: false }; timers.push(t); return { unref() { return this }, ref() { return this }, [Symbol.toPrimitive]: () => t.id, id: t.id } }) as unknown as typeof setInterval
  const clear = ((h: { id?: number } | undefined) => { const t = timers.find((x) => x.id === h?.id); if (t) t.cleared = true }) as typeof clearInterval
  globalThis.setInterval = make
  globalThis.setTimeout = make as unknown as typeof setTimeout
  globalThis.clearInterval = clear
  globalThis.clearTimeout = clear as unknown as typeof clearTimeout
  const restore = () => { globalThis.setInterval = realInterval; globalThis.setTimeout = realTimeout; globalThis.clearInterval = realClearI; globalThis.clearTimeout = realClearT }
  try { return { result: run(), timers, restore } } catch (e) { restore(); throw e }
}
/** 닫힌 뒤 남은 틱을 돌려도 잡히지 않은 오류(던짐·거절)가 없어야 해요 */
async function tickAfterClose(timers: Caught[]) {
  for (const t of timers) await Promise.resolve(t.fn())
}
const signalsTable = "CREATE TABLE signals(id TEXT, owner TEXT, ref TEXT, task TEXT, lane TEXT, status TEXT, reason TEXT, title TEXT, body TEXT, agent TEXT, updated_at INTEGER, resolved_at INTEGER)"

test("AI 실행 정리(initRuns 1분 틱): DB 를 닫으면 타이머가 지워지고, 남은 틱을 돌려도 던지지 않아요", async () => {
  const db = new Database(":memory:")
  db.exec(signalsTable)
  const c = catchTimers(() => initRuns(db))
  try {
    expect(c.timers.length).toBeGreaterThan(0)
    expect(c.timers.every((t) => !t.cleared)).toBe(true)
    db.close()
    expect(c.timers.every((t) => t.cleared)).toBe(true)
    await tickAfterClose(c.timers)
  } finally { c.restore() }
})

test("운영 순회 예약(startOpsScheduler 15초·1분): DB 를 닫으면 둘 다 지워지고, 남은 틱이 거절되지 않아요", async () => {
  const db = new Database(":memory:")
  initOps(db)
  db.exec("CREATE TABLE runs(id TEXT, owner TEXT, kind TEXT, status TEXT); " + signalsTable)
  const deps = { ingest: () => ({}), personalBoard: () => null, readItem: () => null, putItem: () => {}, port: 1234, startRun: async () => ({ id: "run" }) }
  const c = catchTimers(() => startOpsScheduler(db, deps as never, "owner@example.com"))
  try {
    expect(c.timers.length).toBe(2)
    db.close()
    expect(c.timers.every((t) => t.cleared)).toBe(true)
    await tickAfterClose(c.timers)
  } finally { c.restore() }
})

test("문서 새로 고침(startDocsRefresh 1분 틱): DB 를 닫으면 지워져요", () => {
  const db = new Database(":memory:")
  const c = catchTimers(() => startDocsRefresh(db))
  try {
    expect(c.timers.length).toBe(1)
    db.close()
    expect(c.timers.every((t) => t.cleared)).toBe(true)
  } finally { c.restore() }
})

test("DB 가 열려 있는 동안은 주기 작업이 그대로 돌고(운영 동작), 닫은 뒤에는 멈춰요 — 실제 타이머", async () => {
  const db = new Database(":memory:")
  let n = 0
  everyWhileOpen(db, 5, () => { db.query("SELECT 1").get(); n++ }, "test")
  await Bun.sleep(40)
  expect(n).toBeGreaterThan(1)
  db.close()
  const at = n
  await Bun.sleep(40)
  expect(n).toBe(at)
})

test("틱 안의 오류는 잡아 기록하고 다음 틱이 그대로 돌아요(잡히지 않은 오류로 다른 시험·서버를 멈추지 않게)", async () => {
  const db = new Database(":memory:")
  let n = 0
  const errors: unknown[] = []
  const realError = console.error
  console.error = (...a: unknown[]) => { errors.push(a) }
  try {
    everyWhileOpen(db, 5, () => { n++; throw new Error("boom") }, "test")
    everyWhileOpen(db, 5, async () => { throw new Error("async boom") }, "test")
    await Bun.sleep(40)
  } finally { console.error = realError; db.close() }
  expect(n).toBeGreaterThan(1)
  expect(errors.length).toBeGreaterThan(1)
})

// PR #44 리뷰: close 의미를 바꾸지 않아요 — 호출 시점 this 로 원래 close 를 부르고, 실제로 닫힌 인스턴스의 타이머만, 원래 close 가 성공한 뒤에 지워요
test("두 인스턴스: a.close.call(b) 는 b 를 닫고 b 의 타이머만 지워요(a 는 열린 채 a 의 타이머 그대로)", () => {
  const a = new Database(":memory:")
  const b = new Database(":memory:")
  const c = catchTimers(() => { everyWhileOpen(a, 60e3, () => {}, "a"); everyWhileOpen(b, 60e3, () => {}, "b") })
  try {
    const [ta, tb] = c.timers
    a.close.call(b)
    expect(() => b.query("SELECT 1").get()).toThrow()
    expect(a.query("SELECT 1 AS x").get()).toEqual({ x: 1 })
    expect([ta!.cleared, tb!.cleared]).toEqual([false, true])
    a.close()
    expect(ta!.cleared).toBe(true)
  } finally { c.restore() }
})

test("원래 close 가 던지면 타이머는 그대로 두고 그 오류를 다시 던져요, 닫히면 그때 지워요", () => {
  const db = new Database(":memory:")
  let failNext = true
  const original = Database.prototype.close
  db.close = function (this: Database, ...args: Parameters<Database["close"]>) {
    if (failNext) throw new Error("busy")
    return original.apply(this, args)
  } as Database["close"]
  const c = catchTimers(() => everyWhileOpen(db, 60e3, () => {}, "fail"))
  try {
    expect(() => db.close()).toThrow("busy")
    expect(c.timers[0]!.cleared).toBe(false)
    expect(db.query("SELECT 1 AS x").get()).toEqual({ x: 1 })
    failNext = false
    db.close()
    expect(c.timers[0]!.cleared).toBe(true)
  } finally { c.restore() }
})

test("이미 닫힌 DB 에는 타이머를 만들지 않아요(every·later)", () => {
  const db = new Database(":memory:")
  db.close()
  const c = catchTimers(() => { everyWhileOpen(db, 60e3, () => {}, "closed"); laterWhileOpen(db, 15e3, () => {}, "closed") })
  try {
    expect(c.timers.length).toBe(0)
  } finally { c.restore() }
})
