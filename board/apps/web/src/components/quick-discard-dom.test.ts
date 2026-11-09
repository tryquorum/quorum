// 웹 빠른 추가의 버리기 시험: 자리별 저장(PR #43 리뷰)과 규칙 F "확인한 계획만 실행"(PR #43 리뷰 2). 하네스는 __tests__/quickAddHarness.ts.
import { describe, expect, test } from "bun:test"
import { act, CAPTURE_STORE, click, draftKey, openSheet, q, recordKey, remount, render, saved, sleep, slotFor, slotKey, state, typeInto, useQuickAddHarness, win } from "./__tests__/quickAddHarness"

useQuickAddHarness()
const A = "http://127.0.0.1:3191|a@x.test"
const PERSONAL = slotFor("sheet", { boardId: "pb", goalId: null, space: "personal" })
const SCREEN = { bar: { slot: slotFor("bar", { boardId: "pb", space: "personal" }) } }
const show = async (s: "bar" | "sheet") => { await render(A); if (s === "sheet") await openSheet() }
const W = win as unknown as { confirm: (m?: string) => boolean }
// 시트가 열려 있으면 시트 안의 안내만
const alertWith = (t: string) => [...(document.querySelector('[role="dialog"]') ?? document).querySelectorAll('[role="alert"]')].find((p) => (p.textContent ?? "").includes(t)) as HTMLElement | undefined
const clickIn = async (box: HTMLElement | undefined, label: string) => { const b = [...(box?.querySelectorAll("button") ?? [])].find((x) => (x.textContent ?? "").trim() === label); expect(b).toBeTruthy(); await click(b!) }
// 읽기 실패 주입: 진짜 저장소를 감싸 failRead 에 든 키의 getItem 만 던져요
const real = (win as unknown as { localStorage: Storage }).localStorage
const failRead = new Set<string>()
const failWrite = new Set<string>()
let onGet: ((k: string) => void) | null = null
const wrapped = { getItem: (k: string) => { onGet?.(k); if (failRead.has(k)) throw new Error("io"); return real.getItem(k) }, setItem: (k: string, v: string) => { if (failWrite.has(k)) throw new Error("full"); real.setItem(k, v) }, removeItem: (k: string) => real.removeItem(k), clear: () => real.clear(), key: (i: number) => real.key(i), get length() { return real.length } }
const useWrapped = () => { failRead.clear(); failWrite.clear(); onGet = null; Object.defineProperty(win, "localStorage", { configurable: true, value: wrapped }) }
const useReal = () => { failRead.clear(); onGet = null; Object.defineProperty(win, "localStorage", { configurable: true, value: real }) }
/** 확인창: 글을 남기고, 사람이 고르기 전(확인창과 실행 사이)에 between 을 돌려요 */
const confirmWith = async (box: HTMLElement | undefined, label: string, between?: () => void) => {
  const said: string[] = []
  const prev = W.confirm
  W.confirm = (m?: string) => { said.push(m ?? ""); between?.(); return true }
  try { await clickIn(box, label) } finally { W.confirm = prev }
  return said
}
// PR #43 리뷰: 자리마다 키 하나 — 한 자리의 깨짐·버리기가 다른 자리에 닿지 않아요. 예전 묶음은 읽어 넘기고, 묶음 안 다른 자리 항목의 깨짐은 이 자리에 닿지 않아요
describe("웹 자리별 저장(PR #43 리뷰)", () => {
  const rec = (id: string, title: string, draft: Record<string, unknown>) => ({ id, from: "item", text: title, ref: null, scope: A, draft: { kind: "todo", title, at: null, areaId: null, tags: [], note: "", props: [], ...draft } })
    test("한 줄 자리만 깨짐 → 한 줄에서 버리고 새로 → 시트 자리 기록은 그대로·시트에서 복원", async () => {
    const sheetRec = JSON.stringify(rec("s1", "시트 기록 글", { boardId: "pb", space: "personal" }))
    localStorage.setItem(recordKey(A, PERSONAL), sheetRec)
    localStorage.setItem(recordKey(A, SCREEN.bar.slot), "{깨짐")
    await show("bar")
    await confirmWith(alertWith("복구 기록"), "버리고 새로")
    expect(localStorage.getItem(recordKey(A, SCREEN.bar.slot))).toBe("null")
    expect(localStorage.getItem(recordKey(A, PERSONAL))).toBe(sheetRec)
    await openSheet()
    expect(q<HTMLInputElement>('input[aria-label="제목"]')!.value).toBe("시트 기록 글")
  })
  test("리뷰 재현(옛 저장 모양): 묶음 안 한 줄 항목만 깨짐 → 한 줄에서 버리고 새로 → 묶음 안 시트 기록은 그대로 · 묶음 자체가 깨지면 확인창이 모든 자리를 밝혀요", async () => {
    localStorage.setItem(slotKey(A), JSON.stringify({ [SCREEN.bar.slot]: { id: 1 }, [PERSONAL]: rec("s1", "시트 옛 기록", { boardId: "pb", space: "personal" }) }))
    await show("bar")
    const said = await confirmWith(alertWith("복구 기록"), "버리고 새로")
    expect(said.join(" ")).not.toContain("모든 자리")
    await openSheet()
    expect(q<HTMLInputElement>('input[aria-label="제목"]')!.value).toBe("시트 옛 기록")
    localStorage.clear()
    localStorage.setItem(slotKey(A), "{깨짐")
    await remount()
    await show("bar")
    const all = await confirmWith(alertWith("복구 기록"), "버리고 새로")
    expect(all.join(" ")).toContain("모든 자리")
    expect(localStorage.getItem(slotKey(A))).toBe("{}")
  })
  test("AI 정리 칩 하나만 깨졌으면 그것만 버리고 성한 칩은 남겨요(확인창이 개수를 밝혀요)", async () => {
    const chip = { id: "run1", clientKey: "k1", text: "칩 글", draft: null, startedAt: 1, ended: true }
    localStorage.setItem(CAPTURE_STORE, JSON.stringify([chip, { id: 2 }]))
    await show("bar")
    const said = await confirmWith(alertWith("AI 정리 칩"), "버리고 새로")
    expect(said.join(" ")).toContain("1개만")
    expect(JSON.parse(localStorage.getItem(CAPTURE_STORE) ?? "[]")).toEqual([chip])
  })
})


