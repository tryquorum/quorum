import { describe, expect, test } from "bun:test"
import { bundleDiscardText, planFileDiscard, planRecordDiscard, planSlotDiscard, premiseHolds, sameSeen, slotName, slotView, type Raw, type Seen } from "./slot-store.ts"
import { isPending, migrateSlots, slotFor, type Pending } from "./quick-recovery.ts"

const BAR = slotFor("bar", { boardId: "pb", space: "personal" })
const SHEET = slotFor("sheet", { boardId: "pb", goalId: null, space: "personal" })
const rec = (id: string): Pending => ({ id, from: "item", text: id, ref: null, scope: "s", draft: { kind: "todo", title: id, at: null, areaId: null, tags: [], note: "", props: [], boardId: "pb", space: "personal" } as Pending["draft"] })
const val = (v: unknown): Raw => ({ s: "value", v })
const absent: Raw = { s: "absent" }
const view = (own: Raw, bundle: Raw, slot = BAR) => slotView(own, bundle, slot, isPending, migrateSlots)

describe("자리별 저장(PR #43 리뷰): 한 자리의 깨짐·버리기가 다른 자리에 닿지 않아요", () => {
  test("자리 이름은 자리마다 다른 저장 이름", () => {
    expect(slotName("quickPending", BAR)).not.toBe(slotName("quickPending", SHEET))
    expect(slotName("quickPending", BAR).startsWith("quickPending.")).toBe(true)
    expect(slotName("quickPending", BAR)).not.toContain("/")
  })
  test("자리 파일이 있으면 그것만 봐요(null = 비어 있음) — 옛 묶음이 깨져 있어도", () => {
    expect(view(val(rec("own")), { s: "corrupt" })).toEqual({ s: "ok", value: rec("own") })
    expect(view(val(null), { s: "read" })).toEqual({ s: "ok", value: null })
  })
  test("자리 파일이 못 읽힘·깨짐이면 그 자리만의 문제(버리면 그 자리 파일만)", () => {
    expect(view({ s: "read" }, absent)).toEqual({ s: "read", level: "slot" })
    expect(view({ s: "corrupt" }, absent)).toEqual({ s: "corrupt", level: "slot" })
    expect(view(val({ id: 1 }), absent)).toEqual({ s: "corrupt", level: "slot" })
  })
  test("자리 파일이 없으면 옛 묶음에서 그 자리를 읽어 넘겨요", () => {
    expect(view(absent, val({ [BAR]: rec("b"), [SHEET]: rec("s") }))).toEqual({ s: "ok", value: rec("b") })
    expect(view(absent, val({ [SHEET]: rec("s") }))).toEqual({ s: "ok", value: null })
    expect(view(absent, absent)).toEqual({ s: "ok", value: null })
    // 옛 자리 이름(리뷰 18 전)도 그 대상의 새 자리로
    expect(view(absent, val({ bar: rec("legacy") }))).toEqual({ s: "ok", value: rec("legacy") })
  })
  test("옛 묶음 안에서 다른 자리 항목만 깨졌으면 이 자리는 그대로, 이 자리 항목이 깨졌으면 이 자리만의 문제", () => {
    expect(view(absent, val({ [BAR]: rec("b"), [SHEET]: { id: 1 } }))).toEqual({ s: "ok", value: rec("b") })
    expect(view(absent, val({ [BAR]: { id: 1 }, [SHEET]: rec("s") }))).toEqual({ s: "corrupt", level: "slot" })
  })
  test("옛 묶음 자체를 못 읽거나 나눌 수 없으면 묶음 단위 문제(버리면 그 안 자리 모두 — 확인창이 밝혀요)", () => {
    expect(view(absent, { s: "read" })).toEqual({ s: "read", level: "bundle" })
    expect(view(absent, { s: "corrupt" })).toEqual({ s: "corrupt", level: "bundle" })
    expect(view(absent, val([1, 2]))).toEqual({ s: "corrupt", level: "bundle" })
    // 옛 자리 이름의 깨진 항목은 어느 자리인지 알 수 없어요
    expect(view(absent, val({ bar: { id: 1 } }))).toEqual({ s: "corrupt", level: "bundle" })
    expect(bundleDiscardText("빠른 추가 기록")).toContain("모든 자리")
  })
  test("읽는 중이면 준비 아님", () => {
    expect(view({ s: "loading" }, absent)).toEqual({ s: "loading" })
    expect(view(absent, { s: "loading" })).toEqual({ s: "loading" })
  })
})

