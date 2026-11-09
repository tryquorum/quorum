// iOS 빠른 추가 세 화면(한 줄·상세 시트·목표 할 일)의 컴포넌트 하네스(PR #39 리뷰 21). 시험 파일 여럿이 같이 써요(PR #43 리뷰 — 한 파일 600줄 상한).
// 시험 전용 devDependency happy-dom·react-dom 위에 실제 화면 컴포넌트와 실제 기록·편집 초안 훅(pendingSlot·editSlot)·지금 판(parts)을 그려요.
// react-native·네비게이션·서버 훅은 작은 대역으로 바꾸고(mock.module), 기기 저장은 실제 SmallStore 에 시험이 정하는 입출력(늦게 읽기·쓰기 실패)을 붙여요.
// 모듈은 한 번만 실행돼요(대역·저장소를 시험 파일들이 나눠 써요). 시험 파일은 맨 위에서 useQuickHarness() 를 불러요.
import { afterAll, beforeAll, beforeEach, mock } from 'bun:test'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://127.0.0.1:3181/' })
const g = globalThis as Record<string, unknown>
const KEYS = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'Element', 'Node', 'Text', 'Event', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'InputEvent', 'CustomEvent', 'MutationObserver', 'DocumentFragment', 'IS_REACT_ACT_ENVIRONMENT', 'requestAnimationFrame', 'cancelAnimationFrame']
const before = new Map(KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(g, k)]))
for (const k of KEYS.slice(0, 18)) g[k] = (win as unknown as Record<string, unknown>)[k]
g.IS_REACT_ACT_ENVIRONMENT = true
g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0)
g.cancelAnimationFrame = (id: number) => clearTimeout(id)

