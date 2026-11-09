// 목표·전체 목록·사건 보기. 출처: board/apps/web/src/components/goal-view.tsx(목표 카드: D-day 배지·진행률·이어진 할 일),
// roadmap-view.tsx(오늘부터 마감까지 가로 막대), list-view.tsx(지남·오늘·이번 주·나중·날짜 없음 묶음, 영역·검색·끝낸 일 보기).
import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Area, GoalView, Item, Signal } from "./api"
import { SourceChip, whenOf } from "./rows"

export type RowSpec = { key: string; kind: "item"; item: Item; ask?: boolean } | { key: string; kind: "signal"; signal: Signal; decide?: boolean; resolve?: boolean }
export type SectionSpec = { id: string; title: string; hint?: string; rows: RowSpec[]; empty?: string; tone?: "decide" | "review" | "plain"; extra?: React.ReactNode }

const DAY = 864e5
const day0 = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }
const atOf = (w: string) => (w.length > 10 ? new Date(w).getTime() : new Date(w + "T23:59").getTime())
/** board api.ts dday(): 목표 마감까지 남은 날 */
export function dday(due: string): { t: string; late: boolean } {
  const n = Math.round((day0(new Date(due + "T00:00")) - day0()) / DAY)
  return n === 0 ? { t: "D-day", late: false } : n > 0 ? { t: "D-" + n, late: false } : { t: "D+" + -n, late: true }
}

