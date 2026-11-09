import { Check, ChevronDown, Columns3, GalleryHorizontalEnd, Keyboard, LayoutGrid, List, type LucideIcon } from 'lucide-react'
import { DropdownMenu as Menu } from 'radix-ui'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useShortcutHelp } from '@/components/shortcut-dispatch'
import { byId, formatKeys } from '@/lib/shortcuts'
import { AXES, CARD_MAX, CARD_MIN, GROUPS, VIEWS, type DocsViewMode, type DocsViewState } from '@/lib/docs-view-state'

const ICON: Record<DocsViewMode, LucideIcon> = { icon: LayoutGrid, list: List, columns: Columns3, gallery: GalleryHorizontalEnd }
/** 보기 키 표시(레지스트리에서). 숫자라 mac·Windows 가 같아요 */
const keyOf = (id: DocsViewMode) => formatKeys(byId(`docs.view.${id}`), true)[0].join('')

/** Finder 의 보기 메뉴처럼 체크 표시가 있는 라디오 항목. 체크는 왼쪽, 키는 오른쪽 */
function Choice({ value, children, shortcut }: { value: string; children: React.ReactNode; shortcut?: string }) {
  return <Menu.RadioItem value={value} className="relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground">
    <span className="absolute left-2 flex size-4 items-center justify-center"><Menu.ItemIndicator><Check className="size-4" /></Menu.ItemIndicator></span>
    {children}
    {shortcut && <DropdownMenuShortcut><kbd className="num">{shortcut}</kbd></DropdownMenuShortcut>}
  </Menu.RadioItem>
}

/** 문서 목록 위 도구줄: 보기 팝업 메뉴 + 아이콘 버튼 묶음 + 보기별 옵션(카드 크기·그룹, 열 기준). 좁은 화면은 보기 메뉴 하나만(그룹·열 기준도 메뉴 안에 있어요) */
export function ViewToolbar({ state, onChange }: { state: DocsViewState; onChange: (next: Partial<DocsViewState>) => void }) {
  const current = VIEWS.find((x) => x.id === state.view) ?? VIEWS[1]
  const CurrentIcon = ICON[current.id]
  return <div role="toolbar" aria-label="보기" className="flex flex-wrap items-center gap-2 max-md:flex-nowrap">
    <div role="group" aria-label="보기 고르기" className="inline-flex rounded-md border p-0.5 max-md:hidden">
      {VIEWS.map((x) => { const Icon = ICON[x.id]; return <button key={x.id} type="button" aria-pressed={state.view === x.id} aria-label={`${x.menu} (${keyOf(x.id)})`} aria-keyshortcuts={keyOf(x.id)} title={`${x.menu} · 키 ${keyOf(x.id)}`} onClick={() => onChange({ view: x.id })} className="inline-flex h-7 w-8 items-center justify-center rounded-[5px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-foreground aria-pressed:text-background"><Icon aria-hidden className="size-4" /></button> })}
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="px-1.5" aria-label={`보기 메뉴, 지금 ${current.menu}`} title="보기 메뉴"><CurrentIcon aria-hidden /><ChevronDown aria-hidden className="opacity-60" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <Menu.RadioGroup value={state.view} onValueChange={(view) => { const found = VIEWS.find((x) => x.id === view); if (found) onChange({ view: found.id }) }}>
          {VIEWS.map((x) => { const Icon = ICON[x.id]; return <Choice key={x.id} value={x.id} shortcut={keyOf(x.id)}><Icon aria-hidden className="size-4 text-muted-foreground" />{x.menu}</Choice> })}
        </Menu.RadioGroup>
        {state.view === 'icon' && <><DropdownMenuSeparator /><DropdownMenuLabel className="text-xs text-muted-foreground">그룹 기준</DropdownMenuLabel>
          <Menu.RadioGroup value={state.group} onValueChange={(group) => { const found = GROUPS.find((x) => x.id === group); if (found) onChange({ group: found.id }) }}>{GROUPS.map((x) => <Choice key={x.id} value={x.id}>{x.label}</Choice>)}</Menu.RadioGroup></>}
        {state.view === 'columns' && <><DropdownMenuSeparator /><DropdownMenuLabel className="text-xs text-muted-foreground">열 기준</DropdownMenuLabel>
          <Menu.RadioGroup value={state.axis} onValueChange={(axis) => { const found = AXES.find((x) => x.id === axis); if (found) onChange({ axis: found.id }) }}>{AXES.map((x) => <Choice key={x.id} value={x.id}>{x.label}</Choice>)}</Menu.RadioGroup></>}
      </DropdownMenuContent>
    </DropdownMenu>
    {state.view === 'icon' && <>
      <label className="flex items-center gap-2 text-xs text-muted-foreground max-md:hidden">카드 크기<input type="range" aria-label="카드 크기" min={CARD_MIN} max={CARD_MAX} step={10} value={state.size} onChange={(e) => onChange({ size: Number(e.target.value) })} className="w-24 accent-foreground sm:w-28" /><span className="num w-7 text-right">{state.size}</span></label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground max-md:hidden">그룹<select aria-label="그룹 기준" value={state.group} onChange={(e) => { const found = GROUPS.find((x) => x.id === e.target.value); if (found) onChange({ group: found.id }) }} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">{GROUPS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
    </>}
    {state.view === 'columns' && <label className="flex items-center gap-1 text-xs text-muted-foreground max-md:hidden">열 기준<select aria-label="열 기준" value={state.axis} onChange={(e) => { const found = AXES.find((x) => x.id === e.target.value); if (found) onChange({ axis: found.id }) }} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">{AXES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>}
  </div>
}

/** 키보드 아이콘: 단축키 도움말(레지스트리에서 만든 패널)을 열어요. 키보드가 없는 좁은 화면에서는 숨겨요 */
export function KeyHint() {
  const openHelp = useShortcutHelp()
  return <Button variant="ghost" size="icon-sm" className="hidden text-muted-foreground md:inline-flex" aria-label="키보드 단축키" aria-keyshortcuts="Shift+? Meta+/ Control+/" title="키보드 단축키 (?)" onClick={openHelp}><Keyboard /></Button>
}
