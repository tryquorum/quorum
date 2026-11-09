// 웹 빠른 추가 세 화면(한 줄·상세 시트·목표 할 일)의 범위 전환·복원·공간 변경 동작 시험(PR #39 리뷰 19). 하네스는 __tests__/quickAddHarness.ts.
import { afterEach, describe, expect, test } from "bun:test"
import { useQuickAddHarness, openSheet, state, win, act, sleep, q, typeInto, click, buttonByText, render, handle, saved, allUnder, editsText, A, B, slotFor, stallTimer, CAPTURE_STORE, draftKey, editKey, recordKey, slotKey, writeEdit } from "./__tests__/quickAddHarness"

useQuickAddHarness()

describe("웹 한 줄: 범위 전환·복원(리뷰 18·19)", () => {
  test("A 에서 쓰던 한 줄 → 범위 B 면 빈 칸, A 초안은 A 키에 보존 → A 로 돌아오면 복원", async () => {
    await render(A)
    await typeInto(q<HTMLInputElement>('input[aria-label="할 일 추가"]')!, "A 가 쓰던 한 줄")
    await render(B)
    expect(q<HTMLInputElement>('input[aria-label="할 일 추가"]')!.value).toBe("")
    expect(editsText(A)).toContain("A 가 쓰던 한 줄")
    expect(editsText(B)).not.toContain("A 가 쓰던 한 줄")
    await render(A)
    expect(q<HTMLInputElement>('input[aria-label="할 일 추가"]')!.value).toBe("A 가 쓰던 한 줄")
  })
  test("범위가 null 로 먼저 그려지면 입력 막힘 → 범위가 오면 저장된 초안을 읽고 덮지 않아요", async () => {
    writeEdit(localStorage, A, slotFor("bar", { boardId: "pb", space: "personal" }), { text: "저장된 글", boardId: "pb", space: "personal" })
    await render(null)
    expect(q<HTMLInputElement>('input[aria-label="할 일 추가"]')!.disabled).toBe(true)
    await render(A)
    expect(q<HTMLInputElement>('input[aria-label="할 일 추가"]')!.value).toBe("저장된 글")
    await act(async () => { await sleep(350) })
    expect(editsText(A)).toContain("저장된 글")
  })
})

describe("웹 상세 시트: 범위 전환·공간 변경(리뷰 19)", () => {
  test("A 에서 한 줄 글로 연 시트 → 범위 B 로 바뀌면 다시 그린 시트에 A 글·연 쪽 콜백을 넘기지 않아요(A 글은 A 범위 초안에)", async () => {
    let created = 0
    await render(A)
    await act(async () => { handle.current!.open("A 의 한 줄", null, () => { created++ }) })
    await act(async () => { await sleep(30) })
    expect(q<HTMLInputElement>('input[aria-label="제목"]')!.value).toBe("A 의 한 줄")
    await act(async () => { await sleep(350) })
    await render(B)
    expect(q<HTMLInputElement>('input[aria-label="제목"]')!.value).toBe("")
    expect(created).toBe(0)
    expect(editsText(A)).toContain("A 의 한 줄")
  })
  test("범위가 null 이면 시트 입력이 막혀요", async () => {
    await render(null)
    await act(async () => { handle.current!.open("", null) })
    await act(async () => { await sleep(30) })
    const title = q<HTMLInputElement>('input[aria-label="제목"]')!
    expect(title.closest("fieldset")?.disabled).toBe(true)
  })
  test("복원한 개인 초안에서 회사 공간을 고르면 판도 회사 판(새 시트와 같은 규칙)으로 저장", async () => {
    writeEdit(localStorage, A, slotFor("sheet", { boardId: "pb", goalId: null, space: "personal" }), { text: "개인 초안", boardId: "pb", space: "personal", kind: "todo", note: "", tags: [], props: [] })
    await render(A)
    await act(async () => { handle.current!.open("", null) })
    await act(async () => { await sleep(30) })
    expect(q<HTMLInputElement>('input[aria-label="제목"]')!.value).toBe("개인 초안")
    await click([...document.querySelectorAll('[aria-label="공간"] button')].find((b) => b.textContent === "회사")!)
    await click(buttonByText("추가")!)
    await act(async () => { await sleep(50) })
    expect(saved.map((it) => [it.boardId, it.space, it.text])).toEqual([["cb", "ws_1", "개인 초안"]])
  })
})

