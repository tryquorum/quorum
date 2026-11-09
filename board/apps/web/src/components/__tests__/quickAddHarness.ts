// 웹 빠른 추가 세 화면(한 줄·상세 시트·목표 할 일)의 DOM 하네스(PR #39 리뷰 19). 시험 파일 여럿이 같이 써요(PR #43 리뷰 2 — 한 파일 600줄 상한).
// 시험 전용 devDependency happy-dom 의 DOM 위에 실제 컴포넌트를 그리고(새 런타임 의존성 없음), 저장은 그 DOM 의 localStorage, 서버 요청은 주입 fetch.
// 모듈은 한 번만 실행돼요. 시험 파일은 맨 위에서 useQuickAddHarness() 를 불러요(전역 깔기·시험마다 비우기·끝나면 되돌리기).
import { afterAll, beforeAll, beforeEach } from "bun:test"
import { Window } from "happy-dom"

const win = new Window({ url: "http://127.0.0.1:3191/" })
const g = globalThis as Record<string, unknown>
// 같은 프로세스의 다른 시험 파일이 DOM 없는 전역을 보도록 끝나면 되돌려요
const DOM_KEYS = ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Node", "Text", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "InputEvent", "CustomEvent", "MutationObserver", "DocumentFragment", "SVGElement", "NodeFilter", "localStorage", "sessionStorage", "getComputedStyle", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", "IS_REACT_ACT_ENVIRONMENT", "fetch"]
const before = new Map(DOM_KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(g, k)]))

const saved: Record<string, unknown>[] = []
// 시험이 바꾸는 값(모듈 밖에서 다시 넣을 수 없어 객체로): 항목 저장 결과·AI 실행 끝남·다시 시도 횟수
// models: 모델 목록을 열어 AI 정리를 쓸 수 있게, onRun: AI 실행 응답 직전(그사이 다른 탭이 바꾸는 경우)
const state: { saveResult: boolean | "unknown"; runDone: boolean; retries: number; onSave: (() => void) | null; models: boolean; onRun: (() => void) | null } = { saveResult: true, runDone: false, retries: 0, onSave: null, models: false, onRun: null }
const fakeFetch = (async (url: string, init?: { method?: string }) => {
  const path = String(url)
  if (path === "/api/runs" && init?.method === "POST") { state.onRun?.(); return Response.json({ id: "run-ai", created_at: 1, status: "running" }) }
  if (/^\/api\/runs\/[^/]+\/effects/.test(path)) return Response.json(state.runDone ? { run: { id: "run1", status: "done" }, effects: [] } : {})
  if (path.startsWith("/api/runs")) return Response.json({ runs: [] })
  if (path.startsWith("/api/models")) return state.models ? Response.json({ providers: [{ id: "aside", label: "Aside", status: "ok", models: [{ id: "m", name: "M", efforts: ["high"] }] }], default: { provider: "aside", modelId: "m", effort: "high" } }) : Response.json({ error: "none" }, { status: 404 })
  return Response.json({})
}) as typeof fetch
/** 전역 DOM·주입 fetch 를 깔아요(모듈을 읽을 때 한 번, 시험 파일마다 beforeAll 에서 다시 — 앞 파일이 끝나며 되돌려요) */
function install() {
  for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Node", "Text", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "InputEvent", "CustomEvent", "MutationObserver", "DocumentFragment", "SVGElement", "NodeFilter", "localStorage", "sessionStorage"] as const)
    g[k] = (win as unknown as Record<string, unknown>)[k]
  g.getComputedStyle = win.getComputedStyle.bind(win)
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0)
  g.cancelAnimationFrame = (id: number) => clearTimeout(id)
  g.matchMedia = win.matchMedia.bind(win)
  // 칩 트레이가 높이를 재요(시험 DOM 에는 없어 아무것도 하지 않는 대역)
  g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  g.IS_REACT_ACT_ENVIRONMENT = true
  g.fetch = fakeFetch
}
install()

