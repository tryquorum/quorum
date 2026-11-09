import { describe, expect, test } from "bun:test"
import { createWork, goalTodoDraft, type CreateDeps, type Draft } from "./quick-add.ts"
import type { Item } from "./api.ts"

// 빠른 추가 여러 단계: 항목 저장 결과 불명을 실패와 나누고, 다시 시도 전에 항목이 이미 있는지 읽어 있으면 PUT 하지 않아요(P2-5).
// 범위(서버·로그인)가 바뀌어 멈추면 끝난 단계와 남은 단계를 그대로 알려요(구조 1).
const draft: Draft = { boardId: "b", kind: "todo", title: "회의 준비", at: null, areaId: null, tags: ["급함"], note: "노트", props: [] }

// 리뷰 5 P1: 목표에 붙일 할 일은 목표의 판·영역·공간을 물려받아요(웹 목표 한 줄·상세 시트, iOS 목표 할 일·상세 시트가 같이 써요)
describe("목표에 붙일 할 일 초안", () => {
  const g: Item = { id: "g1", boardId: "cb", type: "goal", text: "목표", x: 0, y: 0, w: 1, h: 1, area: "a1", space: "ws_000000000002" }
  test("목표의 공간·판·영역·goalId 를 담고, 저장할 때 space 를 보내요", async () => {
    const d = goalTodoDraft(g, { title: "할 일", at: null, tags: [] })
    expect(d).toMatchObject({ boardId: "cb", kind: "todo", goalId: "g1", areaId: "a1", space: "ws_000000000002" })
    const saved: Item[] = []
    await createWork(d, deps({ save: async (it) => { saved.push(it); return true } }))
    expect(saved[0]?.space).toBe("ws_000000000002")
  })
  test("개인 목표면 personal, 공간을 모르는 옛 서버의 목표면 보내지 않아요(서버가 목표에서 물려받음)", () => {
    expect(goalTodoDraft({ ...g, space: "personal" }, { title: "t", at: null, tags: [] }).space).toBe("personal")
    expect(goalTodoDraft({ ...g, space: undefined }, { title: "t", at: null, tags: [] }).space).toBeUndefined()
  })
})
class Scope extends Error { readonly scopeChanged = true }
function deps(over: Partial<CreateDeps> = {}, calls: string[] = []): CreateDeps {
  return {
    save: async () => { calls.push("save"); return true },
    call: (async (path: string, init: { method: string }) => { calls.push(`${init.method} ${path}`); return { note: null } }) as CreateDeps["call"],
    id: () => "i1",
    now: () => 1,
    ...over,
  }
}

describe("항목 저장 결과 불명", () => {
  // 리뷰 6 P2: 결과를 모르던 항목을 다시 시도할 때 이미 저장돼 있으면, 지금 초안과 다른지(제목·종류·날짜) 비교해 다르면 성공처럼 넘기지 않고 differs 로 알려요
  test("다시 시도에서 이미 있는 항목이 지금 초안과 다르면 differs, 남은 단계는 보내지 않아요", async () => {
    const calls: string[] = []
    const call = (async (path: string, init: { method: string }) => {
      calls.push(`${init.method} ${path}`)
      return { self: { title: "회의 준비 옛 제목", type: "todo", when: null }, note: null }
    }) as CreateDeps["call"]
    const r = await createWork(draft, deps({ call }, calls), { id: "i1", from: "item" })
    expect(r).toMatchObject({ kind: "differs", left: "note", ref: "item:b:i1" })
    expect(calls).toEqual(["GET /api/work/item%3Ab%3Ai1"])
  })
  test("이미 있는 항목이 같은 초안이면 남은 단계만 이어요", async () => {
    const calls: string[] = []
    const call = (async (path: string, init: { method: string }) => {
      calls.push(`${init.method} ${path}`)
      return init.method === "GET" ? { self: { title: "회의 준비", type: "todo", when: null }, note: null } : {}
    }) as CreateDeps["call"]
    const r = await createWork(draft, deps({ call }, calls), { id: "i1", from: "item" })
    expect(r.kind).toBe("done")
    // 항목 GET → 노트 PUT → (이어 하기라 이미 있던 문서) 태그 전 메타 GET → 태그 POST(iOS 리뷰 14)
    expect(calls.length).toBe(4)
  })
  test("결과를 모르면 실패와 나눠 알려요", async () => {
    const r = await createWork(draft, deps({ save: async () => "unknown" as const }))
    expect(r).toMatchObject({ kind: "unknown", at: "item", ref: null })
  })
  test("다시 시도는 먼저 항목을 읽어, 이미 있으면 PUT 하지 않고 남은 단계만", async () => {
    const calls: string[] = []
    const r = await createWork(draft, deps({}, calls), { id: "i1", from: "item" })
    expect(r.kind).toBe("done")
    expect(calls[0]).toBe("GET /api/work/item%3Ab%3Ai1")
    expect(calls).not.toContain("save")
    expect(calls.slice(1)).toEqual(["PUT /api/work/item%3Ab%3Ai1/note", "GET /api/docs/item%3Ab%3Ai1?view=meta", "POST /api/docs/item%3Ab%3Ai1/tags"])
  })
  test("읽어 보니 없으면(404) 그때 저장해요", async () => {
    const calls: string[] = []
    const call = (async (path: string, init: { method: string }) => {
      calls.push(`${init.method} ${path}`)
      if (init.method === "GET" && path.startsWith("/api/work/")) throw Object.assign(new Error("work not found"), { status: 404 })
      return {}
    }) as CreateDeps["call"]
    const r = await createWork(draft, deps({ call }, calls), { id: "i1", from: "item" })
    expect(r.kind).toBe("done")
    expect(calls.slice(0, 2)).toEqual(["GET /api/work/item%3Ab%3Ai1", "save"])
  })
  test("읽기도 결과를 모르면 저장하지 않고 다시 결과 불명으로", async () => {
    const calls: string[] = []
    const call = (async (path: string, init: { method: string }) => { calls.push(`${init.method} ${path}`); throw new Error("net") }) as CreateDeps["call"]
    const r = await createWork(draft, deps({ call }, calls), { id: "i1", from: "item" })
    expect(r).toMatchObject({ kind: "unknown", at: "item" })
    expect(calls).not.toContain("save")
  })
})

describe("범위가 바뀌어 멈춤", () => {
  test("끝난 단계와 남은 단계를 알려요(다음 단계는 보내지 않음)", async () => {
    const calls: string[] = []
    const call = (async (path: string, init: { method: string }) => {
      calls.push(`${init.method} ${path}`)
      if (path.endsWith("/tags")) throw new Scope("scope")
      return {}
    }) as CreateDeps["call"]
    const r = await createWork({ ...draft, props: [{ key: "단계", type: "text", value: "계약" }] }, deps({ call }, calls))
    expect(r).toMatchObject({ kind: "scope", at: "tags", ref: "item:b:i1" })
    expect(calls.some((c) => c.endsWith("/props"))).toBe(false)
  })
})
