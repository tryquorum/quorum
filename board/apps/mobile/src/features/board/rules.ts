// 레인 1 화면의 순수 판단(웹 home.tsx·list-view.tsx·goal-view.tsx 와 같은 규칙). React·RN 없이 bun 으로 시험해요.
import { compareWorkOrder, whenOfItem, type Board, type Collector, type Item, type Signal } from '@direction-board/contracts'
import { dday, isoLocal, srcName } from '@direction-board/contracts/board-text'
import { MAIN_LIMIT, type Task } from '@direction-board/contracts/tasks'
import { short } from '@direction-board/contracts/when'

/* ---------- 오늘 메인 키 ---------- */
export type MainState = { day: string; keys: string[] }
export const isMainState = (v: unknown): v is MainState =>
  !!v && typeof v === 'object' && typeof (v as MainState).day === 'string' && Array.isArray((v as MainState).keys) && (v as MainState).keys.every((k) => typeof k === 'string')
export const dayKey = (d = new Date()) => d.toDateString()
/** 오늘 메인 키. 다른 날의 저장값은 빈 목록이에요 */
export const mainKeysOf = (state: MainState, today = dayKey()) => (state.day === today ? state.keys : [])
/** 별 누르기: 이미 메인이면 빼고, 아니면 안 끝난 메인이 3개 미만일 때만 더해요. 거절이면 null */
export function toggleMainKey(keys: string[], key: string, openKeys: Set<string>): string[] | null {
  if (keys.includes(key)) return keys.filter((k) => k !== key)
  if (keys.filter((k) => openKeys.has(k)).length >= MAIN_LIMIT) return null
  return [...keys, key]
}
/** 안 끝난 할 일·목표·사건 키 전체(다른 판 포함) — 메인 3개 제한을 셀 때 */
export function openKeysOf(items: Item[], signals: Signal[]): Set<string> {
  return new Set([
    ...items.filter((i) => !i.deleted && !i.done && (i.type === 'todo' || i.type === 'goal')).map((i) => `i:${i.boardId}:${i.id}`),
    ...signals.filter((s) => s.status === 'open').map((s) => `s:${s.id}`),
  ])
}

/* ---------- 홈 ---------- */
const dueLabel = (ts: number | null) => (ts ? short(isoLocal(ts)) : '')
export type MainRef = { key: string; ref: string; title: string; meta: string; when?: string | number | null; z?: number; done: boolean; item?: Item; signal?: Signal }

/** 메인 키 하나 → 화면 줄(웹 home.tsx resolve). 지금 데이터에 없으면 null */
export function resolveMain(key: string, items: Item[], signals: Signal[]): MainRef | null {
  if (key.startsWith('s:')) {
    const s = signals.find((x) => x.id === key.slice(2))
    if (!s) return null
    return { key, ref: (s.meta as { work?: string } | null)?.work || `signal:${s.id}`, title: s.title, meta: [srcName(s.source), dueLabel(s.due)].filter(Boolean).join(' · '), when: s.due, z: s.created_at, done: s.status === 'resolved', signal: s }
  }
  const it = items.find((i) => `i:${i.boardId}:${i.id}` === key)
  if (!it || it.deleted) return null
  return {
    key, ref: `item:${it.boardId}:${it.id}`, title: (it.text || '(제목 없음)').split('\n')[0],
    meta: it.type === 'goal' ? dday(it.due).t : it.remindAt ? short(it.remindAt) : '',
    when: it.type === 'goal' ? (it.due ?? null) : (it.remindAt ?? it.due ?? null), z: typeof it.z === 'number' ? it.z : undefined, done: !!it.done, item: it,
  }
}

/** 메인 후보(웹 home.tsx:117-130): main 칸 사건 + 오늘까지 알림 할 일 + 2일 안 목표, 이미 메인인 것 빼고 */
export function mainCandidates(items: Item[], signals: Signal[], mainKeys: string[], now = Date.now()): MainRef[] {
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  const endMs = end.getTime()
  const in2 = now + 2 * 864e5
  const present = (m: MainRef | null): m is MainRef => !!m
  const fromSig = signals.filter((s) => s.lane === 'main' && s.status === 'open').map((s) => resolveMain(`s:${s.id}`, items, signals)).filter(present)
  const fromBoard = items
    .filter((i) => {
      if (i.done || i.deleted) return false
      const at = whenOfItem(i)
      return (i.type === 'todo' && at !== null && at <= endMs) || (i.type === 'goal' && at !== null && at <= in2)
    })
    .map((i) => resolveMain(`i:${i.boardId}:${i.id}`, items, signals))
    .filter(present)
  return [...fromSig, ...fromBoard].filter((c) => !mainKeys.includes(c.key)).sort((a, b) => compareWorkOrder(a, b))
}

