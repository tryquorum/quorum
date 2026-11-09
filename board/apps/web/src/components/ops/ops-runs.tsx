import { useState } from "react"
import { ChevronRight, MessageSquareText } from "lucide-react"
import type { OpsReportItem, OpsRun } from "@direction-board/contracts/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LazyMd } from "@/components/lazy-md"
import { cn } from "@/lib/utils"
import { runLine, STATUS_KO } from "@direction-board/contracts/ops-labels"
import { openRunThread } from "@/hooks/use-ops"

const clock = (ts: number) => new Date(ts).toLocaleString("ko-KR", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" })
const KIND: Record<OpsReportItem["kind"], string> = { signal: "사건", card: "할 일", merged: "합침", closed: "닫음" }
const firstLine = (s: string | null | undefined) => (s || "").split("\n").find((l) => l.trim()) || ""

/** 지난 순회: 줄마다 결과 수와 요약 첫 줄, 펼치면 보고 전문·올린 것(누르면 그 일)·대화 열기 */
export function OpsRuns({ runs }: { runs: OpsRun[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!runs.length) return <p className="rounded-xl border bg-card px-3 py-3 text-sm text-muted-foreground">아직 돈 순회가 없어요. 지금 돌리기로 한 번 돌려 볼 수 있어요</p>
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {runs.map((r) => {
        const expanded = open === r.id
        const { text: line, tone } = runLine(r)
        return (
          <li key={r.id}>
            <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.id)}
              className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant={r.status === "error" ? "destructive" : r.status === "running" ? "default" : "secondary"} className={cn(r.status === "running" && "animate-pulse")}>{STATUS_KO[r.status] || r.status}</Badge>
                  <span className="tnum text-muted-foreground">{clock(r.created_at)}</span>
                  <span className={cn(tone === "error" ? "text-destructive" : tone === "active" ? "text-foreground font-medium" : "text-muted-foreground")}>{line}</span>
                </span>
                {r.report?.summary && <span className="mt-1 block truncate text-muted-foreground">{firstLine(r.report.summary)}</span>}
              </span>
            </button>
            {expanded && (
              <div className="space-y-3 border-t bg-muted/20 px-3 py-3 pl-9 text-sm">
                {r.report?.summary && <p className="whitespace-pre-wrap">{r.report.summary}</p>}
                {r.report && r.report.items.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">올린 것</p>
                    <ul className="space-y-0.5">
                      {r.report.items.map((it) => (
                        <li key={it.kind + it.ref}>
                          <a href={`#/w/${encodeURIComponent(it.ref)}`} className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                            <span className="w-9 shrink-0 text-xs text-muted-foreground">{KIND[it.kind]}</span>
                            <span className="truncate">{it.title || it.ref}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {r.report && r.report.counts.errors > 0 && <p className="text-xs text-muted-foreground">보고에서 받지 못한 항목 {r.report.counts.errors}개</p>}
                {r.error && <p className="whitespace-pre-wrap text-destructive">{r.error}</p>}
                {r.output ? <div className="rounded-lg border bg-background px-3 py-2"><p className="mb-1 text-xs text-muted-foreground">마지막 답</p><LazyMd text={r.output} /></div> : null}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{[r.model_name, r.effort].filter(Boolean).join(" · ")}</span>
                  <Button size="sm" variant="outline" className="ml-auto" onClick={() => openRunThread(r.id)}><MessageSquareText />대화 열기</Button>
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
