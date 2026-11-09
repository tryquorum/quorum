import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUp, ChevronDown, History, Loader2, Plus, RotateCcw, Square } from "lucide-react"
import { AiMark } from "@/components/ai-mark"
import { toast } from "sonner"
import { ago, api, ApiError, type Run, type RunThread } from "@/lib/api"
import { cn } from "@/lib/utils"
import { RunView } from "@/components/run-view"
import type { View } from "@/components/app-sidebar"
import { EffortPicker, ModelPicker, useCatalog, useChoice } from "@/components/model-picker"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { composing, matches } from "@/lib/shortcuts"
import { useShortcut } from "@/components/shortcut-dispatch"
import { publishDock } from "@/components/dock-button"

const VIEW_KO: Record<View, string> = { home: "홈", board: "보드", road: "로드맵", list: "전체 목록", docs: "문서", settings: "설정", issues: "이슈" }
const STATUS_KO: Record<Run["status"], string> = { running: "도는 중", done: "끝남", error: "실패", stopped: "멈춤" }

type ListState = "loading" | "ready" | "error"
type ThreadState = "idle" | "loading" | "ready" | "missing" | "error"

/** 대화 목록(전체 thread 요약)과 고른 대화의 턴. 늦게 도착한 응답은 요청 번호로 버린다 */
function useDockThreads(selectedId: string | null) {
  const [threads, setThreads] = useState<RunThread[]>([])
  const [listState, setListState] = useState<ListState>("loading")
  const [runs, setRuns] = useState<Run[]>([])
  const [threadState, setThreadState] = useState<ThreadState>("idle")
  const [truncated, setTruncated] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const listReq = useRef(0)
  const threadReq = useRef(0)
  const current = useRef(selectedId)
  current.current = selectedId

  const loadList = useCallback(async () => {
    const n = ++listReq.current
    try {
      const r = await api<{ threads: RunThread[] }>("/api/runs/threads?limit=40")
      if (n !== listReq.current) return null
      setThreads(r.threads)
      setListState("ready")
      return r.threads
    } catch {
      if (n === listReq.current) setListState("error")
      return null
    }
  }, [])

  const loadThread = useCallback(async (id: string, quiet = false) => {
    const n = ++threadReq.current
    if (!quiet) setThreadState((s) => (s === "ready" && current.current === id ? s : "loading"))
    try {
      const r = await api<{ runs: Run[]; truncated?: boolean }>("/api/runs?thread=" + encodeURIComponent(id))
      if (n !== threadReq.current || current.current !== id) return
      setRuns(r.runs)
      setTruncated(!!r.truncated)
      setLoadedFor(id)
      setThreadState("ready")
    } catch (e) {
      if (n !== threadReq.current || current.current !== id) return
      setThreadState(e instanceof ApiError && e.status === 404 ? "missing" : "error")
    }
  }, [])

  // 고른 대화가 바뀌면 이전 턴을 바로 비우고 새로 읽는다
  useEffect(() => {
    threadReq.current++
    setRuns([])
    setTruncated(false)
    setLoadedFor(null)
    if (!selectedId) {
      setThreadState("idle")
      return
    }
    setThreadState("loading")
    loadThread(selectedId)
  }, [selectedId, loadThread])

  const ready = threadState === "ready" && loadedFor === selectedId
  const running = ready && runs.some((r) => r.status === "running")
  // 도는 턴이 있을 때만 1초마다 다시 읽고, 끝나면 목록도 새로 읽는다
  const wasRunning = useRef(false)
  useEffect(() => {
    if (running) {
      wasRunning.current = true
      const t = setInterval(() => selectedId && loadThread(selectedId, true), 1000)
      return () => clearInterval(t)
    }
    if (wasRunning.current) {
      wasRunning.current = false
      loadList()
    }
  }, [running, selectedId, loadThread, loadList])

  return { threads, listState, runs, threadState, truncated, loadedFor, ready, running, loadList, loadThread }
}


