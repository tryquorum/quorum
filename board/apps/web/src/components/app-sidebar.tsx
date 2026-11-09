import { useMemo } from "react"
import { Check, ChevronRight, ChevronsUpDown, FileText, House, ListTodo, Map as MapIcon, MessageSquareWarning, PenTool, Search } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { Board, Item, Signal } from "@/lib/api"
import { useStored } from "@/hooks/use-data"
import { compareTasks, toTasks, toggleMain, useMainKeys, useSetDone, type Task } from "@/lib/tasks"
import { GoalSection } from "@/components/goal-sidebar"
import { TaskRow } from "@/components/task-row"
import { OpsStatus } from "@/components/ops/ops-status"
import { SidebarAccount } from "@/components/sidebar-account"
import { openRunThread } from "@/hooks/use-ops"
import { settingsHash } from "@/lib/settings-registry"
import { useSpaces } from "@/hooks/use-space"
import { spaceName } from "@/lib/spaces"

// 운영 순회는 주 메뉴가 아니라 설정 › 운영 순회(#/settings/ops)와 아래 상태 칩에 있어요. 옛 #/ops 는 App 이 그리로 보내요
export type View = "home" | "board" | "road" | "list" | "docs" | "settings" | "issues"
export const VIEWS: readonly View[] = ["home", "board", "road", "list", "docs", "settings", "issues"]
export const isView = (v: string): v is View => (VIEWS as readonly string[]).includes(v)

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

type Props = {
  view: View
  onView: (v: View) => void
  onNavigate: (target: string) => boolean
  onSearch: () => void
  boards: Board[]
  boardId: string | undefined
  onBoard: (id: string) => void
  items: Item[]
  save: (it: Item) => void
  signals: Signal[]
  patchSignal: (id: string, body: Record<string, unknown>) => Promise<void>
  me: string
  syncOk: boolean
  syncText: string
  decideCount: number
  onOpenWork: (ref: string) => void
  activeWorkRef?: string | null
  /** 문서 페이지일 때 메뉴 아래에 붙이는 문서 탐색(노션처럼 앱 사이드바 안에). 사이드바의 navigate 를 받아 다른 링크와 같은 포커스·시트 닫기 규칙을 따른다 */
  docNav?: (navigate: (target: string, action: () => void) => void) => React.ReactNode
}

const endOfToday = () => {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}
const LIMIT = 5

