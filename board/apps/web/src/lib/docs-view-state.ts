// 문서 화면의 Finder 식 보기 상태. 공유·북마크할 수 있게 #/docs?view=… 에 쓰고, 다음에 그냥 #/docs 로 와도 같게 localStorage 에도 둬요.
// 주소를 바꿀 때는 history.replaceState 라 라우트 이벤트(hashchange)가 일어나지 않아요.

export type DocsViewMode = 'icon' | 'list' | 'columns' | 'gallery'
export type DocsGroup = 'none' | 'kind' | 'area' | 'status'
export type ColumnAxis = 'kind' | 'tag' | 'link' | 'folder'
export type DocsViewState = { view: DocsViewMode; size: number; group: DocsGroup; axis: ColumnAxis }

export const VIEW_STATE_KEY = 'db:docs-view'
export const CARD_MIN = 140
export const CARD_MAX = 280
/** Finder 의 ⌘1~4 순서. ⌘·Ctrl+숫자는 브라우저 탭 전환이라 입력 중이 아닐 때 숫자 키만 써요 */
/** 보기 키(1~4)는 단축키 레지스트리 docs.view.<id> 에 있어요 */
export const VIEWS: { id: DocsViewMode; label: string; menu: string }[] = [
  { id: 'icon', label: '아이콘', menu: '아이콘으로' },
  { id: 'list', label: '목록', menu: '목록으로' },
  { id: 'columns', label: '열', menu: '열로' },
  { id: 'gallery', label: '갤러리', menu: '갤러리로' },
]
export const GROUPS: { id: DocsGroup; label: string }[] = [{ id: 'none', label: '없음' }, { id: 'kind', label: '종류' }, { id: 'area', label: '영역' }, { id: 'status', label: '상태' }]
export const AXES: { id: ColumnAxis; label: string }[] = [{ id: 'kind', label: '종류 → 영역' }, { id: 'tag', label: '태그 계층' }, { id: 'link', label: '링크 따라가기' }, { id: 'folder', label: '폴더(문서 계층)' }]

const DEFAULT: DocsViewState = { view: 'list', size: 200, group: 'none', axis: 'kind' }
const isView = (v: unknown): v is DocsViewMode => VIEWS.some((x) => x.id === v)
const isGroup = (v: unknown): v is DocsGroup => GROUPS.some((x) => x.id === v)
const isAxis = (v: unknown): v is ColumnAxis => AXES.some((x) => x.id === v)
const clampSize = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(CARD_MAX, Math.max(CARD_MIN, Math.round(n))) : fallback
}

function stored(storage: Pick<Storage, 'getItem'> | null): Partial<DocsViewState> {
  try { const v: unknown = JSON.parse(storage?.getItem(VIEW_STATE_KEY) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}

/** 주소의 값이 먼저, 없거나 잘못된 값이면 이 브라우저에 저장한 값, 그것도 없으면 기본(목록) */
export function readViewState(hash: string, storage: Pick<Storage, 'getItem'> | null): DocsViewState {
  const q = new URLSearchParams(hash.split('?')[1] || '')
  const s = stored(storage)
  const pick = <T,>(value: unknown, saved: unknown, ok: (v: unknown) => v is T, fallback: T): T => ok(value) ? value : ok(saved) ? saved : fallback
  return {
    view: pick(q.get('view'), s.view, isView, DEFAULT.view),
    size: clampSize(q.get('size'), clampSize(s.size, DEFAULT.size)),
    group: pick(q.get('group'), s.group, isGroup, DEFAULT.group),
    axis: pick(q.get('axis'), s.axis, isAxis, DEFAULT.axis),
  }
}
export const readSelection = (hash: string) => new URLSearchParams(hash.split('?')[1] || '').get('sel')

/** 문서 목록 주소(#/docs 또는 #/docs?…)에 있을 때만 주소를 고쳐요. 다른 쿼리(tag 등)는 그대로 둬요 */
export function viewHash(hash: string, state: DocsViewState, selected: string | null): string | null {
  if (!/^#\/docs(?:\?|$)/.test(hash)) return null
  const q = new URLSearchParams(hash.split('?')[1] || '')
  q.set('view', state.view)
  for (const [key, on, value] of [['size', state.view === 'icon', String(state.size)], ['group', state.view === 'icon', state.group], ['axis', state.view === 'columns', state.axis], ['sel', !!selected, selected || '']] as const) {
    if (on) q.set(key, value); else q.delete(key)
  }
  return `#/docs?${q}`
}

export function saveViewState(state: DocsViewState, selected: string | null) {
  try { localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(state)) } catch { /* 저장 못 해도 주소에는 남아요 */ }
  const next = viewHash(location.hash, state, selected)
  if (next && next !== location.hash) history.replaceState(history.state, '', next)
}
