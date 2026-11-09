// 검색 탭(웹 ⌘K)의 묶음 조립. 할 일·목표·사건 고르기는 웹과 공용(@direction-board/contracts/palette), 화면 묶음은 앱에 있는 것만.
import type { Board, DocKind, Item, SearchResult, Signal } from '@direction-board/contracts'
import { eventEntries, paletteMatch, pickEvents, pickWork, workEntries } from '@direction-board/contracts/palette'
import { exactName } from '@direction-board/contracts/palette-rank'
import { searchSettings, type SettingsSectionId } from '@direction-board/contracts/settings-registry'
import { MOBILE_ITEMS, MOBILE_SECTIONS, mobileSectionTitle } from '../settings/registry'

export type SearchTarget =
  | { type: 'tab'; tab: 'HomeTab' | 'ListTab' | 'DocsTab' | 'AiTab' }
  | { type: 'route'; route: 'Goals' | 'Decisions' | 'Board' }
  | { type: 'settings'; section?: SettingsSectionId; item?: string }
  | { type: 'work'; ref: string }
  | { type: 'doc'; ref: string }
  | { type: 'sweep' }
  | { type: 'newTask'; text: string }
  | { type: 'ask'; text: string }
export type SearchRow = { id: string; label: string; hint?: string; icon: string; target: SearchTarget }
export type SearchGroup = { title: string; rows: SearchRow[] }

type Screen = { label: string; keywords: string[]; target: SearchTarget; route?: string }
const SCREENS: Screen[] = [
  { label: '홈', keywords: ['첫 화면', 'home'], target: { type: 'tab', tab: 'HomeTab' } },
  { label: '전체 목록', keywords: ['할 일', '미리알림', 'list', '전체', '로드맵', '일정'], target: { type: 'tab', tab: 'ListTab' } },
  { label: '문서', keywords: ['노트', 'docs'], target: { type: 'tab', tab: 'DocsTab' } },
  { label: 'AI', keywords: ['대화', '명령창', 'chat', 'ai'], target: { type: 'tab', tab: 'AiTab' } },
  { label: '설정', keywords: ['settings', '환경설정', 'preferences', '옵션'], target: { type: 'settings' } },
  { label: '목표', keywords: ['goal', 'goals', '진행률'], target: { type: 'route', route: 'Goals' }, route: 'Goals' },
  { label: '결정 칸', keywords: ['결정', '사건', 'decide', 'decisions'], target: { type: 'route', route: 'Decisions' }, route: 'Decisions' },
  { label: '보드', keywords: ['화이트보드', 'board', '캔버스'], target: { type: 'route', route: 'Board' }, route: 'Board' },
]

const DOC_KIND: Record<DocKind, string> = { todo: '할 일', goal: '목표', signal: '사건', run: '대화', doc: '문서' }

export type SearchInput = {
  query: string
  items: Item[]
  boards: Board[]
  signals: Signal[]
  signalsStatus: 'loading' | 'ok' | 'error'
  docs: SearchResult | null
  /** 지금 앱에 등록된 상세 라우트(레인 1 의 목표·결정 칸·보드는 등록됐을 때만 보여요) */
  routes: string[]
  /** 빠른 추가 시트가 있는지(레인 1) */
  quickAdd: boolean
  /** 운영 순회를 돌릴 수 있는지(맥 주인) */
  canSweep: boolean
}

