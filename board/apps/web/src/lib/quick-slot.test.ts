import { describe, expect, test } from "bun:test"
import type { Draft } from "@/lib/quick-add"
import type { Pending } from "@direction-board/contracts/quick-recovery"
import { slotFor } from "@direction-board/contracts/quick-recovery"
import { compareAndWrite } from "./store-plan"
import { planSlotReset, readEdit, readSlot, recordKey, saveOutcome, slotKey, submitQuick, writeEdit, writeSlot } from "./quick-slot"

// PR #39 리뷰 16: 웹 빠른 추가 복구 기록은 화면 수명이 아니라 범위별 localStorage 에(닫기·뒤로·새로고침 뒤 복원), 결과 불명 확인은 읽기만.
const S = "http://127.0.0.1:3191|qa@lidgeai.test"
const draft: Draft = { boardId: "b", kind: "todo", title: "회의 준비", at: null, areaId: null, tags: [], note: "아직 안 보낸 노트", props: [] }
const rec = (p: Partial<Pending> = {}): Pending => ({ id: "q1", from: "item", draft, text: "", ref: null, scope: S, ...p })
function memory(over: Partial<{ get: () => string | null; set: () => void }> = {}) {
  const m = new Map<string, string>()
  return { m, storage: { getItem: over.get ?? ((k: string) => m.get(k) ?? null), setItem: over.set ?? ((k: string, v: string) => void m.set(k, v)) } }
}

describe("복구 기록 저장(lib/quick-slot.ts)", () => {
  test("시트 자리의 기록은 화면을 다시 그려도(새로 읽기) 그대로 — 닫기·새로고침 뒤 복원", () => {
    const { storage } = memory()
    expect(writeSlot(storage, S, "sheet:pb:-:personal", rec({ unknown: true }))).toBe(true)
    expect(readSlot(storage, S, "sheet:pb:-:personal")).toEqual({ s: "ok", value: rec({ unknown: true }) })
  })
  test("자리끼리·범위끼리 섞이지 않아요(자리마다 키 하나 — PR #43 리뷰)", () => {
    const { m, storage } = memory()
    writeSlot(storage, S, "sheet:pb:-:personal", rec())
    writeSlot(storage, S, "goal:pb:g1:-", rec({ id: "q2" }))
    writeSlot(storage, S, "sheet:pb:-:personal", null)
    expect(readSlot(storage, S, "sheet:pb:-:personal")).toEqual({ s: "ok", value: null })
    expect(readSlot(storage, S, "goal:pb:g1:-")).toEqual({ s: "ok", value: rec({ id: "q2" }) })
    expect(m.has(recordKey(S, "goal:pb:g1:-"))).toBe(true)
    expect(m.has(slotKey(S))).toBe(false)
    expect(readSlot(storage, "http://127.0.0.1:3191|b@x.test", "goal:pb:g1:-")).toEqual({ s: "ok", value: null })
  })
  test("깨진 값·읽기 실패는 '없음'이 아니에요(corrupt·read) — 덮지 않고, 사람이 버리고 새로 해야 풀려요 · 그 자리만", () => {
    const { m, storage } = memory()
    m.set(recordKey(S, "sheet:pb:-:personal"), '{"id":1}')
    m.set(recordKey(S, "goal:pb:g1:-"), JSON.stringify(rec({ id: "q2" })))
    expect(readSlot(storage, S, "sheet:pb:-:personal")).toEqual({ s: "corrupt", level: "slot" })
    expect(writeSlot(storage, S, "sheet:pb:-:personal", rec())).toBe(false)
    expect(m.get(recordKey(S, "sheet:pb:-:personal"))).toBe('{"id":1}')
    expect(compareAndWrite(storage, planSlotReset(storage, S, "sheet:pb:-:personal")!)).toBe("done")
    expect(readSlot(storage, S, "sheet:pb:-:personal")).toEqual({ s: "ok", value: null })
    expect(readSlot(storage, S, "goal:pb:g1:-")).toEqual({ s: "ok", value: rec({ id: "q2" }) })
    const broken = memory({ get: () => { throw new Error("SecurityError") } })
    expect(readSlot(broken.storage, S, "bar:pb:-:-")).toEqual({ s: "read", level: "slot" })
  })
  test("예전 묶음 키는 그 자리 키가 없을 때만 읽어 넘기고, 묶음 안 다른 자리 항목의 깨짐은 이 자리에 닿지 않아요 · 묶음 자체가 깨지면 묶음 단위", () => {
    const { m, storage } = memory()
    m.set(slotKey(S), JSON.stringify({ "bar:pb:-:personal": rec({ id: "old" }), "sheet:pb:-:personal": { id: 1 } }))
    expect(readSlot(storage, S, "bar:pb:-:personal")).toEqual({ s: "ok", value: rec({ id: "old" }) })
    expect(readSlot(storage, S, "sheet:pb:-:personal")).toEqual({ s: "corrupt", level: "slot" })
    expect(compareAndWrite(storage, planSlotReset(storage, S, "sheet:pb:-:personal")!)).toBe("done")
    expect(m.get(recordKey(S, "sheet:pb:-:personal"))).toBe("null")
    expect(readSlot(storage, S, "bar:pb:-:personal")).toEqual({ s: "ok", value: rec({ id: "old" }) })
    m.set(slotKey(S), "not json")
    expect(readSlot(storage, S, "bar:pb:-:personal")).toEqual({ s: "corrupt", level: "bundle" })
    expect(readSlot(storage, S, "sheet:pb:-:personal")).toEqual({ s: "ok", value: null })
    expect(compareAndWrite(storage, planSlotReset(storage, S, "bar:pb:-:personal")!)).toBe("done")
    expect(m.get(slotKey(S))).toBe("{}")
  })
  test("쓰기 실패는 false(먼저 기록을 못 남기면 보내지 않아요)", () => {
    const { storage } = memory({ set: () => { throw new Error("QuotaExceeded") } })
    expect(writeSlot(storage, S, "bar", rec())).toBe(false)
  })
})

