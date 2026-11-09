import { describe, expect, test } from "bun:test"
import {
  compareWorkOrder,
  computeGoalProgress,
  computeGoalState,
  goalProgressBasis,
  goalStateLabel,
  linkedTodosForGoal,
  parseScheduleKey,
  whenOfItem,
  type Item,
} from "@direction-board/contracts"
import { compareTasks, toTasks } from "@/lib/tasks"

const mkItem = (id: string, overrides: Partial<Item> = {}): Item => ({
  id,
  boardId: "b1",
  type: "todo",
  text: id,
  x: 0,
  y: 0,
  w: 240,
  h: 90,
  z: 1,
  done: false,
  ...overrides,
})

describe("parseScheduleKey and whenOfItem", () => {
  test("distinguishes timed strings, date-only strings, and undated values", () => {
    const timed = parseScheduleKey("2026-11-08T10:30")
    expect(timed.hasDate).toBe(true)
    expect(timed.hasTime).toBe(true)
    expect(timed.dayKey).toBe("2026-11-08")
    expect(timed.timeMinutes).toBe(10 * 60 + 30)

    const dateOnly = parseScheduleKey("2026-11-08")
    expect(dateOnly.hasDate).toBe(true)
    expect(dateOnly.hasTime).toBe(false)
    expect(dateOnly.dayKey).toBe("2026-11-08")
    expect(dateOnly.atMs).toBeGreaterThan(timed.atMs ?? 0)

    const undated = parseScheduleKey(null)
    expect(undated.hasDate).toBe(false)
    expect(undated.atMs).toBeNull()
    expect(whenOfItem(mkItem("u"))).toBeNull()
  })
})

describe("compareWorkOrder", () => {
  test("sorts timed items chronologically, date-only after same-day timed, and undated last by manual z", () => {
    const list = [
      mkItem("undated-2", { z: 20, main: true }),
      mkItem("undated-1", { z: 10 }),
      mkItem("day-only-2", { remindAt: "2026-11-08", z: 25 }),
      mkItem("day-only-1", { type: "goal", due: "2026-11-08", z: 5 }),
      mkItem("late-time", { remindAt: "2026-11-08T23:59", z: 99 }),
      mkItem("morning-time", { remindAt: "2026-11-08T09:00", z: 50 }),
      mkItem("tomorrow", { remindAt: "2026-11-09T08:00", z: 1 }),
      mkItem("done-early", { remindAt: "2026-11-07T08:00", done: true, z: 1 }),
    ]
    const sorted = [...list].sort((a, b) => compareWorkOrder(a, b))
    expect(sorted.map((x) => x.id)).toEqual([
      "morning-time",
      "late-time",
      "day-only-1",
      "day-only-2",
      "tomorrow",
      "undated-2",
      "undated-1",
      "done-early",
    ])
  })

  test("toTasks + compareTasks keeps starred undated tasks after dated/timed tasks and avoids NaN on multiple undated tasks", () => {
    const items: Item[] = [
      mkItem("u-late", { text: "기약없는 2", z: 200 }),
      mkItem("u-main", { text: "기약없는 메인", z: 300 }),
      mkItem("u-early", { text: "기약없는 1", z: 100 }),
      mkItem("d-only", { text: "오늘 날짜만", remindAt: "2026-11-07", z: 1 }),
      mkItem("t-afternoon", { text: "오늘 14시", remindAt: "2026-11-07T14:00", z: 50 }),
      mkItem("t-morning", { text: "오늘 09시", remindAt: "2026-11-07T09:00", z: 80 }),
    ]
    const tasks = toTasks({
      items,
      signals: [],
      boards: [{ id: "b1", name: "나", kind: "personal", mine: true, deleted: false, areas: [] }],
      boardId: "b1",
      mainKeys: ["i:b1:u-main"],
    }).sort(compareTasks)
    expect(tasks.map((t) => t.title)).toEqual([
      "오늘 09시",
      "오늘 14시",
      "오늘 날짜만",
      "기약없는 메인",
      "기약없는 1",
      "기약없는 2",
    ])
  })
})