/**
 * AI 명령창. 평소엔 숨어 있고, 머리글의 AI 단추(DockButton)나 "/" 로 오른쪽 아래에 연다. 쓰기 시작하면 모델 고르기, 결과는 위로 펼쳐진다.
 * 대화 목록에서 지난 대화를 골라 이어 묻거나 새 대화를 시작한다. 일 화면에서는 그 일을 맥락으로 붙일 수 있다.
 * 닫아도 쓰던 글과 고른 대화는 남는다(머리글 단추에 점)
 */
export function CommandDock({ placeholder = "AI에게 맡길 일을 적어요", view, workRef, boardId }: { placeholder?: string; view: View; workRef: string | null; boardId?: string }) {
  const cat = useCatalog()
  const [choice, setChoice] = useChoice(cat)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selGen = useRef(0)
  const { threads, listState, runs, threadState, truncated, ready, running, loadList, loadThread } = useDockThreads(selectedId)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [now, setNow] = useState(() => Date.now())
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [contextOn, setContextOn] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const last = ready ? runs[runs.length - 1] : undefined
  const continuable = !!last && !!last.session_id && last.status !== "running" && (runs[0]?.kind ?? "chat") === "chat"
  const canContinue = !!selectedId && ready && continuable
  const blocked = !!selectedId && (threadState !== "ready" || !continuable) // 고른 대화를 이어갈 수 없거나 아직/못 읽음
  const active = open || !!text.trim()
  const pageLabel = workRef ? VIEW_KO[view] + " · 열어 둔 일" : VIEW_KO[view]
  const collapsed = !expanded && !open
  const textNow = useRef(text)
  const collapsedNow = useRef(collapsed)
  useEffect(() => {
    textNow.current = text
    collapsedNow.current = collapsed
  }, [text, collapsed])
  useEffect(() => {
    publishDock({ open: !collapsed, running, draft: !!text.trim() })
  }, [collapsed, running, text])

  // 고르기: 사용자의 선택은 늦게 온 전송 응답보다 우선한다
  const select = useCallback((id: string | null) => {
    selGen.current++
    setSelectedId(id)
  }, [])

  // 첫 목록만 불러 둔다. 기본은 새 대화이고, 지난 대화는 목록에서 골라야 이어 묻는다
  useEffect(() => {
    loadList()
  }, [loadList])

  // 일이 바뀌면 맥락 칩은 꺼진다
  const [prevWork, setPrevWork] = useState(workRef)
  if (workRef !== prevWork) {
    setPrevWork(workRef)
    setContextOn(false)
  }

  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  // 펼치면 바로 쓸 수 있게
  useEffect(() => {
    if (expanded) ta.current?.focus()
  }, [expanded])
  // 바깥을 누르면 다시 접는다 (쓰던 글이 있을 때, 머리글 단추, 모델 고르기·대화 목록 같은 떠 있는 메뉴는 제외)
  useEffect(() => {
    if (collapsed) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (!t || root.current?.contains(t) || t.closest?.("[data-radix-popper-content-wrapper], [data-dock-trigger]")) return
      if (textNow.current.trim()) return
      setExpanded(false)
      setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [collapsed])
  // 접고 나면 포커스를 머리글 단추로 돌려준다 (키보드로 닫았을 때 길을 잃지 않게)
  const collapse = useCallback((returnFocus: boolean) => {
    setExpanded(false)
    setOpen(false)
    if (returnFocus) requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-dock-trigger]")?.focus())
  }, [])

  // 고른 대화가 돌기 시작하면 결과 창을 연다
  useEffect(() => {
    if (running) setOpen(true)
  }, [running])
  const focusInput = () => requestAnimationFrame(() => ta.current?.focus())
  // 다른 화면에서 "결과 보기"(detail.thread 면 그 대화) · 팔레트에서 "AI에게 묻기"(detail.text 를 입력칸에)
  useEffect(() => {
    const show = (e: Event) => {
      const thread = (e as CustomEvent<{ thread?: unknown } | null>).detail?.thread
      if (typeof thread === "string" && thread) select(thread)
      setExpanded(true)
      setOpen(true)
    }
    const ask = (e: Event) => {
      const t = (e as CustomEvent<{ text?: unknown } | null>).detail?.text
      if (typeof t !== "string" || !t.trim()) return
      // ⌘K 의 "AI에게 묻기"는 늘 새 대화로
      select(null)
      setText(t)
      setExpanded(true)
      setOpen(true)
      focusInput()
    }
    window.addEventListener("dock:open", show)
    window.addEventListener("dock:ask", ask)
    const toggle = () => {
      if (collapsedNow.current) setExpanded(true)
      else collapse(false)
    }
    window.addEventListener("dock:toggle", toggle)
    return () => {
      window.removeEventListener("dock:open", show)
      window.removeEventListener("dock:ask", ask)
      window.removeEventListener("dock:toggle", toggle)
    }
  }, [select, collapse])
  // 결과 창을 열어 끝난 답을 봤으면 그 대화의 확인 기다림을 확인함으로 (닫힌 채 자동 선택만 된 경우는 보내지 않는다)
  const seenFor = useRef<string | null>(null)
  useEffect(() => {
    if (!open || !last || last.status !== "done" || seenFor.current === last.id) return
    seenFor.current = last.id
    api("/api/runs/" + (last.thread || last.id) + "/seen", { method: "POST" }).catch(() => null)
  }, [open, last?.id, last?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const outLen = runs.reduce((n, r) => n + r.output.length + (r.steps?.length || 0), runs.length)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [outLen, open])
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 180) + "px"
  }, [text])
  // "/" 로 바로 쓰기
  useShortcut("dock.focus", () => {
    setExpanded(true)
    ta.current?.focus()
  })

  /** 요청이 끝났을 때 그 사이 사용자가 다른 대화를 골랐으면 선택을 바꾸지 않고 목록에서 찾게 한다 */
  const settle = async (gen: number, row: Run) => {
    const tid = row.thread || row.id
    if (gen !== selGen.current) {
      await loadList()
      toast("보냈어요", { description: "대화 목록에서 확인할 수 있어요" })
      return false
    }
    if (tid === selectedId) await loadThread(tid, true)
    else setSelectedId(tid)
    setOpen(true)
    loadList()
    return true
  }

  const send = async () => {
    const prompt = text.trim()
    if (!prompt || lock.current || running || blocked || (!selectedId && !choice)) return
    lock.current = true
    setBusy(true)
    const gen = selGen.current
    const sentText = text
    try {
      // 지금 보고 있는 화면을 같이 보낸다. 내용은 서버가 이 id 들로 다시 읽어서 AI에게 붙인다
      const page = { view, ...(boardId ? { board: boardId } : {}), ...(workRef ? { work: workRef } : {}) }
      const body = canContinue && last
        ? { prompt, page, target: last.target, parent: last.id, provider: last.provider, model: last.model, effort: last.effort }
        : { prompt, page, target: contextOn ? workRef : null, provider: choice!.provider, model: choice!.model, effort: choice!.effort }
      const r = await api<Run>("/api/runs", { method: "POST", body: JSON.stringify(body) })
      if (gen === selGen.current) setText((cur) => (cur === sentText ? "" : cur))
      if (await settle(gen, r)) setContextOn(false)
    } catch {
      toast("보내지 못했어요", { description: "잠시 뒤 다시 시도해 주세요" })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const retry = async (run: Run) => {
    if (lock.current || running) return
    lock.current = true
    setBusy(true)
    const gen = selGen.current
    try {
      let row: Run | null = null
      try {
        row = await api<Run>("/api/runs/" + run.id + "/retry", { method: "POST" })
      } catch (e) {
        const dup = e instanceof ApiError && e.status === 409 ? (e.body as { run?: Run } | null)?.run : null
        if (!dup) throw e
        row = dup
      }
      if (row) await settle(gen, row)
    } catch {
      toast("다시 시도하지 못했어요", { description: "잠시 뒤 다시 시도해 주세요" })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const stop = async () => {
    const r = [...runs].reverse().find((x) => x.status === "running")
    if (r) await api("/api/runs/" + r.id + "/stop", { method: "POST" }).catch(() => null)
    if (selectedId) loadThread(selectedId, true)
  }
  const fresh = () => {
    select(null)
    setContextOn(false)
    setOpen(false)
    setListOpen(false)
    setExpanded(true)
    focusInput()
  }

  const title = runs[0]?.prompt.split("\n")[0] || "AI에게 맡긴 일"
  const showPanel = open && !!selectedId && threadState !== "idle"
  const list = (
    <Popover open={listOpen} onOpenChange={(o) => { setListOpen(o); if (o) loadList() }}>
      <PopoverTrigger asChild>
        <button type="button" className="relative grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="대화 목록" title="대화 목록">
          <History className="size-4" />
          {running && !open && <span className="absolute top-1.5 right-1.5 size-1.5 animate-pulse rounded-full bg-running" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">최근 대화 40개</span>
          <button type="button" onClick={fresh} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-muted"><Plus className="size-3.5" /> 새 대화</button>
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {listState === "loading" && !threads.length ? (
            <p className="flex items-center gap-2 px-3 py-6 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> 대화를 불러오는 중이에요</p>
          ) : listState === "error" && !threads.length ? (
            <div className="flex flex-col items-start gap-2 px-3 py-4 text-xs text-muted-foreground">
              대화를 불러오지 못했어요
              <button type="button" onClick={() => loadList()} className="rounded-md border px-2 py-1 font-medium text-foreground hover:bg-muted">다시 시도</button>
            </div>
          ) : !threads.length ? (
            <p className="px-3 py-6 text-xs text-muted-foreground">아직 대화가 없어요</p>
          ) : (
            <ul className="flex flex-col">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    aria-current={t.id === selectedId ? "true" : undefined}
                    onClick={() => { select(t.id); setListOpen(false); setOpen(true); setExpanded(true) }}
                    className={cn("flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-muted", t.id === selectedId && "bg-muted")}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm">{t.first || "제목 없는 대화"}</span>
                      {t.target && <span className="shrink-0 rounded-full border px-1.5 text-2xs text-muted-foreground">일과 연결</span>}
                    </span>
                    <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                      {t.last_status === "running" && <span className="size-1.5 animate-pulse rounded-full bg-running" />}
                      {t.model_name ? t.model_name + " · " : ""}{STATUS_KO[t.last_status]} · <span className="num">{ago(t.last_at)}</span> · <span className="num">{t.count}</span>턴
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )

  if (collapsed) return null
  return (
    <div
      ref={root}
      id="command-dock"
      role="region"
      aria-label="AI 명령창"
      // Esc 는 명령창 안 어디서나(입력칸·결과·단추) 닫고 머리글 단추로 돌아가요. 떠 있는 메뉴(모델·대화 목록)가 먼저 받은 Esc 와 포털 안 키는 제외
      onKeyDown={(e) => {
        if (!matches(e, "dock.collapse") || e.defaultPrevented || !root.current?.contains(e.target as Node)) return
        e.preventDefault()
        collapse(true)
      }}
      className="pointer-events-none fixed right-4 bottom-4 sm:right-5 sm:bottom-5 z-40 flex w-[min(460px,calc(100vw-2rem))] sm:w-[min(460px,calc(100vw-2.5rem))] flex-col items-stretch gap-2"
    >
      {showPanel && (
        <div className="pointer-events-auto flex max-h-[min(560px,50dvh)] sm:max-h-[min(560px,62vh)] flex-col overflow-hidden rounded-2xl border bg-background shadow-xl animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2 border-b px-4 py-2.5 text-xs font-medium text-muted-foreground">
            <AiMark className="size-3.5 shrink-0 text-ai" />
            <span className="min-w-0 flex-1 truncate">{title}</span>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-muted hover:text-foreground" aria-label="결과 접기"><ChevronDown className="size-4" /></button>
          </div>
          <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
            {threadState === "loading" && !runs.length ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> 대화를 불러오는 중이에요</p>
            ) : threadState === "missing" ? (
              <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
                대화를 찾을 수 없어요
                <button type="button" onClick={fresh} className="rounded-md border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted">새 대화</button>
              </div>
            ) : (
              <>
                {threadState === "error" && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                    <span className="flex-1">{runs.length ? "연결이 끊겼어요. 다시 시도해 주세요" : "대화를 열지 못했어요"}</span>
                    <button type="button" onClick={() => selectedId && loadThread(selectedId)} className="rounded-md border bg-background px-2 py-1 font-medium text-foreground hover:bg-muted">다시 시도</button>
                  </div>
                )}
                {truncated && <p className="text-center text-2xs text-muted-foreground">앞의 오래된 대화는 생략했어요</p>}
                {runs.map((r) => (
                  <div key={r.id} className="flex flex-col gap-2">
                    <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{r.prompt}</div>
                    <RunView run={r} now={now} compact onRetry={retry} retrying={busy || running} />
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      <div className="pointer-events-auto rounded-[22px] border bg-background shadow-lg transition-shadow focus-within:shadow-xl focus-within:ring-2 focus-within:ring-ring">
        <div className="flex items-end gap-1.5 py-1.5 pr-1.5 pl-3.5">
          <AiMark className="mb-2.5 size-4 shrink-0 text-ai" />
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
            aria-label="AI에게 보낼 내용"
            placeholder={canContinue ? "이어서 맡기기" : placeholder}
            className="block min-w-0 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          {list}
          {selectedId && !open && threadState !== "idle" && (
            <button type="button" onClick={() => setOpen(true)} className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="결과 열기" title="결과 열기">
              <ChevronDown className="size-4 rotate-180" />
            </button>
          )}
          {running ? (
            <button type="button" onClick={stop} className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-background" aria-label="멈추기"><Square className="size-3 fill-current" /></button>
          ) : (
            <button type="button" onClick={send} disabled={!text.trim() || busy || blocked || (!selectedId && !choice)} className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-background disabled:opacity-30" aria-label="보내기">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </button>
          )}
        </div>
        {active && (
          <div className="flex min-w-0 flex-wrap items-center gap-1 border-t px-2 py-1.5">
            {selectedId ? (
              <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <span className="min-w-0 truncate rounded-full bg-muted px-2.5 py-1 whitespace-nowrap">
                  {canContinue ? "같은 세션 이어서 · " + (last?.model_name || last?.model) : threadState === "loading" ? "대화를 불러오는 중이에요" : threadState === "ready" && !running ? "이 대화는 이어갈 수 없어요. 새 대화를 시작해 주세요" : running ? "답을 기다리는 중이에요" : threadState === "missing" ? "대화를 찾을 수 없어요" : "대화를 열지 못했어요"}
                </span>
                <button type="button" className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 whitespace-nowrap hover:bg-muted hover:text-foreground" onClick={fresh}>
                  <RotateCcw className="size-3" /> 새 대화
                </button>
                <span className="ml-auto shrink-0 px-1 text-2xs" title="보낼 때 지금 화면에 보이는 것을 AI에게 같이 알려줘요">AI가 보는 화면: {pageLabel}</span>
              </div>
            ) : (
              <>
                <ModelPicker cat={cat} choice={choice} onChange={setChoice} />
                <EffortPicker cat={cat} choice={choice} onChange={setChoice} />
                {workRef && (
                  <button
                    type="button"
                    aria-pressed={contextOn}
                    onClick={() => setContextOn((v) => !v)}
                    className={cn("flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap", contextOn ? "border-ai/40 bg-ai/10 text-foreground" : "text-muted-foreground hover:bg-muted")}
                  >
                    <AiMark className={cn("size-3", contextOn ? "text-ai" : "")} /> 현재 일 함께 보내기
                  </button>
                )}
                <span className="ml-auto shrink-0 px-1 text-2xs text-muted-foreground" title="보낼 때 지금 화면에 보이는 것을 AI에게 같이 알려줘요">AI가 보는 화면: {pageLabel}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
