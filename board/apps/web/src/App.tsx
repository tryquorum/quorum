import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppSidebar, isView, type View } from "@/components/app-sidebar"
import { CommandDock } from "@/components/command-dock"
import { DockButton } from "@/components/dock-button"
import { CommandPalette } from "@/components/command-palette"
import { Home } from "@/components/home"
import { LoadErrorBoundary, LoadingSkeleton } from "@/components/load-error-boundary"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Bell } from "lucide-react"
import { useRunWatch } from "@/hooks/use-run-watch"
import { useBoard, useSignals, useStored } from "@/hooks/use-data"
import { SpaceContext } from "@/hooks/use-space"
import { filterBySpace, type SpaceView } from "@/lib/spaces"
import { IssueButton, IssuesView } from "@/components/issues"
import { useIsMobile } from "@/hooks/use-mobile"
import { setTitle } from "@/lib/brand"
import "@/lib/archived-safety"
import { documentHash, parseDocumentHash } from "@/lib/document-route"
import { DocumentNav } from "@/components/document-nav"
import { QuickAddButton, QuickAddProvider, type QuickAddApi } from "@/components/quick-add"
import { openDecideCount } from "@/lib/capture"
import { DocCreateProvider } from "@/components/doc-create"
import { DocMoveProvider } from "@/components/doc-move"
import { useShortcut, useShortcutHelp } from "@/components/shortcut-dispatch"
import { legacySettingsHash, parseSettingsHash, settingsHash } from "@/lib/settings-registry"
import type { WebSectionId as SettingsSectionId } from "@/lib/settings-registry"
import { ApiError } from "@/lib/api"
import { confirmUnsavedPrompt, runSweepNow } from "@/hooks/use-ops"
import { toast } from "sonner"

const DocsView = lazy(() => import("@/components/docs-view").then((m) => ({ default: m.DocsView })))
const DocumentPage = lazy(() => import("@/components/document-page").then((m) => ({ default: m.DocumentPage })))
const ListView = lazy(() => import("@/components/list-view").then((m) => ({ default: m.ListView })))
const RoadmapView = lazy(() => import("@/components/roadmap-view").then((m) => ({ default: m.RoadmapView })))
const WorkView = lazy(() => import("@/components/work-view").then((m) => ({ default: m.WorkView })))
const SettingsView = lazy(() => import("@/components/settings/settings-view").then((m) => ({ default: m.SettingsView })))
const WorkDialog = lazy(() => import("@/components/work-view").then((m) => ({ default: m.WorkDialog })))

const TITLE: Record<View, string> = { home: "홈", board: "보드", road: "로드맵", list: "전체 목록", docs: "문서", settings: "설정", issues: "이슈" }

