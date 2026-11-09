import { describe, expect, test } from "bun:test"
import type { Call, CreateResult, Draft } from "./quick-add.ts"
import { aiAllowed, checkWith, closeGuard, migrateEdits, migrateSlots, slotFor, submitWithRecord, targetProblem, type Pending } from "./quick-recovery.ts"

// PR #39 리뷰 16: 웹·iOS 가 같이 쓰는 빠른 추가 흐름. 먼저 기록, 결과 불명 확인은 읽기만(쓰기 0건), done 만 끝, 닫기·✦ 는 기록을 지우지 않음.
const S = "https://board.test|a@x.test"
const draft: Draft = { boardId: "b", kind: "todo", title: "회의 준비", at: null, areaId: null, tags: [], note: "아직 안 보낸 노트", props: [] }
const rec = (p: Partial<Pending> = {}): Pending => ({ id: "q1", from: "item", draft, text: "회의 준비", ref: null, scope: S, ...p })
function io(read: (path: string) => unknown) {
  const calls: string[] = []
  const call = (async (path: string, init: { method: string }) => {
    calls.push(init.method + " " + path)
    if (init.method !== "GET") throw new Error("쓰면 안 돼요: " + path)
    const v = read(path)
    if (v instanceof Error) throw v
    return v
  }) as Call
  return { calls, call }
}
const base = (over: Partial<Parameters<typeof submitWithRecord>[0]> = {}) => {
  const created: string[] = []
  const ahead: Pending[] = []
  const a: Parameters<typeof submitWithRecord>[0] = {
    text: "회의 준비",
    makeDraft: () => draft,
    pending: null,
    writeAhead: async (p) => { ahead.push(p); return true },
    scope: S,
    same: () => true,
    check: async () => ({ state: "unknown" }),
    create: async (_d, id) => { created.push(id); return { kind: "done", ref: "item:b:" + id, id, item: null, scope: S } },
    id: () => "n1",
    ...over,
  }
  return { a, created, ahead }
}

describe("공용 빠른 추가 흐름(submitWithRecord)", () => {
  test("먼저 기록: 기록을 못 남기면 보내지 않아요", async () => {
    const t = base({ writeAhead: async () => false })
    expect((await submitWithRecord(t.a)).kind).toBe("not-sent")
    expect(t.created).toEqual([])
  })
  test("보내기 전에 결과 불명 기록(시작 범위·id·초안·단계)을 남기고, done 이면 끝", async () => {
    const t = base()
    const r = await submitWithRecord(t.a)
    expect(t.ahead).toEqual([{ id: "n1", from: "item", draft, text: "회의 준비", ref: null, unknown: true, scope: S }])
    expect(r.kind).toBe("done")
  })
  test("done 이 아닌 결과는 모두 기록(초안·id 유지)", async () => {
    const kinds: Exclude<CreateResult["kind"], "done">[] = ["differs", "conflict", "failed", "unknown", "scope"]
    for (const kind of kinds) {
      const r0 = kind === "differs" ? { kind, ref: "item:b:n1", id: "n1", at: "item" as const, left: "note" as const } : kind === "conflict" ? { kind, ref: "item:b:n1", id: "n1", at: "note" as const } : { kind, ref: null, id: "n1", at: "item" as const }
      const t = base({ create: async () => ({ ...r0, scope: S }) as CreateResult & { scope: string } })
      const r = await submitWithRecord(t.a)
      expect(r.kind).toBe("pending")
      if (r.kind === "pending") expect([r.pending.id, r.pending.draft.note]).toEqual(["n1", "아직 안 보낸 노트"])
    }
  })
  test("결과 불명 기록의 확인은 읽기만(GET) — 쓰기 0건, 보내기(create)도 0건", async () => {
    const { calls, call } = io((p) => (p.startsWith("/api/work/") ? { self: { title: "회의 준비", type: "todo", when: null }, note: null } : {}))
    const t = base({ pending: rec({ unknown: true }), check: checkWith(call) })
    const r = await submitWithRecord(t.a)
    expect(t.created).toEqual([])
    expect(calls.every((c) => c.startsWith("GET "))).toBe(true)
    expect(r.kind).toBe("pending") // 항목은 있고 노트가 남음 → 이어 하기는 사람이
    if (r.kind === "pending") expect([r.pending.from, r.pending.unknown]).toEqual(["note", undefined])
  })
  test("못 읽으면 기록 그대로(지우지 않음)", async () => {
    const p = rec({ unknown: true, from: "note", ref: "item:b:q1" })
    const t = base({ pending: p, check: async () => { throw new Error("net") } })
    const r = await submitWithRecord(t.a)
    expect(r).toMatchObject({ kind: "pending", pending: p })
  })
  test("다른 범위에서 시작한 기록은 보내지도 읽지도 않아요", async () => {
    const t = base({ pending: rec({ unknown: true, scope: "https://board.test|b@x.test" }) })
    expect((await submitWithRecord(t.a)).kind).toBe("other-scope")
    expect(t.created).toEqual([])
  })
})