/** 로드맵 띠: 오늘부터 가장 먼 마감까지 목표마다 막대 하나, 진행률만큼 채워요 */
export function Roadmap({ goals, onOpen }: { goals: GoalView[]; onOpen: (id: string) => void }) {
  const dated = goals.filter((g) => g.goal.due)
  if (!dated.length) return null
  const start = day0()
  const end = Math.max(...dated.map((g) => atOf(g.goal.due!)), start + 14 * DAY)
  const span = end - start
  return (
    <div className="rounded-2xl border bg-card/60 p-4">
      <div className="mb-3 flex justify-between font-mono text-2xs text-muted-foreground"><span>today</span><span>{new Date(end).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>
      <ul className="flex flex-col gap-2.5">
        {dated.map((g) => {
          const w = Math.max(4, Math.min(100, ((atOf(g.goal.due!) - start) / span) * 100))
          const pct = g.total ? g.done / g.total : 0
          const d = dday(g.goal.due!)
          return (
            <li key={g.goal.id}>
              <button type="button" onClick={() => onOpen(g.goal.id)} className="group block w-full text-left">
                <div className="mb-1 flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate group-hover:underline">{g.goal.text}</span><span className={cn("num font-mono text-2xs", d.late ? "text-cut" : "text-muted-foreground")}>{d.t}</span></div>
                <div className="h-2 rounded-full bg-foreground/5"><div className="relative h-full rounded-full bg-foreground/15" style={{ width: w + "%" }}><div className="absolute inset-y-0 left-0 rounded-full bg-keep" style={{ width: pct * 100 + "%" }} /></div></div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** 목표 카드 머리: 제목, D-day 배지, 진행률 막대(board goal-view.tsx) */
export function GoalHeader({ g, focus }: { g: GoalView; focus?: boolean }) {
  const pct = g.total ? Math.round((g.done / g.total) * 100) : 0
  const d = g.goal.due ? dday(g.goal.due) : null
  return (
    <div className={cn("flex flex-col gap-2", focus && "rounded-xl ring-2 ring-ring/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{g.goal.text}</h3>
        <SourceChip item={g.goal} />
        {d && <span className={cn("rounded-full px-2 py-0.5 font-mono text-2xs", d.late ? "bg-cut/10 text-cut ring-1 ring-cut/20" : "bg-keep/10 text-keep ring-1 ring-keep/30")}>{d.t}</span>}
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-keep transition-[width]" style={{ width: pct + "%" }} /></div>
        <span className="num font-mono text-2xs text-muted-foreground">{g.done}/{g.total} · {pct}%</span>
      </div>
    </div>
  )
}

const GROUPS = ["Overdue", "Today", "This week", "Later", "No date"] as const
/** 전체 목록의 묶음(board list-view.tsx 의 지남/오늘/이번 주/나중/날짜 없음) */
export function groupByWhen(items: Item[]): Record<(typeof GROUPS)[number], Item[]> {
  const start = day0()
  const end = start + DAY - 1
  const week = end + 7 * DAY
  const g: Record<(typeof GROUPS)[number], Item[]> = { Overdue: [], Today: [], "This week": [], Later: [], "No date": [] }
  for (const i of items) {
    const w = whenOf(i)
    if (!w) { g["No date"].push(i); continue }
    const at = w.length > 10 ? new Date(w).getTime() : new Date(w + "T12:00").getTime()
    const d0 = w.length > 10 ? at : new Date(w + "T00:00").getTime()
    g[d0 < start ? "Overdue" : at <= end ? "Today" : at <= week ? "This week" : "Later"].push(i)
  }
  for (const k of GROUPS) g[k].sort((a, b) => String(whenOf(a)).localeCompare(String(whenOf(b))))
  return g
}

export function ListFilters({ areas, area, onArea, q, onQ, showDone, onShowDone }: { areas: Area[]; area: string; onArea: (a: string) => void; q: string; onQ: (q: string) => void; showDone: boolean; onShowDone: (v: boolean) => void }) {
  const chip = (on: boolean) => cn("inline-flex items-center justify-center rounded-full px-2.5 py-1 text-xs whitespace-nowrap transition-colors max-md:min-h-11 max-md:px-3.5", on ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <button type="button" className={chip(area === "all")} onClick={() => onArea("all")} aria-pressed={area === "all"}>All areas</button>
      {areas.map((a) => (
        <button key={a.id} type="button" className={chip(area === a.id)} onClick={() => onArea(a.id)} aria-pressed={area === a.id}>
          <span className="mr-1.5 size-1.5 rounded-full" style={{ background: a.color }} />{a.name}
        </button>
      ))}
      <label className="ml-auto flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground max-md:w-full">
        <Search className="size-3.5" /><input value={q} onChange={(e) => onQ(e.target.value)} placeholder="Filter" aria-label="Filter tasks" className="w-28 bg-transparent outline-none max-md:flex-1" />
      </label>
      <button type="button" className={chip(showDone)} onClick={() => onShowDone(!showDone)} aria-pressed={showDone}>{showDone ? "Hide done" : "Show done"}</button>
    </div>
  )
}

export function useListState() {
  const [q, setQ] = useState("")
  const [showDone, setShowDone] = useState(false)
  return { q, setQ, showDone, setShowDone }
}

export function useSignalSections(signals: Signal[]): SectionSpec[] {
  return useMemo(() => {
    const by = (f: (s: Signal) => boolean) => signals.filter(f)
    const council = (s: Signal) => !!s.meta?.runId && !!s.meta?.proposalId
    return [
      { id: "sig-decide", title: "Needs you", tone: "decide" as const, rows: by((s) => s.status === "open" && ["decide", "now", "main"].includes(s.lane)).map((s) => ({ key: "s:" + s.id, kind: "signal" as const, signal: s, decide: council(s), resolve: !council(s) })), empty: "Nothing is waiting on you." },
      { id: "sig-running", title: "Running", rows: by((s) => s.status === "running" || s.lane === "running").map((s) => ({ key: "s:" + s.id, kind: "signal" as const, signal: s })), empty: "Nothing running." },
      { id: "sig-review", title: "Review", tone: "review" as const, rows: by((s) => s.status === "open" && s.lane === "review").map((s) => ({ key: "s:" + s.id, kind: "signal" as const, signal: s, resolve: true })), empty: "Nothing to review." },
    ]
  }, [signals])
}
