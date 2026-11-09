// Quorum Workspace (/w). 출처: board/apps/web/src/App.tsx 의 배치 — SidebarProvider + 왼쪽 사이드바 + 본문(SidebarInset),
// 해시 주소로 보기 바꾸기(#/now, #/inbox, #/goals, #/goal/<id>, #/signals, #/list), ⌘K 팔레트, 단축키 디스패처 하나, 상세 창.
// 첫 화면 "Now" 는 바로 처리할 일만: Needs you → Due today → Goals → Review → Inbox.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Keyboard, Search } from "lucide-react"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar"
import { TooltipProvider } from "./ui/tooltip"
import { cn } from "@/lib/utils"
import { ws, type Item, type Meta, type NowView, type Signal } from "./api"
import { ALERT, DECIDE } from "./tone"
import { CaptureBar } from "./capture-bar"
import { CommandPalette } from "./command-palette"
import { Detail, type Open } from "./detail"
import { ItemRow, SignalRow } from "./rows"
import { ShortcutHelp } from "./shortcut-help"
import { resolveShortcut } from "./shortcuts"
import { GoalHeader, groupByWhen, ListFilters, Roadmap, useListState, useSignalSections, type RowSpec, type SectionSpec } from "./views"
import { SyncButton, WsSidebar, useStored, type View } from "./ws-sidebar"
import { hashFor, parseHash, type Route } from "./route"
const TITLES: Record<View, string> = { now: "Now", inbox: "Inbox", goals: "Goals", signals: "Signals", list: "All tasks" }