describe("닫기·✦ 는 기록을 지우지 않아요(리뷰 16)", () => {
  test("확실한 거절 기록에도 닫기 확인", () => {
    expect(closeGuard(rec())).not.toBeNull()
    expect(closeGuard(rec({ unknown: true }))).not.toBeNull()
    expect(closeGuard(null)).toBeNull()
  })
  test("기록이 있는 동안 ✦ 막힘", () => {
    expect(aiAllowed(rec())).toBe(false)
    expect(aiAllowed(null)).toBe(true)
  })
})

describe("대상별 자리(리뷰 18)", () => {
  test("판·목표·공간이 다르면 자리도 달라요(개인 목표 초안이 회사 판 시트에 보이지 않게)", () => {
    const goalSheet = slotFor("sheet", { boardId: "pb", goalId: "g1", space: "personal" })
    const companySheet = slotFor("sheet", { boardId: "cb", space: "ws_1" })
    expect(goalSheet).not.toBe(companySheet)
    expect(slotFor("bar", { boardId: "pb", space: "personal" })).toBe("bar:pb:-:personal")
  })
  test("대상(판·목표)을 지금 범위에서 찾을 수 없으면 안내 — 제출을 막아요", () => {
    const boards = [{ id: "pb" }]
    const items = [{ boardId: "pb", id: "g1", type: "goal" }]
    expect(targetProblem({ boardId: "pb", goalId: "g1" }, boards, items)).toBeNull()
    expect(targetProblem({ boardId: "cb" }, boards, items)).toContain("판을 지금 계정에서 찾을 수 없어요")
    expect(targetProblem({ boardId: "pb", goalId: "gone" }, boards, items)).toContain("목표를 지금 찾을 수 없어요")
    expect(targetProblem({ boardId: "pb" }, null, null)).toBeNull()
  })
})

describe("(리뷰 19) 대상 확인·옛 자리 이름", () => {
  test("판 목록이 빈 배열이어도(받았는데 없음) 그 판이 없다고 막아요 — 아직 못 받았으면(null) 판정하지 않아요", () => {
    expect(targetProblem({ boardId: "pb" }, [], null)).toContain("판을 지금 계정에서 찾을 수 없어요")
    expect(targetProblem({ boardId: "pb" }, null, null)).toBeNull()
  })
  test("옛 자리 이름(bar·sheet·goal:<id>)의 기록은 초안의 대상으로 새 자리에, 새 자리에 이미 있으면 덮지 않고 그대로", () => {
    const d = (over: Partial<Pending["draft"]> = {}) => ({ ...rec().draft, ...over })
    const bar = rec({ draft: d({ boardId: "pb", space: "personal" }) })
    const sheet = rec({ id: "q2", draft: d({ boardId: "pb", goalId: "g1", space: "personal" }) })
    const goal = rec({ id: "q3", draft: d({ boardId: "pb", goalId: "g9" }) })
    const out = migrateSlots({ bar, sheet, "goal:g9": goal })
    expect(Object.keys(out).sort()).toEqual(["bar:pb:-:personal", "goal:pb:g9:-", "sheet:pb:g1:personal"])
    const kept = migrateSlots({ sheet, "sheet:pb:g1:personal": rec({ id: "new" }) })
    expect(Object.keys(kept).sort()).toEqual(["sheet", "sheet:pb:g1:personal"])
    expect(kept["sheet:pb:g1:personal"]!.id).toBe("new")
  })
  test("옛 편집 초안은 대상(판)을 알 때만 옮겨요", () => {
    const out = migrateEdits({ sheet: { text: "옛 초안", boardId: "pb", space: "personal" }, bar: { text: "판 모름" } })
    expect(Object.keys(out).sort()).toEqual(["bar", "sheet:pb:-:personal"])
  })
})
