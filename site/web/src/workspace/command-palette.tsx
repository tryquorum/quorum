// ⌘K 검색·빠른 실행. 출처: board/apps/web/src/components/command-palette.tsx — 쓴 글이 있으면 "기록하기"를 늘 보이고,
// 고른 동작은 팔레트가 닫힌 뒤(onCloseAutoFocus) 실행하고, 고른 게 없으면 연 자리로 포커스를 돌려줘요. 이미 받은 데이터만 써요.
import { useRef, useState } from "react"
import { Feather, Gavel, Keyboard, LayoutDashboard, ListChecks, MessageSquareText, Terminal } from "lucide-react"
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import type { NowView } from "./api"

type Entry = { id: string; label: string; hint?: string; icon: React.ReactNode; action: () => void }
const match = (s: string, q: string) => !q || s.toLocaleLowerCase().includes(q)

export function CommandPalette({ open, onOpenChange, view, onOpenItem, onOpenSignal, onCapture, onAsk, onShortcuts, returnFocus }: {
  open: boolean; onOpenChange: (o: boolean) => void; view: NowView | null
  onOpenItem: (id: string) => void; onOpenSignal: (id: string) => void
  onCapture: (text: string) => void; onAsk: (text: string) => void; onShortcuts: () => void; returnFocus: () => void
}) {
  const [query, setQuery] = useState("")
  const pending = useRef<(() => void) | null>(null)
  const q = query.trim().toLocaleLowerCase()
  const raw = query.trim()
  const signals = view ? [...view.needsYou, ...view.running, ...view.review] : []
  const items = view ? [...view.dueToday, ...view.inbox, ...view.later] : []
  const sig: Entry[] = signals.filter((s) => match(s.title + " " + (s.reason ?? ""), q)).slice(0, 8).map((s) => ({ id: "s:" + s.id, label: s.title, hint: s.lane === "review" ? "Review" : s.status === "running" ? "Running" : "Needs you", icon: s.lane === "review" ? <MessageSquareText /> : <Gavel />, action: () => onOpenSignal(s.id) }))
  const its: Entry[] = items.filter((i) => match(i.text, q)).slice(0, 8).map((i) => ({ id: "i:" + i.id, label: i.text, hint: i.due ? "Due" : "Inbox", icon: <ListChecks />, action: () => onOpenItem(i.id) }))
  const go: Entry[] = [
    { id: "go:now", label: "Now", hint: "workspace", icon: <LayoutDashboard />, action: () => window.scrollTo({ top: 0 }) },
    { id: "go:console", label: "Council console", hint: "G C", icon: <Terminal />, action: () => { window.location.href = "/app" } },
    { id: "help", label: "Keyboard shortcuts", hint: "?", icon: <Keyboard />, action: onShortcuts },
  ].filter((e) => match(e.label, q))
  const choose = (fn: () => void) => { pending.current = fn; onOpenChange(false) }
  const row = (e: Entry) => (
    <CommandItem key={e.id} value={e.id} onSelect={() => choose(e.action)}>
      {e.icon}<span className="min-w-0 flex-1 truncate">{e.label}</span>{e.hint && <span className="ml-2 shrink-0 text-xs text-muted-foreground">{e.hint}</span>}
    </CommandItem>
  )
  return (
    <CommandDialog open={open} onOpenChange={(o) => { if (!o) setQuery(""); onOpenChange(o) }} title="Search and quick actions" description="Find work, write something down, or ask the council"
      onCloseAutoFocus={(e) => { e.preventDefault(); const fn = pending.current; pending.current = null; if (fn) fn(); else returnFocus() }}>
      <Command shouldFilter={false} loop>
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search, write down, or ask the council…" aria-label="Search work" />
        <CommandList className="max-h-[min(420px,60vh)]">
          {raw && (
            <CommandGroup heading="Quick actions">
              <CommandItem value="action:capture" onSelect={() => choose(() => onCapture(raw))}><Feather /><span className="min-w-0 flex-1 truncate">Write down: {raw}</span></CommandItem>
              <CommandItem value="action:ask" onSelect={() => choose(() => onAsk(raw))}><Gavel /><span className="min-w-0 flex-1 truncate">Ask the council: {raw}</span></CommandItem>
            </CommandGroup>
          )}
          {sig.length > 0 && <CommandGroup heading="Council">{sig.map(row)}</CommandGroup>}
          {its.length > 0 && <CommandGroup heading="Your list">{its.map(row)}</CommandGroup>}
          {go.length > 0 && <CommandGroup heading="Go to">{go.map(row)}</CommandGroup>}
          {q && !sig.length && !its.length && !go.length && !raw && <p className="px-4 py-3 text-sm text-muted-foreground">Nothing matches.</p>}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