/** 데이터: /api/ws/now 5초, 항목 전체 10초, 메타 30초. 실패해도 마지막 내용은 남기고 다시 해요(board useBoard 규칙) */
function useWorkspaceData(withDone: boolean) {
  const [now, setNow] = useState<NowView | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [signals, setSignals] = useState<Signal[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    try {
      const [n, it, sg] = await Promise.all([ws.now(), ws.items(withDone), ws.signals()])
      setNow(n); setItems(it); setSignals(sg); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [withDone])
  const reloadMeta = useCallback(() => ws.meta().then(setMeta).catch(() => {}), [])
  useEffect(() => {
    void reload()
    const a = window.setInterval(() => { if (!document.hidden) void reload() }, 5000)
    return () => window.clearInterval(a)
  }, [reload])
  useEffect(() => {
    void reloadMeta()
    const b = window.setInterval(() => void reloadMeta(), 30000)
    return () => window.clearInterval(b)
  }, [reloadMeta])
  return { now, items, signals, meta, error, reload, reloadMeta }
}

export function Workspace() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash))
  // 팝업은 주소에 있어요(board 의 #/w/<ref> 처럼): 열면 기록이 하나 쌓이고, 뒤로가기·Esc·닫기 모두 같은 길로 닫혀요
  const pushedOpen = useRef(false)
  useEffect(() => {
    const on = () => { const r = parseHash(location.hash); if (!r.open) pushedOpen.current = false; setRoute(r) }
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  const goView = (v: View) => { location.hash = "/" + v }
  const goGoal = (id: string) => { location.hash = hashFor({ view: "goals", goal: id }).slice(1) }
  const list = useListState()
  const [space, setSpace] = useStored("qw:space", "all")
  const [area, setArea] = useStored("qw:area", "all")
  const data = useWorkspaceData(list.showDone)
  const { now, items, signals, meta } = data
  const open: Open = route.open ?? null
  const setOpen = useCallback((o: Open) => {
    if (o) {
      pushedOpen.current = true
      location.hash = hashFor({ ...route, open: o }).slice(1)
    } else if (pushedOpen.current) {
      pushedOpen.current = false
      history.back()
    } else {
      // 주소로 바로 들어와 연 팝업: 기록을 거슬러 가지 않고 open 만 지워요
      const next = { ...route, open: undefined }
      history.replaceState(null, "", hashFor(next))
      setRoute(next)
    }
  }, [route])
  const [palette, setPalette] = useState(false)
  const [help, setHelp] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const captureRef = useRef<HTMLInputElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)

  const inSpace = useCallback((i: Item) => space === "all" || (i.space ?? "personal") === space, [space])
  const areaOf = useCallback((i: Item) => (meta?.boards.find((b) => b.id === i.boardId)?.areas.find((a) => a.id === i.area)) ?? null, [meta])
  const areas = useMemo(() => (meta?.boards ?? []).flatMap((b) => b.areas), [meta])

  const act = useCallback(async (key: string, label: string, fn: () => Promise<unknown>) => {
    setBusy((b) => new Set(b).add(key))
    try { await fn(); setToast({ tone: "ok", text: label }); await data.reload() }
    catch (e) { setToast({ tone: "error", text: label + " failed: " + (e instanceof Error ? e.message : String(e)) }) }
    finally { setBusy((b) => { const n = new Set(b); n.delete(key); return n }) }
  }, [data])
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 4000); return () => window.clearTimeout(t) }, [toast])

  const actions = useMemo(() => ({
    done: (i: Item) => act("i:" + i.id, "Done: " + i.text.split("\n")[0], () => ws.done(i.id)),
    ask: (i: Item) => act("i:" + i.id, "Sent to the council", () => ws.ask(i)),
    approve: (s: Signal) => act("s:" + s.id, "Approved — running on " + (s.meta?.executor ?? "executor"), () => ws.approve(s.id)),
    reject: (s: Signal) => act("s:" + s.id, "Rejected", () => ws.reject(s.id)),
    resolve: (s: Signal) => act("s:" + s.id, s.lane === "review" ? "Marked reviewed" : "Marked handled", () => ws.resolve(s.id)),
  }), [act])

  // 보기마다 줄 묶음. 키보드는 이 순서로 고르고 처리해요
  const sigSections = useSignalSections(signals)
  const sections: SectionSpec[] = useMemo(() => {
    if (!now) return []
    const council = (s: Signal) => !!s.meta?.runId && !!s.meta?.proposalId
    const itemRows = (list: Item[], ask = false): RowSpec[] => list.filter(inSpace).map((i) => ({ key: "i:" + i.id, kind: "item", item: i, ask }))
    if (route.view === "now") return [
      { id: "needs", title: "Needs you", hint: "council holds and decisions waiting on you", tone: "decide", rows: now.needsYou.map((s) => ({ key: "s:" + s.id, kind: "signal", signal: s, decide: council(s), resolve: !council(s) })), empty: "Nothing is waiting on you." },
      { id: "due", title: "Due today", hint: "and overdue", rows: itemRows(now.dueToday), empty: "Nothing due today. Write a task with a date (내일 3시 …) and it lands here." },
      { id: "goals", title: "Goals", rows: [], extra: now.goals.length ? <GoalStrip goals={now.goals} onOpen={goGoal} /> : null, empty: now.goals.length ? undefined : "No open goals. Goals come from Direction Board." },
      { id: "review", title: "Review", hint: "what the council ran", tone: "review", rows: now.review.map((s) => ({ key: "s:" + s.id, kind: "signal", signal: s, resolve: true })), empty: "Nothing to review." },
      { id: "inbox", title: "Inbox", hint: "written down, no date yet", rows: itemRows(now.inbox, true).slice(0, 12), empty: "Inbox zero. Write something down above (press N)." , extra: now.inbox.filter(inSpace).length > 12 ? <a href="#/inbox" className="px-3 text-xs text-muted-foreground hover:text-foreground">{now.inbox.filter(inSpace).length - 12} more in Inbox →</a> : null },
    ]
    if (route.view === "inbox") return [{ id: "inbox", title: "Inbox", hint: "no date yet — Ask the council or just do it", rows: itemRows(now.inbox, true), empty: "Inbox zero. Write something down above (press N)." }]
    if (route.view === "signals") return sigSections
    if (route.view === "goals") {
      const all = route.goal ? now.goals.filter((g) => g.goal.id === route.goal) : now.goals
      return all.map((g) => ({ id: "goal-" + g.goal.id, title: "", rows: itemRows(g.open), extra: <button type="button" onClick={() => setOpen({ kind: "item", id: g.goal.id })} className="block w-full rounded-lg p-1 text-left hover:bg-muted/40"><GoalHeader g={g} /></button>, empty: g.total ? "All linked tasks are done." : "No tasks are linked to this goal yet. Open the goal and Send to agent to break it into tasks." }))
    }
    const shown = items.filter((i) => i.type === "todo" && inSpace(i) && (area === "all" || i.area === area) && (!list.q.trim() || i.text.toLowerCase().includes(list.q.trim().toLowerCase())))
    const g = groupByWhen(shown.filter((i) => !i.done))
    const out: SectionSpec[] = (Object.keys(g) as (keyof typeof g)[]).filter((k) => g[k].length).map((k) => ({ id: "list-" + k, title: k, rows: itemRows(g[k], k === "No date") }))
    if (list.showDone) out.push({ id: "list-done", title: "Done", rows: itemRows(shown.filter((i) => i.done).sort((a, b) => (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt)).slice(0, 50)) })
    if (!out.length) out.push({ id: "list-empty", title: "Tasks", rows: [], empty: list.q.trim() || area !== "all" ? "No open tasks match this filter. Clear the filter to see everything." : "No open tasks. Write one down above." })
    return out
  }, [now, items, route, inSpace, area, list.q, list.showDone, sigSections])
  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections])
  const selected = flat.find((r) => r.key === sel) ?? null

  const openRow = useCallback((r: RowSpec) => { lastFocus.current = document.activeElement as HTMLElement; setOpen(r.kind === "item" ? { kind: "item", id: r.item.id } : { kind: "signal", id: r.signal.id }) }, [])
  const move = useCallback((d: 1 | -1) => {
    if (!flat.length) return
    const i = flat.findIndex((r) => r.key === sel)
    const next = flat[Math.max(0, Math.min(flat.length - 1, i < 0 ? 0 : i + d))]
    setSel(next.key)
    requestAnimationFrame(() => document.querySelector('[data-row="' + next.key + '"]')?.scrollIntoView({ block: "nearest" }))
  }, [flat, sel])

  // 단축키 디스패처 하나(board shortcut-dispatch.tsx 처럼 창에 한 번만)
  const pendingG = useRef<number | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const overlay = !!document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]')
      const r = resolveShortcut(e, { target: e.target as HTMLElement | null, overlay, pendingG: pendingG.current, now: Date.now() })
      pendingG.current = r.pendingG
      if (!r.id) return
      e.preventDefault()
      const s = selected
      switch (r.id) {
        case "palette.toggle": lastFocus.current = document.activeElement as HTMLElement; setPalette((o) => !o); break
        case "help.open": setHelp(true); break
        case "capture.focus": captureRef.current?.focus(); break
        case "row.next": move(1); break
        case "row.prev": move(-1); break
        case "row.open": if (s) openRow(s); break
        case "row.done": if (s?.kind === "item" && !s.item.done) void actions.done(s.item); else if (s?.kind === "signal" && s.resolve) void actions.resolve(s.signal); break
        case "row.approve": if (s?.kind === "signal" && s.decide) void actions.approve(s.signal); break
        case "row.reject": if (s?.kind === "signal" && s.decide) void actions.reject(s.signal); break
        case "row.ask": if (s?.kind === "item" && s.ask && !s.item.runId) void actions.ask(s.item); break
        case "go.console": location.href = "/app"; break
        case "go.home": location.href = "/"; break
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [actions, move, openRow, selected])

  const renderRow = (r: RowSpec) => {
    const b = busy.has(r.key)
    return (
      <div key={r.key} data-row={r.key} className="contents">
        {r.kind === "item" ? (
          <ItemRow item={r.item} area={areaOf(r.item)} selected={sel === r.key} busy={b} onSelect={() => setSel(r.key)} onOpen={() => openRow(r)} onDone={() => void actions.done(r.item)} onAsk={r.ask ? () => void actions.ask(r.item) : undefined} />
        ) : (
          <SignalRow s={r.signal} selected={sel === r.key} busy={b} onSelect={() => setSel(r.key)} onOpen={() => openRow(r)}
            onApprove={r.decide ? () => void actions.approve(r.signal) : undefined} onReject={r.decide ? () => void actions.reject(r.signal) : undefined}
            onResolve={r.resolve ? () => void actions.resolve(r.signal) : undefined} />
        )}
      </div>
    )
  }

  const imp = meta?.import
  // 머리의 "N to handle" 은 화면에 보이는 줄(고른 공간으로 거른 것)과 같은 수로 세요
  const total = route.view === "now" ? sections.filter((s) => s.id === "needs" || s.id === "due" || s.id === "review").reduce((n, s) => n + s.rows.length, 0) : 0
  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider>
        <WsSidebar view={route.view} onView={goView} onSearch={() => setPalette(true)} meta={meta} now={now} items={items.filter(inSpace)}
          space={space} onSpace={setSpace} areaFilter={area} onArea={setArea}
          onOpenItem={(id) => setOpen({ kind: "item", id })} onOpenGoal={goGoal} />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-xl">
            <div className="mx-auto flex max-w-[880px] items-center gap-2 px-4 py-2.5 sm:px-6">
              <SidebarTrigger className="-ml-1" />
              <h1 className="text-sm font-semibold">{route.goal ? "Goal" : TITLES[route.view]}</h1>
              {route.view === "now" && now && <span className="font-mono text-2xs text-muted-foreground">{now.today} · {total ? total + " to handle" : "all clear"}</span>}
              <div className="ml-auto flex items-center gap-1.5">
                {imp && <SyncButton onSync={async () => { await ws.syncBoard().catch(() => null); await Promise.all([data.reload(), data.reloadMeta()]) }} />}
                <button type="button" onClick={() => setPalette(true)} className="inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground max-md:size-11 [@media(pointer:coarse)]:size-11" aria-label="Search"><Search className="size-3.5" /><kbd className="font-mono text-2xs max-sm:hidden">⌘K</kbd></button>
                <button type="button" onClick={() => setHelp(true)} className="rounded-full p-1.5 text-muted-foreground hover:text-foreground max-sm:hidden" aria-label="Keyboard shortcuts"><Keyboard className="size-4" /></button>
              </div>
            </div>
            <div className="mx-auto max-w-[880px] px-4 pb-3 sm:px-6">
              <CaptureBar ref={captureRef} onSaved={() => void data.reload()} />
            </div>
          </header>

          <main className="mx-auto w-full max-w-[880px] px-2 pt-4 pb-24 sm:px-4">
            {data.error && <div role="alert" className={"mx-2 mb-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs " + ALERT}><span className="min-w-0 flex-1">Can't reach the Quorum server: {data.error}. Showing the last data.</span><button type="button" onClick={() => void data.reload()} className="rounded-full border border-current px-2.5 py-0.5 max-md:h-11 max-md:px-4">Retry</button></div>}
            {imp && !imp.ok && imp.error && <div role="status" className={"mx-2 mb-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs " + ALERT}><span className="min-w-0 flex-1">Direction Board import paused: {imp.error}. Your copies stay as they were.</span><button type="button" onClick={() => void ws.syncBoard().catch(() => null).then(() => Promise.all([data.reload(), data.reloadMeta()]))} className="rounded-full border border-current px-2.5 py-0.5 max-md:h-11 max-md:px-4">Retry</button></div>}
            {route.view === "goals" && now && !route.goal && <div className="mx-2 mb-4"><Roadmap goals={now.goals} onOpen={goGoal} /></div>}
            {route.view === "list" && <div className="mx-2"><ListFilters areas={areas} area={area} onArea={setArea} q={list.q} onQ={list.setQ} showDone={list.showDone} onShowDone={list.setShowDone} /></div>}
            {!now && !data.error && <p className="px-3 py-8 text-sm text-muted-foreground">Loading…</p>}
            {sections.map((s) => (
              <section key={s.id} aria-label={s.title || "Goal"} className={cn("mb-5", s.id.startsWith("goal-") && "mx-2 rounded-2xl border bg-card/40 p-3")}>
                {s.title && (
                  <h2 className="mb-1 flex items-baseline gap-2 px-3">
                    <span className={cn("text-xs font-semibold tracking-wide uppercase", "text-foreground")}>{s.title}</span>
                    {s.rows.length > 0 && <span className={cn("num font-mono text-2xs", s.tone === "decide" ? "rounded-full px-1.5 " + DECIDE : "text-muted-foreground")}>{s.rows.length}</span>}
                    {s.hint && <span className="truncate text-2xs text-muted-foreground max-sm:hidden">{s.hint}</span>}
                  </h2>
                )}
                {s.id.startsWith("goal-") && s.extra}
                {s.rows.length > 0 ? <ul className={cn("flex flex-col", s.id.startsWith("goal-") && "mt-2")}>{s.rows.map(renderRow)}</ul> : s.empty && !s.extra ? <p className="px-3 py-2 text-xs text-muted-foreground">{s.empty}</p> : s.empty && s.id.startsWith("goal-") ? <p className="mt-2 px-1 text-xs text-muted-foreground">{s.empty}</p> : null}
                {!s.id.startsWith("goal-") && s.extra}
              </section>
            ))}
          </main>
        </SidebarInset>
      </SidebarProvider>

      <Detail open={open} onClose={() => { setOpen(null); lastFocus.current?.focus?.() }} onChanged={() => void data.reload()}
        act={{ approve: actions.approve, reject: actions.reject, resolve: actions.resolve, done: actions.done, ask: actions.ask }}
        areaOf={areaOf} goalOf={(id) => now?.goals.find((g) => g.goal.id === id) ?? null} />
      <CommandPalette open={palette} onOpenChange={setPalette} view={now}
        onOpenItem={(id) => setOpen({ kind: "item", id })} onOpenSignal={(id) => setOpen({ kind: "signal", id })}
        onCapture={(t) => void act("capture", "Saved", () => ws.capture(t, "p" + Date.now().toString(36)))}
        onAsk={(t) => void act("ask", "Sent to the council", async () => { const r = await ws.capture(t, "p" + Date.now().toString(36)); await ws.ask(r.item) })}
        onShortcuts={() => setHelp(true)} returnFocus={() => lastFocus.current?.focus?.()} />
      <ShortcutHelp open={help} onOpenChange={setHelp} />
      {toast && <div role="status" className={cn("fixed right-4 bottom-4 z-50 max-w-sm rounded-xl border px-3 py-2 text-sm shadow-lg backdrop-blur-xl", toast.tone === "error" ? "border-transparent " + ALERT : "bg-card/90")}>{toast.text}</div>}
    </TooltipProvider>
  )
}

function GoalStrip({ goals, onOpen }: { goals: NowView["goals"]; onOpen: (id: string) => void }) {
  return (
    <div className="grid gap-2 px-1 sm:grid-cols-2">
      {goals.map((g) => (
        <button key={g.goal.id} type="button" onClick={() => onOpen(g.goal.id)} className="rounded-xl border bg-card/50 p-3 text-left transition-colors hover:bg-muted/50">
          <GoalHeader g={g} />
          {g.open[0] && <p className="mt-2 truncate text-2xs text-muted-foreground">Next: {g.open[0].text.split("\n")[0]}</p>}
        </button>
      ))}
    </div>
  )
}
