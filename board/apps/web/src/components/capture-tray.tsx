// AI로 할 일 추가의 진행 칩과 결과 목록. 한 줄 아래(slot) 또는 화면 아래 오른쪽(보드는 위 오른쪽)에 뜬다.
import { useEffect, useRef, useState } from "react"
import { CircleAlert, X } from "lucide-react"
import type { CaptureEffect } from "@direction-board/contracts"
import { AiMark } from "@/components/ai-mark"
import { Button } from "@/components/ui/button"
import type { Captures } from "@/hooks/use-captures"
import { failureText, lastLine, OP_LABEL, SHOWN, summarize, visibleEntries, type CaptureEntry } from "@/lib/capture"
import { cn } from "@/lib/utils"

const elapsed = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초` }
const day = (ms: number) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(ms)
const badge: Record<CaptureEffect["op"], string> = { created: "bg-ai/10 text-ai-foreground", decision: "bg-decide/10 text-decide", merged: "bg-muted text-muted-foreground", updated: "bg-muted text-muted-foreground" }

function EffectRow({ e, onOpen, onUndo }: { e: CaptureEffect; onOpen: (ref: string) => void; onUndo: () => void }) {
  const gone = e.undone || !e.now
  return (
    <li className="flex min-h-8 items-center gap-2">
      <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium", badge[e.op])}>{OP_LABEL[e.op]}</span>
      <span className={cn("min-w-0 flex-1 truncate", gone && "text-muted-foreground line-through")}>{e.now?.title ?? e.title}</span>
      {gone ? <span className="shrink-0 text-xs text-muted-foreground">{e.undone ? "되돌림" : "없음"}</span> : (
        <>
          {e.now?.area && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{e.now.area}</span>}
          {e.now?.due ? <span className="num shrink-0 text-xs text-muted-foreground">{day(e.now.due)}</span> : null}
          <Button variant="ghost" size="xs" onClick={() => onOpen(e.ref)}>열기</Button>
          {e.undoable && <Button variant="ghost" size="xs" onClick={onUndo}>되돌리기</Button>}
        </>
      )}
    </li>
  )
}

function Card({ entry, c, now, onOpen, onManual }: { entry: CaptureEntry; c: Captures; now: number; onOpen: (ref: string) => void; onManual: (e: CaptureEntry) => void }) {
  const view = c.views[entry.id]
  const phase = c.phases[entry.id] ?? "running"
  const effects = view?.effects ?? []
  const run = view?.run
  const thread = run ? `run:${run.thread || run.id}` : null
  const step = run?.steps?.at(-1)
  const first = entry.text.split("\n")[0]
  return (
    <section aria-label={`AI 정리: ${first}`} className="rounded-lg border bg-card px-3 py-2.5 text-sm shadow-xs">
      <div className="flex items-center gap-2">
        <AiMark className={cn("size-3.5 text-ai", phase === "running" && "animate-pulse motion-reduce:animate-none")} />
        <p role="status" aria-live="polite" className="min-w-0 flex-1 truncate">
          {phase === "running" ? <span className="font-medium">AI가 정리 중</span> : phase === "done" ? <span className="font-medium">{summarize(effects)}</span> : <span className="font-medium text-destructive">{run ? failureText(run) : "AI가 정리하지 못했어요"}</span>}
          <span className="text-muted-foreground"> · {first}</span>
        </p>
        {phase === "running"
          ? <span className="num shrink-0 text-xs text-muted-foreground">{elapsed(now - entry.startedAt)}</span>
          : <Button variant="ghost" size="icon-xs" aria-label="닫기" onClick={() => c.dismiss(entry.id)}><X /></Button>}
      </div>
      {phase === "failed" && run?.status === "error" && (!run.error_kind || run.error_kind === "unknown") && lastLine(run.error) && (
        <p className="mt-0.5 truncate pl-5.5 text-xs text-muted-foreground" title={run.error ?? undefined}>{lastLine(run.error)}</p>
      )}
      {phase === "running" && (
        <div className="mt-1 flex items-center gap-2 pl-5.5">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{step ? `${step.tool} ${step.arg}` : "같은 일을 찾고 사실을 확인하는 중"}</span>
          <Button variant="ghost" size="xs" onClick={() => void c.stop(entry.id)}>멈추기</Button>
        </div>
      )}
      {effects.length > 0 && (
        <ul className="mt-1.5 flex flex-col pl-5.5" aria-label={phase === "failed" ? "일부는 올렸어요" : "AI가 올린 것"}>
          {effects.map((e) => <EffectRow key={e.ref} e={e} onOpen={onOpen} onUndo={() => void c.undo(entry.id, e.ref)} />)}
        </ul>
      )}
      {phase !== "running" && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-5.5">
          {phase === "failed" && effects.length > 0 && <span className="mr-1 flex items-center gap-1 text-xs text-muted-foreground"><CircleAlert className="size-3" />일부는 올렸어요</span>}
          {phase === "failed" && <Button variant="outline" size="xs" onClick={() => void c.retry(entry.id)}>다시 시도</Button>}
          {(phase === "failed" || effects.length === 0) && <Button variant="outline" size="xs" onClick={() => onManual(entry)}>직접 추가</Button>}
          {thread && <Button variant="ghost" size="xs" onClick={() => onOpen(thread)}>대화 열기</Button>}
        </div>
      )}
    </section>
  )
}

/** floating: 자리(slot)가 없는 화면에서 떠요. 보통은 아래 오른쪽(제목·머리 단추를 가리지 않게), 보드처럼 아래에 도구줄이 있는 화면은 top 으로 위 오른쪽 */
export function CaptureTray({ c, onOpen, onManual, floating, top = false }: { c: Captures; onOpen: (ref: string) => void; onManual: (e: CaptureEntry) => void; floating: boolean; top?: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  const box = useRef<HTMLDivElement>(null)
  const live = c.entries.filter((e) => !e.dismissed).reverse()
  const running = live.some((e) => (c.phases[e.id] ?? "running") === "running")
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  // 화면 아래에 떠 있을 때는 그 높이만큼 본문 끝에 자리를 내줘요(마지막 줄·포커스가 트레이 밑에 숨지 않게)
  const floatingShown = floating && !top && live.length > 0
  useEffect(() => {
    const el = box.current
    if (!floatingShown || !el) return
    const root = document.documentElement
    const ro = new ResizeObserver(() => root.style.setProperty("--tray-space", `${Math.ceil(el.getBoundingClientRect().height) + 12}px`))
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty("--tray-space")
    }
  }, [floatingShown])
  if (!live.length) return null
  const shown = visibleEntries(c.entries, c.expanded)
  return (
    <div ref={box} className={cn("flex flex-col gap-2", floating ? cn("fixed inset-x-3 z-30 max-h-[40dvh] overflow-y-auto overscroll-contain sm:inset-x-auto sm:right-4 sm:w-[min(420px,calc(100vw-2rem))]", top ? "top-14" : "bottom-3 sm:bottom-4") : "mt-2")}>
      {shown.map((e) => <Card key={e.id} entry={e} c={c} now={now} onOpen={onOpen} onManual={onManual} />)}
      {live.length > SHOWN && <Button variant="ghost" size="xs" className="self-start" onClick={() => c.setExpanded(!c.expanded)}>{c.expanded ? "접기" : `${live.length - SHOWN}개 더`}</Button>}
    </div>
  )
}