describe("규칙 F 웹: 확인한 계획만 실행(PR #43 리뷰 2)", () => {
  const rec = (id: string, title: string) => ({ id, from: "item", text: title, ref: null, scope: A, draft: { kind: "todo", title, at: null, areaId: null, tags: [], note: "", props: [], boardId: "pb", space: "personal" } })
  const chip = { id: "run1", clientKey: "k1", text: "칩 글", draft: null, startedAt: 1, ended: true }
  test("리뷰 2 P1-1 재현: 칩 확인창은 '깨진 1개만' → 확인 직후 한 번 읽기 실패 → 성한 칩까지 지우지 않아요(0건)", async () => {
    useWrapped()
    try {
      const text = JSON.stringify([chip, { id: 2 }])
      real.setItem(CAPTURE_STORE, text)
      await show("bar")
      const said = await confirmWith(alertWith("AI 정리 칩"), "버리고 새로", () => failRead.add(CAPTURE_STORE))
      expect(said.join(" ")).toContain("1개만")
      expect(real.getItem(CAPTURE_STORE)).toBe(text)
      expect(document.body.textContent).toContain("그사이 바뀌었어요")
    } finally { useReal() }
  })
  test("리뷰 2 P1-2 재현: 한 줄 자리 읽기 실패 + 옛 묶음(깨진 옛 항목·성한 시트 기록) → 확인창은 그 자리만 → 실행 직전 자리가 읽히면 0건(묶음 그대로)", async () => {
    useWrapped()
    try {
      const own = recordKey(A, SCREEN.bar.slot)
      const bundle = JSON.stringify({ bar: { id: 1 }, [PERSONAL]: rec("s1", "시트 옛 기록") })
      real.setItem(slotKey(A), bundle)
      failRead.add(own)
      await show("bar")
      const said = await confirmWith(alertWith("복구 기록"), "버리고 새로", () => failRead.delete(own))
      expect(said.join(" ")).not.toContain("모든 자리")
      expect(real.getItem(slotKey(A))).toBe(bundle)
      expect(real.getItem(own)).toBeNull()
      expect(document.body.textContent).toContain("그사이 바뀌었어요")
    } finally { useReal() }
  })
  const paths: { name: string; key: () => string; what: string; sheet?: boolean }[] = [
    { name: "한 줄 기록 자리", key: () => recordKey(A, SCREEN.bar.slot), what: "복구 기록" },
    { name: "한 줄 쓰던 초안 자리", key: () => draftKey(A, SCREEN.bar.slot), what: "쓰던 초안" },
    { name: "시트 열기 전 검사 · 기록", key: () => recordKey(A, PERSONAL), what: "복구 기록", sheet: true },
    { name: "시트 열기 전 검사 · 쓰던 초안", key: () => draftKey(A, PERSONAL), what: "쓰던 초안", sheet: true },
    { name: "AI 정리 칩", key: () => CAPTURE_STORE, what: "AI 정리 칩" },
  ]
  for (const p of paths) {
    test(p.name + ": 확인창 뒤 저장이 바뀌면(전제와 다름) 0건", async () => {
      real.setItem(p.key(), "{깨짐1")
      await show(p.sheet ? "sheet" : "bar")
      await confirmWith(alertWith(p.what), "버리고 새로", () => real.setItem(p.key(), "{깨짐2"))
      expect(real.getItem(p.key())).toBe("{깨짐2")
      expect(document.body.textContent).toContain("그사이 바뀌었어요")
    })
    test(p.name + ": 확인창 뒤 다시 읽기가 실패하면 0건", async () => {
      useWrapped()
      try {
        real.setItem(p.key(), "{깨짐1")
        await show(p.sheet ? "sheet" : "bar")
        await confirmWith(alertWith(p.what), "버리고 새로", () => failRead.add(p.key()))
        expect(real.getItem(p.key())).toBe("{깨짐1")
      } finally { useReal() }
    })
  }
  test("남은 기록 버리기: 확인창 뒤 그 자리 기록이 다른 기록으로 바뀌면 0건", async () => {
    const own = recordKey(A, SCREEN.bar.slot)
    real.setItem(own, JSON.stringify(rec("r1", "보인 기록")))
    await show("bar")
    await confirmWith(alertWith("저장하지 못한") ?? alertWith("보인 기록") ?? document.querySelector('[role="alert"]') as HTMLElement, "버리기", () => real.setItem(own, JSON.stringify(rec("r2", "새 기록"))))
    expect(JSON.parse(real.getItem(own) ?? "null")?.id).toBe("r2")
  })
})