describe("규칙 F 계획(PR #43 리뷰 2): 지울 곳 하나 + 전제 + 확인창 글", () => {
  const text = (v: unknown): Seen => ({ s: "text", text: typeof v === "string" ? v : JSON.stringify(v) })
  const absent: Seen = { s: "absent" }
  test("전제 비교는 원문 글자까지, 못 읽음은 언제나 다름(리뷰 6 — 못 읽음끼리도)", () => {
    expect(sameSeen(text("a"), text("a"))).toBe(true)
    expect(sameSeen(text("a"), text("a "))).toBe(false)
    expect(sameSeen(text("a"), { s: "unreadable" })).toBe(false)
    expect(sameSeen({ s: "unreadable" }, { s: "unreadable" })).toBe(false)
    expect(sameSeen({ s: "unreadable" }, text("a"))).toBe(false)
    expect(sameSeen(absent, text("null"))).toBe(false)
  })
  test("못 읽음을 전제로 쓰는 길은 사람이 확인창에서 고른 계획(확인창 글이 있는 계획)뿐(리뷰 6)", () => {
    const unreadable: Seen = { s: "unreadable" }
    const confirmed = { premises: [{ key: "own", seen: unreadable }], write: { key: "own", value: null }, message: "읽지 못한 것을 버려요" }
    const auto = { premises: [{ key: "own", seen: unreadable }], write: { key: "own", value: null } }
    expect(premiseHolds(confirmed, 0, unreadable)).toBe(true)
    expect(premiseHolds(confirmed, 0, text("a"))).toBe(false)
    expect(premiseHolds(auto, 0, unreadable)).toBe(false)
    expect(premiseHolds(auto, 0, text("a"))).toBe(false)
    expect(premiseHolds({ premises: [{ key: "own", seen: text("a") }], write: auto.write }, 0, text("a"))).toBe(true)
  })
  test("자리 계획: 그 자리 문제면 자리 파일만(null), 묶음 문제면 묶음만({}) — 확인창 글이 범위를 밝히고, 문제가 없으면 null", () => {
    const own = (seen: Seen) => ({ key: "own", seen })
    const bundle = (seen: Seen) => ({ key: "bundle", seen })
    const slotPlan = planSlotDiscard(own({ s: "unreadable" }), bundle(text({ bar: { id: 1 } })), BAR, isPending, migrateSlots, "빠른 추가 기록")
    expect(slotPlan?.write).toEqual({ key: "own", value: null })
    expect(slotPlan?.message).not.toContain("모든 자리")
    expect(slotPlan?.premises.map((p) => p.key)).toEqual(["own", "bundle"])
    const bundlePlan = planSlotDiscard(own(absent), bundle(text({ bar: { id: 1 } })), BAR, isPending, migrateSlots, "빠른 추가 기록")
    expect(bundlePlan?.write).toEqual({ key: "bundle", value: {} })
    expect(bundlePlan?.message).toContain("모든 자리")
    expect(planSlotDiscard(own(text(rec("b"))), bundle(absent), BAR, isPending, migrateSlots, "x")).toBeNull()
  })
  test("보인 기록 버리기: 지금 그 자리 값이 본 것과 같을 때만", () => {
    const own = { key: "own", seen: text(rec("b")) }
    const bundle = { key: "bundle", seen: absent }
    expect(planRecordDiscard(own, bundle, BAR, isPending, migrateSlots, rec("b"), "m")?.write).toEqual({ key: "own", value: null })
    expect(planRecordDiscard(own, bundle, BAR, isPending, migrateSlots, rec("other"), "m")).toBeNull()
  })
  test("파일 계획: 나눌 수 있으면 깨진 것만(개수), 아니면 통째로, 멀쩡하면 null", () => {
    const isList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "number")
    const split = (v: unknown) => (Array.isArray(v) ? { keep: v.filter((x) => typeof x === "number"), dropped: v.filter((x) => typeof x !== "number").length, kept: v.filter((x) => typeof x === "number").length } : null)
    const part = planFileDiscard({ key: "f", seen: text([1, "x"]) }, isList, [] as number[], "칩", split)
    expect(part?.write.value).toEqual([1])
    expect(part?.message).toContain("1개만")
    const whole = planFileDiscard({ key: "f", seen: text("{깨짐") }, isList, [] as number[], "칩", split)
    expect(whole?.write.value).toEqual([])
    expect(whole?.message).toContain("통째로")
    expect(planFileDiscard({ key: "f", seen: text([1]) }, isList, [] as number[], "칩", split)).toBeNull()
  })
})
