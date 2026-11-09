import { Copy, FilePlus2, Loader2 } from "lucide-react"
import { LazyMd } from "@/components/lazy-md"
import { ago, type Run } from "@/lib/api"
import { errorGuide, elapsedLabel, runStalled, toolLabel } from "@direction-board/contracts/run-labels"

type Step = { tool: string; arg: string }
export type RunViewProps = {
  run: Run
  now: number
  onRetry?: (run: Run) => void
  retrying?: boolean
  onCopy?: (run: Run) => void
  onToNote?: (run: Run) => void
  compact?: boolean
}
export function Steps({ steps, running }: { steps: Step[]; running: boolean }) {
  if (!steps.length) return null
  const last = steps[steps.length - 1]
  return (
    <details className="group/st text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 select-none hover:text-foreground">
        {running ? <Loader2 className="size-3 animate-spin text-ai" /> : <span className="text-2xs transition-transform group-open/st:rotate-90">▶</span>}
        {running ? <span className="truncate">{toolLabel(last.tool)}{last.arg ? ` · ${last.arg}` : ""}</span> : <span>작업 {steps.length}단계</span>}
      </summary>
      <ol className="mt-1.5 ml-1 flex flex-col gap-1 pl-3">
        {steps.map((s, i) => <li key={i} className="truncate"><span className="font-medium text-foreground/70">{toolLabel(s.tool)}</span>{s.arg ? ` · ${s.arg}` : ""}</li>)}
      </ol>
    </details>
  )
}

export function RunError({ run, onRetry, retrying = false }: Pick<RunViewProps, "run" | "onRetry" | "retrying">) {
  const guide = errorGuide(run.error_kind)
  const stopped = run.status === "stopped"
  return (
    <div role={stopped ? "status" : "alert"} className={stopped ? "flex flex-col gap-1.5 rounded-lg bg-muted px-3 py-2.5 text-sm" : "flex flex-col gap-1.5 rounded-lg bg-destructive/5 px-3 py-2.5 text-sm"}>
      {!stopped && <><p className="font-semibold text-destructive">{guide.title}</p><p className="leading-relaxed text-foreground/80">{guide.guidance}</p></>}
      {stopped && <p className="text-muted-foreground">실행을 멈췄어요</p>}
      {run.error && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer select-none hover:text-foreground">자세히</summary><pre className="mt-1 max-h-40 overflow-auto font-mono text-2xs whitespace-pre-wrap break-words">{run.error}</pre></details>}
      {onRetry && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button type="button" disabled={retrying} onClick={() => onRetry(run)} className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-40">{retrying ? "다시 시작하는 중…" : "다시 시도"}</button>
          {run.parent && <span className="text-2xs text-muted-foreground">새 대화로 다시 시작해요(앞 대화 맥락은 빠져요)</span>}
        </div>
      )}
    </div>
  )
}
export function RunStatus({ run, now }: { run: Run; now: number }) {
  const running = run.status === "running"
  const elapsed = elapsedLabel(run, now)
  const stalled = runStalled(run, now)
  return (
    <div className="text-2xs text-muted-foreground">
      <div className="flex items-center gap-1">
        {running && <span className="size-2 rounded-full bg-running" />}
        <span>{run.model_name || run.model}{run.effort ? ` · ${run.effort}` : ""}{run.parent ? " · 이어서" : ""}{run.retry_of ? " · 다시 시도한 실행" : ""} · {running ? "진행 중" : run.status === "done" ? "끝남" : run.status === "stopped" ? "멈춤" : "오류"} · <span className="num">{elapsed}</span>{!running && run.finished_at ? ` · ${ago(run.finished_at)}` : ""}</span>
      </div>
      {stalled && <p role="status" className="mt-1 rounded-md bg-muted px-2.5 py-1.5 text-xs text-foreground/80">응답이 없어요(90초). 계속 기다리거나 멈출 수 있어요</p>}
    </div>
  )
}
export function RunView({ run, now, onRetry, retrying, onCopy, onToNote, compact = false }: RunViewProps) {
  const running = run.status === "running"
  return (
    <div className="group/ans flex flex-col gap-2">
      <Steps steps={run.steps || []} running={running} />
      {run.output ? <LazyMd text={run.output} /> : running && !(run.steps || []).length ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> 생각하는 중…</div> : null}
      {(run.status === "error" || run.status === "stopped") && <RunError run={run} onRetry={run.kind === "sweep" ? undefined : onRetry} retrying={retrying} />}
      <RunStatus run={run} now={now} />
      {run.output && !running && (onCopy || onToNote) && <div className="flex gap-1 text-2xs text-muted-foreground">
        {onCopy && <button type="button" onClick={() => onCopy(run)} className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted"><Copy className="size-3" />복사</button>}
        {onToNote && <button type="button" onClick={() => onToNote(run)} className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted"><FilePlus2 className="size-3" />노트에 넣기</button>}
      </div>}
      {compact && <span className="sr-only">명령창 실행</span>}
    </div>
  )
}
