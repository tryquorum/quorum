import { useEffect, useMemo, useRef, useState } from "react"
import { exactName } from "@direction-board/contracts/palette-rank"
import { CornerDownLeft, FileText, Flag, Inbox, Keyboard, LayoutGrid, ListChecks, Play, Plus, Settings, Target, Timer } from "lucide-react"
import { AiMark } from "@/components/ai-mark"
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import type { Board, Item, Signal } from "@/lib/api"
import { eventEntries, paletteMatch, pickEvents, pickWork, workEntries } from "@direction-board/contracts/palette"
import type { View } from "@/components/app-sidebar"
import { searchDocs, type SearchResult } from "@/lib/docs-api"
import { kindLabel } from "@/lib/doc-labels"
import { searchSettings } from "@direction-board/contracts/settings-registry"
import { webSearchLists, webSectionTitle as sectionTitle, type WebSectionId as SettingsSectionId } from "@/lib/settings-registry"

export type PaletteResult = { id: string; label: string; hint?: string; keywords: string[]; icon?: React.ReactNode; action: () => void }
export type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  boards: Board[]
  items: Item[]
  signals: Signal[]
  signalsStatus: "loading" | "ok" | "error"
  onView: (view: View) => void
  onOpenWork: (ref: string) => void
  onOpenDocument: (ref: string) => void
  /** 설정 항목으로 이동: #/settings/<섹션>?item=<항목> */
  onSettings: (section: SettingsSectionId, item: string) => void
  /** 빠른 추가 시트를 연다. 팔레트에 쓴 글이 있으면 그 글을 제목으로 */
  onNewTask: (text: string) => void
  onAsk: (text: string) => void
  /** 키보드 단축키 도움말 열기 */
  onShortcuts?: () => void
  /** 운영 순회 지금 돌리기 */
  onRunSweep?: () => void
  returnFocus: () => void
}

const VIEWS: { id: View; label: string; keywords: string[] }[] = [
  { id: "home", label: "홈", keywords: ["첫 화면", "home"] },
  { id: "board", label: "보드", keywords: ["화이트보드", "board"] },
  { id: "road", label: "로드맵", keywords: ["일정", "roadmap"] },
  { id: "list", label: "전체 목록", keywords: ["할 일", "미리알림", "list"] },
  { id: "docs", label: "문서", keywords: ["노트", "docs"] },
  { id: "settings", label: "설정", keywords: ["settings", "환경설정", "preferences", "옵션"] },
]
const match = paletteMatch

