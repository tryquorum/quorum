import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import type { OpsResponse } from "@direction-board/contracts/api"
import { initOps, nextSweepAt, opsApi } from "./ops.ts"

const OWNER = "owner@example.com"
const H = 3600e3
/** 한국 시간 2026-11-07 hh:mm 의 UTC ms */
const kst = (hh: number, mm = 0, day = 7) => Date.UTC(2026, 10, day, hh - 9, mm)

function setup() {
  const db = new Database(":memory:")
  initOps(db)
  db.exec("CREATE TABLE runs(id TEXT, owner TEXT, kind TEXT, status TEXT, prompt TEXT, output TEXT, model_name TEXT, effort TEXT, session_id TEXT, error TEXT, created_at INTEGER, finished_at INTEGER); CREATE TABLE signals(owner TEXT, status TEXT, ref TEXT, title TEXT, lane TEXT, updated_at INTEGER)")
  const prompts: string[] = []
  const ingested: Record<string, unknown>[] = []
  let n = 0
  const deps = {
    ingest: (_owner: string, raw: Record<string, unknown>) => { ingested.push(raw); return { id: "sig" + ingested.length, title: raw.title, lane: "decide" } },
    personalBoard: () => null, readItem: () => null, putItem: () => {}, port: 1234,
    startRun: async (owner: string, opts: { prompt: string }) => {
      prompts.push(opts.prompt)
      const id = "run" + ++n
      db.query("INSERT INTO runs VALUES (?,?,'sweep','done',?, 'out', 'm', 'medium', null, null, ?, ?)").run(id, owner, opts.prompt, n, n)
      return { id }
    },
  }
  const call = async (method: string, path: string, body?: unknown, loopback = true) => {
    const url = new URL("http://127.0.0.1:1234" + path)
    const req = new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } })
    const res = await opsApi(db, req, url, { email: OWNER, agent: false }, url.pathname.split("/").filter(Boolean), loopback, deps, true)
    if (!res) throw new Error("opsApi 가 응답하지 않았어요")
    return { status: res.status, body: await res.json() }
  }
  const token = (prompt: string) => prompt.match(/report\?sweep=([\w-]+)/)?.[1] ?? ""
  return { db, deps, prompts, ingested, call, token }
}
const report = (title: string) => ({ summary: `${title} 요약\n둘째 줄`, checked: [], signals: [{ key: title, kind: "approval", title }] })

test("늦게 온 보고는 토큰으로 제 순회에 붙고, 다음 순회에는 붙지 않는다", async () => {
  const t = setup()
  await t.call("POST", "/api/ops/run")
  await t.call("POST", "/api/ops/run")
  const [a, b] = t.prompts.map(t.token)
  expect(a).not.toBe(b)
  const late = await t.call("POST", `/api/ops/report?sweep=${a}`, report("첫 순회"))
  expect(late.status).toBe(200)
  const got = (await t.call("GET", "/api/ops")).body as OpsResponse
  const byId = Object.fromEntries(got.runs.map((r) => [r.id, r.report]))
  expect(byId.run1?.summary).toBe("첫 순회 요약\n둘째 줄")
  expect(byId.run1?.counts.signals).toBe(1)
  expect(byId.run1?.items).toEqual([{ ref: "signal:sig1", title: "첫 순회", kind: "signal", lane: "decide" }])
  expect(byId.run2).toBeNull()
  expect(t.ingested.find((s) => String(s.ref).startsWith("ops:sweep:"))?.ref).toBe("ops:sweep:run1")
})

test("토큰 없는 보고는 어느 순회에도 붙지 않고, 모르는 토큰은 거절, 루프백 밖은 403", async () => {
  const t = setup()
  await t.call("POST", "/api/ops/run")
  expect((await t.call("POST", "/api/ops/report", report("손으로"))).status).toBe(200)
  expect(String(t.ingested.at(-1)?.ref)).toMatch(/^ops:sweep:report-\d+$/)
  expect(((await t.call("GET", "/api/ops")).body as OpsResponse).runs[0].report).toBeNull()
  expect((await t.call("POST", "/api/ops/report?sweep=nope", report("x"))).status).toBe(400)
  expect((await t.call("POST", `/api/ops/report?sweep=${t.token(t.prompts[0])}`, report("x"), false)).status).toBe(403)
})

test("같은 토큰으로 다시 보내면 마지막 보고가 남는다", async () => {
  const t = setup()
  await t.call("POST", "/api/ops/run")
  const tk = t.token(t.prompts[0])
  await t.call("POST", `/api/ops/report?sweep=${tk}`, report("하나"))
  await t.call("POST", `/api/ops/report?sweep=${tk}`, report("둘"))
  expect(((await t.call("GET", "/api/ops")).body as OpsResponse).runs[0].report?.summary).toStartWith("둘 요약")
})