// PR #43 리뷰 3 P1-1: 기록 버리기는 계획에 대상 둘(기록·쓰던 초안)을 각자 전제와 함께 담고 확인창에 둘 다 밝혀요. 실행은 각각 비교-후-쓰기 —
// 초안이 그사이 바뀌었으면 초안은 남겨요. 제출이 끝난(done) 뒤 초안 비우기도 제출한 초안 원문이 전제예요
describe("리뷰 3 웹: 기록 버리기·제출 끝의 쓰던 초안(PR #43 리뷰 3)", () => {
  const rec = (id: string, title: string) => ({ id, from: "item", text: title, ref: null, scope: A, draft: { kind: "todo", title, at: null, areaId: null, tags: [], note: "", props: [], boardId: "pb", space: "personal" } })
  const bar = SCREEN.bar.slot
  test("리뷰 3 P1-1 재현: 확인창이 떠 있는 동안 다른 탭이 같은 자리 초안을 새 글로 → 확인 뒤 기록만 지우고 새 초안은 남겨요", async () => {
    real.setItem(recordKey(A, bar), JSON.stringify(rec("r1", "남은 기록")))
    real.setItem(draftKey(A, bar), JSON.stringify({ text: "옛 초안", boardId: "pb", space: "personal" }))
    await show("bar")
    const fresh = JSON.stringify({ text: "다른 탭 새 초안", boardId: "pb", space: "personal" })
    const said = await confirmWith(document.querySelector('[role="alert"]') as HTMLElement, "버리기", () => real.setItem(draftKey(A, bar), fresh))
    expect(said.join(" ")).toContain("쓰던 초안")
    expect(real.getItem(recordKey(A, bar))).toBe("null")
    expect(real.getItem(draftKey(A, bar))).toBe(fresh)
  })
  test("제출이 끝나기 전에 다른 탭이 같은 자리 초안을 새 글로 → done 뒤에도 새 초안은 남겨요", async () => {
    await show("bar")
    await typeInto(q<HTMLInputElement>('input[aria-label="할 일 추가"]')!, "보낼 할 일")
    await act(async () => { await sleep(350) })
    const fresh = JSON.stringify({ text: "다른 탭 새 초안", boardId: "pb", space: "personal" })
    state.onSave = () => real.setItem(draftKey(A, bar), fresh)
    await act(async () => { q<HTMLInputElement>('input[aria-label="할 일 추가"]')!.form!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event) })
    await act(async () => { await sleep(60) })
    expect(saved.length).toBe(1)
    expect(real.getItem(draftKey(A, bar))).toBe(fresh)
  })
})

