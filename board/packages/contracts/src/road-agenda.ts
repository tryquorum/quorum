// 로드맵: 영역별 표시(목표·미리알림·마감·일정)와 좁은 화면 목록 보기(오늘부터 며칠을 날짜별로). 웹 로드맵과 iOS "일정"이 같이 써요.
import { compareWorkOrder, whenOfItem, type OrderableWork } from "./order.ts"
import type { Board, Item, Signal } from "./api.ts"
import { dday } from "./board-text.ts"
import { isCalendar, opsCardRefs } from "./tasks.ts"

const DAY = 864e5
const WEEK = "일월화수목금토"

export type AgendaMark = OrderableWork & { at: number; done: boolean }
export type Agenda<M extends AgendaMark> = { overdue: M[]; days: { day: number; marks: M[] }[]; later: number; undated: number }

const dayStart = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * today0(오늘 0시) 기준으로 끝나지 않은 표시를 나눠요.
 * overdue: 오늘 이전, days: 오늘부터 n일(표시가 있는 날만), later: 그 뒤 개수, undated: 날짜 없는 일 합.
 * 끝난 일은 빼요. 같은 날 안의 순서는 다른 화면과 같은 compareWorkOrder.
 */
export function agenda<M extends AgendaMark>(marks: M[], undated: number, today0: number, n = 14): Agenda<M> {
  const end = new Date(today0)
  end.setDate(end.getDate() + n)
  const order = (a: M, b: M) => compareWorkOrder(a, b, { doneLast: false })
  const open = marks.filter((m) => !m.done)
  const byDay = new Map<number, M[]>()
  for (const m of open) {
    if (m.at < today0 || m.at >= end.getTime()) continue
    const k = dayStart(m.at)
    byDay.set(k, [...(byDay.get(k) ?? []), m])
  }
  return {
    overdue: open.filter((m) => m.at < today0).sort(order),
    days: [...byDay.entries()].sort(([a], [b]) => a - b).map(([day, ms]) => ({ day, marks: ms.sort(order) })),
    later: open.filter((m) => m.at >= end.getTime()).length,
    undated,
  }
}

/** 날짜 머리: "오늘 · 11월 8일 (일)", "내일 · …", 그 밖은 "11월 10일 (화)" */
export function agendaDayLabel(day: number, today0: number) {
  const d = new Date(day)
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`
  const diff = Math.round((dayStart(day) - today0) / DAY)
  return diff === 0 ? `오늘 · ${base}` : diff === 1 ? `내일 · ${base}` : base
}

/** 목록 행의 시각: 날짜만 있는 일(그날 23:59:59 로 잡힘)은 빈 글자 */
export function agendaTime(at: number) {
  const d = new Date(at)
  if (d.getHours() === 23 && d.getMinutes() === 59 && d.getSeconds() === 59) return ""
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export type MarkKind = "goal" | "todo" | "deadline" | "event"
export type RoadMark = { key: string; ref: string; kind: MarkKind; title: string; at: number; when?: string | number | null; z?: number; late: boolean; done: boolean; color: string; area: string }
export type RoadRow = { id: string; name: string; color: string; marks: RoadMark[]; undated: number; event?: boolean }

/** 판 하나의 로드맵 줄(영역마다, 날짜 없는 일은 개수만). 사건은 개인 판에서만(사람마다 따로 오는 소식이라) */
export function roadRows(items: Item[], signals: Signal[], board: Board | undefined, boardId: string | undefined, noAreaColor: string, now = Date.now()) {
  const areas = board?.areas || []
  const byArea = new Map<string, RoadRow>(areas.map((a) => [a.id, { id: a.id, name: a.name, color: a.color, marks: [], undated: 0 }]))
  const none: RoadRow = { id: "__none", name: "영역 없음", color: noAreaColor, marks: [], undated: 0 }
  const events: RoadRow = { id: "__events", name: "일정", color: noAreaColor, marks: [], undated: 0, event: true }
  const rowOfItem = (it: Item) => (it.area && byArea.get(it.area as string)) || none
  const rowOfName = (name: string | null) => (name && [...byArea.values()].find((r) => r.name.toLowerCase() === name.toLowerCase())) || none
  for (const it of items) {
    if (it.boardId !== boardId || it.deleted || (it.type !== "goal" && it.type !== "todo")) continue
    const at = whenOfItem(it)
    if (at === null) {
      if (!it.done) rowOfItem(it).undated++
      continue
    }
    if (it.type === "todo" && it.done) continue
    const goal = it.type === "goal"
    rowOfItem(it).marks.push({
      key: `i:${it.id}`, ref: `item:${it.boardId}:${it.id}`, kind: goal ? "goal" : "todo", title: (it.text || "(제목 없음)").split("\n")[0], at,
      when: goal ? (it.due ?? null) : (it.remindAt ?? it.due ?? null), z: typeof it.z === "number" ? it.z : undefined,
      late: !it.done && (goal ? !!it.due && dday(it.due).late : at < now), done: !!it.done, color: rowOfItem(it).color, area: rowOfItem(it).name,
    })
  }
  if (board?.kind === "personal") {
    const dupes = opsCardRefs(items)
    for (const s of signals) {
      if (s.status !== "open" || !s.due || (s.ref && dupes.has(s.ref))) continue
      const cal = isCalendar(s)
      const row = cal ? events : rowOfName(s.area)
      row.marks.push({
        key: `s:${s.id}`, ref: (s.meta as { work?: string } | null)?.work || `signal:${s.id}`, kind: cal ? "event" : "deadline",
        title: s.title, at: s.due, when: s.due, z: s.created_at, late: !cal && s.due < now, done: false, color: row.color, area: row.name,
      })
    }
  }
  const rows = [...(events.marks.length ? [events] : []), ...byArea.values(), ...(none.marks.length || none.undated ? [none] : [])]
  const all = rows.flatMap((r) => r.marks)
  const counts = { goal: 0, todo: 0, deadline: 0, event: 0 } as Record<MarkKind, number>
  for (const m of all) counts[m.kind]++
  return { rows, counts, total: all.length }
}