describe("웹 목표 할 일: 범위 전환(리뷰 18)", () => {
  test("A 에서 쓰던 목표 할 일 → 범위 B 면 빈 칸 → A 로 돌아오면 복원", async () => {
    await render(A, true)
    await typeInto(q<HTMLInputElement>('input[aria-label="이 목표의 할 일 추가"]')!, "목표에 붙일 글")
    await render(B, true)
    expect(q<HTMLInputElement>('input[aria-label="이 목표의 할 일 추가"]')!.value).toBe("")
    await render(A, true)
    expect(q<HTMLInputElement>('input[aria-label="이 목표의 할 일 추가"]')!.value).toBe("목표에 붙일 글")
  })
})

const spaceChip = (name: string) => [...document.querySelectorAll('[aria-label="공간"] button')].find((b) => b.textContent === name) as HTMLButtonElement
const slots = () => allUnder(slotKey(A)) as Record<string, { id: string; draft: { boardId: string; space?: string } }>
const edits = () => allUnder(editKey(A)) as Record<string, { text: string }>
const PERSONAL = slotFor("sheet", { boardId: "pb", goalId: null, space: "personal" })
const COMPANY = slotFor("sheet", { boardId: "cb", goalId: null, space: "ws_1" })

describe("웹 상세 시트: 자리는 지금 고른 대상에서(리뷰 20)", () => {
  test("공간 변경 → 결과 불명 → 닫기 → 회사 공간에서 다시 열기: 기록·확인이 보이고 새 제출은 막혀 같은 일 2건 0", async () => {
    state.saveResult = "unknown"
    await render(A)
    await openSheet()
    await typeInto(q<HTMLInputElement>('input[aria-label="제목"]')!, "회사 일")
    await click(spaceChip("회사"))
    await click(buttonByText("추가")!)
    await act(async () => { await sleep(50) })
    expect(Object.keys(slots())).toEqual([COMPANY])
    expect(slots()[COMPANY]!.draft).toMatchObject({ boardId: "cb", space: "ws_1" })
    // 기록이 있는 동안은 공간을 바꿀 수 없어요
    expect(spaceChip("개인").disabled).toBe(true)
    await click(buttonByText("닫기(기록 남김)")!)
    state.saveResult = true
    await render(A, false, "ws_1")
    await openSheet()
    expect(q<HTMLInputElement>('input[aria-label="제목"]')!.value).toBe("회사 일")
    expect(document.body.textContent).toContain("저장 결과를 확인하지 못했어요")
    await click(buttonByText("확인")!)
    await act(async () => { await sleep(50) })
    expect(saved.length).toBe(1)
  })
  test("기록 없이 쓰던 초안은 공간을 바꾸면 새 자리로 옮기고 옛 자리는 비워요", async () => {
    await render(A)
    await openSheet()
    await typeInto(q<HTMLInputElement>('input[aria-label="제목"]')!, "옮길 초안")
    await act(async () => { await sleep(350) })
    expect(edits()[PERSONAL]?.text).toBe("옮길 초안")
    await click(spaceChip("회사"))
    await act(async () => { await sleep(350) })
    expect(edits()[PERSONAL]).toBeUndefined()
    expect(edits()[COMPANY]?.text).toBe("옮길 초안")
  })
  test("새 자리에 이미 초안이 있으면 덮지 않고 멈춰요(\"그 공간에 쓰던 초안이 있어요\")", async () => {
    writeEdit(localStorage, A, COMPANY, { text: "회사에 쓰던 초안", boardId: "cb", space: "ws_1" })
    await render(A)
    await openSheet()
    await typeInto(q<HTMLInputElement>('input[aria-label="제목"]')!, "개인 초안")
    await click(spaceChip("회사"))
    await act(async () => { await sleep(350) })
    expect(document.body.textContent).toContain("그 공간에 쓰던 초안이 있어요")
    expect(spaceChip("개인").getAttribute("aria-pressed")).toBe("true")
    expect(edits()[COMPANY]?.text).toBe("회사에 쓰던 초안")
    expect(edits()[PERSONAL]?.text).toBe("개인 초안")
  })
  test("초안을 새 자리에 저장하지 못하면 공간을 바꾸지 않고 옛 자리 초안도 그대로", async () => {
    await render(A)
    await openSheet()
    await typeInto(q<HTMLInputElement>('input[aria-label="제목"]')!, "못 옮긴 초안")
    await act(async () => { await sleep(350) })
    // 저장 실패를 흉내 내요: 화면이 쓰는 window.localStorage 를 편집 초안 키 쓰기만 실패하는 감싸개로 잠깐 바꿔요
    const real = localStorage
    const failing = { getItem: (k: string) => real.getItem(k), removeItem: (k: string) => real.removeItem(k), setItem: (k: string, v: string) => { if (k.startsWith(editKey(A))) throw new Error("quota"); real.setItem(k, v) } }
    Object.defineProperty(win, "localStorage", { value: failing, configurable: true })
    try {
      await click(spaceChip("회사"))
    } finally {
      Object.defineProperty(win, "localStorage", { value: real, configurable: true })
    }
    expect(document.body.textContent).toContain("쓰던 초안을 그 공간으로 옮기지 못했어요")
    expect(spaceChip("개인").getAttribute("aria-pressed")).toBe("true")
    expect(edits()[PERSONAL]?.text).toBe("못 옮긴 초안")
    expect(edits()[COMPANY]).toBeUndefined()
  })
  test("개인 공간에서 다시 연 시트가 회사로 바꾸려 하면 회사 자리의 남은 기록을 덮지 않고 알려요 → 그 기록으로 가면 확인만(새 일 0)", async () => {
    state.saveResult = "unknown"
    await render(A)
    await openSheet()
    await typeInto(q<HTMLInputElement>('input[aria-label="제목"]')!, "회사 일")
    await click(spaceChip("회사"))
    await click(buttonByText("추가")!)
    await act(async () => { await sleep(50) })
    await click(buttonByText("닫기(기록 남김)")!)
    state.saveResult = true
    // 부모 화면은 여전히 개인 공간 — 개인 자리는 비어 있어요
    await openSheet()
    expect(q<HTMLInputElement>('input[aria-label="제목"]')!.value).toBe("")
    await typeInto(q<HTMLInputElement>('input[aria-label="제목"]')!, "회사 일")
    await click(spaceChip("회사"))
    expect(document.body.textContent).toContain("그 공간에 남은 추가 기록이 있어요")
    expect(spaceChip("개인").getAttribute("aria-pressed")).toBe("true")
    await click(buttonByText("그 초안으로 가기")!)
    await act(async () => { await sleep(30) })
    expect(document.body.textContent).toContain("저장 결과를 확인하지 못했어요")
    expect(buttonByText("추가")).toBeFalsy()
    await click(buttonByText("확인")!)
    await act(async () => { await sleep(50) })
    expect(saved.length).toBe(1)
    expect(Object.keys(slots())).toEqual([])
  })
})

