// 항목 한 줄. 출처: board/apps/web/src/components/task-row.tsx — 동그란 완료 버튼, 제목 버튼(열기), 오른쪽 날짜 칩, 터치에서 44px 높이.
// Workspace 판: 사건(의회 판정) 줄에는 Approve/Reject·Reviewed 버튼을 바로 붙여요(열지 않고 처리).
import { Check, CircleAlert, ExternalLink, Gavel, Loader2, MessageSquareText, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Area, Item, Signal } from "./api"
import { ALERT, LATE } from "./tone"
import { W } from "./when"

const pad = (n: number) => String(n).padStart(2, "0")
export const todayIso = (d = new Date()) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
export const dueLabel = (due: string) => W.short(due)
export const isLate = (due: string | null) => {
  if (!due) return false
  const now = new Date()
  if (due.length > 10) return new Date(due).getTime() < now.getTime()
  return due < todayIso(now)
}
const EXEC: Record<string, string> = { aside: "browser · Aside", codex: "code · Codex", board: "board", none: "no action" }
export const whenOf = (i: Item) => i.due ?? i.remindAt ?? null
/** 출처 표시: 방향판(3070)에서 읽어 온 사본 */
export function SourceChip({ item, className }: { item: { source?: string; meta?: Record<string, any> }; className?: string }) {
  const from = item.source === "direction-board" || item.meta?.from === "direction-board"
  if (!from) return null
  return <span title="from Direction Board — read-only copy; changes stay in Quorum" aria-label="from Direction Board" className={cn("shrink-0 rounded border border-border px-1 font-mono text-[10px] leading-4 text-muted-foreground", className)}><span className="max-sm:hidden">from Direction Board</span><span className="sm:hidden" aria-hidden>DB</span></span>
}

type RowShell = { selected: boolean; onSelect: () => void; children: React.ReactNode; tone?: "decide" | "review" | "plain" }
function Row({ selected, onSelect, children }: RowShell) {
  return (
    <li
      data-selected={selected || undefined}
      onMouseDown={onSelect}
      className={cn(
        "group/tr relative flex items-start gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors max-md:min-h-11 hover:bg-muted/50",
        selected && "border-border bg-muted/60",
      )}
    >
      {children}
    </li>
  )
}