const React = await import('react')
type Props = Record<string, unknown> & { children?: unknown }
const h = React.createElement
const kids = (p: Props) => (typeof p.children === 'function' ? (p.children as (s: { pressed: boolean }) => unknown)({ pressed: false }) : p.children) as React.ReactNode
const alerts: { title: string; message?: string; buttons?: { text: string; onPress?: () => void }[] }[] = []
mock.module('react-native', () => ({
  View: (p: Props) => h('div', { 'aria-label': p.accessibilityLabel as string | undefined, role: p.accessibilityRole as string | undefined }, kids(p)),
  Text: (p: Props) => h('span', { role: p.accessibilityRole as string | undefined }, kids(p)),
  ScrollView: (p: Props) => h('div', null, kids(p)),
  Pressable: (p: Props) => h('button', { type: 'button', 'aria-label': p.accessibilityLabel as string | undefined, disabled: !!p.disabled, onClick: () => (p.onPress as (() => void) | undefined)?.() }, kids(p)),
  TextInput: (p: Props) =>
    h(p.multiline ? 'textarea' : 'input', {
      value: (p.value as string) ?? '',
      disabled: p.editable === false,
      placeholder: p.placeholder as string | undefined,
      'aria-label': p.accessibilityLabel as string | undefined,
      onChange: (e: { target: { value: string } }) => (p.onChangeText as ((v: string) => void) | undefined)?.(e.target.value),
      onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') (p.onSubmitEditing as (() => void) | undefined)?.() },
    }),
  StyleSheet: { create: <T,>(x: T) => x, flatten: <T,>(x: T) => x, hairlineWidth: 1 },
  Alert: { alert: (title: string, message?: string, buttons?: { text: string; onPress?: () => void }[]) => void alerts.push({ title, message, buttons }), prompt: () => {} },
  ActionSheetIOS: { showActionSheetWithOptions: () => {} },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  DynamicColorIOS: (c: { light: string }) => c.light,
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  Animated: { View: (p: Props) => h('div', null, kids(p)), Value: class { setValue() {} interpolate() { return 0 } }, timing: () => ({ start: () => {} }), spring: () => ({ start: () => {} }), event: () => () => {} },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  AccessibilityInfo: { announceForAccessibility: () => {}, isReduceMotionEnabled: async () => false },
  ActivityIndicator: () => null,
  Keyboard: { dismiss: () => {}, addListener: () => ({ remove: () => {} }) },
  Modal: (p: Props) => h('div', null, kids(p)),
  RefreshControl: () => null,
  Share: { share: async () => ({}) },
}))
mock.module('expo-symbols', () => ({ SymbolView: () => null }))
const nav = { navigate: mock(() => {}), goBack: mock(() => {}), dispatch: mock(() => {}), setOptions: () => {}, listeners: new Map<string, ((e: unknown) => void)[]>(), addListener(name: string, cb: (e: unknown) => void) { const l = this.listeners.get(name) ?? []; l.push(cb); this.listeners.set(name, l); return () => this.listeners.set(name, (this.listeners.get(name) ?? []).filter((x) => x !== cb)) } }
mock.module('@react-navigation/native', () => ({ useNavigation: () => nav }))
const toasts: string[] = []
const toastFn = (m: string) => void toasts.push(m)
mock.module('../../../../ui/Toast', () => ({ useToast: () => toastFn }))
type Board = import('@direction-board/contracts').Board
type Item = import('@direction-board/contracts').Item
const boards: Board[] = [{ id: 'pb', name: '나', kind: 'personal', mine: true, areas: [] } as unknown as Board]
const goal: Item = { id: 'g1', boardId: 'pb', type: 'goal', text: '개인 목표', x: 0, y: 0, w: 1, h: 1, space: 'personal' } as Item
let refreshes = 0
const boardState: { data: { boards: Board[]; items: Item[] } | undefined; status: string; refresh: () => Promise<void> } = { data: { boards, items: [goal] }, status: 'ok', refresh: async () => { refreshes++ } }
mock.module('../../../../api/board', () => ({ useBoardState: () => boardState, useSaveItem: () => async () => {} }))
mock.module('expo-crypto', () => ({ randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2), digestStringAsync: async () => 'h', CryptoDigestAlgorithm: { SHA256: 'SHA256' } }))
// AI 정리 칩(실제 useCaptures)이 묻는 모델 목록·쓰기 범위
mock.module('../../../../api/query', () => ({ useQuery: () => ({ status: 'ok', data: [{ id: 'm' }], error: null, fetching: false, refresh: async () => {} }) }))
mock.module('../../../../api/scope', () => ({ useWriteScope: () => ({ scope: 'http://127.0.0.1:3181|anon', same: () => true, client: () => ({ origin: 'http://127.0.0.1:3181', scope: 'http://127.0.0.1:3181|anon', same: () => true }) }) }))
mock.module('../../../../server', () => ({ useServer: () => ({ origin: 'http://127.0.0.1:3181' }) }))
// 칩 트레이 대역: 첫 칩을 닫는 단추 하나(칩 쓰기 실패 칸을 사람 동작으로 일으켜요)
mock.module('../CaptureTray', () => ({ CaptureTray: ({ c }: { c: { entries: { id: string }[]; dismiss: (id: string) => void } }) => h('button', { type: 'button', 'aria-label': '칩 닫기', onClick: () => c.dismiss(c.entries.find((e) => !(e as { dismissed?: boolean }).dismissed)?.id ?? '') }) }))
const created: string[] = []
const confirms: string[] = []
// createDone: 제출이 끝(done)나게, beforeDone: 끝나기 직전(그사이 다른 곳이 바꾸는 경우)
const hooks: { beforeConfirm: (() => void) | null; createDone: boolean; beforeDone: (() => void) | null; onRead: ((name: string) => void) | null } = { beforeConfirm: null, createDone: false, beforeDone: null, onRead: null }
mock.module('../create', () => ({
  // 확인창 글(무엇이 버려지는지 — PR #43 리뷰)을 남기고 바로 고른 것으로 해요
  // hooks.beforeConfirm: 확인창이 뜬 뒤·사람이 고르기 전에 저장이 바뀌는 경우(규칙 F — PR #43 리뷰 2)
  confirmDiscard: (fn: () => void, message?: string) => { confirms.push(message ?? ''); hooks.beforeConfirm?.(); fn() },
  createdText: () => '추가했어요',
  stepFailureText: () => '실패',
  requestSheet: () => {},
  takeSheet: () => null,
  // 실제 흐름처럼 보내기 전에 기록을 먼저 남겨요(남기지 못하면 보내지 않아요 — 규칙 B·E)
  useCreateWork: () => async (text: string, makeDraft: () => unknown, _p: unknown, writeAhead: (p: unknown) => Promise<boolean>) => {
    const ok = await writeAhead({ id: 'w1', from: 'item', draft: makeDraft(), text, ref: null, scope: 'http://127.0.0.1:3181|anon' })
    if (!ok) return { kind: 'not-sent', message: '기록을 남기지 못해 보내지 않았어요' }
    created.push(text)
    if (hooks.createDone) {
      hooks.beforeDone?.()
      const draft = makeDraft() as { title: string }
      return { kind: 'done', result: { id: 'w1', ref: 'item:pb:w1', existed: false }, draft }
    }
    return { kind: 'not-sent', message: '시험' }
  },
}))
mock.module('../../actions', () => ({ useMain: () => ({ keys: [], toggle: () => {} }), useSetDone: () => async () => {} }))
mock.module('../../Goals', () => ({ goalSummary: () => ({ label: '진행', state: 'ok', due: '', late: false, pct: 0, progress: { done: 0, total: 0 }, basis: 'linked' }), Progress: () => null }))
mock.module('../../TaskRow', () => ({ TaskRow: () => null }))
// 기기 저장: 실제 SmallStore + 시험이 정하는 입출력
const { SmallStore } = await import('../../smallStore')
const disk = new Map<string, string>()
const gates = new Map<string, Promise<void>>()
const failWrites = new Set<string>()
const failReads = new Set<string>()
const writeGates = new Map<string, Promise<void>>()
let store = new SmallStore({ read: async () => null, write: async () => {} })
const fresh = () => {
  store = new SmallStore({
    read: async (name) => { await gates.get(name); hooks.onRead?.(name); if (failReads.has(name)) throw new Error('io'); return disk.get(name) ?? null },
    // 쓰기 실패는 그 이름과 그 이름의 자리별 파일(quickPending.<자리> — PR #43 리뷰)에 같이 걸려요. 쓰기 늦음은 writeGates(다음 쓰기 하나)
    write: async (name, text) => { const wait = writeGates.get(name) ?? writeGates.get(name.split('.')[0] ?? ''); if (wait) { writeGates.delete(name); writeGates.delete(name.split('.')[0] ?? ''); await wait } if (failWrites.has(name) || failWrites.has(name.split('.')[0] ?? '')) throw new Error('disk full'); disk.set(name, text) },
  })
}
const { useStoredIn } = await import('../../storedHook')
mock.module('../../stored', () => ({ useSmallStore: () => store, useStored: <T,>(name: string, init: T, check: (v: unknown) => v is T) => useStoredIn(store, name, init, check) }))

