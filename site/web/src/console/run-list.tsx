import { useEffect, useState } from "react"
import { ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { RunSummary } from "@/lib/contract"

// From board/apps/web/src/components/ops/ops-runs.tsx: one row per run with a status badge, expandable.
// Quorum lists GET /api/runs and says plainly when the server cannot list them yet.
const clock = (iso: string) => new Date(iso).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })

export function RunList({ refreshKey }: { refreshKey: number }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetch("/api/runs")
      .then(async (r) => {
        if (!r.ok) throw new Error(`GET /api/runs returned HTTP ${r.status}`)
        return (await r.json()) as RunSummary[]
      })
      .then((list) => { if (alive) { setRuns(Array.isArray(list) ? list : []); setProblem(null) } })
      .catch((e: unknown) => { if (alive) setProblem(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [refreshKey])
  if (problem) return <p className="rounded-xl border bg-card px-3 py-3 text-sm text-muted-foreground">Run history is unavailable: {problem}</p>
  if (!runs) return <p className="rounded-xl border bg-card px-3 py-3 text-sm text-muted-foreground">Loading run history…</p>
  if (!runs.length) return <p className="rounded-xl border bg-card px-3 py-3 text-sm text-muted-foreground">No runs yet. Convene the council to start one.</p>
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {runs.map((r) => {
        const expanded = open === r.runId
        return (
          <li key={r.runId}>
            <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.runId)}
              className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant={r.status === "error" ? "destructive" : r.status === "running" ? "default" : "secondary"} className={cn(r.status === "running" && "animate-pulse")}>{r.status}</Badge>
                  {r.mode === "replay" && <Badge className="bg-escalate/15 text-escalate">REPLAY</Badge>}
                  <span className="tnum text-muted-foreground">{clock(r.startedAt)}</span>
                </span>
                <span className="mt-1 block truncate">{r.request}</span>
              </span>
            </button>
            {expanded && <div className="border-t bg-muted/20 px-3 py-2 pl-9 font-mono text-xs text-muted-foreground">{r.runId}</div>}
          </li>
        )
      })}
    </ul>
  )
}
