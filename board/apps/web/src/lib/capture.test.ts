import { describe, expect, test } from "bun:test"
import type { CaptureEffect } from "@direction-board/contracts"
import { activeSame, captureHints, captureText, failureText, hiddenFailures, lastFinishedRun, lastLine, openDecideCount, phaseOf, readCaptures, saveCaptures, summarize, visibleEntries, CAPTURE_STORE, type CaptureEntry } from "./capture"

const areas = [{ id: "a1", name: "업무", color: "#0a0" }]
const entry = (p: Partial<CaptureEntry>): CaptureEntry => ({ id: "r1", clientKey: "k", text: "겜스고 연장", draft: null, startedAt: 1, ...p })
const eff = (p: Partial<CaptureEffect>): CaptureEffect => ({ ref: "item:b:i", op: "created", title: "t", at: 1, run: "r1", undone: false, undoable: true, now: null, ...p })
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, m } }

describe("capture helpers", () => {
  test("text joins title and note; hints carry area name, date, tags, goal and filled typed props", () => {
    expect(captureText(" 겜스고 연장 ", "\n메일 확인\n")).toBe("겜스고 연장\n\n메일 확인")
    expect(captureText("제목만", "  ")).toBe("제목만")
    expect(captureHints({ kind: "goal", at: "2026-11-10T09:00", areaId: "a1", tags: ["구독"], props: [{ key: "금액", type: "number", value: "9900" }, { key: "", type: "text", value: "x" }] }, areas))
      .toEqual({ area: "업무", at: "2026-11-10", tags: ["구독"], type: "goal", props: [{ key: "금액", type: "number", value: "9900" }] })
    expect(captureHints({ kind: "todo", at: null, areaId: "gone", tags: [], props: [] }, areas)).toBeUndefined()
  })
  test("same running text is found after normalization; finished or dismissed ones are not", () => {
    const list = [entry({ id: "r1" }), entry({ id: "r2", text: "다른 글" })]
    expect(activeSame(list, {}, " 겜스고, 연장! ")?.id).toBe("r1")
    expect(activeSame(list, { r1: "done" }, "겜스고 연장")).toBeNull()
    expect(activeSame([entry({ dismissed: true })], {}, "겜스고 연장")).toBeNull()
    expect(activeSame(list, {}, "!!")).toBeNull()
  })
  test("phase, summary and failure text", () => {
    expect([phaseOf(null), phaseOf({ status: "running" }), phaseOf({ status: "done" }), phaseOf({ status: "stopped" })]).toEqual(["running", "running", "done", "failed"])
    expect(summarize([eff({}), eff({ ref: "x", op: "merged" }), eff({ ref: "y", op: "decision" }), eff({ ref: "z", undone: true })])).toBe("AI가 올렸어요 · 새로 1개 · 기존 일 1개에 추가 · 결정 1개")
    expect(summarize([])).toBe("AI가 올린 항목이 없어요")
    expect(failureText({ status: "error", error_kind: "rate_limit" })).toBe("사용 한도에 걸렸어요")
    expect(failureText({ status: "stopped", error_kind: null })).toBe("멈췄어요")
    expect(failureText({ status: "error", error_kind: null })).toBe("AI가 정리하지 못했어요")
  })
  // 규칙 E(리뷰 22): 읽기 실패·깨짐은 "칩 없음"이 아니에요 — 걸러 내지 않고 깨짐으로 알려요(걸러 낸 목록을 저장하면 결과를 모르는 칩이 사라져요)
  test("storage: 읽기 실패는 read, 깨진 JSON·칩 모양이 아닌 항목이 하나라도 있으면 corrupt, 없음은 빈 목록", () => {
    const s = mem()
    expect(readCaptures(s)).toEqual({ ok: true, entries: [] })
    s.m.set(CAPTURE_STORE, "{broken")
    expect(readCaptures(s)).toEqual({ ok: false, problem: "corrupt" })
    s.m.set(CAPTURE_STORE, JSON.stringify([{ id: 1 }, entry({})]))
    expect(readCaptures(s)).toEqual({ ok: false, problem: "corrupt" })
    expect(readCaptures({ getItem: () => { throw new Error("denied") }, setItem: () => {} })).toEqual({ ok: false, problem: "read" })
    expect(saveCaptures(s, Array.from({ length: 12 }, (_, i) => entry({ id: `r${i}` })))).toBe(true)
    const r = readCaptures(s)
    expect(r.ok && r.entries.map((e) => e.id)).toEqual(Array.from({ length: 10 }, (_, i) => `r${i + 2}`))
    expect(saveCaptures({ getItem: () => null, setItem: () => { throw new Error("full") } }, [entry({})])).toBe(false)
  })
})