const { createRoot } = await import('react-dom/client')
const { QuickAddBar } = await import('../QuickAddBar')
const { QuickAddSheet } = await import('../QuickAddSheet')
const { GoalOverview } = await import('../../work/GoalOverview')
const { slotFor, EDITS } = await import('../recovery')
const act = React.act
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const q = <T extends Element>(sel: string) => document.querySelector(sel) as unknown as T | null
const typeInto = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event)
  })
}
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click() }); await act(async () => { await sleep(10) }) }
const settle = async (ms = 20) => { await act(async () => { await sleep(ms) }) }
const gate = (name: string) => { let open!: () => void; gates.set(name, new Promise<void>((r) => (open = r))); return () => act(async () => { open(); await sleep(20) }) }
const SAVE_FAILED_TEXT = '기기에 저장하지 못했어요'
const SHEET = slotFor('sheet', { boardId: 'pb', goalId: null, space: null })
const BAR = slotFor('bar', { boardId: 'pb' })
const GOAL = slotFor('goal', { boardId: 'pb', goalId: 'g1' })

let root: ReturnType<typeof createRoot> | undefined
const mount = async (el: React.ReactElement) => { await act(async () => { root?.render(el) }); await settle() }
const sheetEl = (params: { text?: string } = {}) => h(QuickAddSheet, { navigation: nav, route: { key: 'QuickAdd', name: 'QuickAdd', params } } as never)
const beforeRemove = () => { const e = { preventDefault: mock(() => {}), data: { action: { type: 'GO_BACK' } } }; for (const l of nav.listeners.get('beforeRemove') ?? []) l(e); return e }
/** 화면을 내리고 새 뿌리에 다시 그릴 준비(기기 저장은 그대로 두고 메모리 저장소만 새로 — 앱을 다시 연 것처럼) */
const remount = async () => {
  if (root) await act(async () => root?.unmount())
  const box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box as unknown as HTMLElement)
  fresh()
}
const install = () => {
  for (const k of KEYS.slice(0, 18)) g[k] = (win as unknown as Record<string, unknown>)[k]
  g.IS_REACT_ACT_ENVIRONMENT = true
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0)
  g.cancelAnimationFrame = (id: number) => clearTimeout(id)
}

/** 시험 파일 맨 위에서 불러요: 전역 DOM 을 깔고, 시험마다 저장·대역을 비우고, 끝나면 전역을 되돌려요 */
function useQuickHarness() {
  beforeAll(install)
  beforeEach(async () => {
    if (root) await act(async () => root?.unmount())
    document.body.innerHTML = ''
    const box = document.createElement('div')
    document.body.appendChild(box)
    root = createRoot(box as unknown as HTMLElement)
    disk.clear(); gates.clear(); writeGates.clear(); failWrites.clear(); failReads.clear(); alerts.length = 0; toasts.length = 0; created.length = 0; confirms.length = 0; hooks.beforeConfirm = null; hooks.createDone = false; hooks.beforeDone = null; hooks.onRead = null
    boardState.data = { boards, items: [goal] }; boardState.status = 'ok'; refreshes = 0
    nav.listeners.clear(); nav.navigate.mockClear(); nav.dispatch.mockClear(); nav.goBack.mockClear()
    fresh()
  })
  afterAll(async () => {
    if (root) await act(async () => root?.unmount())
    root = undefined
    for (const [k, d] of before) { if (d) Object.defineProperty(g, k, d); else delete g[k] }
  })
}
/** 다음 쓰기 하나를 붙잡아요(이름 또는 그 이름의 자리별 파일). 돌려준 함수가 풀어요 */
const holdWrite = (name: string) => { let open!: () => void; writeGates.set(name, new Promise<void>((r) => (open = r))); return () => act(async () => { open(); await sleep(20) }) }

export { useQuickHarness, remount, holdWrite, hooks, win, React, h, act, sleep, q, typeInto, click, settle, gate, mount, sheetEl, beforeRemove, nav, alerts, toasts, created, confirms, disk, gates, failWrites, failReads, boardState, boards, goal, store, refreshes, SHEET, BAR, GOAL, SAVE_FAILED_TEXT, QuickAddBar, QuickAddSheet, GoalOverview, slotFor, EDITS, useStoredIn }