// PR #39 리뷰 21: 규칙 C "입력 가능 = 준비 완료", 규칙 D "저장 실패면 화면 상태를 바꾸지 않음"
// 저장 실패 흉내: 화면이 쓰는 window.localStorage 를 편집 초안 키 쓰기만 실패하는 감싸개로 바꿔요(다음 그림부터 그 저장소를 써요)
const realStorage = localStorage
const failEdits = () => Object.defineProperty(win, "localStorage", { configurable: true, value: { getItem: (k: string) => realStorage.getItem(k), removeItem: (k: string) => realStorage.removeItem(k), clear: () => realStorage.clear(), setItem: (k: string, v: string) => { if (k.startsWith(editKey(A))) throw new Error("quota"); realStorage.setItem(k, v) } } })
const healEdits = () => Object.defineProperty(win, "localStorage", { configurable: true, value: realStorage })
const SAVE_FAILED_TEXT = "기기에 저장하지 못했어요"

describe("규칙 D: 저장 실패면 화면 상태를 바꾸지 않음(리뷰 21)", () => {
  test("리뷰 21 P1-1 재현: 개인 초안을 고친 직후 초안 있는 회사 공간 → '그 초안으로 가기' 때 저장 실패 → 가지 않고 방금 쓴 글 그대로, 다시 저장하면 남아요", async () => {
    writeEdit(localStorage, A, COMPANY, { text: "회사에 쓰던 초안", boardId: "cb", space: "ws_1" })
    await render(A)
    await openSheet()
    await typeInto(q<HTMLInputElement>('input[aria-label="제목"]')!, "개인 초안")
    await act(async () => { await sleep(350) })
    failEdits()
    try {
      await typeInto(q<HTMLInputElement>('input[aria-label="제목"]')!, "개인 초안 방금 고침")
      await click(spaceChip("회사"))
      expect(document.body.textContent).toContain("그 공간에 쓰던 초안이 있어요")
      await click(buttonByText("그 초안으로 가기")!)
      expect(q<HTMLInputElement>('input[aria-label="제목"]')!.value).toBe("개인 초안 방금 고침")
      expect(spaceChip("개인").getAttribute("aria-pressed")).toBe("true")
      expect(document.body.textContent).toContain(SAVE_FAILED_TEXT)
    } finally {
      healEdits()
    }
    await click(buttonByText("다시 저장")!)
    expect(edits()[PERSONAL]?.text).toBe("개인 초안 방금 고침")
    expect(edits()[COMPANY]?.text).toBe("회사에 쓰던 초안")
  })
  test("시트: 저장하지 못하면 닫지 않아요(취소·Esc) — 칸 그대로·안내, 저장되면 닫혀요", async () => {
    await render(A)
    await openSheet()
    failEdits()
    try {
      await typeInto(q<HTMLInputElement>('input[aria-label="제목"]')!, "닫기 전 글")
      await click(buttonByText("취소")!)
      expect(q<HTMLInputElement>('input[aria-label="제목"]')?.value).toBe("닫기 전 글")
      expect(document.body.textContent).toContain(SAVE_FAILED_TEXT)
      expect(document.body.textContent).toContain("닫지 않았어요")
    } finally {
      healEdits()
    }
    await typeInto(q<HTMLInputElement>('input[aria-label="제목"]')!, "닫기 전 글!")
    await click(buttonByText("취소")!)
    await act(async () => { await sleep(30) })
    expect(edits()[PERSONAL]?.text).toBe("닫기 전 글!")
  })
  test("한 줄: 저장 실패를 알리고 밀린 글을 버리지 않아요, 저장되기 전에는 상세 시트로 옮기지 않아요", async () => {
    await render(A)
    failEdits()
    try {
      await typeInto(q<HTMLInputElement>('input[aria-label="할 일 추가"]')!, "한 줄 글")
      await act(async () => { await sleep(350) })
      expect(document.body.textContent).toContain(SAVE_FAILED_TEXT)
      await click(q<HTMLButtonElement>('button[aria-label="자세히 추가"]')!)
      await act(async () => { await sleep(30) })
      expect(q('input[aria-label="제목"]')).toBeNull()
      expect(q<HTMLInputElement>('input[aria-label="할 일 추가"]')!.value).toBe("한 줄 글")
    } finally {
      healEdits()
    }
    await click(buttonByText("다시 저장")!)
    expect(editsText(A)).toContain("한 줄 글")
    expect(document.body.textContent).not.toContain(SAVE_FAILED_TEXT)
  })
  test("목표 할 일: 저장 실패를 알리고 상세 시트로 옮기지 않아요", async () => {
    await render(A, true)
    failEdits()
    try {
      await typeInto(q<HTMLInputElement>('input[aria-label="이 목표의 할 일 추가"]')!, "목표 글")
      await act(async () => { await sleep(350) })
      expect(document.body.textContent).toContain(SAVE_FAILED_TEXT)
      await click(q<HTMLButtonElement>('button[aria-label="목표 할 일 자세히 추가"]')!)
      await act(async () => { await sleep(30) })
      expect(q('input[aria-label="제목"]')).toBeNull()
    } finally {
      healEdits()
    }
    await click(buttonByText("다시 저장")!)
    expect(editsText(A)).toContain("목표 글")
  })
})