/** 홈 사건 묶음(웹 home.tsx:57-81). hidden: 트레이에 보이는 AI 정리 실패와 같은 사건 */
export function homeGroups(signals: Signal[], hidden: Set<string> = new Set(), now = Date.now()) {
  const open = (lane: string) => signals.filter((s) => s.lane === lane && s.status === 'open' && !hidden.has(s.id))
  const seen = new Set<string>()
  return {
    now: open('now'),
    decide: open('decide'),
    review: open('review').sort((a, b) => b.updated_at - a.updated_at),
    running: signals.filter((s) => s.lane === 'running' && s.status === 'open').filter((s) => {
      const k = s.task || s.id
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }),
    autoDone: signals.filter((s) => s.lane === 'auto' && now - s.updated_at < 864e5),
  }
}

export type Upcoming = { key: string; title: string; at: number; src: string; ref: string }
/** 마감(웹 home.tsx Upcoming): 마감 사건(info 칸) + 기한 있는 열린 목표, 하루 지난 것까지, 6개 */
export function upcoming(signals: Signal[], items: Item[], now = Date.now()): Upcoming[] {
  return [
    ...signals.flatMap((s) => (s.kind === 'deadline' && s.status === 'open' && s.lane === 'info' && s.due ? [{ ...s, due: s.due }] : [])).map((s) => ({ key: `s:${s.id}`, title: s.title, at: s.due, when: s.due, z: s.created_at, src: srcName(s.source), ref: (s.meta as { work?: string } | null)?.work || `signal:${s.id}` })),
    ...items.filter((i) => i.type === 'goal' && !i.done && !i.deleted && i.due).map((i) => ({ key: `i:${i.boardId}:${i.id}`, title: (i.text || '목표').split('\n')[0], at: whenOfItem(i) ?? new Date(i.due + 'T23:59:59').getTime(), when: i.due, z: typeof i.z === 'number' ? i.z : undefined, src: '목표', ref: `item:${i.boardId}:${i.id}` })),
  ]
    .filter((x) => x.at > now - 864e5)
    .sort((a, b) => compareWorkOrder(a, b, { doneLast: false }))
    .slice(0, 6)
    .map(({ key, title, at, src, ref }) => ({ key, title, at, src, ref }))
}
export const dueText = (at: number) => short(isoLocal(at))

/** 수집기 상태(웹 home.tsx:344-356): 실패했거나 주기의 3배 동안 소식이 없으면 문제 */
export function collectorState(c: Collector, now = Date.now()): { bad: boolean; note: string } {
  const stale = !!c.every_min && now - c.last_seen > c.every_min * 3 * 6e4
  const bad = !c.ok || stale
  return { bad, note: bad ? (stale && c.ok ? '소식 없음' : c.note || '문제 있음') : '정상' }
}

/* ---------- 전체 목록 ---------- */
export type Kind = 'all' | 'main' | 'todo' | 'signal' | 'goal'
export const KINDS: [Kind, string][] = [['all', '전체'], ['main', '메인'], ['todo', '미리알림'], ['signal', '사건'], ['goal', '목표']]
export const GROUPS = ['지남', '오늘', '이번 주', '나중', '날짜 없음'] as const
export type Group = (typeof GROUPS)[number]
export type ListFilter = { kind: Kind; area: string; q: string }

export const countKind = (all: Task[], k: Kind) => all.filter((t) => !t.done && (k === 'all' || (k === 'main' ? t.main : t.kind === k))).length

