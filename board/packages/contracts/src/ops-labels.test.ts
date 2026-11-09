import { describe, expect, test } from "bun:test"
import { chipState, countsLabel, hasReportCounts, runLine, whenLabel } from "./ops-labels.ts"

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const zero = { signals: 0, cards: 0, merged: 0, skipped: 0, closed: 0, checked: 0, notes: 0, errors: 0 }
const ops = { enabled: true } as never

describe("순회 표시", () => {
  test("다음 시각은 오늘·내일·그 뒤로", () => {
    expect(whenLabel(at(7, 14, 3), at(7, 9))).toBe("14:03")
    expect(whenLabel(at(8, 8), at(7, 23))).toBe("내일 08:00")
    expect(whenLabel(at(9, 8), at(7, 23))).toBe("11/9 08:00")
  })
  test("결과 수는 0 을 빼고, 없으면 올린 것 없음", () => {
    expect(countsLabel({ ...zero, signals: 3, cards: 2, merged: 1 })).toBe("사건 3 · 할 일 2 · 합침 1")
    expect(countsLabel(zero)).toBe("올린 것 없음")
    expect(hasReportCounts(zero)).toBe(false)
    expect(hasReportCounts({ ...zero, cards: 1 })).toBe(true)
  })
  test("순회 줄 요약: 보고 없음·올린 것 없음은 흐리게(muted), 건수 있는 보고·실행 중은 강조(active)", () => {
    expect(runLine({ status: "done", report: null, error: null })).toEqual({ text: "보고 없음", tone: "muted" })
    expect(runLine({ status: "done", report: { summary: "", counts: zero, items: [], at: 1 }, error: null })).toEqual({ text: "올린 것 없음", tone: "muted" })
    expect(runLine({ status: "done", report: { summary: "요약", counts: { ...zero, signals: 1, cards: 1 }, items: [], at: 1 }, error: null })).toEqual({ text: "사건 1 · 할 일 1", tone: "active" })
    expect(runLine({ status: "running", report: null, error: null })).toEqual({ text: "돌아보는 중", tone: "active" })
    expect(runLine({ status: "error", report: null, error: "첫 줄 오류\n둘째 줄" })).toEqual({ text: "첫 줄 오류", tone: "error" })
  })
  test("칩: 도는 중 > 꺼짐 > 마지막 실패 > 다음 시각", () => {
    const run = (status: string) => ({ status }) as never
    expect(chipState({ ops, runs: [run("running")], next_at: null }).tone).toBe("running")
    expect(chipState({ ops: { enabled: false } as never, runs: [run("error")], next_at: null })).toEqual({ tone: "off", label: "순회 꺼짐" })
    expect(chipState({ ops, runs: [run("error")], next_at: at(7, 16) }, at(7, 14))).toEqual({ tone: "error", label: "순회 실패 · 다음 16:00" })
    expect(chipState({ ops, runs: [run("done")], next_at: at(7, 16) }, at(7, 14))).toEqual({ tone: "idle", label: "순회 · 다음 16:00" })
    expect(chipState({ ops, runs: [], next_at: at(8, 8) }, at(7, 23)).label).toBe("순회 · 다음 내일 08:00")
  })
})