// PR #39 리뷰 22: 규칙 E "읽기 실패 ≠ 빈 값" — 저장 기본 요소 × 고장 × 화면 표(014_write_inventory.md 리뷰 22 절)의 웹 칸.
// 저장소 고장 흉내: 키마다 읽기 실패(getItem 이 던짐)·쓰기 실패(setItem 이 던짐). 깨짐은 저장소에 깨진 JSON 을 둬요. 웹 localStorage 는 바로 읽혀 "늦음" 칸은 없어요
const faults = { read: new Set<string>(), write: new Set<string>() }
const faulty = {
  getItem: (k: string) => { if (faults.read.has(k)) throw new Error("denied"); return realStorage.getItem(k) },
  setItem: (k: string, v: string) => { if (faults.write.has(k)) throw new Error("quota"); realStorage.setItem(k, v) },
  removeItem: (k: string) => realStorage.removeItem(k),
  clear: () => realStorage.clear(),
}
const breakStore = () => Object.defineProperty(win, "localStorage", { configurable: true, value: faulty })
const heal = () => { faults.read.clear(); faults.write.clear() }
const BAR_SLOT = slotFor("bar", { boardId: "pb", space: "personal" })
const GOAL_SLOT = slotFor("goal", { boardId: "pb", goalId: "g1" })
type ScreenName = "bar" | "sheet" | "goal"
const SCREEN: Record<ScreenName, { slot: string; input: string; draft: Record<string, unknown> }> = {
  bar: { slot: BAR_SLOT, input: 'input[aria-label="할 일 추가"]', draft: { boardId: "pb", space: "personal" } },
  sheet: { slot: PERSONAL, input: 'input[aria-label="제목"]', draft: { boardId: "pb", space: "personal" } },
  goal: { slot: GOAL_SLOT, input: 'input[aria-label="이 목표의 할 일 추가"]', draft: { boardId: "pb", goalId: "g1", space: "personal" } },
}
const show = async (s: ScreenName) => { await render(A, s === "goal"); if (s === "sheet") await openSheet() }
const W = win as unknown as { confirm: () => boolean }
// 시트가 열려 있으면 시트 안의 안내만(뒤의 한 줄도 같은 저장소 안내를 보여요)
const alertWith = (t: string) => [...(document.querySelector('[role="dialog"]') ?? document).querySelectorAll('[role="alert"]')].find((p) => (p.textContent ?? "").includes(t)) as HTMLElement | undefined
const clickIn = async (box: HTMLElement | undefined, label: string) => { const b = [...(box?.querySelectorAll("button") ?? [])].find((x) => (x.textContent ?? "").trim() === label); expect(b).toBeTruthy(); await click(b!) }
const blocked = (s: ScreenName) => { const el = q<HTMLInputElement>(SCREEN[s].input); return s === "sheet" ? el === null : !!el?.disabled }
// 그 자리의 키에 심고 그 키를 돌려줘요(자리마다 키 하나 — PR #43 리뷰)
const seed = (prim: "records" | "edits", s: ScreenName) => {
  const key = prim === "records" ? recordKey(A, SCREEN[s].slot) : draftKey(A, SCREEN[s].slot)
  if (prim === "records") localStorage.setItem(key, JSON.stringify({ id: "rec1", from: "item", text: "남은 기록 글", ref: null, scope: A, draft: { kind: "todo", title: "남은 기록 글", at: null, areaId: null, tags: [], note: "", props: [], ...SCREEN[s].draft } }))
  else localStorage.setItem(key, JSON.stringify(s === "goal" ? { text: "쓰던 글", boardId: "pb", goalId: "g1" } : { text: "쓰던 글", ...SCREEN[s].draft }))
  return key
}
const WHAT = { records: "복구 기록", edits: "쓰던 초안" } as const
const RESTORED = { records: "남은 기록 글", edits: "쓰던 글" } as const

