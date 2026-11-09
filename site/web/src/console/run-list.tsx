import { useEffect, useState } from "react"
import { Play } from "lucide-react"
import { ALERT, CHIP, DECIDE } from "@/workspace/tone"
import { asset } from "@/lib/base"
import { cn } from "@/lib/utils"
import type { RunSummary } from "@/lib/contract"

// From board/apps/web/src/components/ops/ops-runs.tsx: one row per run with a status badge.
// Quorum rows replay the run: the engine streams a finished run's stored events over the same SSE route.
const clock = (iso: string) => new Date(iso).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })

export function RunList({ refreshKey, current, onPlay }: { refreshKey: number; current?: string; onPlay: (run: RunSummary) => void }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetch(asset("api/runs?limit=20"))
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
  if (!runs.length) return <p className="rounded-xl border bg-card px-3 py-3 text-sm text-muted-foreground">No runs on this server yet. Convene the council to start one.</p>
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {runs.map((r) => (
        <li key={r.runId}>
          <button type="button" onClick={() => onPlay(r)} aria-current={current === r.runId}
            className={cn("group flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring", current === r.runId && "bg-muted/40")}>
            <Play aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn("rounded-full px-1.5 py-px font-mono text-2xs", r.status === "error" ? ALERT : r.status === "running" ? DECIDE + " animate-pulse" : CHIP)}>{r.status}</span>
                {r.mode === "replay" && <span className={"rounded-full px-1.5 py-px font-mono text-2xs " + DECIDE}>REPLAY</span>}
                <span className="tnum text-muted-foreground">{clock(r.startedAt)}</span>
                <span className="font-mono text-2xs text-muted-foreground/70">{r.runId}</span>
              </span>
              <span className="mt-1 block truncate">{r.request}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