describe("goal progress and state", () => {
  test("computes linked subtasks via goalId or canvas link first and falls back to same area when no explicit links exist", () => {
    const goalA = mkItem("g1", { type: "goal", text: "목표 A", area: "a1", due: "2026-12-01" })
    const goalB = mkItem("g2", { type: "goal", text: "목표 B", area: "a1", due: "2026-10-01" })
    const items: Item[] = [
      goalA,
      goalB,
      mkItem("t-explicit-done", { goalId: "g1", done: true, remindAt: "2026-11-07T09:00" }),
      mkItem("t-explicit-open", { goalId: "g1", done: false, z: 20 }),
      mkItem("t-canvas-open", { done: false, remindAt: "2026-11-07T11:00", z: 30 }),
      mkItem("lnk1", { type: "link", from: "g1", to: "t-canvas-open" }),
      mkItem("t-area-only", { area: "a1", done: false, remindAt: "2026-11-08" }),
    ]
    const subsA = linkedTodosForGoal(goalA, items)
    expect(subsA.map((t) => t.id)).toEqual(["t-canvas-open", "t-explicit-open", "t-explicit-done"])
    expect(computeGoalProgress(goalA, items)).toEqual({ done: 1, total: 3 })

    // goalB has no explicit links so it falls back to unlinked todos in area a1
    const subsB = linkedTodosForGoal(goalB, items)
    expect(subsB.map((t) => t.id)).toEqual(["t-area-only"])
    expect(computeGoalProgress(goalB, items)).toEqual({ done: 0, total: 1 })

    const now = new Date(2026, 10, 7, 12, 0, 0)
    expect(computeGoalState(goalA, now)).toBe("on_track")
    expect(goalStateLabel(computeGoalState(goalA, now))).toBe("순항")
    expect(computeGoalState(goalB, now)).toBe("late")
    expect(goalStateLabel(computeGoalState(goalB, now))).toBe("지연")
    expect(goalStateLabel(computeGoalState({ ...goalB, done: true }, now))).toBe("완료")
  })

  test("진행률 근거는 붙인 할 일·영역·없음으로 linkedTodosForGoal 과 같은 판정이에요", () => {
    const linked = mkItem("g1", { type: "goal", area: "a1" })
    const byArea = mkItem("g2", { type: "goal", area: "a1" })
    const noArea = mkItem("g3", { type: "goal" })
    const emptyArea = mkItem("g4", { type: "goal", area: "a2" })
    const items: Item[] = [linked, byArea, noArea, emptyArea, mkItem("t1", { goalId: "g1" }), mkItem("t2", { area: "a1" })]
    expect(goalProgressBasis(linked, items)).toBe("linked")
    expect(goalProgressBasis(byArea, items)).toBe("area")
    expect(goalProgressBasis(noArea, items)).toBe("none")
    // 영역은 있지만 그 영역에 할 일이 없으면 여전히 영역 기준(0개)이에요
    expect(goalProgressBasis(emptyArea, items)).toBe("area")
    expect(linkedTodosForGoal(emptyArea, items)).toEqual([])
    // 화면이 넘기는 연결 id 도 붙인 할 일로 쳐요
    expect(goalProgressBasis(byArea, items, ["t2"])).toBe("linked")
  })

  test("진행률 근거: 캔버스 링크는 붙인 것, 삭제된 일·다른 판 일·다른 목표에 붙은 일은 세지 않아요", () => {
    const g = mkItem("g1", { type: "goal", area: "a1" })
    const canvas: Item[] = [g, mkItem("t1", { area: "a9" }), mkItem("l1", { type: "link", from: "t1", to: "g1" })]
    expect(goalProgressBasis(g, canvas)).toBe("linked")
    expect(linkedTodosForGoal(g, canvas).map((t) => t.id)).toEqual(["t1"])
    const noise: Item[] = [g, mkItem("del", { goalId: "g1", deleted: true }), mkItem("other", { goalId: "g1", boardId: "b2" }), mkItem("mine", { area: "a1", goalId: "g9" })]
    expect(goalProgressBasis(g, noise)).toBe("area")
    expect(linkedTodosForGoal(g, noise)).toEqual([])
  })
})