/** 웹 command-palette 와 같은 순서: (문서) 화면 · 명령 · 설정 · 할 일·목표 · 사건 · (이름이 같으면 문서) · 빠른 실행 */
export function searchGroups(input: SearchInput): { groups: SearchGroup[]; nothing: boolean } {
  const raw = input.query.trim()
  const q = raw.toLocaleLowerCase()
  // 빈 검색에서는 탭 필에 이미 있는 화면은 빼고 탭 밖 화면(설정·목표·결정 칸·보드)만 보여요
  const screens: SearchRow[] = SCREENS.filter((s) => !s.route || input.routes.includes(s.route))
    .filter((s) => q || s.target.type !== 'tab')
    .filter((s) => paletteMatch({ label: s.label, keywords: ['화면 이동', ...s.keywords] }, q))
    .map((s) => ({ id: 'view:' + s.label, label: s.label, hint: '화면', icon: 'square.grid.2x2', target: s.target }))
  const ops: (SearchRow & { keywords: string[] })[] = [
    ...(input.canSweep ? [{ id: 'action:sweep', label: '지금 순회 돌리기', icon: 'play', keywords: ['순회', '운영', 'sweep', 'run', '돌리기', 'ops'], target: { type: 'sweep' } as const }] : []),
    { id: 'action:ops-settings', label: '운영 순회 설정', icon: 'timer', keywords: ['순회', '운영', 'ops', 'sweep', '지시문', '주기', 'schedule'], target: { type: 'settings', section: 'ops', item: 'ops-schedule' } },
  ]
  const commands = q ? ops.filter((r) => paletteMatch(r, q)) : []
  const settings: SearchRow[] = searchSettings(q, 8, MOBILE_ITEMS, MOBILE_SECTIONS).map((s) => ({
    id: 'setting:' + s.id,
    label: s.title,
    hint: '설정 · ' + mobileSectionTitle(s.section),
    icon: 'gearshape',
    target: { type: 'settings', section: s.section, item: s.id },
  }))
  const work: SearchRow[] = pickWork(workEntries(input.items, input.boards), q).map((e) => ({ id: e.id, label: e.label, hint: e.hint, icon: e.kind === 'goal' ? 'target' : 'checklist', target: { type: 'work', ref: e.ref } }))
  const events: SearchRow[] = pickEvents(eventEntries(input.signals), q).map((e) => ({ id: e.id, label: e.label, hint: e.hint, icon: 'flag', target: { type: 'work', ref: e.ref } }))
  const docs: SearchRow[] = q && input.docs ? input.docs.results.map((d) => ({ id: 'doc:' + d.ref, label: d.title, hint: DOC_KIND[d.kind] ?? d.kind, icon: 'doc.text', target: { type: 'doc', ref: d.ref } })) : []
  const gestures: SearchRow = { id: 'action:gestures', label: '제스처', icon: 'hand.tap', target: { type: 'settings', section: 'shortcuts' } }
  const newTask: SearchRow[] = input.quickAdd ? [raw ? { id: 'action:task', label: `할 일로 추가: ${raw}`, icon: 'plus', target: { type: 'newTask', text: raw } } : { id: 'action:task', label: '새 할 일', icon: 'plus', target: { type: 'newTask', text: '' } }] : []
  const quick: SearchRow[] = raw
    ? [{ id: 'action:ask', label: `AI에게 묻기: ${raw}`, icon: 'sparkles', target: { type: 'ask', text: raw } }, ...newTask, ...(paletteMatch({ label: '제스처', keywords: ['단축키', '키보드', 'shortcut', 'help', '도움말', 'gesture'] }, q) ? [gestures] : [])]
    : [...newTask, gestures, ...ops]
  const docsLast = exactName(q, [...screens, ...commands, ...settings].map((r) => r.label))
  const groups: SearchGroup[] = []
  const add = (title: string, rows: SearchRow[]) => rows.length && groups.push({ title, rows })
  if (!docsLast) add('문서', docs)
  add('화면', screens)
  add('명령', commands)
  add('설정', settings)
  add(q ? '할 일 · 목표' : '안 끝난 할 일 · 목표', work)
  add(q ? '사건' : '열린 사건', events)
  if (docsLast) add('문서', docs)
  add('빠른 실행', quick)
  const nothing = !!q && !screens.length && !commands.length && !settings.length && !work.length && !events.length && !docs.length
  return { groups, nothing }
}