export function AppSidebar({ view, onView, onNavigate, onSearch, boards, boardId, onBoard, items, save, signals, patchSignal, me, syncOk, syncText, decideCount, onOpenWork, activeWorkRef, docNav }: Props) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar()
  const closeMobile = () => { if (isMobile) setOpenMobile(false) }
  const navigate = (target: string, action: () => void) => {
    const moving = onNavigate(target)
    if (moving && isMobile && openMobile) document.body.dataset.sheetNav = "1"
    closeMobile()
    action()
  }
  const board = boards.find((b) => b.id === boardId)
  const areas = board?.areas || []
  const [mainKeys, setMainKeys] = useMainKeys()
  const { spaces, view: space, setView: setSpace, me: profile } = useSpaces()
  const member = profile?.role === "member"
  const setDone = useSetDone(save, patchSignal)
  // 미리알림·목표·사건·메인 일을 한 목록으로
  const tasks = useMemo(() => toTasks({ items, signals, boards, boardId, mainKeys, space }), [items, signals, boards, boardId, mainKeys, space])
  const openKeys = useMemo(() => new Set(tasks.map((t) => t.key)), [tasks])
  const star = (t: Task) => toggleMain(t, mainKeys, setMainKeys, openKeys)
  const { today, week } = useMemo(() => {
    const e = endOfToday()
    const w = e + 7 * 864e5
    const isToday = (t: Task) => t.main || (t.at !== null ? t.at <= e : t.kind === "todo") || t.lane === "now"
    return {
      today: tasks.filter(isToday).sort(compareTasks),
      week: tasks.filter((t) => !isToday(t) && t.at !== null && t.at > e && t.at <= w).sort(compareTasks),
    }
  }, [tasks])
  const openCount = tasks.length

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <img src="/brand/logo-192.png" alt="" className="size-8 rounded-lg" />
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-semibold">{board?.name || "나"}</span>
                    <span className="truncate text-xs text-muted-foreground">{space === "all" ? (board?.kind === "company" ? "회사 판" : "모든 공간") : spaceName(spaces, space)}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60" align="start">
                {spaces.length > 1 && !member && (<>
                  <DropdownMenuLabel>공간</DropdownMenuLabel>
                  {([["all", "모든 공간"], ...spaces.map((s) => [s.id, s.name])] as [typeof space, string][]).map(([id, name]) => (
                    <DropdownMenuItem key={id} onSelect={() => { closeMobile(); setSpace(id) }} aria-checked={space === id} role="menuitemradio">
                      <span className="flex-1 truncate">{name}</span>
                      {space === id && <Check className="size-4" />}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>)}
                <DropdownMenuLabel>판 바꾸기</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {boards.map((b) => (
                  <DropdownMenuItem key={b.id} onSelect={() => { closeMobile(); onBoard(b.id) }}>
                    <span className="flex-1 truncate">{b.name}</span>
                    <span className="text-xs text-muted-foreground">{b.kind === "company" ? "회사" : "개인"}</span>
                  </DropdownMenuItem>
                ))}
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
                <SidebarMenuButton onClick={() => { closeMobile(); onSearch() }} className="text-muted-foreground">
                  <Search />
                  <span>검색</span>
                  <kbd className="num ml-auto rounded border bg-background px-1.5 text-2xs leading-4 text-muted-foreground">{IS_MAC ? "⌘K" : "Ctrl K"}</kbd>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {([
                ["home", "홈", House],
                ["board", "보드", PenTool],
                ["road", "로드맵", MapIcon],
                ["list", "전체 목록", ListTodo],
                ...(member ? [] : [["docs", "문서", FileText]] as const),
                ...(profile?.issues ? [["issues", member ? "내 이슈" : "이슈", MessageSquareWarning]] as const : []),
              ] as const).map(([v, label, Icon]) => (
                <SidebarMenuItem key={v}>
                  <SidebarMenuButton isActive={view === v} onClick={() => navigate(`v:${v}`, () => onView(v))}>
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                  {v === "home" && decideCount > 0 && <SidebarMenuBadge>{decideCount}</SidebarMenuBadge>}
                  {v === "list" && openCount > 0 && <SidebarMenuBadge>{openCount}</SidebarMenuBadge>}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {docNav?.(navigate)}

        <GoalSection
          board={board}
          boardId={boardId}
          items={items}
          activeWorkRef={activeWorkRef}
          onOpenGoal={(ref) => navigate(`w:${ref}`, () => onOpenWork(ref))}
        />

        <Section id="today" label="오늘" count={today.length}>
          <TaskList list={today} onOpen={(ref) => navigate(`w:${ref}`, () => onOpenWork(ref))} onDone={setDone} onStar={star} onMore={() => navigate("v:list", () => onView("list"))} empty="오늘 할 일이 없어요" />
        </Section>

        {week.length > 0 && (
          <Section id="week" label="다가오는 7일" count={week.length}>
            <TaskList list={week} onOpen={(ref) => navigate(`w:${ref}`, () => onOpenWork(ref))} onDone={setDone} onStar={star} onMore={() => navigate("v:list", () => onView("list"))} />
          </Section>
        )}

        {areas.length > 0 && (
          <Section id="areas" label="영역" count={areas.length}>
              <SidebarMenu>
                {areas.map((a) => {
                  const n = items.filter((i) => i.boardId === boardId && i.area === a.id && i.type !== "link" && !i.done).length
                  return (
                    <SidebarMenuItem key={a.id}>
                      <SidebarMenuButton size="sm" onClick={() => navigate("v:board", () => onView("board"))}>
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
          <OpsStatus
            onOpenSettings={() => navigate("v:settings", () => { location.hash = settingsHash("ops").slice(1) })}
            onOpenRun={(id) => { closeMobile(); openRunThread(id) }}
          />
          <SidebarAccount email={me} syncOk={syncOk} syncText={syncText} active={view === "settings"} navigate={navigate} closeMobile={closeMobile} />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** 접고 펼 수 있는 사이드바 묶음. 접힘 상태는 기억한다 (db:sb:<id>). action 이 함수면 지금 펼침 여부를 받아요(접힘 상태의 원본은 여기 하나) */
export function Section({ id, label, count, action: actionOf, children }: { id: string; label: string; count: number; action?: React.ReactNode | ((open: boolean) => React.ReactNode); children: React.ReactNode }) {
  const [open, setOpen] = useStored(`db:sb:${id}`, true)
  const action = typeof actionOf === "function" ? actionOf(open) : actionOf
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="group/sec flex w-full items-center gap-1 hover:text-sidebar-foreground" aria-label={`${label} ${open ? "접기" : "펼치기"}`}>
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            <span>{label}</span>
            {!open && count > 0 && <span className={cn("ml-auto num text-2xs", action && "mr-6")}>{count}</span>}
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        {action}
        <CollapsibleContent>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

/** 사이드바 할 일 목록: 5개까지, 넘치면 전체 목록으로 */
function TaskList({ list, onOpen, onDone, onStar, onMore, empty }: { list: Task[]; onOpen: (ref: string) => void; onDone: (t: Task, done: boolean) => void; onStar: (t: Task) => void; onMore: () => void; empty?: string }) {
  if (!list.length) return empty ? <p className="px-2 py-1.5 text-xs text-muted-foreground">{empty}</p> : null
  return (
    <>
      <ul className="flex flex-col">
        {list.slice(0, LIMIT).map((t) => <TaskRow key={t.key} t={t} compact onOpen={onOpen} onDone={onDone} onStar={onStar} />)}
      </ul>
      {list.length > LIMIT && (
        <button type="button" onClick={onMore} className="w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground max-md:min-h-11 [@media(pointer:coarse)]:min-h-11 hover:bg-sidebar-accent hover:text-sidebar-foreground">
          {list.length - LIMIT}개 더 · 전체 보기
        </button>
      )}
    </>
  )
}
