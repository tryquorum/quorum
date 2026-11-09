// 왼쪽 사이드바. 출처: board/apps/web/src/components/app-sidebar.tsx (방향판 2ee6e8a) — 머리(판·공간 고르기 드롭다운),
// 검색(⌘K), 보기 메뉴와 배지, 목표 묶음(goal-sidebar.tsx 의 진행률), 오늘 묶음(5개까지, 넘치면 전체 목록), 영역(색 점·열린 일 수),
// 접고 펼 수 있는 Section(접힘 상태 기억), 바닥의 계정·동기화 상태. 모바일은 ui/sidebar.tsx 가 그대로 시트로 열어요.
import { useState } from "react"
import { Check, ChevronRight, ChevronsUpDown, Gavel, Inbox, LayoutDashboard, ListTodo, Radio, RefreshCw, Search, Target, Terminal, Workflow } from "lucide-react"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from "./ui/sidebar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu"
import { QuorumMark } from "@/components/wordmark"
import { cn } from "@/lib/utils"
import type { Area, Item, Meta, NowView } from "./api"
import { dueLabel, isLate, whenOf } from "./rows"
import { ALERT, LATE } from "./tone"

export type View = "now" | "inbox" | "goals" | "signals" | "list"
export const VIEWS: readonly View[] = ["now", "inbox", "goals", "signals", "list"]
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const LIMIT = 5

/** 기억하는 상태(board use-data.ts useStored 와 같은 localStorage 규칙) */
export function useStored<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(key); return s === null ? init : (JSON.parse(s) as T) } catch { return init } })
  return [v, (next: T) => { setV(next); try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* 저장 못 해도 화면은 그대로 */ } }]
}