describe("저장 결과 셋(saveOutcome)", () => {
  test("4xx 응답은 확실한 거절, 네트워크·5xx·시간 초과는 결과 불명", () => {
    expect(saveOutcome(Object.assign(new Error("bad"), { status: 400 }))).toBe(false)
    expect(saveOutcome(Object.assign(new Error("forbidden"), { status: 403 }))).toBe(false)
    expect(saveOutcome(Object.assign(new Error("bad gateway"), { status: 502 }))).toBe("unknown")
    expect(saveOutcome(new TypeError("Failed to fetch"))).toBe("unknown")
    expect(saveOutcome(new DOMException("timeout", "AbortError"))).toBe("unknown")
  })
})

describe("웹 빠른 추가 흐름(submitQuick)", () => {
  const server = (doc: { item: boolean; note: string | null }, fail: { notePut?: Error } = {}) => {
    const calls: string[] = []
    const call = (async (path: string, init: { method: string }) => {
      calls.push(init.method + " " + path)
      if (init.method === "GET" && path.startsWith("/api/work/")) {
        if (!doc.item) throw Object.assign(new Error("nf"), { status: 404 })
        return { self: { title: "회의 준비", type: "todo", when: null }, note: doc.note === null ? null : { text: doc.note } }
      }
      if (init.method === "PUT" && path.endsWith("/note")) {
        if (fail.notePut) throw fail.notePut
        doc.note = "아직 안 보낸 노트"
        return {}
      }
      return {}
    }) as Parameters<typeof submitQuick>[0]["call"]
    return { calls, call, writes: () => calls.filter((c) => !c.startsWith("GET ")) }
  }
  const run = (a: Partial<Parameters<typeof submitQuick>[0]>) =>
    submitQuick({ text: "", makeDraft: () => draft, pending: null, writeAhead: async () => true, scope: S, same: () => true, save: async () => true, id: () => "q1", ...a })
  test("노트 PUT 이 네트워크 오류면 결과 불명(확실한 실패로 보이지 않음), 기록·노트 유지", async () => {
    const s = server({ item: false, note: null }, { notePut: new TypeError("Failed to fetch") })
    const r = await run({ call: s.call, save: async () => true })
    expect(r.kind).toBe("pending")
    if (r.kind === "pending") expect([r.pending.from, r.pending.unknown, r.pending.draft.note]).toEqual(["note", true, "아직 안 보낸 노트"])
  })
  test("그 기록의 다시 누름은 확인(읽기만): 쓰기 0건", async () => {
    const s = server({ item: true, note: "아직 안 보낸 노트" })
    const r = await run({ call: s.call, pending: rec({ from: "note", ref: "item:b:q1", unknown: true }) })
    expect(s.writes()).toEqual([])
    expect(r.kind).toBe("done")
  })
  test("항목 저장 결과 불명이면 결과 불명 기록, 확인은 읽기만 — 남은 노트 보내기는 그다음 사람이 누를 때", async () => {
    const s = server({ item: true, note: null })
    const first = await run({ call: s.call, save: async () => "unknown" })
    expect(first.kind).toBe("pending")
    if (first.kind !== "pending") return
    expect(first.pending.unknown).toBe(true)
    const checked = await run({ call: s.call, pending: first.pending })
    expect(s.writes()).toEqual([])
    expect(checked.kind).toBe("pending")
    if (checked.kind !== "pending") return
    expect([checked.pending.from, checked.pending.unknown]).toEqual(["note", undefined])
    const sent = await run({ call: s.call, pending: checked.pending })
    expect(sent.kind).toBe("done")
    expect(s.writes()).toEqual(["PUT /api/work/item%3Ab%3Aq1/note"])
  })
})

describe("(리뷰 18) 편집 초안은 범위·대상 키로", () => {
  test("A 에서 쓰던 한 줄 → 범위 B 에서는 빈 칸(B 키), A 초안은 A 키에 보존 → A 로 돌아오면 복원", () => {
    const { storage } = memory()
    const A2 = "http://127.0.0.1:3191|a@x.test", B2 = "http://127.0.0.1:3191|b@x.test"
    const bar = slotFor("bar", { boardId: "pb", space: "personal" })
    expect(writeEdit(storage, A2, bar, { text: "A 가 쓰던 글", boardId: "pb", space: "personal" })).toBe(true)
    expect(readEdit(storage, B2, bar)).toBeNull()
    expect(readEdit(storage, A2, bar)?.text).toBe("A 가 쓰던 글")
  })
  test("개인 목표 시트의 초안은 회사 판 시트 자리에서 보이지 않아요", () => {
    const { storage } = memory()
    const goalSheet = slotFor("sheet", { boardId: "pb", goalId: "g1", space: "personal" })
    writeEdit(storage, S, goalSheet, { text: "목표에 붙일 할 일", boardId: "pb", goalId: "g1", space: "personal" })
    expect(readEdit(storage, S, slotFor("sheet", { boardId: "cb", space: "ws_1" }))).toBeNull()
    expect(readEdit(storage, S, goalSheet)).toMatchObject({ boardId: "pb", goalId: "g1", space: "personal" })
  })
})
