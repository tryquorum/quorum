// 할 일 한 층: 미리알림(보드 todo)·목표·내가 처리할 사건(signal)·메인 일을 같은 모양으로 다뤄요.
// 웹 사이드바 "오늘"·전체 목록과 iOS 전체 목록이 같은 규칙을 써요. 메인 키 저장은 화면 쪽(웹 db:main, iOS 기기 파일).
import type { Board, Item, Signal, SpaceId } from "./api.ts"
import { compareWorkOrder, whenOfItem } from "./order.ts"
import { dday, srcName } from "./board-text.ts"

export type Task = {
  key: string // "i:<bid>:<id>" | "s:<id>" (첫 화면 메인 키와 같은 형식)
  ref: string // 일 화면 주소: "item:<bid>:<id>" | meta.work | "signal:<id>"
  kind: "todo" | "goal" | "signal"
  title: string
  at: number | null
  when?: string | number | null
  z?: number
  done: boolean
  late: boolean
  area: { name: string; color: string } | null
  source: string
  lane?: string
  /** 공간(개인 또는 워크스페이스 id) */
  space: SpaceId
  main: boolean
  updatedAt: number
  item?: Item
  signal?: Signal
}

export const compareTasks = (a: Task, b: Task) => compareWorkOrder(a, b)

/** 내가 처리할 사건 칸: 지금 봐야 함 · 결정 대기 · 메인 일 후보 (마감 사건은 따로 포함) */
export const TASK_LANES = new Set(["now", "decide", "main"])
export const isCalendar = (s: Signal) => s.source === "calendar" || s.source === "luma"

/** 운영 순회는 같은 일을 사건과 카드로 같이 올린다. 카드가 있으면 그 사건은 겹치니 숨긴다 */
export const opsCardRefs = (items: Item[]) => new Set(items.filter((i) => !i.deleted && typeof i.opsKey === "string").map((i) => `ops:${i.opsKey as string}`))

/** 옛 서버(space 를 안 줌)와 NULL 은 개인(웹 lib/spaces.ts spaceOf 와 같음) */
const spaceOf = (x: { space?: string | null }): SpaceId => (x.space || "personal") as SpaceId

/** noAreaColor: 판 영역에 없는 사건 영역의 색(웹은 CSS 변수, iOS 는 토큰 색) */
export function toTasks({ items, signals, boards, boardId, mainKeys, withDone = false, noAreaColor = "var(--no-area)", space = "all" }: {
  items: Item[]; signals: Signal[]; boards: Board[]; boardId: string | undefined; mainKeys: string[]; withDone?: boolean; noAreaColor?: string
  /** 공간 보기. all 이 아니면 판과 상관없이 그 공간의 할 일·사건만 */
  space?: "all" | SpaceId
}): Task[] {
  const board = boards.find((b) => b.id === boardId)
  const main = new Set(mainKeys)
  const now = Date.now()
  const out: Task[] = []
  const areaOfItem = (it: Item) => {
    const a = boards.find((b) => b.id === it.boardId)?.areas.find((x) => x.id === it.area)
    return a ? { name: a.name, color: a.color } : null
  }
  const areaOfSignal = (name: string | null) => {
    if (!name) return null
    const a = board?.areas.find((x) => x.name.toLowerCase() === name.toLowerCase())
    return a ? { name: a.name, color: a.color } : { name, color: noAreaColor }
  }
  for (const it of items) {
    if (it.deleted || (it.type !== "todo" && it.type !== "goal")) continue
    const key = `i:${it.boardId}:${it.id}`
    if (space !== "all" && spaceOf(it) !== space) continue
    // 다른 판 항목도 메인으로 골랐으면 같이 보인다
    if (space === "all" && it.boardId !== boardId && !main.has(key)) continue
    if (it.done && !withDone) continue
    const at = whenOfItem(it)
    const when = it.type === "goal" ? (it.due ?? null) : (it.remindAt ?? it.due ?? null)
    const late = !it.done && (it.type === "goal" ? !!it.due && dday(it.due).late : at !== null && at < now)
    out.push({
      key, ref: `item:${it.boardId}:${it.id}`, kind: it.type, title: (it.text || "(제목 없음)").split("\n")[0], at, when,
      z: typeof it.z === "number" ? it.z : undefined, done: !!it.done, late,
      area: areaOfItem(it), source: it.type === "goal" ? "목표" : "미리알림", main: main.has(key), updatedAt: Number(it.updatedAt) || 0, item: it, space: spaceOf(it),
    })
  }
  if (board?.kind === "personal" || space !== "all") {
    const dupes = opsCardRefs(items)
    for (const s of signals) {
      const key = `s:${s.id}`
      const done = s.status === "resolved"
      if (s.status === "snoozed") continue
      if (space !== "all" && spaceOf(s) !== space) continue
      if (!(TASK_LANES.has(s.lane) || (s.kind === "deadline" && s.due) || main.has(key))) continue
      if (s.ref && dupes.has(s.ref) && !main.has(key)) continue
      if (done && !(withDone && now - (s.resolved_at || 0) < 7 * 864e5)) continue
      out.push({
        key, ref: (s.meta as { work?: string } | null)?.work || `signal:${s.id}`, kind: "signal", title: s.title, at: s.due, when: s.due, z: s.created_at, done,
        late: !done && !!s.due && s.due < now, area: areaOfSignal(s.area), source: srcName(s.source), lane: s.lane, main: main.has(key),
        updatedAt: s.updated_at, signal: s, space: spaceOf(s),
      })
    }
  }
  return out
}

/** 메인 일 3개 제한: 지금 안 끝난 할 일 키(다른 판 포함) 중 고른 것만 세요 */
export const MAIN_LIMIT = 3
export function canAddMain(keys: string[], openKeys: Set<string>): boolean {
  return keys.filter((k) => openKeys.has(k)).length < MAIN_LIMIT
}