// PR #43 리뷰 4 규칙 G: 프로그램이 칸을 바꾸면(제출 끝·AI 넘김·버리기 뒤·복원·바뀜 채우기) 자동 저장이 그것을 사람 편집처럼 덮지 않아요.
// 자동 저장도 비교-후-쓰기(전제 = 이 화면이 마지막으로 읽거나 쓴 디스크 값)라, 그사이 다른 곳이 바꿨으면 쓰지 않고 "다른 곳에서 바뀐 초안" 안내
describe("규칙 G 웹: 프로그램이 바꾼 칸·자동 저장(PR #43 리뷰 4)", () => {
  const bar = SCREEN.bar.slot
  const input = () => q<HTMLInputElement>('input[aria-label="할 일 추가"]')!
  const fresh = JSON.stringify({ text: "다른 탭 새 초안", boardId: "pb", space: "personal" })
  const wait = async (ms: number) => { await act(async () => { await sleep(ms) }) }
  const enter = async () => { await act(async () => { input().form!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event) }); await wait(60) }
  test("제출 끝 · 그사이 변경 없음 → 1초 뒤에도 초안 비움(null), 다시 그려도 빈 칸", async () => {
    await show("bar")
    await typeInto(input(), "보낼 할 일")
    await wait(350)
    await enter()
    await wait(1000)
    expect(real.getItem(draftKey(A, bar))).toBe("null")
    await remount(); await show("bar")
    expect(input().value).toBe("")
  })
  test("제출 끝 · 그사이 다른 탭 변경 → 1초 뒤에도 새 초안 그대로, 칸·다시 그린 칸에 그 글", async () => {
    await show("bar")
    await typeInto(input(), "보낼 할 일")
    await wait(350)
    state.onSave = () => real.setItem(draftKey(A, bar), fresh)
    await enter()
    await wait(1000)
    expect(real.getItem(draftKey(A, bar))).toBe(fresh)
    expect(input().value).toBe("다른 탭 새 초안")
    await remount(); await show("bar")
    expect(input().value).toBe("다른 탭 새 초안")
  })
  test("버리기 · 그사이 다른 탭 변경 → 1초 뒤에도 새 초안 그대로", async () => {
    real.setItem(recordKey(A, bar), JSON.stringify({ id: "r1", from: "item", text: "남은 기록", ref: null, scope: A, draft: { kind: "todo", title: "남은 기록", at: null, areaId: null, tags: [], note: "", props: [], boardId: "pb", space: "personal" } }))
    real.setItem(draftKey(A, bar), JSON.stringify({ text: "옛 초안", boardId: "pb", space: "personal" }))
    await show("bar")
    await confirmWith(document.querySelector('[role="alert"]') as HTMLElement, "버리기", () => real.setItem(draftKey(A, bar), fresh))
    await wait(1000)
    expect(real.getItem(draftKey(A, bar))).toBe(fresh)
    expect(input().value).toBe("다른 탭 새 초안")
  })
  test("복원 · 그사이 변경 없음 → 1초 뒤에도 저장된 원문 그대로(다시 쓰지 않음)", async () => {
    const saved0 = JSON.stringify({ text: "저장된 글", boardId: "pb", space: "personal" })
    real.setItem(draftKey(A, bar), saved0)
    await show("bar")
    expect(input().value).toBe("저장된 글")
    await wait(1000)
    expect(real.getItem(draftKey(A, bar))).toBe(saved0)
  })
  test("자동 저장 · 그사이 다른 탭 변경 → 쓰지 않고 안내, 불러오기 → 칸에 그 글, 그 뒤 내 편집은 저장", async () => {
    await show("bar")
    await typeInto(input(), "내 글")
    await wait(350)
    real.setItem(draftKey(A, bar), fresh)
    await typeInto(input(), "내 글 더")
    await wait(1000)
    expect(real.getItem(draftKey(A, bar))).toBe(fresh)
    expect(alertWith("다른 곳에서 바뀐 초안")).toBeTruthy()
    await clickIn(alertWith("다른 곳에서 바뀐 초안"), "불러오기")
    expect(input().value).toBe("다른 탭 새 초안")
    await typeInto(input(), "불러온 뒤 내 글")
    await wait(400)
    expect(JSON.parse(real.getItem(draftKey(A, bar)) ?? "null")?.text).toBe("불러온 뒤 내 글")
  })
  test("자동 저장 충돌 · 내 것으로 덮기(확인창) → 내 글을 저장", async () => {
    await show("bar")
    await typeInto(input(), "내 글")
    await wait(350)
    real.setItem(draftKey(A, bar), fresh)
    await typeInto(input(), "덮을 내 글")
    await wait(400)
    await confirmWith(alertWith("다른 곳에서 바뀐 초안"), "내 것으로 덮기")
    expect(JSON.parse(real.getItem(draftKey(A, bar)) ?? "null")?.text).toBe("덮을 내 글")
  })
  // 맨 끝(모델 목록 캐시가 남아 뒤 시험에 AI 를 열어 두지 않게)
  test("리뷰 4 P1-2 재현: AI 넘김 응답 직전 다른 탭이 새 초안 → 1초 뒤에도 새 초안 그대로, 다시 그린 칸에 그 글", async () => {
    state.models = true
    try {
      await show("bar")
      await wait(30)
      await typeInto(input(), "AI에게 줄 글")
      await wait(350)
      state.onRun = () => real.setItem(draftKey(A, bar), fresh)
      await click(q<HTMLButtonElement>('button[aria-label="AI로 정리해서 올리기"]')!)
      await wait(1000)
      expect(real.getItem(draftKey(A, bar))).toBe(fresh)
      await remount(); await show("bar")
      expect(input().value).toBe("다른 탭 새 초안")
    } finally { state.models = false }
  })
})

