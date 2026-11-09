import { expect, test } from "bun:test"
import { agenda, agendaDayLabel, agendaTime } from "./road-agenda"

const at = (y: number, mo: number, d: number, h = 23, mi = 59, s = 59) => new Date(y, mo - 1, d, h, mi, s).getTime()
const today0 = new Date(2026, 10, 8).getTime() // 11월 8일 (일) 0시
const m = (key: string, ms: number, extra: { done?: boolean; z?: number } = {}) => ({ key, at: ms, when: ms, done: !!extra.done, z: extra.z })

test("지난 일·오늘·내일·14일 경계·그 뒤·날짜 없음으로 나눠요", () => {
  const r = agenda([
    m("late", at(2026, 11, 7, 9, 0, 0)),
    m("today", at(2026, 11, 8)),
    m("tomorrow", at(2026, 11, 9, 10, 0, 0)),
    m("last", at(2026, 11, 21, 23, 59, 59)), // 14일째(오늘 포함) 끝
    m("edge", at(2026, 11, 22, 0, 0, 0)), // 15일째 0시 = 그 뒤
    m("far", at(2027, 1, 3)),
  ], 4, today0)
  expect(r.overdue.map((x) => x.key)).toEqual(["late"])
  expect(r.days.map((d) => d.marks.map((x) => x.key))).toEqual([["today"], ["tomorrow"], ["last"]])
  expect(r.later).toBe(2)
  expect(r.undated).toBe(4)
})

test("끝난 일은 빼고, 같은 날은 시각 있는 일 → 날짜만 있는 일, 같은 버킷은 z 순", () => {
  const r = agenda([
    m("dateOnly", at(2026, 11, 10)),
    m("done", at(2026, 11, 10, 8, 0, 0), { done: true }),
    m("noon", at(2026, 11, 10, 12, 0, 0)),
    m("morning", at(2026, 11, 10, 9, 0, 0)),
    m("z2", at(2026, 11, 11), { z: 2 }),
    m("z1", at(2026, 11, 11), { z: 1 }),
    m("oldDone", at(2026, 11, 1), { done: true }),
  ], 0, today0)
  expect(r.overdue).toEqual([])
  expect(r.days.map((d) => d.marks.map((x) => x.key))).toEqual([["morning", "noon", "dateOnly"], ["z1", "z2"]])
})

test("날짜 머리는 오늘·내일만 말로, 시각은 날짜만 있는 일이면 비워요", () => {
  expect(agendaDayLabel(today0, today0)).toBe("오늘 · 11월 8일 (일)")
  expect(agendaDayLabel(at(2026, 11, 9, 0, 0, 0), today0)).toBe("내일 · 11월 9일 (월)")
  expect(agendaDayLabel(at(2026, 11, 10, 0, 0, 0), today0)).toBe("11월 10일 (화)")
  expect(agendaTime(at(2026, 11, 10))).toBe("")
  expect(agendaTime(at(2026, 11, 10, 9, 5, 0))).toBe("09:05")
})