export function WsSidebar({ view, onView, onSearch, meta, now, items, space, onSpace, areaFilter, onArea, onOpenItem, onOpenGoal }: {
  view: View; onView: (v: View) => void; onSearch: () => void; meta: Meta | null; now: NowView | null; items: Item[]
  space: string; onSpace: (s: string) => void; areaFilter: string; onArea: (id: string) => void
  onOpenItem: (id: string) => void; onOpenGoal: (id: string) => void
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  const go = (fn: () => void) => { if (isMobile) setOpenMobile(false); fn() }
  const spaces = meta?.spaces ?? []
  const areas: (Area & { boardId: string })[] = (meta?.boards ?? []).flatMap((b) => b.areas.map((a) => ({ ...a, boardId: b.id })))
  const spaceName = space === "all" ? "All spaces" : spaces.find((s) => s.id === space)?.name ?? space
  const today = now?.dueToday ?? []
  const imp = meta?.import
  const views: [View, string, typeof LayoutDashboard, number][] = [
    ["now", "Now", LayoutDashboard, now?.counts.needsYou ?? 0],
    ["inbox", "Inbox", Inbox, now?.counts.inbox ?? 0],
    ["goals", "Goals", Target, now?.counts.goals ?? 0],
    ["signals", "Signals", Radio, (now?.counts.running ?? 0) + (now?.counts.review ?? 0) + (now?.counts.needsYou ?? 0)],
    ["list", "All tasks", ListTodo, items.filter((i) => i.type === "todo" && !i.done).length],
  ]
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <span className="grid size-8 place-items-center rounded-lg bg-foreground/5"><QuorumMark className="size-5" /></span>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-semibold">Quorum workspace</span>
                    <span className="truncate text-xs text-muted-foreground">{spaceName}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60" align="start">
                <DropdownMenuLabel>Space</DropdownMenuLabel>
                {([["all", "All spaces"], ...spaces.map((s) => [s.id, s.name])] as [string, string][]).map(([id, name]) => (
                  <DropdownMenuItem key={id} onSelect={() => go(() => onSpace(id))} aria-checked={space === id} role="menuitemradio">
                    <span className="flex-1 truncate">{name}</span>
                    {space === id && <Check className="size-4" />}
                  </DropdownMenuItem>
                ))}
                {(meta?.boards.length ?? 0) > 0 && <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Boards (Direction Board)</DropdownMenuLabel>
                  {meta!.boards.map((b) => (
                    <DropdownMenuItem key={b.id} onSelect={() => go(() => onView("list"))}>
                      <span className="flex-1 truncate">{b.name}</span>
                      <span className="text-xs text-muted-foreground">{b.kind}</span>
                    </DropdownMenuItem>
                  ))}
                </>}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => go(onSearch)} className="text-muted-foreground">
                  <Search /><span>Search</span>
                  <kbd className="num ml-auto rounded border bg-background px-1.5 text-2xs leading-4 text-muted-foreground">{IS_MAC ? "⌘K" : "Ctrl K"}</kbd>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {views.map(([v, label, Icon, n]) => (
                <SidebarMenuItem key={v}>
                  <SidebarMenuButton isActive={view === v} onClick={() => go(() => onView(v))}><Icon /><span>{label}</span></SidebarMenuButton>
                  {n > 0 && <SidebarMenuBadge className={cn(v === "now" && "rounded-full bg-foreground px-1.5 !text-background")}>{n}</SidebarMenuBadge>}
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton asChild><a href="/app"><Gavel /><span>Council runs</span></a></SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild><a href="/app#recipes"><Workflow /><span>Recipes</span></a></SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {(now?.goals.length ?? 0) > 0 && (
          <Section id="goals" label="Goals" count={now!.goals.length}>
            <SidebarMenu>
              {now!.goals.map((g) => {
                const pct = g.total ? Math.round((g.done / g.total) * 100) : 0
                return (
                  <SidebarMenuItem key={g.goal.id}>
                    <SidebarMenuButton size="sm" onClick={() => go(() => onOpenGoal(g.goal.id))} className="h-auto py-1.5">
                      <Target className="text-muted-foreground" />
                      <div className="grid min-w-0 flex-1 gap-1">
                        <span className="truncate">{g.goal.text}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10"><span className="block h-full rounded-full bg-foreground" style={{ width: pct + "%" }} /></span>
                          <span className="num font-mono text-2xs text-muted-foreground">{g.done}/{g.total}</span>
                        </span>
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </Section>
        )}

        <Section id="today" label="Today" count={today.length}>
          {!today.length ? <p className="px-2 py-1.5 text-xs text-muted-foreground">Nothing due today</p> : (
            <>
              <ul className="flex flex-col">
                {today.slice(0, LIMIT).map((t) => {
                  const w = whenOf(t)
                  return (
                    <li key={t.id}>
                      <button type="button" onClick={() => go(() => onOpenItem(t.id))} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent max-md:min-h-11">
                        <span className="min-w-0 flex-1 truncate">{t.text.split("\n")[0]}</span>
                        {w && <span className={cn("shrink-0 num font-mono text-2xs text-muted-foreground", isLate(w) && LATE)}>{dueLabel(w)}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {today.length > LIMIT && (
                <button type="button" onClick={() => go(() => onView("list"))} className="w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground max-md:min-h-11">
                  {today.length - LIMIT} more · see all
                </button>
              )}
            </>
          )}
        </Section>

        {areas.length > 0 && (
          <Section id="areas" label="Areas" count={areas.length}>
            <SidebarMenu>
              {areas.map((a) => {
                const n = items.filter((i) => i.boardId === a.boardId && i.area === a.id && !i.done).length
                return (
                  <SidebarMenuItem key={a.boardId + a.id}>
                    <SidebarMenuButton size="sm" isActive={view === "list" && areaFilter === a.id} onClick={() => go(() => { onArea(a.id); onView("list") })}>
                      <span className="size-2 rounded-full" style={{ background: a.color }} />
                      <span>{a.name}</span>
                    </SidebarMenuButton>
                    {n > 0 && <SidebarMenuBadge>{n}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </Section>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="sm" className="text-muted-foreground"><a href="/app"><Terminal /><span>Council console</span></a></SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground/10 text-xs font-semibold uppercase">{meta?.me?.email?.[0] ?? "?"}</span>
              <div className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-xs">{meta?.me?.email ?? "Not signed in"}</span>
                <span className={cn("flex items-center gap-1 truncate text-2xs", imp && !imp.ok ? "rounded px-1 " + ALERT : "text-muted-foreground")} title={imp?.error ?? imp?.base ?? ""}>
                  <span className={cn("size-1.5 shrink-0 rounded-full", !imp ? "bg-foreground/25" : imp.ok ? "bg-foreground/60" : "bg-white")} />
                  {!imp ? "Direction Board import off" : imp.ok ? "Direction Board · " + imp.items + " copied" : "Direction Board unreachable"}
                </span>
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** 접고 펼 수 있는 사이드바 묶음. 접힘 상태는 기억해요 (qw:sb:<id>) — board app-sidebar.tsx Section 그대로 */
export function Section({ id, label, count, children }: { id: string; label: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useStored("qw:sb:" + id, true)
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="group/sec flex w-full items-center gap-1 hover:text-sidebar-foreground" aria-label={label + (open ? " collapse" : " expand")}>
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            <span>{label}</span>
            {!open && count > 0 && <span className="ml-auto num text-2xs">{count}</span>}
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

export function SyncButton({ onSync }: { onSync: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <button type="button" disabled={busy} onClick={() => { setBusy(true); void onSync().finally(() => setBusy(false)) }} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs text-muted-foreground hover:text-foreground disabled:opacity-50" title="Read Direction Board again (GET only)">
      <RefreshCw className={cn("size-3", busy && "animate-spin")} />Sync
    </button>
  )
}