describe("규칙 E 웹: 기록·쓰던 초안 × 읽기 실패·깨짐·복구됨 × 한 줄·시트·목표(리뷰 22)", () => {
  afterEach(() => { heal(); healEdits() })
  for (const prim of ["records", "edits"] as const)
    for (const s of ["bar", "sheet", "goal"] as const) {
      test(prim + " · 읽기 실패 → 입력·자동 저장·자동 삭제 없음 + 안내 → 저장소 복구 뒤에도 다시 읽기 전에는 그대로 → 다시 읽기 → 복원 · " + s, async () => {
        const key = seed(prim, s)
        const raw = localStorage.getItem(key)
        breakStore()
        faults.read.add(key)
        await show(s)
        expect(blocked(s)).toBe(true)
        expect(alertWith(WHAT[prim])?.textContent).toContain("읽지 못했어요")
        heal() // 사람 손 없이 저장소가 돌아와도(리뷰 22 P1-1) 지우지도 쓰지도 않아요
        await act(async () => { await sleep(450) })
        expect(realStorage.getItem(key)).toBe(raw)
        expect(blocked(s)).toBe(true)
        await clickIn(alertWith(WHAT[prim]), "다시 읽기")
        expect(blocked(s)).toBe(false)
        expect(q<HTMLInputElement>(SCREEN[s].input)!.value).toBe(RESTORED[prim])
        await act(async () => { await sleep(450) })
        expect(realStorage.getItem(key)).toBe(raw)
      })
      test(prim + " · 깨짐 → 막고 안내, 버리고 새로(확인창)만 비워요 · " + s, async () => {
        const key = seed(prim, s)
        localStorage.setItem(key, "{깨짐")
        await show(s)
        expect(blocked(s)).toBe(true)
        expect(alertWith(WHAT[prim])?.textContent).toContain("깨져")
        await act(async () => { await sleep(450) })
        expect(localStorage.getItem(key)).toBe("{깨짐")
        const prev = W.confirm
        W.confirm = () => true
        try { await clickIn(alertWith(WHAT[prim]), "버리고 새로") } finally { W.confirm = prev }
        expect(localStorage.getItem(key)).toBe("null")
        expect(blocked(s)).toBe(false)
      })
    }
  for (const s of ["bar", "sheet", "goal"] as const)
    test("기록 · 쓰기 실패 → 보내지 않고(같은 일 0건) 칸 그대로 · " + s, async () => {
      breakStore()
      faults.write.add(recordKey(A, SCREEN[s].slot))
      await show(s)
      await typeInto(q<HTMLInputElement>(SCREEN[s].input)!, "쓰기 실패 글")
      if (s === "bar") await act(async () => { q<HTMLInputElement>(SCREEN[s].input)!.form!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event) })
      else if (s === "goal") await click(buttonByText("추가")!)
      else await click([...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-keyshortcuts") === "Meta+Enter Control+Enter")!)
      await act(async () => { await sleep(50) })
      expect(saved.length).toBe(0)
      expect(q<HTMLInputElement>(SCREEN[s].input)!.value).toBe("쓰기 실패 글")
    })
})

describe("규칙 E 웹: AI 정리 칩 × 읽기 실패·깨짐·복구됨·쓰기 실패(리뷰 22)", () => {
  afterEach(() => { heal(); healEdits() })
  const chip = { id: "run1", clientKey: "k1", text: "칩 글", draft: null, startedAt: 1 }
  test("읽기 실패 → 안내, 빈 목록으로 덮지 않음 → 저장소 복구 뒤 다시 읽기 → 안내 사라짐·목록 그대로", async () => {
    localStorage.setItem(CAPTURE_STORE, JSON.stringify([chip]))
    breakStore()
    faults.read.add(CAPTURE_STORE)
    await render(A)
    expect(alertWith("AI 정리 칩")?.textContent).toContain("읽지 못했어요")
    heal()
    await act(async () => { await sleep(100) })
    expect(realStorage.getItem(CAPTURE_STORE)).toBe(JSON.stringify([chip]))
    await clickIn(alertWith("AI 정리 칩"), "다시 읽기")
    expect(alertWith("AI 정리 칩")).toBeUndefined()
    expect(realStorage.getItem(CAPTURE_STORE)).toBe(JSON.stringify([chip]))
  })
  test("깨짐 → 안내·그대로, 버리고 새로(확인창)만 비워요", async () => {
    localStorage.setItem(CAPTURE_STORE, "[{\"id\":1}]")
    await render(A)
    expect(alertWith("AI 정리 칩")?.textContent).toContain("깨져")
    await act(async () => { await sleep(100) })
    expect(localStorage.getItem(CAPTURE_STORE)).toBe("[{\"id\":1}]")
    const prev = W.confirm
    W.confirm = () => true
    try { await clickIn(alertWith("AI 정리 칩"), "버리고 새로") } finally { W.confirm = prev }
    expect(localStorage.getItem(CAPTURE_STORE)).toBe("[]")
    expect(alertWith("AI 정리 칩")).toBeUndefined()
  })
  test("쓰기 실패 → 안내(이 탭에서는 보임) → 다시 저장으로 같은 목록을 써요", async () => {
    localStorage.setItem(CAPTURE_STORE, JSON.stringify([chip]))
    state.runDone = true
    await render(A)
    await act(async () => { await sleep(50) })
    breakStore()
    faults.write.add(CAPTURE_STORE)
    await click(q<HTMLButtonElement>('section[aria-label^="AI 정리"] button[aria-label="닫기"]')!)
    expect(alertWith("AI 정리 칩을 기기에 남기지 못했어요")).toBeTruthy()
    expect(realStorage.getItem(CAPTURE_STORE)).toBe(JSON.stringify([chip]))
    heal()
    await clickIn(alertWith("AI 정리 칩을 기기에 남기지 못했어요"), "다시 저장")
    expect(JSON.parse(realStorage.getItem(CAPTURE_STORE) ?? "[]")[0]?.dismissed).toBe(true)
    expect(alertWith("AI 정리 칩을 기기에 남기지 못했어요")).toBeUndefined()
  })
})

describe("리뷰 22 P2 웹: 준비 신호가 늦으면 원인 안내와 다시 시도", () => {
  for (const s of ["bar", "sheet", "goal"] as const)
    test("범위(로그인)가 오지 않으면 " + s + " 에 \"로그인 정보를 아직 받지 못했어요\" + 다시 시도", async () => {
      stallTimer.ms = 60
      state.retries = 0
      try {
        await render(null, s === "goal")
        if (s === "sheet") await openSheet()
        expect(alertWith("로그인 정보를 아직 받지 못했어요")).toBeUndefined()
        await act(async () => { await sleep(120) })
        await clickIn(alertWith("로그인 정보를 아직 받지 못했어요"), "다시 시도")
        expect(state.retries).toBe(1)
      } finally {
        stallTimer.ms = 8000
      }
    })
})