const React = await import("react")
const { createRoot } = await import("react-dom/client")
const { QuickAddProvider, QuickAddBar } = await import("@/components/quick-add")
const { GoalOverview } = await import("@/components/goal-view")
const { SpaceContext } = await import("@/hooks/use-space")
const { slotFor, stallTimer } = await import("@direction-board/contracts/quick-recovery")
const { CAPTURE_STORE } = await import("@direction-board/contracts/capture")
const { draftKey, editKey, recordKey, slotKey, writeEdit } = await import("@/lib/quick-slot")
// 자리마다 키 하나(PR #43 리뷰): 그 범위의 자리 키들(base + "." + 자리)을 모아 { 자리: 값 } 으로(비운 자리 null 은 빼요)
const store0 = localStorage
const allUnder = (base: string): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (let i = 0; i < store0.length; i++) {
    const k = store0.key(i)
    if (!k?.startsWith(base + ".")) continue
    const v: unknown = JSON.parse(store0.getItem(k) ?? "null")
    if (v !== null) out[decodeURIComponent(k.slice(base.length + 1))] = v
  }
  return out
}
const editsText = (scope: string) => JSON.stringify(allUnder(editKey(scope)))
type Board = import("@/lib/api").Board
type Item = import("@/lib/api").Item
type Api = import("@/components/quick-add").QuickAddApi

const A = "http://127.0.0.1:3191|a@x.test"
const B = "http://127.0.0.1:3191|b@x.test"
const boards: Board[] = [
  { id: "pb", name: "나", kind: "personal", mine: true, areas: [] } as unknown as Board,
  { id: "cb", name: "회사", kind: "company", mine: false, areas: [] } as unknown as Board,
]
const goal: Item = { id: "g1", boardId: "pb", type: "goal", text: "개인 목표", x: 0, y: 0, w: 1, h: 1, space: "personal" }
const spaces = [{ id: "personal", name: "개인", kind: "personal" }, { id: "ws_1", name: "회사", kind: "workspace" }]
const act = React.act
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let container: HTMLElement
let root: ReturnType<typeof createRoot>
const handle = { current: null as Api | null }
function App({ scope, goalView = false, space = "personal" }: { scope: string | null; goalView?: boolean; space?: string }) {
  const env = { boards, boardId: "pb", items: [goal], save: async () => true, saveKnown: async (it: Item) => { saved.push(it as Record<string, unknown>); state.onSave?.(); return state.saveResult }, onOpenWork: () => {}, scope, boardsReady: true, space, retry: () => { state.retries++ } }
  return React.createElement(SpaceContext.Provider, { value: { spaces: spaces as never, view: "all", setView: () => {}, me: { email: "a@x.test" } as never } },
    React.createElement(QuickAddProvider, { ...env, handle } as never,
      goalView
        ? React.createElement(GoalOverview, { workRef: "item:pb:g1", items: [goal], boards, save: async () => true, patchSignal: async () => {}, onOpen: () => {} })
        : React.createElement(QuickAddBar)))
}
const render = async (scope: string | null, goalView = false, space = "personal") => { await act(async () => { root.render(React.createElement(App, { scope, goalView, space })) }); await act(async () => { await sleep(10) }) }
const q = <T extends Element>(sel: string) => document.querySelector(sel) as unknown as T | null
const typeInto = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el.tagName === "TEXTAREA" ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value)
    el.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event)
  })
}
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click() }); await act(async () => { await sleep(10) }) }
const buttonByText = (t: string) => [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith(t)) as HTMLButtonElement | undefined


const reset = async () => {
  if (root) await act(async () => root.unmount())
  document.body.innerHTML = ""
  localStorage.clear()
  saved.length = 0
  state.saveResult = true
  state.runDone = false
  state.onSave = null
  state.onRun = null
  container = document.createElement("div") as unknown as HTMLElement
  document.body.appendChild(container as never)
  root = createRoot(container)
}

/** 화면을 내리고 새 뿌리에 다시 그릴 준비(저장은 그대로) */
const remount = async () => {
  if (root) await act(async () => root.unmount())
  root = createRoot(container)
}
const openSheet = async () => { await act(async () => { handle.current?.open("", null) }); await act(async () => { await sleep(30) }) }

function useQuickAddHarness() {
  beforeAll(install)
  beforeEach(reset)
  afterAll(async () => {
    if (root) await act(async () => root.unmount())
    for (const [k, d] of before) {
      if (d) Object.defineProperty(g, k, d)
      else delete g[k]
    }
  })
}

export { useQuickAddHarness, remount, openSheet, state, win, React, act, sleep, q, typeInto, click, buttonByText, render, handle, saved, allUnder, editsText, A, B, boards, goal, slotFor, stallTimer, CAPTURE_STORE, draftKey, editKey, recordKey, slotKey, writeEdit }