/** 주소: #/home  #/board  #/road  #/list  #/settings[/<섹션>][?item=<항목>]  #/w/<일 주소>  (일 페이지는 뒤로가기로 돌아온다). 옛 #/ops 는 #/settings/ops 로 바꿔 열어요 */
type Route = { view: View; work: string | null; pane: string; doc?: string | null; settings?: { section: SettingsSectionId | null; item: string | null } }
/** 설정의 "시작 화면". 주소 없이 열 때만 */
const startView = (): View => {
  try {
    const v = JSON.parse(localStorage.getItem("db:start") || "null")
    return typeof v === "string" && isView(v) && v !== "settings" ? v : "home"
  } catch { return "home" }
}
const readRoute = (): Route => {
  // 옛 주소는 기록을 바꿔치기해서 뒤로가기에 옛 주소가 남지 않게
  const legacy = legacySettingsHash(location.hash)
  if (legacy) history.replaceState(history.state, "", legacy)
  const h = location.hash.replace(/^#\/?/, "")
  const settings = parseSettingsHash(location.hash)
  if (settings) return { view: "settings", work: null, pane: "note", settings }
  if (!h) return { view: startView(), work: null, pane: "note" }
  const doc = parseDocumentHash(location.hash)
  if (doc) return {view:'docs',work:null,pane:'note',doc}
  if (h.startsWith('docs?')) return {view:'docs',work:null,pane:'note'}
  if (h.startsWith("w/")) {
    const [ref, pane] = h.slice(2).split("/")
    return { view: "home", work: decodeURIComponent(ref), pane: pane ? decodeURIComponent(pane) : "note" }
  }
  return { view: isView(h) ? h : "home", work: null, pane: "note" }
}
const workHash = (ref: string, pane = "note") => `#/w/${encodeURIComponent(ref)}${pane === "note" ? "" : `/${encodeURIComponent(pane)}`}`

export function App() {
  const runWatch = useRunWatch()
  const [route, setRoute] = useState<Route>(readRoute)
  const [lastView, setLastView] = useState<View>(route.view)
  const [dialogRef, setDialogRef] = useState<string | null>(null)
  const [dialogLoaded, setDialogLoaded] = useState(false)
  const dialogOpener = useRef<HTMLElement | null>(null)
  const [dialogPane, setDialogPane] = useState<string>("note")
  const pushedFromApp = useRef(false)
  const mobile = useIsMobile()
  const board = useBoard()
  // 보드 할 일·미리알림·목표를 일 화면(팝업/페이지)에서 끝냄/다시 열기
  const setItemDone = useCallback(async (ref: string, done: boolean) => {
    const [, bid, iid] = ref.split(":")
    const it = board.items.find((i) => i.boardId === bid && i.id === iid)
    if (!it) return false
    return (await board.save({ ...it, done })) ? true : "failed" as const
  }, [board])
  const sig = useSignals()
  // 공간 보기(사이드바 머리에서 고름). 사라진 공간은 "모든 공간"으로. 파일럿 멤버는 회사 공간만 받아요
  const [spaceStored, setSpaceView] = useStored<SpaceView>("db:space", "all")
  const spaceView: SpaceView = spaceStored === "all" || board.spaces.some((s) => s.id === spaceStored) ? spaceStored : "all"
  const member = board.profile?.role === "member"
  const shown = useMemo(() => filterBySpace(board.items, sig.signals, spaceView), [board.items, sig.signals, spaceView])
  const sigShown = useMemo(() => ({ ...sig, signals: shown.signals }), [sig, shown.signals])
  const spaceCtx = useMemo(() => ({ spaces: board.spaces, view: spaceView, setView: setSpaceView, me: board.profile }), [board.spaces, spaceView, setSpaceView, board.profile])
  const newSpace = member ? board.spaces.find((s) => s.kind === "workspace")?.id ?? "personal" : spaceView === "all" ? "personal" : spaceView
  const boardState = useMemo(() => ({ status: board.status, hasData: board.hasData, retry: board.reload }), [board.status, board.hasData, board.reload])
  const signalState = useMemo(() => ({ status: sig.status, hasData: sig.hasData, retry: sig.load }), [sig.status, sig.hasData, sig.load])
  // ⌘K 명령 팔레트: 열기 직전 포커스를 기억해 두었다가 그냥 닫으면 돌려준다
  const [paletteOpen, setPaletteOpen] = useState(false)
  const paletteOpenRef = useRef(paletteOpen)
  useEffect(() => {
    paletteOpenRef.current = paletteOpen
  }, [paletteOpen])
  // 일 팝업과 노트 편집기 코드는 앱이 한가할 때 미리 받아 둬요. 처음 열 때 자리 표시가 끼었다 바뀌지 않게
  useEffect(() => {
    const preload = () => { void import("@/components/work-view"); void import("@/components/note-editor") }
    if ("requestIdleCallback" in window) window.requestIdleCallback(preload, { timeout: 4000 })
    else setTimeout(preload, 1500)
  }, [])
  const paletteFrom = useRef<HTMLElement | null>(null)
  const quickAdd = useRef<QuickAddApi | null>(null)
  const openPalette = useCallback((returnTo?: HTMLElement | null) => {
    const el = returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    if (!el?.closest("[data-command-palette]")) paletteFrom.current = el
    setPaletteOpen(true)
  }, [])
  const returnFocus = useCallback(() => {
    const el = paletteFrom.current
    if (el?.isConnected) el.focus()
  }, [])
  // ⌘K·Ctrl+K. 키와 판정은 단축키 레지스트리(lib/shortcuts.ts palette.toggle)
  useShortcut("palette.toggle", () => {
    if (paletteOpenRef.current) setPaletteOpen(false)
    else openPalette()
  })
  // ⌘,·Ctrl+, (settings.open). 팔레트가 열려 있으면 닫고 설정으로
  useShortcut("settings.open", () => {
    setPaletteOpen(false)
    location.hash = settingsHash().slice(1)
  })
  const openHelp = useShortcutHelp()
  const askTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (askTimer.current) window.clearTimeout(askTimer.current)
  }, [])
  const [boardId, setBoardId] = useStored<string | undefined>("db:board", undefined)
  const curBoard = board.boards.find((b) => b.id === boardId)?.id ?? board.personal?.id

  useEffect(() => {
    const on = () => {
      const r = readRoute()
      setRoute(r)
      if (!r.work) setLastView(r.view)
      setDialogRef(null)
    }
    addEventListener("hashchange", on)
    return () => removeEventListener("hashchange", on)
  }, [])

  const go = (v: View) => {
    location.hash = `/${v}`
  }
  // g 다음 글자로 화면 이동(리니어 관례)
  useShortcut("go.home", () => go("home"))
  useShortcut("go.list", () => go("list"))
  useShortcut("go.road", () => go("road"))
  useShortcut("go.docs", () => go("docs"))
  useShortcut("go.ops", () => { location.hash = settingsHash("ops").slice(1) })
  useShortcut("go.board", () => go("board"))
  // 팔레트의 "AI에게 묻기": 일 팝업이 열려 있으면 닫히고 포커스 가둠이 풀린 뒤 명령창에 넘긴다. 마지막 선택만
  const askDock = useCallback((text: string) => {
    if (askTimer.current) window.clearTimeout(askTimer.current)
    askTimer.current = null
    const fire = () => window.dispatchEvent(new CustomEvent("dock:ask", { detail: { text } }))
    if (dialogRef) {
      setDialogRef(null)
      askTimer.current = window.setTimeout(() => {
        askTimer.current = null
        fire()
      }, 260)
    } else fire()
  }, [dialogRef])
  const goPage = useCallback((ref: string, pane = "note") => {
    pushedFromApp.current = true
    location.hash = workHash(ref, pane).slice(1)
  }, [])
  const goDocument = useCallback((ref:string) => {pushedFromApp.current = true; setDialogRef(null); location.hash = documentHash(ref).slice(1)}, [])
  const setPane = useCallback((pane: string, replace?: boolean) => {
    if (!route.work) return
    if (replace) {
      history.replaceState(null, "", workHash(route.work, pane))
      setRoute((r) => ({ ...r, pane }))
    } else location.hash = workHash(route.work, pane).slice(1)
  }, [route.work])
  // 데스크탑: 가운데 팝업 / 모바일: 페이지로 이동
  // 목표(type === "goal")는 데스크탑·모바일 모두 목표 페이지(#/w/<ref>)로 연다
  // pane: 바로 열 칸 (예: "c:<대화 id>" 로 그 대화)
  const openWork = useCallback((ref: string, pane = "note") => {
    const isGoal = board.items.some((i) => i.type === "goal" && `item:${i.boardId}:${i.id}` === ref)
    if (mobile || isGoal) return goPage(ref, pane)
    dialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDialogLoaded(true)
    setDialogPane(pane)
    setDialogRef(ref)
  }, [mobile, goPage, board.items])
  const closePage = () => {
    if (pushedFromApp.current && history.length > 1) history.back()
    else location.hash = `/${lastView}`
  }
  const [hiddenSig, setHiddenSig] = useState<ReadonlySet<string>>(() => new Set())
  const onHidden = useCallback((next: ReadonlySet<string>) => setHiddenSig((prev) => (prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next)), [])
  const decideCount = openDecideCount(sig.signals, hiddenSig)
  const isGoalWork = !!route.work && board.items.some((i) => i.type === "goal" && `item:${i.boardId}:${i.id}` === route.work)
  const workTitle = route.work ? (isGoalWork ? "목표" : "일") : TITLE[route.view]
  const routeKey = route.doc ? `d:${route.doc}` : route.work ? `w:${route.work}` : `v:${route.view}`
  const routeContent = useRef<HTMLDivElement>(null)
  const previousRoute = useRef(routeKey)
  const focusIntent = useRef<"title" | null>(null)
  const onNavigate = (target: string) => {
    const targetGoal = target.startsWith("w:") && board.items.some((i) => i.type === "goal" && `w:item:${i.boardId}:${i.id}` === target)
    if (target === routeKey || (target.startsWith("w:") && !mobile && !targetGoal)) return false
    focusIntent.current = "title"
    document.body.dataset.focusIntent = "title"
    return true
  }
  useEffect(() => {
    if (previousRoute.current === routeKey) return
    previousRoute.current = routeKey
    const active = document.activeElement
    if (!focusIntent.current && (active === document.body || !active?.isConnected)) {
      focusIntent.current = "title"
      document.body.dataset.focusIntent = "title"
    }
    if (focusIntent.current !== "title") return

    let loadingTitle: HTMLElement | null = null
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      observer.disconnect()
      window.clearTimeout(timer)
      document.removeEventListener("focusin", onFocus)
      document.removeEventListener("pointerdown", finish)
      document.removeEventListener("keydown", finish)
      focusIntent.current = null
      delete document.body.dataset.focusIntent
    }
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof Element) || !event.target.hasAttribute("data-page-title")) finish()
    }
    const focusTitle = () => {
      if (loadingTitle?.isConnected) return
      const container = routeContent.current
      if (!container || container.dataset.route !== routeKey) return
      const title = container.querySelector<HTMLElement>("[data-page-title]")
      if (!title) return
      title.focus({ preventScroll: true })
      if (document.activeElement !== title) return
      if (title.dataset.pageTitle === "loading") loadingTitle = title
      else finish()
    }
    const observer = new MutationObserver(focusTitle)
    observer.observe(document.body, { childList: true, subtree: true })
    const timer = window.setTimeout(finish, 5000)
    document.addEventListener("focusin", onFocus)
    document.addEventListener("pointerdown", finish)
    document.addEventListener("keydown", finish)
    focusTitle()
    return finish
  }, [routeKey])

  useEffect(() => { setTitle(dialogRef || route.work ? "일" : TITLE[route.view], runWatch.unread) }, [dialogRef, route.work, route.view, runWatch.unread])
  // AI 정리가 보는 화면: 열어 둔 일(대화상자 또는 일 페이지)
  const openedWork = dialogRef ?? route.work

  return (
    <SpaceContext.Provider value={spaceCtx}>
    <TooltipProvider>
      <QuickAddProvider handle={quickAdd} boards={board.boards} boardId={curBoard} items={board.items} signals={sig.signals} onHidden={onHidden} save={board.save} saveKnown={board.saveKnown} boardsReady={board.hasData} scope={board.me ? `${window.location.origin}|${board.me}` : null} onOpenWork={openWork} space={newSpace} retry={board.reload}
        page={{ view: route.work ? lastView : route.view, ...(curBoard ? { board: curBoard } : {}), ...(openedWork ? { work: openedWork } : {}) }}>
      <DocCreateProvider onOpenDoc={goDocument}>
      <DocMoveProvider>
      <SidebarProvider>
        <AppSidebar
          view={route.work ? lastView : route.view}
          onView={go}
          onNavigate={onNavigate}
          onSearch={() => openPalette(mobile ? document.querySelector<HTMLElement>('[data-sidebar="trigger"]') : undefined)}
          boards={board.boards}
          boardId={curBoard}
          onBoard={setBoardId}
          items={shown.items}
          save={board.save}
          signals={shown.signals}
          patchSignal={sig.patch}
          me={board.me}
          syncOk={board.status !== "error" && !board.saveFailed}
          syncText={board.status === "error" ? "연결 안 됨" : board.saveFailed ? "저장 못 함" : "저장됨"}
          decideCount={decideCount}
          onOpenWork={openWork}
          activeWorkRef={route.work}
          docNav={route.doc ? (navigate) => <DocumentNav docRef={route.doc!} onOpen={(ref) => navigate(`d:${ref}`, () => goDocument(ref))} /> : undefined}
        />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur">
            <SidebarTrigger className="mr-1" />
            {route.work ? (
              <nav aria-label="현재 위치" className="flex min-w-0 items-center gap-1.5 text-sm">
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={closePage}>{TITLE[lastView]}</button>
                <span className="text-muted-foreground">/</span>
                <span className="truncate font-medium">{workTitle}</span>
              </nav>
            ) : (
              <span className="text-sm font-medium">{TITLE[route.view]}</span>
            )}
            <span className="ml-auto" />
            <IssueButton />
            {!member && <QuickAddButton keyHint={!(route.doc || (!route.work && route.view === "docs"))} />}
            {!member && <DockButton />}
            <Popover>
              <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" className="relative" aria-label="완료 알림 설정"><Bell />{runWatch.unread > 0 && <span aria-hidden className="absolute right-1 top-1 size-2 rounded-full bg-running" />}</Button></PopoverTrigger>
              <PopoverContent align="end" className="p-4">
                <p className="font-medium">완료 알림</p>
                <p className="text-muted-foreground">AI에게 맡긴 일이 끝나면 탭 제목과 알림으로 알려줘요. 질문과 답 내용은 알림에 넣지 않아요.</p>
                <div className="flex items-center justify-between gap-3"><span>시스템 알림</span><Switch aria-label="시스템 알림" checked={runWatch.enabled} disabled={runWatch.permission === "denied" || runWatch.permission === "unsupported"} onCheckedChange={(on) => { if (on) void runWatch.enableNotifications(); else runWatch.disableNotifications() }} /></div>
                {runWatch.permission === "denied" && <p role="status" className="text-muted-foreground">브라우저 설정에서 알림을 허용해 주세요</p>}
                {runWatch.permission === "unsupported" && <p role="status" className="text-muted-foreground">이 브라우저에서는 시스템 알림을 쓸 수 없어요</p>}
              </PopoverContent>
            </Popover>
          </header>
          <div ref={routeContent} data-route={routeKey} className="pb-(--tray-space)">
          <LoadErrorBoundary key={routeKey}><Suspense fallback={<LoadingSkeleton />}>
          {route.doc ? (
            <DocumentPage key={route.doc} docRef={route.doc} onOpen={goDocument} onBack={closePage} onTag={(tag) => {location.hash = `/docs?tag=${encodeURIComponent(tag)}`}} />
          ) : route.work ? (
            <WorkView key={route.work} workRef={route.work} mode="page" onOpen={(r) => openWork(r)} onOpenDocument={goDocument} onClose={closePage} onChanged={sig.load} patchSignal={sig.patch} setItemDone={setItemDone} items={board.items} boards={board.boards} save={board.save} pane={route.pane} onPane={setPane} />
          ) : route.view === "home" ? (
            <Home sig={sigShown} items={shown.items} boards={board.boards} save={board.save} onOpenWork={openWork} boardStatus={board.status} boardHasData={board.hasData} reloadBoard={board.reload} />
          ) : route.view === "road" ? (
            <RoadmapView items={shown.items} boards={board.boards} boardId={curBoard} signals={shown.signals} boardState={boardState} signalState={signalState} onOpenWork={openWork} />
          ) : route.view === "list" ? (
            <ListView items={shown.items} boards={board.boards} boardId={curBoard} signals={shown.signals} boardState={boardState} signalState={signalState} save={board.save} patchSignal={sig.patch} onOpenWork={openWork} />
          ) : route.view === "issues" ? (
            <IssuesView onOpenWork={openWork} />
          ) : route.view === "docs" ? (
            <DocsView onOpen={goDocument} />
          ) : route.view === "settings" ? (
            <SettingsView section={route.settings?.section ?? null} item={route.settings?.item ?? null} />
          ) : (
            <LegacyFrame view={route.view} boardId={curBoard} />
          )}
          </Suspense></LoadErrorBoundary>
          </div>
        </SidebarInset>
      </SidebarProvider>
      {/* 팝업 코드를 받는 동안은 덮개도 아직 없으니 아무것도 그리지 않아요(페이지 아래에 스켈레톤이 잠깐 끼지 않게) */}
      {dialogLoaded && <LoadErrorBoundary><Suspense fallback={null}><WorkDialog
        workRef={dialogRef}
        initialPane={dialogPane}
        onOpenRef={setDialogRef}
        onOpenDocument={goDocument}
        onReturnFocus={() => { if (dialogOpener.current?.isConnected) dialogOpener.current.focus(); else if (route.view === 'docs') document.querySelector<HTMLInputElement>('input[aria-label="문서 검색"]')?.focus() }}
        onClose={() => setDialogRef(null)}
        onExpand={(ref, pane) => {
          setDialogRef(null)
          goPage(ref, pane)
        }}
        onChanged={sig.load}
        patchSignal={sig.patch}
        setItemDone={setItemDone}
        items={board.items}
        boards={board.boards}
        save={board.save}
      /></Suspense></LoadErrorBoundary>}
      {/* AI 명령창은 어느 화면에서나 머리글의 AI 단추나 "/" 로 연다 */}
      {!member && <CommandDock
        view={route.work ? lastView : route.view}
        workRef={dialogRef ?? route.work}
        boardId={curBoard}
      />}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        boards={board.boards}
        items={board.items}
        signals={sig.signals}
        signalsStatus={sig.status}
        onView={(v) => {
          setDialogRef(null)
          go(v)
        }}
        onOpenWork={(ref) => openWork(ref)}
        onOpenDocument={goDocument}
        onSettings={(section, item) => {
          setDialogRef(null)
          const target = settingsHash(section, item)
          // 이미 그 항목 주소면 hashchange 가 없으니 설정창에 다시 강조하라고 알려요
          if (location.hash === target) window.dispatchEvent(new CustomEvent("settings:focus", { detail: item }))
          else location.hash = target.slice(1)
        }}
        onNewTask={(text) => {
          setDialogRef(null)
          quickAdd.current?.open(text, paletteFrom.current)
        }}
        onAsk={askDock}
        onShortcuts={openHelp}
        onRunSweep={() => {
          setDialogRef(null)
          if (!confirmUnsavedPrompt()) return
          runSweepNow().then(() => { toast.success("순회를 시작했어요. 끝나면 홈에 올라와요"); void sig.load() }, (e: unknown) => {
            toast.error(e instanceof ApiError && e.status === 403 ? "운영 순회는 이 맥의 주인만 돌릴 수 있어요" : e instanceof Error && e.message ? e.message : "시작하지 못했어요")
          })
        }}
        returnFocus={returnFocus}
      />
      </DocMoveProvider>
      </DocCreateProvider>
      </QuickAddProvider>
      <Toaster position="bottom-center" />
    </TooltipProvider>
    </SpaceContext.Provider>
  )
}

/** 화이트보드는 아직 옛 화면을 그대로 쓴다 (옛 사이드바·헤더는 숨김). React로 옮기기 전까지의 다리 */
function LegacyFrame({ view, boardId }: { view: View; boardId: string | undefined }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [src] = useState(() => `/legacy/?embed=1&view=${view}${boardId ? `&board=${boardId}` : ""}`)
  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ type: "db:view", view, boardId }, location.origin)
  }, [view, boardId])
  return <iframe ref={ref} src={src} title={TITLE[view]} className="h-[calc(100svh-3rem)] w-full border-0" />
}

export default App
