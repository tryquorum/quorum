import { Loader2 } from "lucide-react"
import { Md } from "@/components/md"
import { cn } from "@/lib/utils"
import type { ExecStep } from "@/console/stream"

// From board/apps/web/src/components/run-view.tsx (Steps): same disclosure, spinner while running and
// a numbered trail when finished. Quorum adds executor result items and renders a multi-line result
// summary as markdown with board's Md renderer (run-view renders run.output with LazyMd the same way).
export function Steps({ steps }: { steps: ExecStep[] }) {
  if (!steps.length) return null
  const last = steps[steps.length - 1]
  const running = last.type === "execute.start"
  const failed = last.type === "execute.result" && last.ok === false
  const items = steps.flatMap((s) => s.items)
  const report = steps.map((s) => s.summary).find((s) => s && s.includes("\n"))
  return (
    <div className="flex flex-col gap-2">
      <details className="group/st text-xs text-muted-foreground" open={!running && !report && items.length > 0 && items.length <= 8}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 select-none hover:text-foreground">
          {running ? <Loader2 className="size-3 animate-spin text-live" /> : <span className="text-2xs transition-transform group-open/st:rotate-90">▶</span>}
          <span className={cn("truncate", failed ? "text-cut" : running ? "text-live" : "text-foreground/80")}>
            <span className="font-mono">{last.actor}</span> · {running ? "running…" : last.text}
          </span>
        </summary>
        <ol className="mt-1.5 ml-1 flex flex-col gap-1 border-l pl-3">
          {steps.map((s) => (
            <li key={s.seq} className="truncate"><span className="num text-foreground/50">#{s.seq}</span> <span className="font-medium text-foreground/70">{s.type === "execute.start" ? "started" : s.ok === false ? "failed" : "result"}</span> · {s.text}</li>
          ))}
          {items.map((it, i) => <li key={`i${i}`} className="text-foreground/85">• {it}</li>)}
        </ol>
      </details>
      {report && (
        <div className="row-in rounded-xl border bg-background/70 px-4 py-3">
          <p className="mb-2 font-mono text-2xs tracking-wider text-live uppercase">{last.actor} report</p>
          <Md text={report} className="scroll-pane max-h-96 overflow-y-auto pr-2 text-[13.5px]" />
        </div>
      )}
    </div>
  )
}
