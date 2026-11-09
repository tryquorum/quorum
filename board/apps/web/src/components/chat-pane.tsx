import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, Loader2, Square, X } from "lucide-react"
import { toast } from "sonner"
import { api, ApiError, type Run } from "@/lib/api"
import { cn } from "@/lib/utils"
import { makeRunner, newLife, type Life, type Runner } from "@/hooks/use-data"
import { RunView } from "@/components/run-view"
import { EffortPicker, ModelPicker, useCatalog, useChoice } from "@/components/model-picker"
import { composing, matches } from "@/lib/shortcuts"

export type Thread = { id: string; title: string; model: string; runs: Run[]; running: boolean; updated: number; status: Run["status"] }

/** 이 일(target)의 모든 실행을 불러오고 대화 묶음(thread)으로 나눈다. 도는 중이면 1초마다 */
export function useThreads(target: string) {
  const bound = useMemo(() => ({ life: null as Life | null, targetRunner: null as Runner | null,
    pinned: new Map<string, Run[]>(), pinnedRunners: new Map<string, Runner>(), targetRows: [] as Run[],
    lastRows: null as Run[] | null, status: "loading" as "loading" | "ok" | "error", lastErrorTick: 0 }), [target])
  const current = useRef(bound)
  current.current = bound
  const [data, setData] = useState<{ key: typeof bound; runs: Run[]; status: "loading" | "ok" | "error"; hasData: boolean }>({ key: bound, runs: [], status: "loading", hasData: false })
  const live = (life: Life) => life.alive && life.key === target && current.current === bound && bound.life === life
  const publish = (life: Life) => {
    if (!live(life)) return
    const rows = new Map<string, Run>()
    for (const list of bound.pinned.values()) for (const row of list) rows.set(row.id, row)
    for (const row of bound.targetRows) {
      const old = rows.get(row.id)
      const stamp = (r: Run) => Math.max(r.last_activity_at || 0, r.finished_at || 0, r.created_at)
      if (!old || stamp(row) > stamp(old)) rows.set(row.id, row)
    }
    setData((prev) => ({ key: bound, runs: [...rows.values()].sort((a, b) => a.created_at - b.created_at), status: bound.status, hasData: prev.key === bound && prev.hasData }))
  }
  const ensurePinnedRunner = (life: Life, id: string) => {
    let runner = bound.pinnedRunners.get(id)
    if (!runner) {
      runner = makeRunner(life, async () => {
        try {
          const rows = (await api<{ runs: Run[] }>(`/api/runs?thread=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15000) })).runs
          if (!live(life) || rows.some((r) => r.target !== target)) return
          bound.pinned.set(id, rows)
          publish(life)
        } catch { /* 다음 tick 에 다시 시도 */ }
      })
      bound.pinnedRunners.set(id, runner)
    }
    return runner
  }
  useEffect(() => {
    const life = newLife(target)
    bound.life = life
    bound.pinned.clear()
    bound.pinnedRunners.clear()
    bound.targetRows = []
    bound.lastRows = null
    bound.status = "loading"
    setData({ key: bound, runs: [], status: "loading", hasData: false })
    const runner = makeRunner(life, async () => {
      if (!live(life)) return
      try {
        const rows = (await api<{ runs: Run[] }>(`/api/runs?target=${encodeURIComponent(target)}`, { signal: AbortSignal.timeout(15000) })).runs
        if (!live(life)) return
        bound.targetRows = rows
        bound.lastRows = rows
        bound.status = "ok"
        publish(life)
        setData((prev) => prev.key === bound ? { ...prev, hasData: true } : prev)
      } catch {
        if (!live(life)) return
        bound.lastRows = null
        bound.status = "error"
        bound.lastErrorTick = Date.now()
        publish(life)
      }
    })
    bound.targetRunner = runner
    void runner.run()
    const timer = setInterval(() => {
      if (!live(life) || document.hidden) return
      const pinnedRunning = [...bound.pinned.values()].some((rows) => rows.some((r) => r.status === "running"))
      if (bound.status === "error" ? Date.now() - bound.lastErrorTick >= 5000 : bound.targetRows.some((r) => r.status === "running") || pinnedRunning) {
        if (bound.status === "error") bound.lastErrorTick = Date.now()
        runner.tick()
      }
      for (const [id, rows] of bound.pinned) if (rows.some((r) => r.status === "running")) ensurePinnedRunner(life, id).tick()
    }, 1000)
    return () => {
      life.alive = false
      clearInterval(timer)
      runner.dispose()
      for (const r of bound.pinnedRunners.values()) r.dispose()
    }
  }, [bound, target]) // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(async (): Promise<Run[] | null> => {
    const life = bound.life
    const runner = bound.targetRunner
    if (!life || !runner || !live(life)) return null
    await runner.run()
    if (!live(life)) return null
    const rows = bound.lastRows
    await Promise.all([...bound.pinned.keys()].map((id) => ensurePinnedRunner(life, id).run()))
    return live(life) ? rows : null
  }, [bound, target]) // eslint-disable-line react-hooks/exhaustive-deps
  const mergeRuns = useCallback((id: string, rows: Run[]) => {
    const life = bound.life
    if (!life || !live(life) || rows.some((r) => r.target !== target)) return
    bound.pinned.set(id, rows)
    ensurePinnedRunner(life, id)
    publish(life)
  }, [bound, target]) // eslint-disable-line react-hooks/exhaustive-deps
  const { runs, status, hasData } = data.key === bound ? data : { runs: [] as Run[], status: "loading" as const, hasData: false }
  const running = runs.some((r) => r.status === "running")
  const threads = useMemo(() => {
    const m = new Map<string, Thread>()
    for (const r of runs) {
      if (r.kind === "draft") continue
      const k = r.thread || r.id
      const t = m.get(k) || { id: k, title: r.prompt.split("\n")[0].slice(0, 60), model: r.model_name || r.model, runs: [], running: false, updated: 0, status: r.status }
      t.runs.push(r)
      t.running ||= r.status === "running"
      t.updated = Math.max(t.updated, r.finished_at || r.created_at)
      t.status = r.status
      m.set(k, t)
    }
    return [...m.values()].sort((a, b) => b.updated - a.updated)
  }, [runs])
  return { threads, runs, load, running, status, hasData, mergeRuns }
}

/** 대화 하나 (새 대화면 thread=null). 일반 AI 채팅 화면처럼 */
export function ChatPane({
  target, thread, onCreated, reload, onToNote, contextHint, quote, onQuoteClear, onSeen,
}: {
  target: string
  thread: Thread | null
  onCreated: (threadId: string) => void
  reload: () => Promise<Run[] | null>
  onToNote: (md: string, heading: string) => void
  contextHint: string
  /** 노트에서 고른 부분. 첫 질문에 인용으로 붙는다 */
  quote?: string | null
  onQuoteClear?: () => void
  /** 끝난 대화를 열어 봤을 때 (확인 기다림을 확인함으로 바꾼 뒤) */
  onSeen?: () => void
}) {
  const cat = useCatalog()
  const [choice, setChoice] = useChoice(cat)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const lock = useRef(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const runs = thread?.runs || []
  const last = runs[runs.length - 1]
  const running = !!thread?.running

  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  // 끝난 대화를 열어 보면 그 대화의 "확인 기다림"을 확인함으로
  useEffect(() => {
    if (!thread || running || thread.status !== "done") return
    api<{ changed: number }>(`/api/runs/${thread.id}/seen`, { method: "POST" }).then((r) => r.changed && onSeen?.()).catch(() => null)
  }, [thread?.id, running, thread?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ta.current?.focus()
  }, [thread?.id])
  const outLen = runs.reduce((n, r) => n + r.output.length, 0) + runs.length
  // 답이 이어서 오는 동안에는 사람이 아래 끝을 보고 있을 때만 따라 내려가요. 위로 올려 읽는 중에 끌어내리면 화면이 튀어요
  const stick = useRef(true)
  const shownThread = useRef<string | undefined>(undefined)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    if (shownThread.current !== thread?.id) { shownThread.current = thread?.id; stick.current = true }
    if (stick.current) el.scrollTop = el.scrollHeight
  }, [outLen, thread?.id])
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }, [text])

  const send = async () => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      const q = text.trim()
      const prompt = quote ? `${q || "이 부분을 설명해줘"}\n\n노트에서 고른 부분:\n${quote.split("\n").map((l) => `> ${l}`).join("\n")}` : q
      if (!prompt || running || (!thread && !choice)) return
      if (thread && !last?.session_id) return toast("이전 답이 아직 세션을 만들지 못했어요. 새 대화로 시작해 주세요")
      const r = await api<Run>("/api/runs", {
        method: "POST",
        body: JSON.stringify(thread ? { prompt, target, parent: last.id } : { prompt, target, provider: choice!.provider, model: choice!.model, effort: choice!.effort }),
      })
      setText("")
      onQuoteClear?.()
      await reload()
      if (!thread) onCreated(r.thread || r.id)
    } catch (e) {
      toast("보내지 못했어요", { description: String((e as Error).message) })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const retry = async (run: Run) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      if (running) return
      let next: Run
      try {
        next = await api<Run>(`/api/runs/${encodeURIComponent(run.id)}/retry`, { method: "POST" })
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.body && typeof e.body === "object" && "error" in e.body && e.body.error === "already retried" && "run" in e.body && e.body.run && typeof e.body.run === "object" && "id" in e.body.run && typeof e.body.run.id === "string") next = e.body.run as Run
        else throw e
      }
      const tid = next.thread || next.id
      const rows = await reload()
      if (!rows) toast("목록을 다시 읽지 못했어요")
      else if (rows.some((r) => (r.thread || r.id) === tid)) onCreated(tid)
      else toast("이미 다시 시도했어요", { description: "그 실행은 대화 목록에서 확인할 수 있어요" })
    } catch (e) {
      toast("다시 시작하지 못했어요", { description: String((e as Error).message) })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const copy = async (run: Run) => {
    try { await navigator.clipboard.writeText(run.output); toast("복사했어요") }
    catch { toast("복사하지 못했어요") }
  }
  const stop = async () => {
    const r = runs.find((x) => x.status === "running")
    if (r) await api(`/api/runs/${r.id}/stop`, { method: "POST" }).catch(() => null)
    reload()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} onScroll={(event) => { const el = event.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-5 py-6">
          {!thread && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <div className="text-base font-medium">이 일을 아는 에이전트와 새 대화</div>
              <p className="max-w-sm text-sm text-muted-foreground">{contextHint}</p>
            </div>
          )}
          {runs.map((r) => (
            <div key={r.id} className="flex flex-col gap-3">
              <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">{r.prompt}</div>
              <RunView run={r} now={now} retrying={busy || running} onRetry={retry} onCopy={copy} onToNote={(run) => onToNote(run.output, run.prompt.split("\n")[0].slice(0, 60))} />
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[720px] shrink-0 px-5 pb-[calc(1rem+var(--tray-space,0px))]">
        <div className="rounded-2xl border bg-background shadow-xs focus-within:ring-2 focus-within:ring-ring">
          {quote && (
            <div className="mx-2 mt-2 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1"><span className="mb-0.5 block font-medium">인용</span><span className="line-clamp-3 whitespace-pre-wrap">{quote}</span></span>
              <button type="button" onClick={onQuoteClear} className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground" aria-label="인용 빼기"><X className="size-3.5" /></button>
            </div>
          )}
          <textarea
            ref={ta}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (matches(e, "chat.send") && !composing(e.nativeEvent)) {
                e.preventDefault()
                send()
              }
            }}
            rows={1}
            placeholder={thread ? "이어서 물어보기" : quote ? "이 부분에 대해 물어봐요 (비워두면 설명해 줘요)" : "이 일에 대해 물어보거나 맡겨요"}
            className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex min-w-0 items-center gap-1 px-2 pb-2">
            {thread ? (
              <span className="min-w-0 truncate rounded-full bg-muted px-2.5 py-1.5 text-xs whitespace-nowrap text-muted-foreground">{thread.model} · 같은 세션</span>
            ) : (
              <>
                <ModelPicker cat={cat} choice={choice} onChange={setChoice} />
                <EffortPicker cat={cat} choice={choice} onChange={setChoice} />
              </>
            )}
            <div className="flex-1" />
            {running ? (
              <button type="button" onClick={stop} className="grid size-8 place-items-center rounded-full bg-foreground text-background" aria-label="멈추기"><Square className="size-3 fill-current" /></button>
            ) : (
              <button type="button" onClick={send} disabled={(!text.trim() && !quote) || busy} className={cn("grid size-8 place-items-center rounded-full bg-foreground text-background disabled:opacity-30")} aria-label="보내기">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
