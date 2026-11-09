import { describe, expect, test } from "bun:test"
import type { Draft } from "@/lib/quick-add"
import type { Pending } from "@direction-board/contracts/quick-recovery"
import { readSlot, submitQuick, writeSlot } from "./quick-slot"

// PR #39 리뷰 17 P1-1 재현: A 로 항목 저장 직후 쿠키가 B 로 바뀜 → 같은 제출의 노트 PUT 이 B 로 나가 done.
// 서버(가짜)는 진짜 서버처럼 X-Direction-Expect-User 가 지금 주체(B)와 다르면 409 scope-changed, 헤더가 없으면 지금 주체로 받아요.
const A = "http://127.0.0.1:3191|a@x.test"
const draft: Draft = { boardId: "b", kind: "todo", title: "회의 준비", at: null, areaId: null, tags: [], note: "A 의 노트", props: [] }
function server() {
  let current = "a@x.test"
  const writes: { path: string; as: string; header: string | null }[] = []
  const gate = (headers?: Record<string, string>) => {
    const want = headers?.["X-Direction-Expect-User"] ?? null
    if (want !== null && want !== current) throw Object.assign(new Error("scope-changed"), { status: 409, body: { error: "scope-changed" } })
    return want
  }
  const call = (async (path: string, init: { method: string; headers?: Record<string, string> }) => {
    if (init.method === "GET") return path.includes("?view=meta") ? {} : { self: { title: "회의 준비", type: "todo", when: null }, note: null }
    const header = gate(init.headers)
    writes.push({ path, as: current, header })
    return {}
  }) as Parameters<typeof submitQuick>[0]["call"]
  const save = async (_it: unknown, opts?: { expectUser?: string }) => {
    gate(opts?.expectUser ? { "X-Direction-Expect-User": opts.expectUser } : undefined)
    writes.push({ path: "PUT item", as: current, header: opts?.expectUser ?? null })
    current = "b@x.test" // 항목 저장 직후 쿠키가 B 로
    return true as const
  }
  return { call, save, writes }
}

describe("(리뷰 17 P1-1) 웹 빠른 추가의 모든 쓰기는 시작 범위의 주체를 밝히고, 서버가 다르면 거절", () => {
  test("항목 저장 뒤 계정이 바뀌면 노트는 B 로 나가지 않고 범위 바뀜 기록(노트·id 유지)", async () => {
    const s = server()
    const r = await submitQuick({ text: "", makeDraft: () => draft, pending: null, writeAhead: async () => true, scope: A, same: () => true, save: s.save, call: s.call, id: () => "q1" })
    expect(s.writes.filter((w) => w.as === "b@x.test")).toEqual([])
    expect(s.writes.every((w) => w.header === "a@x.test")).toBe(true)
    expect(r.kind).toBe("pending")
    if (r.kind === "pending") expect([r.pending.from, r.pending.stopped, r.pending.draft.note, r.pending.scope]).toEqual(["note", "scope", "A 의 노트", A])
  })
})

describe("(리뷰 17 P2) 끝난 뒤 기록 지우기에 실패해도 다음에 열면 확인(읽기만)으로 정리", () => {
  test("남은 기록은 먼저 기록(결과 불명)이라 다시 누르면 GET 만, 결과 done", async () => {
    const m = new Map<string, string>()
    let failDelete = false
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { if (failDelete && v === "null") throw new Error("QuotaExceeded"); m.set(k, v) } }
    const writes: string[] = []
    const call = (async (path: string, init: { method: string }) => {
      if (init.method !== "GET") { writes.push(init.method + " " + path); return {} }
      return { self: { title: "회의 준비", type: "todo", when: null }, note: { text: "A 의 노트" } }
    }) as Parameters<typeof submitQuick>[0]["call"]
    const first = await submitQuick({ text: "", makeDraft: () => draft, pending: null, writeAhead: async (p) => writeSlot(storage, A, "sheet:b:-:-", p), scope: A, same: () => true, save: async () => true, call, id: () => "q1" })
    expect(first.kind).toBe("done")
    failDelete = true
    expect(writeSlot(storage, A, "sheet:b:-:-", null)).toBe(false)
    const left = readSlot(storage, A, "sheet:b:-:-")
    const p = (left.s === "ok" ? left.value : null) as Pending
    expect(p.unknown).toBe(true)
    writes.length = 0
    const again = await submitQuick({ text: "", makeDraft: () => draft, pending: p, writeAhead: async () => true, scope: A, same: () => true, save: async () => true, call, id: () => "q1" })
    expect(writes).toEqual([])
    expect(again.kind).toBe("done")
  })
})