/** ⌘K 로 어디서나 여는 검색·빠른 실행. 이미 받은 데이터만 쓰고 따로 요청하지 않는다 */
export function CommandPalette({ open, onOpenChange, boards, items, signals, signalsStatus, onView, onOpenWork, onOpenDocument, onSettings, onNewTask, onAsk, onShortcuts, onRunSweep, returnFocus }: CommandPaletteProps) {
  const [query, setQuery] = useState("")
  const [docs, setDocs] = useState<SearchResult | null>(null)
  const [docsState, setDocsState] = useState<"idle" | "loading" | "error" | "ok">("idle")
  useEffect(() => {
    let live = true
    setDocs(null)
    if (!open || !query.trim()) { setDocsState("idle"); return () => { live = false } }
    setDocsState("loading")
    const timer = setTimeout(() => { searchDocs({q: query}).then((r) => { if (live) { setDocs(r); setDocsState("ok") } }).catch(() => { if (live) setDocsState("error") }) }, 200)
    return () => { live = false; clearTimeout(timer) }
  }, [open, query])
  const pending = useRef<(() => void) | null>(null)
  // 닫히는 중에 다시 열면 이전 회차의 선택은 버린다
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) pending.current = null
  }
  const q = query.trim().toLocaleLowerCase()

  const all = useMemo(() => {
    const screens: PaletteResult[] = VIEWS.map((v) => ({ id: "view:" + v.id, label: v.label, hint: "화면", keywords: ["화면 이동", ...v.keywords], icon: <LayoutGrid />, action: () => onView(v.id) }))
    const work = workEntries(items, boards).map((e) => ({ ...e, icon: e.kind === "goal" ? <Target /> : <ListChecks />, action: () => onOpenWork(e.ref) }))
    const events = eventEntries(signals).map((e) => ({ ...e, icon: <Flag />, action: () => onOpenWork(e.ref) }))
    return { screens, work, events }
  }, [boards, items, signals, onView, onOpenWork])

  const screens = all.screens.filter((r) => match(r, q))
  const settings: PaletteResult[] = searchSettings(q, 8, webSearchLists().items, webSearchLists().sections).map((s) => ({ id: "setting:" + s.id, label: s.title, hint: "설정 · " + sectionTitle(s.section), keywords: [], icon: <Settings />, action: () => onSettings(s.section, s.id) }))
  const work = pickWork(all.work, q)
  const events = pickEvents(all.events, q)
  const raw = query.trim()
  // 쓴 글이 있으면 검색과 상관없이 "할 일로 추가" 를 늘 보인다. 글은 지금 값을 잡아 두고 팔레트가 닫힌 뒤 시트를 연다
  const task: PaletteResult = raw
    ? { id: "action:task", label: `할 일로 추가: ${raw}`, keywords: [], icon: <Plus />, action: () => onNewTask(raw) }
    : { id: "action:task", label: "새 할 일", hint: "N", keywords: ["추가", "할 일", "미리알림", "new"], icon: <Plus />, action: () => onNewTask("") }
  const help: PaletteResult[] = onShortcuts ? [{ id: "action:shortcuts", label: "키보드 단축키", hint: "?", keywords: ["단축키", "키보드", "shortcut", "help", "도움말"], icon: <Keyboard />, action: onShortcuts }] : []
  // 운영 순회: 주 메뉴에 없으니 여기서 바로 돌리거나 설정을 열어요
  const ops: PaletteResult[] = [
    ...(onRunSweep ? [{ id: "action:sweep", label: "지금 순회 돌리기", keywords: ["순회", "운영", "sweep", "run", "돌리기", "ops"], icon: <Play />, action: onRunSweep }] : []),
    { id: "action:ops-settings", label: "운영 순회 설정", hint: "G O", keywords: ["순회", "운영", "ops", "sweep", "지시문", "주기", "schedule"], icon: <Timer />, action: () => onSettings("ops", "ops-schedule") },
  ]
  // 검색어가 순회 명령에 맞으면 사건 목록 아래로 묻히지 않게 화면 바로 아래 "명령" 묶음으로
  const commands = q ? ops.filter((r) => match(r, q)) : []
  const quick = raw ? [task, ...help.filter((r) => match(r, q))] : [task, ...help, ...ops].filter((r) => match(r, q))
  const nothing = !!q && !screens.length && !commands.length && !settings.length && !work.length && !events.length

  const choose = (action: () => void) => {
    pending.current = action
    onOpenChange(false)
  }
  const row = (r: PaletteResult) => (
    <CommandItem key={r.id} value={r.id} onSelect={() => choose(r.action)}>
      {r.icon}
      <span className="min-w-0 flex-1 truncate">{r.label}</span>
      {r.hint && <span className="ml-2 shrink-0 text-xs text-muted-foreground">{r.hint}</span>}
    </CommandItem>
  )

  // 검색어가 화면·명령·설정 이름과 정확히 같으면(예: "설정") 늦게 오는 문서 결과를 그 아래로 보내요(GAP-10)
  const docsLast = exactName(q, [...screens, ...commands, ...settings].map((r) => r.label))
  const docsGroup = docs && docs.results.length > 0 && <CommandGroup heading="문서">{docs.results.map((d) => row({id: "doc:" + d.ref, label:d.title, hint:kindLabel(d.kind), keywords:[], icon:<FileText />, action:() => onOpenDocument(d.ref)}))}</CommandGroup>
  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) { setQuery("") }
        onOpenChange(o)
      }}
      title="검색과 빠른 실행"
      description="화면과 일을 찾거나 AI에게 물어요"
      onCloseAutoFocus={(e) => {
        e.preventDefault()
        const action = pending.current
        pending.current = null
        if (action) action()
        else returnFocus() // 트리거 없이 여는 팔레트라 연 사람이 기억해 둔 자리로 돌려보낸다
      }}
    >
      <Command shouldFilter={false} loop data-command-palette="">
        <CommandInput value={query} onValueChange={setQuery} placeholder="화면, 설정, 할 일, 사건을 찾거나 AI에게 물어요" aria-label="화면과 일 검색" />
        <CommandList className="max-h-[min(420px,60vh)]">
          {nothing && docsState === "ok" && docs?.results.length === 0 && <p role="status" className="px-4 pt-4 pb-2 text-sm text-muted-foreground">검색 결과가 없어요. 사건은 열린 항목과 최근 7일만 찾아요.</p>}
          {q && <div className="px-4 py-2 text-xs text-muted-foreground"><span>문서 검색 · AI 초안 제외</span>{docsState === "loading" && <span role="status"> · 검색 중…</span>}{docsState === "error" && <span role="alert"> · 문서 검색에 실패했어요</span>}</div>}
          {!docsLast && docsGroup}
          {screens.length > 0 && <CommandGroup heading="화면">{screens.map(row)}</CommandGroup>}
          {commands.length > 0 && <CommandGroup heading="명령">{commands.map(row)}</CommandGroup>}
          {settings.length > 0 && <CommandGroup heading="설정">{settings.map(row)}</CommandGroup>}
          {work.length > 0 && <CommandGroup heading={q ? "할 일 · 목표" : "안 끝난 할 일 · 목표"}>{work.map(row)}</CommandGroup>}
          {signalsStatus !== "ok" && !signals.length ? (
            <p className="px-4 py-2 text-xs text-muted-foreground">{signalsStatus === "loading" ? "사건을 불러오는 중이에요" : "사건을 불러오지 못했어요"}</p>
          ) : events.length > 0 && <CommandGroup heading={q ? "사건" : "열린 사건"}>{events.map(row)}</CommandGroup>}
          {docsLast && docsGroup}
          {(raw || quick.length > 0) && (
            <CommandGroup heading="빠른 실행">
              {raw && (
                <CommandItem value="action:ask" onSelect={() => choose(() => onAsk(raw))}>
                  <AiMark className="text-ai" />
                  <span className="min-w-0 flex-1 truncate">AI에게 묻기: {raw}</span>
                  <CornerDownLeft className="ml-2 size-3.5 text-muted-foreground" />
                </CommandItem>
              )}
              {quick.map(row)}
            </CommandGroup>
          )}
          {!raw && !work.length && !events.length && signalsStatus === "ok" && (
            <p className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground"><Inbox className="size-3.5" /> 안 끝난 할 일과 열린 사건이 없어요</p>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
