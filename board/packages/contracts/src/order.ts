// 할 일·목표·사건 공용 정렬과 목표 진행률·상태 계산 (웹·서버·MCP·모바일 공통).
import type { Item } from "./api.ts"

export type GoalProgress = { done: number; total: number }
export type GoalState = "on_track" | "late" | "done"
export type ScheduleKey = {
  hasDate: boolean
  dayKey: string
  hasTime: boolean
  timeMinutes: number
  atMs: number | null
}

export type OrderableWork = {
  id?: string
  key?: string
  type?: string
  done?: boolean
  main?: boolean
  remindAt?: string | null
  due?: string | number | null
  when?: string | number | null
  at?: number | null
  z?: number | null
  createdAt?: number | null
  updatedAt?: number | null
}

const p2 = (n: number) => String(n).padStart(2, "0")
export const localDayKey = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const NO_SCHEDULE: ScheduleKey = { hasDate: false, dayKey: "", hasTime: false, timeMinutes: 24 * 60, atMs: null }
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/

/** 날짜·시각 문자열(YYYY-MM-DD / YYYY-MM-DDTHH:MM)이나 타임스탬프를 로컬 달력 기준 정렬 키로 바꾼다 */
export function parseScheduleKey(raw?: string | number | null): ScheduleKey {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return NO_SCHEDULE
    const d = new Date(raw)
    return { hasDate: true, dayKey: localDayKey(d), hasTime: true, timeMinutes: d.getHours() * 60 + d.getMinutes(), atMs: raw }
  }
  if (typeof raw !== "string") return NO_SCHEDULE
  const m = ISO_RE.exec(raw.trim())
  if (!m) return NO_SCHEDULE
  const y = Number(m[1])
  const mo = Number(m[2])
  const day = Number(m[3])
  const dayKey = `${m[1]}-${m[2]}-${m[3]}`
  if (m[4] !== undefined && m[5] !== undefined) {
    const hh = Number(m[4])
    const mm = Number(m[5])
    const atMs = new Date(y, mo - 1, day, hh, mm, 0, 0).getTime()
    return { hasDate: true, dayKey, hasTime: true, timeMinutes: hh * 60 + mm, atMs }
  }
  // 날짜만 있는 항목은 같은 날 시각이 있는 항목 뒤로 가도록 그날 23:59:59 로 둔다
  const atMs = new Date(y, mo - 1, day, 23, 59, 59, 0).getTime()
  return { hasDate: true, dayKey, hasTime: false, timeMinutes: 24 * 60, atMs }
}

export function scheduleOfWork(w: OrderableWork): ScheduleKey {
  if (w.when !== undefined && w.when !== null && w.when !== "") return parseScheduleKey(w.when)
  if (w.type === "goal") return parseScheduleKey(w.due ?? w.remindAt ?? w.at ?? null)
  return parseScheduleKey(w.remindAt ?? w.due ?? w.at ?? null)
}

/** 할 일·목표의 기준 시각(로컬 ms). 날짜만 있으면 그날 23:59:59, 없으면 null */
export function whenOfItem(it: { type?: string; due?: string | number | null; remindAt?: string | null }): number | null {
  return scheduleOfWork(it).atMs
}

const finiteOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

/**
 * 할 일·목표·사건 정렬 비교:
 * 1) 미완료 먼저, 완료 뒤 (opts.doneLast !== false)
 * 2) 날짜·시각 있는 항목이 기약 없는 항목보다 항상 위
 * 3) 이른 날짜 → 늦은 날짜; 같은 날이면 시각 있는 항목(시각 순) → 날짜만 있는 항목
 * 4) 같은 시간 버킷 또는 기약 없는 항목끼리는 수동 순서(z) → 만든/바뀐 순 → id 순
 */