// PR #43 리뷰 5(웹): 충돌 중(사람이 고르기 전)에는 제출 뒤 비우기가 0건 — 비우기 전제는 이 화면이 디스크에 있음을 확인한 값(known)이에요
describe("리뷰 5 웹: 충돌 중 비우기·혼자 입력(PR #43 리뷰 5)", () => {
  const bar = SCREEN.bar.slot
  const input = () => q<HTMLInputElement>('input[aria-label="할 일 추가"]')!
  const fresh = JSON.stringify({ text: "다른 탭 새 초안", boardId: "pb", space: "personal" })
  const wait = async (ms: number) => { await act(async () => { await sleep(ms) }) }
  const enter = async () => { await act(async () => { input().form!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event) }); await wait(60) }
  const textOf = () => (JSON.parse(real.getItem(draftKey(A, bar)) ?? "null") as { text?: string } | null)?.text ?? null
  test("리뷰 5 P1-1 재현: 내 글 저장 → 다른 탭 변경 → 추가 입력 충돌 안내 → 제출 1건 성공 → 1초 뒤에도 다른 초안 그대로, 안내 유지", async () => {
    await show("bar")
    await typeInto(input(), "내 글")
    await wait(350)
    real.setItem(draftKey(A, bar), fresh)
    await typeInto(input(), "내 글 더")
    await wait(400)
    expect(!!alertWith("다른 곳에서 바뀐 초안")).toBe(true)
    await enter()
    await wait(1000)
    expect(saved.length).toBe(1)
    expect(real.getItem(draftKey(A, bar))).toBe(fresh)
    expect(!!alertWith("다른 곳에서 바뀐 초안")).toBe(true)
    await clickIn(alertWith("다른 곳에서 바뀐 초안"), "불러오기")
    expect(input().value).toBe("다른 탭 새 초안")
  })
  test("혼자 입력 · 빠른 연속 입력 → 마지막 글 저장, 충돌 없음", async () => {
    await show("bar")
    await typeInto(input(), "가")
    await wait(40)
    await typeInto(input(), "가나")
    await wait(40)
    await typeInto(input(), "가나다")
    await wait(500)
    expect(textOf()).toBe("가나다")
    expect(!!alertWith("다른 곳에서 바뀐 초안")).toBe(false)
  })
  test("혼자 입력 · 저장 실패 뒤 입력 → 회복되면 마지막 글 저장, 충돌 없음", async () => {
    useWrapped()
    try {
      await show("bar")
      failWrite.add(draftKey(A, bar))
      await typeInto(input(), "실패할 글")
      await wait(400)
      failWrite.clear()
      await typeInto(input(), "실패 뒤 글")
      await wait(500)
      expect(textOf()).toBe("실패 뒤 글")
      expect(!!alertWith("다른 곳에서 바뀐 초안")).toBe(false)
    } finally { useReal() }
  })
})

