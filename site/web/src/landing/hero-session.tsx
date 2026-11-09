import { useEffect, useMemo, useState } from "react"
import { Brain, Globe } from "lucide-react"
import { RoleChamber } from "@/components/hemicycle"
import { useReducedMotion } from "@/components/reveal"
import { cn } from "@/lib/utils"
import type { Decision, QuorumEvent, Role, Stance } from "@/lib/contract"
import { EN, SEOUL_EVENTS, SEOUL_PROPOSALS, SEOUL_STATS } from "@/lib/seoul"

// Plays the real recording of the first live council run (c0mpiled-17 Seoul, 11:31 KST).
// The engine emitted all critiques and verdicts in one batch (same timestamp), so they are shown grouped
// by proposal; every line keeps its real seq. Timing is compressed; the real run took 2 min 32 s.
const DWELL: Partial<Record<QuorumEvent["type"], number>> = {
  "run.start": 1700, recall: 2300, proposal: 1100, critique: 850, verdict: 1700,
  "execute.start": 1700, "execute.result": 3200, "memory.saved": 1200, "run.end": 3600,
}
function script(events: QuorumEvent[]): QuorumEvent[] {
  const pid = (e: QuorumEvent) => (e.data as { proposalId?: string } | undefined)?.proposalId
  const head = events.filter((e) => ["run.start", "recall", "proposal"].includes(e.type))
  const tail = events.filter((e) => ["execute.start", "execute.result", "memory.saved", "run.end"].includes(e.type))
  const debate = SEOUL_PROPOSALS.flatMap((p) => events.filter((e) => (e.type === "critique" || e.type === "verdict") && pid(e) === p.id))
  return [...head, ...debate, ...tail]
}

const STAMP: Record<Decision, string> = { pass: "border-keep text-keep", hold: "border-escalate text-escalate", reject: "border-cut text-cut" }
const TYPE_TONE: Partial<Record<QuorumEvent["type"], string>> = {
  recall: "text-memory", proposal: "text-foreground", critique: "text-muted-foreground", verdict: "text-signal",
  "execute.start": "text-live", "execute.result": "text-live", "memory.saved": "text-memory", "run.end": "text-signal",
}
const STANCE_TONE: Record<Stance, string> = { keep: "text-keep", cut: "text-cut", escalate: "text-escalate" }