export function filterTasks(all: Task[], f: ListFilter): Task[] {
  const q = f.q.trim().toLowerCase()
  return all.filter((t) => {
    if (f.kind === 'main' ? !t.main : f.kind !== 'all' && t.kind !== f.kind) return false
    if (f.area === 'none' ? !!t.area : f.area !== 'all' && t.area?.name !== f.area) return false
    return !q || t.title.toLowerCase().includes(q)
  })
}
/** 시간 묶음(웹 list-view.tsx:43-56). 끝낸 것은 빼고, 묶음 안은 compareWorkOrder */
export function groupTasks(shown: Task[], now = Date.now()): Record<Group, Task[]> {
  const t0 = new Date(now)
  t0.setHours(0, 0, 0, 0)
  const start = t0.getTime()
  const end = start + 864e5 - 1
  const week = end + 7 * 864e5
  const g: Record<Group, Task[]> = { 지남: [], 오늘: [], '이번 주': [], 나중: [], '날짜 없음': [] }
  for (const t of shown) {
    if (t.done) continue
    const k: Group = t.at === null ? '날짜 없음' : t.at < start ? '지남' : t.at <= end ? '오늘' : t.at <= week ? '이번 주' : '나중'
    g[k].push(t)
  }
  for (const k of GROUPS) g[k].sort((a, b) => compareWorkOrder(a, b))
  return g
}
export const doneTasks = (shown: Task[]) => shown.filter((t) => t.done).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50)
/** 목록 행 시각(웹 task-row.tsx taskWhen) */
export const taskWhen = (t: Task) => (t.kind === 'goal' && t.item?.due ? dday(t.item.due as string).t : typeof t.when === 'string' && t.when ? short(t.when) : t.at !== null ? short(isoLocal(t.at)) : '')

/* ---------- 판 ---------- */
/** 지금 판: 고른 판이 보이면 그것, 아니면 내 개인 판, 없으면 보이는 첫 판(웹 App.tsx:123-124 의 personal 규칙) */
export function currentBoard(boards: Board[], picked: string | null): Board | undefined {
  const live = boards.filter((b) => !b.deleted)
  return live.find((b) => b.id === picked) ?? live.find((b) => b.kind === 'personal' && b.mine) ?? live[0]
}
/** 회사 판은 문서 색인 밖이라 태그·속성을 못 붙이고 AI 정리도 개인 판에만 올려요 */
export const personalOnly = (board: Board | undefined) => board?.kind !== 'company'

/**
 * 되돌리기 대상: 서버를 새로 읽은 값에서만 골라요. 읽기에 실패하면 되돌리지 않아요
 * (가진 캐시 전체 항목을 다시 쓰면 그사이 다른 곳에서 고친 제목·날짜를 덮어요)
 */
export async function freshItem(read: () => Promise<{ items: Item[] }>, item: Item): Promise<{ ok: true; item: Item } | { ok: false; reason: 'read' | 'missing' }> {
  let items: Item[] | null = null
  try {
    items = (await read()).items
  } catch {
    return { ok: false, reason: 'read' }
  }
  const found = items.find((i) => i.boardId === item.boardId && i.id === item.id)
  return found ? { ok: true, item: found } : { ok: false, reason: 'missing' }
}

/** 서버가 붙이는 값(누가·언제)은 비교에서 빼고, 서버가 채우는 기본값(삭제 안 됨·개인 공간)은 맞춰요 */
const SERVER_META = new Set(['by', 'updatedAt'])
const comparable = (it: Item): string => {
  const o: Record<string, unknown> = { ...it, deleted: !!it.deleted, space: it.space || 'personal', done: !!it.done }
  return JSON.stringify(Object.keys(o).filter((k) => !SERVER_META.has(k) && o[k] !== undefined).sort().map((k) => [k, o[k]]))
}
/**
 * 끝냄 되돌리기 직전 판정(PR #39 리뷰 15 P2): 다시 읽은 항목(fresh)이 내가 끝냄/다시 열기로 저장한 그 상태(mine) 그대로일 때만 되돌려요.
 * 그사이 다른 기기가 제목·날짜·끝냄을 바꿨으면 되돌리지 않아요. 서버 항목 PUT 에 버전 조건이 없어 읽기와 쓰기 사이의 아주 짧은 틈은 남아요(전수 표)
 */
export const undoTarget = (fresh: Item, mine: Item): boolean => comparable(fresh) === comparable(mine)