// PR #43 리뷰 6(웹): known 은 잘 읽거나 쓴 원문만 — 읽기 실패는 known 이 되지 않고, 전제·재검사 읽기 실패는 언제나 "다름"(쓰기 0건 + 읽기 실패 안내)
describe("리뷰 6 웹: 읽지 못한 값은 known 이 아니에요(PR #43 리뷰 6)", () => {
  const bar = SCREEN.bar.slot
  const input = () => q<HTMLInputElement>('input[aria-label="할 일 추가"]')!
  const fresh = JSON.stringify({ text: "다른 탭 새 초안 B", boardId: "pb", space: "personal" })
  const wait = async (ms: number) => { await act(async () => { await sleep(ms) }) }
  const enter = async () => { await act(async () => { input().form!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event) }); await wait(60) }
  const toConflict = async () => {
    await typeInto(input(), "내 글")
    await wait(350)
    real.setItem(draftKey(A, bar), JSON.stringify({ text: "다른 탭 X", boardId: "pb", space: "personal" }))
    await typeInto(input(), "내 글 더")
    await wait(400)
    expect(!!alertWith("다른 곳에서 바뀐 초안")).toBe(true)
  }
  test("리뷰 6 재현(중간 실패 × 제출 뒤 비우기): 제출 뒤 비우기 때 읽기 실패 → 읽기가 계속 실패하는 동안 다른 탭이 B → 새 입력 자동 저장이 B 를 덮지 않음 + 읽기 실패 안내", async () => {
    useWrapped()
    try {
      await show("bar")
      await typeInto(input(), "보낼 글")
      await wait(350)
      state.onSave = () => failRead.add(draftKey(A, bar))
      await enter()
      await wait(100)
      real.setItem(draftKey(A, bar), fresh)
      await typeInto(input(), "다음 글")
      await wait(500)
      expect(saved.length).toBe(1)
      expect(real.getItem(draftKey(A, bar))).toBe(fresh)
      expect(!!alertWith("읽지 못해")).toBe(true)
      failRead.clear()
      await typeInto(input(), "다음 글 더")
      await wait(500)
      expect(real.getItem(draftKey(A, bar))).toBe(fresh)
      expect(!!alertWith("다른 곳에서 바뀐 초안")).toBe(true)
    } finally { useReal() }
  })
  test("중간 실패 × 자동 저장(불러오기): 충돌 → 불러오기 때 읽기 실패 → 그사이 B → 새 입력이 B 를 덮지 않음, 충돌 안내 유지", async () => {
    useWrapped()
    try {
      await show("bar")
      await toConflict()
      failRead.add(draftKey(A, bar))
      await clickIn(alertWith("다른 곳에서 바뀐 초안"), "불러오기")
      real.setItem(draftKey(A, bar), fresh)
      await typeInto(input(), "새 글")
      await wait(500)
      expect(real.getItem(draftKey(A, bar))).toBe(fresh)
      expect(!!alertWith("읽지 못해")).toBe(true)
      failRead.clear()
      await typeInto(input(), "새 글 더")
      await wait(500)
      expect(real.getItem(draftKey(A, bar))).toBe(fresh)
    } finally { useReal() }
  })
  test("중간 실패 × 내 것으로 덮기: 덮기 때 읽기 실패면 쓰지 않음", async () => {
    useWrapped()
    try {
      await show("bar")
      await toConflict()
      failRead.add(draftKey(A, bar))
      real.setItem(draftKey(A, bar), fresh)
      await confirmWith(alertWith("다른 곳에서 바뀐 초안"), "내 것으로 덮기")
      await wait(400)
      expect(real.getItem(draftKey(A, bar))).toBe(fresh)
    } finally { useReal() }
  })
  test("계속 실패 × 제출 뒤 비우기: 처음부터 계속 읽기 실패면 비우지 않음(0건)", async () => {
    useWrapped()
    try {
      await show("bar")
      await typeInto(input(), "보낼 글")
      await wait(350)
      const mine = real.getItem(draftKey(A, bar))
      failRead.add(draftKey(A, bar))
      await enter()
      await wait(500)
      expect(saved.length).toBe(1)
      expect(real.getItem(draftKey(A, bar))).toBe(mine)
    } finally { useReal() }
  })
  test("처음 읽기 실패: 입력 막힘·쓰기 0건·다시 읽기 안내(규칙 E 그대로)", async () => {
    useWrapped()
    try {
      real.setItem(draftKey(A, bar), JSON.stringify({ text: "저장된 A", boardId: "pb", space: "personal" }))
      failRead.add(draftKey(A, bar))
      await show("bar")
      await wait(400)
      expect(input().disabled || !!input().closest("fieldset[disabled]")).toBe(true)
      expect(JSON.parse(real.getItem(draftKey(A, bar)) ?? "null")?.text).toBe("저장된 A")
    } finally { useReal() }
  })
})