export function HeroSession() {
  const reduced = useReducedMotion()
  const steps = useMemo(() => script(SEOUL_EVENTS), [])
  const starts = useMemo(() => { let t = 0; return steps.map((e) => { const s = t; t += DWELL[e.type] ?? 1000; return s }) }, [steps])
  const total = starts[starts.length - 1] + (DWELL[steps[steps.length - 1].type] ?? 1000)
  const [clock, setClock] = useState(0)
  useEffect(() => {
    if (reduced) return
    const t0 = performance.now()
    const id = window.setInterval(() => setClock((performance.now() - t0) % total), 100)
    return () => window.clearInterval(id)
  }, [reduced, total])
  // Reduced motion: show the moment the CSO escalates p2, the scene the section below is about.
  const index = reduced ? steps.findIndex((e) => e.seq === 18) : Math.max(0, starts.findLastIndex((s) => s <= clock))
  const shown = steps.slice(0, index + 1)
  const cur = shown[shown.length - 1]
  const curPid = (() => { for (let i = shown.length - 1; i >= 0; i--) { const p = (shown[i].data as { proposalId?: string } | undefined)?.proposalId; if (p && shown[i].type !== "proposal") return p } return undefined })()
  const executing = cur.type.startsWith("execute") || cur.type === "memory.saved" || cur.type === "run.end"
  const focusPid = executing ? "p1" : curPid
  const p = SEOUL_PROPOSALS.find((x) => x.id === focusPid)
  const stances: Partial<Record<Role, Stance>> = {}
  if (p) for (const e of shown) { const d = e.data as { proposalId?: string; role?: Role; stance?: Stance }; if (e.type === "critique" && d.proposalId === p.id && d.role && d.stance) stances[d.role] = d.stance }
  const verdict = p && shown.some((e) => e.type === "verdict" && (e.data as { proposalId?: string }).proposalId === p.id) ? p.decision : undefined
  const lines = shown.slice(-6)
  const progress = reduced ? 0.6 : clock / total

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card/60 shadow-2xl shadow-black/50 backdrop-blur">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 text-xs text-muted-foreground">
        <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-cut/60" /><span className="relative inline-flex size-2 rounded-full bg-cut" /></span>
        <span className="truncate font-medium text-foreground">Recorded live · Seoul · 11:31 KST today</span>
        <span className="ml-auto hidden font-mono text-2xs sm:inline">real run 2 min 32 s · shown faster</span>
      </div>
      <div className="grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="relative flex flex-col px-4 pt-7 pb-5 sm:px-8">
          <RoleChamber stances={stances} className="mx-auto max-w-[30rem]" />
          <div className="mt-2 flex min-h-28 flex-col items-center gap-2 text-center">
            {cur.type === "run.start" ? (
              <p className="max-w-[34ch] text-sm text-muted-foreground">“{EN[0].replace("Request: ", "")}”</p>
            ) : cur.type === "recall" ? (
              <p className="inline-flex items-center gap-2 rounded-full bg-memory/12 px-3 py-1 text-sm text-memory"><Brain className="size-4" />gbrain recall · closest {Math.round(SEOUL_STATS.recallScore * 100)}% &lt; {Math.round(SEOUL_STATS.recallThreshold * 100)}% · debate from scratch</p>
            ) : p ? (
              <>
                <p className="font-mono text-2xs text-muted-foreground">{p.id} · {p.actor}</p>
                <p className="max-w-[30ch] text-base leading-snug font-medium text-balance">{p.titleEn}</p>
                <div className="flex h-8 items-center gap-2">
                  {verdict ? (
                    <span key={p.id + verdict} className={cn("stamp rounded-md border-2 px-2.5 py-0.5 font-mono text-sm font-bold tracking-widest uppercase", STAMP[verdict])}>{verdict}</span>
                  ) : (
                    <span className="font-mono text-2xs tracking-wider text-muted-foreground uppercase">arguing…</span>
                  )}
                  {executing && <span className="inline-flex items-center gap-1 rounded-full bg-live/12 px-2 py-0.5 font-mono text-2xs text-live"><Globe className="size-3" />aside</span>}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{SEOUL_PROPOSALS.length} proposals on the floor</p>
            )}
          </div>
        </div>
        <ol className="flex min-h-[22rem] min-w-0 flex-col justify-end gap-2.5 border-t bg-background/60 p-4 md:border-t-0 md:border-l" aria-label="Recorded council events">
          {lines.map((e) => {
            const d = e.data as { stance?: Stance; role?: string; proposalId?: string } | undefined
            return (
              <li key={e.seq} className="row-in min-w-0">
                <div className="flex items-baseline gap-2 font-mono text-[11px]">
                  <span className="num w-5 shrink-0 text-muted-foreground/60">{e.seq}</span>
                  <span className={cn("shrink-0", TYPE_TONE[e.type] ?? "text-muted-foreground")}>{e.type}</span>
                  <span className="truncate text-muted-foreground">{e.actor}{d?.proposalId ? ` → ${d.proposalId}` : ""}</span>
                </div>
                <p className={cn("truncate pl-7 text-[13px]", d?.stance ? STANCE_TONE[d.stance] : "text-foreground/90")} lang="ko">{e.text}</p>
                {EN[e.seq] && <p className="truncate pl-7 text-[12px] text-muted-foreground italic">{EN[e.seq]}</p>}
              </li>
            )
          })}
        </ol>
      </div>
      <div className="h-0.5 bg-muted"><div className="h-full bg-signal/70 transition-[width] duration-100" style={{ width: `${progress * 100}%` }} /></div>
    </div>
  )
}