export function compareWorkOrder(a: OrderableWork, b: OrderableWork, opts?: { doneLast?: boolean }): number {
  if (opts?.doneLast !== false) {
    const doneDiff = Number(!!a.done) - Number(!!b.done)
    if (doneDiff !== 0) return doneDiff
  }
  const sa = scheduleOfWork(a)
  const sb = scheduleOfWork(b)
  if (sa.hasDate !== sb.hasDate) return sa.hasDate ? -1 : 1
  if (sa.hasDate && sb.hasDate) {
    const dayDiff = sa.dayKey.localeCompare(sb.dayKey)
    if (dayDiff !== 0) return dayDiff
    if (sa.hasTime !== sb.hasTime) return sa.hasTime ? -1 : 1
    if (sa.timeMinutes !== sb.timeMinutes) return sa.timeMinutes - sb.timeMinutes
    if (sa.atMs !== null && sb.atMs !== null && sa.atMs !== sb.atMs) return sa.atMs - sb.atMs
  }
  if (!!a.main !== !!b.main) return a.main ? -1 : 1
  const za = finiteOrNull(a.z)
  const zb = finiteOrNull(b.z)
  if (za !== null && zb !== null && za !== zb) return za - zb
  const ca = finiteOrNull(a.createdAt)
  const cb = finiteOrNull(b.createdAt)
  if (ca !== null && cb !== null && ca !== cb) return ca - cb
  const ua = finiteOrNull(a.updatedAt)
  const ub = finiteOrNull(b.updatedAt)
  if (ua !== null && ub !== null && ua !== ub) return ua - ub
  return String(a.id ?? a.key ?? "").localeCompare(String(b.id ?? b.key ?? ""))
}

/** 목표에 연결된 하위 할 일 목록(위 정렬 규칙 적용). 명시적 연결(goalId·work_links·캔버스 link) 우선, 없을 때만 같은 영역 폴백 */
/** 목표 진행률을 무엇으로 세는지: 붙인 할 일(goalId·연결), 같은 영역의 할 일, 셀 것 없음 */
export type GoalProgressBasis = "linked" | "area" | "none"

function goalTodos(goal: Pick<Item, "id" | "boardId" | "area">, items: Item[], linkedTodoIds?: Iterable<string>): { basis: GoalProgressBasis; todos: Item[] } {
  const explicitIds = new Set<string>(linkedTodoIds ?? [])
  for (const it of items) {
    if (it.boardId !== goal.boardId || it.deleted || it.type !== "link") continue
    if (it.from === goal.id && typeof it.to === "string") explicitIds.add(it.to)
    else if (it.to === goal.id && typeof it.from === "string") explicitIds.add(it.from)
  }
  const todos = items.filter((it) => it.boardId === goal.boardId && !it.deleted && it.type === "todo")
  const explicit = todos.filter((it) => it.goalId === goal.id || explicitIds.has(it.id))
  if (explicit.length > 0) return { basis: "linked", todos: [...explicit].sort(compareWorkOrder) }
  if (typeof goal.area === "string" && goal.area.length > 0) {
    const byArea = todos.filter((it) => !it.goalId && it.area === goal.area)
    return { basis: "area", todos: [...byArea].sort(compareWorkOrder) }
  }
  return { basis: "none", todos: [] }
}

export function linkedTodosForGoal(goal: Pick<Item, "id" | "boardId" | "area">, items: Item[], linkedTodoIds?: Iterable<string>): Item[] {
  return goalTodos(goal, items, linkedTodoIds).todos
}

/** 진행률의 근거. linkedTodosForGoal 과 같은 판정에서 나와요(영역 기준이면 화면에 "영역 기준"을 적어요) */
export function goalProgressBasis(goal: Pick<Item, "id" | "boardId" | "area">, items: Item[], linkedTodoIds?: Iterable<string>): GoalProgressBasis {
  return goalTodos(goal, items, linkedTodoIds).basis
}

export function computeGoalProgress(goal: Pick<Item, "id" | "boardId" | "area">, items: Item[], linkedTodoIds?: Iterable<string>): GoalProgress {
  const todos = linkedTodosForGoal(goal, items, linkedTodoIds)
  return { done: todos.filter((t) => !!t.done).length, total: todos.length }
}

export function computeGoalState(goal: { done?: boolean; due?: string | null }, now: Date = new Date()): GoalState {
  if (goal.done) return "done"
  if (typeof goal.due === "string" && /^\d{4}-\d{2}-\d{2}/.test(goal.due)) {
    if (goal.due.slice(0, 10) < localDayKey(now)) return "late"
  }
  return "on_track"
}

export const goalStateLabel = (state: GoalState): "완료" | "지연" | "순항" =>
  state === "done" ? "완료" : state === "late" ? "지연" : "순항"