test("lite 는 최근 3개만, 프롬프트·출력·초안 없이", async () => {
  const t = setup()
  for (let i = 0; i < 4; i++) await t.call("POST", "/api/ops/run")
  const lite = (await t.call("GET", "/api/ops?lite=1")).body as OpsResponse
  expect(lite.runs.length).toBe(3)
  expect(lite.runs.every((r) => r.prompt === undefined && r.output === undefined)).toBe(true)
  expect(lite.default_text).toBeUndefined()
  const full = (await t.call("GET", "/api/ops")).body as OpsResponse
  expect(full.runs.length).toBe(4)
  expect(typeof full.default_text).toBe("string")
})

test("base_rev 가 다르면 409 로 덮지 않고, base_rev 없는 옛 클라이언트는 그대로 쓴다", async () => {
  const t = setup()
  const rev0 = ((await t.call("GET", "/api/ops")).body as OpsResponse).ops.rev
  const first = await t.call("PUT", "/api/ops", { text: "탭 A", base_rev: rev0 })
  expect(first.status).toBe(200)
  expect(first.body.ops.rev).toBe(rev0 + 1)
  // 같은 밀리초라도 rev 로 구별된다: 탭 B 는 rev0 을 들고 있다
  const stale = await t.call("PUT", "/api/ops", { text: "탭 B", base_rev: rev0 })
  expect(stale.status).toBe(409)
  expect(stale.body.ops.text).toBe("탭 A")
  const old = await t.call("PUT", "/api/ops", { enabled: false })
  expect(old.status).toBe(200)
  expect(old.body.ops.text).toBe("탭 A")
  // rev 는 지시문의 판이라 설정만 바꾸면 그대로
  expect(old.body.ops.rev).toBe(rev0 + 1)
})

test("nextSweepAt 은 활동 시간을 따른다", () => {
  const day = { enabled: 1, every_min: 120, active_from: 8, active_to: 24 }
  expect(nextSweepAt({ ...day, last_run_at: kst(10) }, kst(11))).toBe(kst(12))
  // 밤 23:30 에 끝난 순회의 다음은 01:30 이 아니라 다음 날 08:00
  expect(nextSweepAt({ ...day, last_run_at: kst(23, 30) }, kst(23, 40))).toBe(kst(8, 0, 8))
  // 자정을 넘는 창(22~6): 06:00 이후면 그날 22:00
  expect(nextSweepAt({ enabled: 1, every_min: 60, active_from: 22, active_to: 6, last_run_at: kst(5, 30) }, kst(7))).toBe(kst(22))
  expect(nextSweepAt({ enabled: 1, every_min: 60, active_from: 22, active_to: 6, last_run_at: kst(23) }, kst(23, 10))).toBe(kst(0, 0, 8))
  expect(nextSweepAt({ ...day, active_from: 0, active_to: 24, last_run_at: null }, kst(3))).toBe(kst(3))
  expect(nextSweepAt({ ...day, enabled: 0, last_run_at: null }, kst(9))).toBeNull()
  expect(nextSweepAt({ ...day, active_from: 9, active_to: 9, last_run_at: null }, kst(9))).toBeNull()
  expect(H).toBe(3600e3)
})


test("보고 자리를 만들지 못해 순회가 실패해도 다음 순회를 막지 않는다", async () => {
  const t = setup()
  t.db.exec("ALTER TABLE ops_reports RENAME TO ops_reports_off")
  const failed = await t.call("POST", "/api/ops/run")
  expect(failed.status).toBe(409)
  t.db.exec("ALTER TABLE ops_reports_off RENAME TO ops_reports")
  const next = await t.call("POST", "/api/ops/run")
  expect(next.status).toBe(201)
  expect(t.prompts.length).toBe(1)
})

test("겹친 쓰기: 설정만 바꾸는 PUT 이 같은 때 저장한 지시문을 되돌리지 않는다", async () => {
  const t = setup()
  const rev0 = ((await t.call("GET", "/api/ops")).body as OpsResponse).ops.rev
  // 두 요청을 동시에: 하나는 base_rev 없는 설정 변경, 하나는 지시문 저장
  const [b, a] = await Promise.all([t.call("PUT", "/api/ops", { text: "새 지시문", base_rev: rev0 }), t.call("PUT", "/api/ops", { enabled: false })])
  expect([a.status, b.status]).toEqual([200, 200])
  const now = ((await t.call("GET", "/api/ops")).body as OpsResponse).ops
  expect(now.enabled).toBe(false)
  expect(now.text).toBe("새 지시문")
})