// PR #43 리뷰 7(웹): known 을 처음 잡거나 다시 잡는 모든 경로(첫 그림·읽기 실패 뒤 복구·다시 그림)에서 화면이 복원한 값과 읽은 값을 비교 —
// 다르면 known 은 읽은 값으로 두되 충돌(자동 저장·비우기 0건, 불러오기/덮기 안내)
describe("리뷰 7 웹: 늦게 읽은 known 이 화면 값과 다르면 충돌(PR #43 리뷰 7)", () => {
  const bar = SCREEN.bar.slot
  const input = () => q<HTMLInputElement>('input[aria-label="할 일 추가"]')!
  const wait = async (ms: number) => { await act(async () => { await sleep(ms) }) }
  const enter = async () => { await act(async () => { input().form!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event) }); await wait(60) }
  const Akey = JSON.stringify({ text: "복원한 A", boardId: "pb", space: "personal" })
  const B = JSON.stringify({ text: "다른 탭 B", boardId: "pb", space: "personal" })
  /** n 번째 읽기에 일을 해요(그 자리 초안 키) */
  const onNthRead = (nth: number, fn: () => void) => { let n = 0; onGet = (k) => { if (k === draftKey(A, bar) && ++n === nth) fn() } }
  test("리뷰 7 재현: 복원 A → known 읽기 실패 → 저장소 B → 읽기 복구 뒤 다시 그림 → A 편집 저장이 B 를 덮지 않고 충돌", async () => {
    useWrapped()
    try {
      real.setItem(draftKey(A, bar), Akey)
      onNthRead(2, () => failRead.add(draftKey(A, bar)))
      await show("bar")
      expect(input().value).toBe("복원한 A")
      real.setItem(draftKey(A, bar), B)
      failRead.clear()
      await typeInto(input(), "복원한 A 고침")
      await wait(500)
      expect(real.getItem(draftKey(A, bar))).toBe(B)
      expect(!!alertWith("다른 곳에서 바뀐 초안")).toBe(true)
    } finally { useReal() }
  })
  test("리뷰 7 재현: 같은 전제에서 다시 그린 뒤(입력) 곧바로 제출 → 비우기가 B 를 null 로 만들지 않음", async () => {
    useWrapped()
    try {
      real.setItem(draftKey(A, bar), Akey)
      onNthRead(2, () => failRead.add(draftKey(A, bar)))
      await show("bar")
      real.setItem(draftKey(A, bar), B)
      failRead.clear()
      await typeInto(input(), "복원한 A 고침")
      await enter()
      await wait(500)
      expect(saved.length).toBe(1)
      expect(real.getItem(draftKey(A, bar))).toBe(B)
    } finally { useReal() }
  })
  test("첫 두 읽기 사이 변경(복원 A 를 읽은 뒤 known 읽기 전에 B) → 편집 저장이 B 를 덮지 않음", async () => {
    useWrapped()
    try {
      real.setItem(draftKey(A, bar), Akey)
      onNthRead(2, () => real.setItem(draftKey(A, bar), B))
      await show("bar")
      expect(input().value).toBe("복원한 A")
      await typeInto(input(), "복원한 A 고침")
      await wait(500)
      expect(real.getItem(draftKey(A, bar))).toBe(B)
      expect(!!alertWith("다른 곳에서 바뀐 초안")).toBe(true)
    } finally { useReal() }
  })
  test("정상: 복원 A 그대로 → 편집 저장 됨(충돌 없음)", async () => {
    useWrapped()
    try {
      real.setItem(draftKey(A, bar), Akey)
      await show("bar")
      await typeInto(input(), "복원한 A 고침")
      await wait(500)
      expect(JSON.parse(real.getItem(draftKey(A, bar)) ?? "null")?.text).toBe("복원한 A 고침")
      expect(!!alertWith("다른 곳에서 바뀐 초안")).toBe(false)
    } finally { useReal() }
  })
})