describe("실패를 두 곳에 띄우지 않기", () => {
  const sig = (id: string, ref: string, kind = "error") => ({ id, ref, kind })
  const failed = (id: string, thread: string | null = null) => ({ run: { id, thread, status: "error" as const } })
  test("트레이에 보이는 실패가 그 대화의 마지막 끝난 실행이면 결정 칸 사건을 숨겨요", () => {
    expect([...hiddenFailures([sig("s1", "run:r1")], [failed("r1")], { r1: "r1" })]).toEqual(["s1"])
    expect([...hiddenFailures([sig("s1", "run:t1")], [failed("r2", "t1")], { t1: "r2" })]).toEqual(["s1"])
    const sigs = [
      { id: "s1", ref: "run:r1", kind: "error", lane: "decide" as const, status: "open" as const },
      { id: "s2", ref: "x", kind: "info", lane: "now" as const, status: "open" as const },
      { id: "s3", ref: "y", kind: "info", lane: "decide" as const, status: "resolved" as const },
    ]
    const hidden = hiddenFailures(sigs, [failed("r1")], { r1: "r1" })
    expect(openDecideCount(sigs, hidden)).toBe(1)
    expect(openDecideCount(sigs)).toBe(2)
  })
  test("같은 대화의 다른 실행이 마지막이면(몇 초 안이라도) 숨기지 않아요", () => {
    expect(hiddenFailures([sig("s1", "run:t1")], [failed("r2", "t1")], { t1: "r3" }).size).toBe(0)
  })
  test("대화 목록을 아직 못 받았으면 숨기지 않아요", () => {
    expect(hiddenFailures([sig("s1", "run:r1")], [failed("r1")], {}).size).toBe(0)
  })
  test("진행·끝남·멈춤 실행, 다른 ref, 오류가 아닌 사건은 그대로", () => {
    const running = { run: { id: "r1", thread: null, status: "running" as const } }
    const stopped = { run: { id: "r1", thread: null, status: "stopped" as const } }
    expect(hiddenFailures([sig("s1", "run:r1")], [running, stopped, { run: undefined }], { r1: "r1" }).size).toBe(0)
    expect(hiddenFailures([sig("s1", "run:r9"), sig("s2", "run:r1", "done")], [failed("r1")], { r1: "r1" }).size).toBe(0)
  })
  test("보이는 항목: 닫은 것 빼고 최근부터 3개, 펼치면 전부", () => {
    const list = [1, 2, 3, 4, 5].map((n) => entry({ id: `r${n}` })).concat(entry({ id: "r6", dismissed: true }))
    expect(visibleEntries(list, false).map((e) => e.id)).toEqual(["r5", "r4", "r3"])
    expect(visibleEntries(list, true).map((e) => e.id)).toEqual(["r5", "r4", "r3", "r2", "r1"])
  })
  test("마지막으로 끝난 실행과 진단 마지막 줄", () => {
    expect(lastFinishedRun([{ id: "a", created_at: 1, finished_at: 5 }, { id: "b", created_at: 2, finished_at: 9 }, { id: "c", created_at: 3, finished_at: null }])).toBe("b")
    expect(lastFinishedRun([])).toBeNull()
    expect(lastLine("warn: x\n\n종료 코드 1\n  ")).toBe("종료 코드 1")
    expect(lastLine(null)).toBe("")
  })
})