export function ItemRow({ item, area, selected, busy, onSelect, onOpen, onDone, onAsk }: { item: Item; area?: Area | null; selected: boolean; busy: boolean; onSelect: () => void; onOpen: () => void; onDone: () => void; onAsk?: () => void }) {
  const when = whenOf(item)
  const late = !item.done && isLate(when)
  const lastAuto = [...item.log].reverse().find((l) => l.by === "agent")
  return (
    <Row selected={selected} onSelect={onSelect}>
      {/* 터치에서는 누르는 자리를 44px 로 넓히고 동그라미는 그대로(board task-row 의 coarse min-h-11 규칙) */}
      <button type="button" onClick={onDone} disabled={busy} aria-pressed={item.done} aria-label={(item.done ? "Reopen: " : "Mark done: ") + item.text} title={item.done ? "Done (E)·reopen" : "Done (E)"}
        className="group/done mt-0.5 grid size-[18px] shrink-0 place-items-center disabled:opacity-60 max-md:-m-[13px] max-md:size-11 [@media(pointer:coarse)]:-m-[13px] [@media(pointer:coarse)]:size-11">
        <span className={cn("grid size-[18px] place-items-center rounded-full border border-foreground/30 text-transparent transition-colors group-hover/done:border-foreground group-hover/done:text-foreground", item.done && "border-foreground bg-foreground text-background")}>
          <Check className="size-3" strokeWidth={3} />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className={cn("block w-full truncate text-left text-sm leading-5 hover:underline max-md:-my-3 max-md:py-3 [@media(pointer:coarse)]:-my-3 [@media(pointer:coarse)]:py-3", item.done && "text-muted-foreground line-through")} title={item.raw ?? item.text}>{item.text.split("\n")[0]}</button>
        {(item.runId || lastAuto || item.source === "direction-board" || area) && (
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-2xs text-muted-foreground">
            {area && <span className="inline-flex shrink-0 items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: area.color }} aria-hidden />{area.name}</span>}
            <SourceChip item={item} />
            {item.runId && <span className="inline-flex items-center gap-1 font-mono text-muted-foreground"><Gavel className="size-3" />{item.runId}</span>}
            {lastAuto && <span className="truncate">{lastAuto.text}</span>}
          </p>
        )}
      </div>
      {when && <span className={cn("mt-0.5 shrink-0 num font-mono text-2xs text-muted-foreground", late && LATE)}>{dueLabel(when)}</span>}
      {onAsk && !item.runId && !item.done && (
        <Button type="button" variant="outline" size="xs" className="shrink-0 rounded-full max-sm:w-11 max-sm:px-1.5" onClick={onAsk} disabled={busy} title="Send to agent (Q)" aria-label={"Send to agent: " + item.text}>
          <Send /><span className="max-sm:hidden">Send to agent</span>
        </Button>
      )}
    </Row>
  )
}

export function SignalRow({ s, selected, busy, onSelect, onOpen, onApprove, onReject, onResolve }: {
  s: Signal; selected: boolean; busy: boolean; onSelect: () => void; onOpen: () => void
  onApprove?: () => void; onReject?: () => void; onResolve?: () => void
}) {
  const exec = s.meta?.executor as string | undefined
  const failed = s.kind === "error"
  const running = s.status === "running"
  const tone = s.lane === "review" ? "review" : s.lane === "decide" || s.lane === "now" ? "decide" : "plain"
  return (
    <Row selected={selected} onSelect={onSelect} tone={tone}>
      <span className={cn("mt-0.5 grid size-[18px] shrink-0 place-items-center", failed ? "rounded-full " + ALERT : "text-muted-foreground")} aria-hidden>
        {failed ? <CircleAlert className="size-4" /> : running ? <Loader2 className="size-4 animate-spin" /> : tone === "review" ? <MessageSquareText className="size-4" /> : <Gavel className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className="block w-full truncate text-left text-sm leading-5 hover:underline max-md:-my-3 max-md:py-3 [@media(pointer:coarse)]:-my-3 [@media(pointer:coarse)]:py-3" title={s.title}>{s.title}</button>
        <p className="mt-0.5 line-clamp-2 text-2xs leading-4 text-muted-foreground">
          <SourceChip item={s} className="mr-1.5 inline" />
          {exec && <span className="mr-1.5 rounded bg-muted px-1 font-mono">{EXEC[exec] ?? exec}</span>}
          {s.reason}{s.body && tone === "review" ? " — " + s.body.split("\n")[0] : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {onApprove && (
          <Button type="button" size="xs" className="rounded-full max-sm:w-11" onClick={onApprove} disabled={busy} title={failed ? "Retry (A)" : "Approve (A)"}>
            <Check /><span className="max-sm:sr-only">{failed ? "Retry" : "Approve"}</span>
          </Button>
        )}
        {onReject && (
          <Button type="button" variant="outline" size="xs" className="rounded-full max-sm:w-11" onClick={onReject} disabled={busy} title={failed ? "Dismiss (X)" : "Reject (X)"}>
            <X /><span className="max-sm:sr-only">{failed ? "Dismiss" : "Reject"}</span>
          </Button>
        )}
        {onResolve && (
          <Button type="button" variant="outline" size="xs" className="rounded-full max-sm:w-11" onClick={onResolve} disabled={busy} title={s.lane === "review" ? "Mark reviewed (E)" : "Mark handled here (E)"}>
            <Check /><span className="max-sm:sr-only">{s.lane === "review" ? "Reviewed" : "Handled"}</span>
          </Button>
        )}
        {s.meta?.runId && !onApprove && !onResolve && (
          <a href="/app" className="text-muted-foreground hover:text-foreground" title={"Council run " + s.meta.runId}><ExternalLink className="size-3.5" /></a>
        )}
      </div>
    </Row>
  )
}
