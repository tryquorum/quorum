import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ArrowLeft, ArrowLeftRight, ArrowRight, Bot, Check, CircleCheck, CircleDot, ExternalLink, FileText, Link2, Loader2, Lock, Maximize2, MessageSquare, PanelRight, Plus, X,
} from "lucide-react"
import { AiMark } from "@/components/ai-mark"
import { DocLinks } from "@/components/doc-links"
import { GoalOverview } from "@/components/goal-view"
import { ArchivedWorkView } from "@/components/archived-work-view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { NoteHandle } from "@/components/note-editor"
import { ChatPane, useThreads } from "@/components/chat-pane"
import { LoadErrorBoundary } from "@/components/load-error-boundary"
import { NotePreview } from "@/components/note-preview"
import { useWork, type Brief, type Work } from "@/hooks/use-work"

const NoteEditor = lazy(() => import("@/components/note-editor").then((m) => ({ default: m.NoteEditor })))
import { cn } from "@/lib/utils"
import { ItemSpaceSelect } from "@/components/space-select"
import { ago, api, ApiError, isoLocal, srcName, W, type Board, type Item, type Run } from "@/lib/api"
import { noteVersion } from "@/lib/note-save"

export const LANE_KO: Record<string, string> = { now: "지금 봐야 함", decide: "결정 대기", review: "확인 필요", running: "하는 중", auto: "AI가 처리함", main: "메인 일 후보", info: "기록" }
const LINK_LABELS = ["막힘", "위해서", "관련", "다음에", "같은 건"]
const DRAFT_PROMPT = "이 일의 요약 노트 초안을 써줘. 노트에 들어갈 마크다운만 출력하고 앞뒤 설명은 쓰지 마. 형식: ## 상황 (2~3줄) / ## 결정할 것 / ## 다음 할 일 (- [ ] 체크리스트). 모르는 건 지어내지 말고 '확인 필요'라고 적어."
const savedModel = () => {
  const c = JSON.parse(localStorage.getItem("db:model") || "null")
  return c ? { provider: c.provider, model: c.model, effort: c.effort } : {}
}

function Retry({ onRetry }: { onRetry: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false)
  return <Button variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await onRetry() } finally { setBusy(false) } }}>{busy ? "다시 불러오는 중…" : "다시 시도"}</Button>
}

/** 처음 여는 일(캐시 없음)의 자리. 스켈레톤은 250ms 넘게 걸릴 때만 보여요(delayed-show) */
function WorkLoading({ dialog }: { dialog: boolean }) {
  return <div className="p-8" aria-busy="true">{dialog && <DialogTitle className="sr-only">일을 불러오는 중</DialogTitle>}<h1 tabIndex={-1} data-page-title="loading" className="delayed-show mb-5 h-6 w-1/2 animate-pulse rounded bg-muted outline-none"><span className="sr-only">일을 불러오는 중이에요</span></h1><div className="delayed-show grid gap-3 md:grid-cols-3">{[0, 1, 2].map((n) => <div key={n} className="h-32 animate-pulse rounded bg-muted" />)}</div></div>
}

function WorkUnavailable({ dialog, message, onClose, onRetry }: { dialog: boolean; message: string; onClose: () => void; onRetry?: () => Promise<unknown> }) {
  return <div className="grid h-full place-items-center p-10"><div role="alert" className="flex flex-col items-center gap-3 text-sm text-muted-foreground">{dialog && <DialogTitle className="sr-only">{message}</DialogTitle>}<h1 tabIndex={-1} data-page-title className="outline-none">{message}</h1><div className="flex gap-2"><Button variant="outline" size="sm" onClick={onClose}>{dialog ? "닫기" : "뒤로"}</Button>{onRetry && <Retry onRetry={onRetry} />}</div></div></div>
}

function StatusDot({ b }: { b: Brief }) {
  if (b.status === "resolved") return <CircleCheck className="size-3.5 shrink-0 text-muted-foreground" />
  const c = b.lane === "now" ? "text-destructive" : b.lane === "running" ? "text-running" : b.lane === "decide" ? "text-warn-foreground" : "text-muted-foreground"
  return <CircleDot className={cn("size-3.5 shrink-0", c)} />
}

function WorkRow({ b, onOpen, right, sub }: { b: Brief; onOpen: (ref: string) => void; right?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="group/wr flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
      <span className="pt-0.5"><StatusDot b={b} /></span>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(b.ref)}>
        <div className={cn("truncate text-sm", b.status === "resolved" && "text-muted-foreground line-through")}>{b.title}</div>
        {(sub || b.when || b.due) && <div className="flex items-center gap-1.5 truncate text-2xs text-muted-foreground">{sub}{(b.when || b.due) && <span className="num">{W.short(b.when || isoLocal(b.due ?? 0))}</span>}</div>}
        <span className="sr-only">{srcName(b.source)}{b.lane ? ` · ${LANE_KO[b.lane] || b.lane}` : ""}</span>
      </button>
      {right}
    </div>
  )
}

function AddLink({ self, onDone }: { self: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [label, setLabel] = useState("관련")
  const [res, setRes] = useState<Brief[]>([])
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      api<{ results: Brief[] }>(`/api/work/search?q=${encodeURIComponent(q)}&exclude=${encodeURIComponent(self)}`).then((r) => setRes(r.results)).catch(() => null)
    }, 120)
    return () => clearTimeout(t)
  }, [q, open, self])
  const add = async (b: Brief) => {
    try {
      await api("/api/work/links", { method: "POST", body: JSON.stringify({ a: self, b: b.ref, label }) })
      toast("연결했어요", { description: `${label} · ${b.title}` })
      setOpen(false)
      setQ("")
      onDone()
    } catch (e) {
      toast(String((e as Error).message).includes("409") ? "이미 연결돼 있어요" : "연결하지 못했어요")
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="일 연결하기"><Plus /></Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex flex-wrap gap-1 border-b p-2">
          {LINK_LABELS.map((l) => (
            <button key={l} type="button" onClick={() => setLabel(l)} className={cn("rounded-full px-2 py-0.5 text-xs", label === l ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="연결할 일 찾기" />
          <CommandList>
            <CommandEmpty>맞는 일이 없어요</CommandEmpty>
            <CommandGroup>
              {res.map((b) => (
                <CommandItem key={b.ref} value={b.ref} onSelect={() => add(b)}>
                  <StatusDot b={b} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{b.title}</div>
                    <div className="truncate text-2xs text-muted-foreground">{srcName(b.source)}{b.area ? ` · ${b.area}` : ""}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export type Pane = string // "note" | "chats" | "links" | "c:new" | "c:<threadId>"

/** 일 상세 본문. 팝업과 전체 페이지가 같이 쓴다 */
export function WorkView({
  workRef, mode, onOpen, onOpenDocument, onClose, onExpand, onChanged, patchSignal, setItemDone, items, boards, save, pane: paneProp, onPane, initialPane,
}: {
  workRef: string
  mode: "dialog" | "page"
  onOpen: (ref: string) => void
  onOpenDocument?: (ref: string) => void
  onClose: () => void
  onExpand?: (pane: Pane) => void
  onChanged?: () => void
  patchSignal: (id: string, body: Record<string, unknown>) => Promise<void>
  /** 보드 할 일(item:)을 끝냄/다시 열기. 찾았으면 true */
  setItemDone?: (ref: string, done: boolean) => Promise<boolean | "failed">
  items?: Item[]
  boards?: Board[]
  save?: (it: Item) => Promise<boolean> | void
  pane?: Pane
  onPane?: (p: Pane, replace?: boolean) => void
  initialPane?: Pane
}) {
  const { w, status, fresh, load } = useWork(workRef)
  const { threads, runs: allRuns, load: loadThreads, status: threadsStatus, hasData, mergeRuns } = useThreads(workRef)
  const draft = allRuns.find((r) => r.kind === "draft" && !r.applied) || null
  const [localPane, setLocalPane] = useState<Pane>(initialPane || "note")
  const pane = paneProp ?? localPane
  const setPane = (p: Pane, replace?: boolean) => (onPane ? onPane(p, replace) : setLocalPane(p))
  const [side, setSide] = useState(true)
  const noteRef = useRef<NoteHandle>(null)
  const [, setDraftRevision] = useState(0)
  const [editorReady, setEditorReady] = useState(false)
  const onEditorReady = useCallback(() => setEditorReady(true), [])
  const [closingDraft, setClosingDraft] = useState(false)
  const s = w?.signal
  const refresh = () => {
    load()
    onChanged?.()
  }
  // 확인 기다림인 사건을 열어 봤으면 확인한 걸로 ("AI가 처리한 것"으로 옮긴다). 캐시로 그린 옛 상태로는 하지 않고 최신 응답(fresh)만 봐요
  useEffect(() => {
    if (fresh && s && s.lane === "review" && s.status === "open") patchSignal(s.id, { status: "resolved", lane: "auto", reason: "확인함" }).then(() => onChanged?.())
  }, [fresh, s?.id, s?.lane, s?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  // 새 대화가 생기면 기록·연결이 바뀌니 일을 다시 받아요. 처음 대화 목록이 도착한 것은 바뀐 게 아니라 건너뛰어요(같은 내용을 두 번 받아 다시 그리지 않게)
  const seenThreads = useRef<number | null>(null)
  useEffect(() => {
    if (!hasData) return
    if (seenThreads.current !== null && seenThreads.current !== threads.length) void load()
    seenThreads.current = threads.length
  }, [threads.length, hasData, load])
  const resolve = async () => {
    if (!s) return
    await patchSignal(s.id, { status: s.status === "resolved" ? "open" : "resolved" })
    toast(s.status === "resolved" ? "다시 열었어요" : "처리했어요")
    refresh()
  }
  // AI가 처리한 걸로 닫기: "AI가 알아서 처리한 것" 칸으로 간다
  const aiDone = async () => {
    if (!s) return
    const prev = { status: s.status, lane: s.lane, reason: s.reason }
    await patchSignal(s.id, { status: "resolved", lane: "auto", reason: "AI가 처리함" })
    toast("AI가 처리한 걸로 닫았어요", { action: { label: "되돌리기", onClick: () => patchSignal(s.id, prev).then(refresh) } })
    refresh()
  }
  // 보드 할 일·미리알림·목표: 끝냄 / 다시 열기
  const toggleItem = async () => {
    if (!w || !setItemDone) return
    const next = w.self.status !== "resolved"
    const r = await setItemDone(workRef, next)
    if (r === "failed") return
    if (!r) return toast("이 일을 보드에서 찾지 못했어요")
    toast(next ? "끝냈어요" : "다시 열었어요", next ? { action: { label: "되돌리기", onClick: () => { void setItemDone(workRef, false).then((result) => { if (result === true) refresh(); else if (result === false) toast("이 일을 보드에서 찾지 못했어요") }) } } } : undefined)
    refresh()
  }
  const mute = async () => {
    if (!s) return
    await patchSignal(s.id, { feedback: "mute" })
    toast("규칙을 만들었어요", { description: `${srcName(s.source)}의 이런 소식은 앞으로 안 보내요` })
    refresh()
  }
  const toNote = (md: string, heading: string) => {
    if (!noteRef.current) { toast("노트를 불러오는 중이에요. 잠시 뒤 다시 넣어 주세요"); return }
    if (!noteRef.current?.appendMarkdown(md, heading)) return
    toast("노트에 넣었어요", { action: { label: "노트 보기", onClick: () => setPane("note") } })
  }
  // 노트에서 고른 부분 → AI에게 묻기: 노트 위 입력칸에서 질문을 받아 바로 보내고, 보낸 뒤에야 그 대화로 옮긴다
  const [quote, setQuote] = useState<string | null>(null)
  const asking = useRef(false)
  const askAbout = async (sel: string, q: string) => {
    if (asking.current) return
    asking.current = true
    const prompt = `${q || "이 부분을 설명해줘"}\n\n노트에서 고른 부분:\n${sel.split("\n").map((l) => `> ${l}`).join("\n")}`
    try {
      const r = await api<Run>("/api/runs", { method: "POST", body: JSON.stringify({ prompt, target: workRef, ...savedModel() }) })
      await loadThreads()
      setPane(`c:${r.thread || r.id}`)
    } catch (e) {
      toast("보내지 못했어요", { description: String((e as Error).message) })
    } finally {
      asking.current = false
    }
  }
  // 노트에서 고른 부분 → 새 일: 만들고, 이 일과 잇고, 새 일의 노트 초안을 AI에게 맡긴다 (새 일을 열면 초안이 들어가 있다)
  const makeWork = async (sel: string, noteText: string) => {
    const parentTitle = s?.title || w?.self.title || ""
    const title = sel.split("\n")[0].replace(/\s+/g, " ").trim().slice(0, 200)
    try {
      const sig = await api<{ id: string }>("/api/signals", {
        method: "POST",
        body: JSON.stringify({
          source: "note", kind: "info", lane: "main", title,
          reason: `「${parentTitle.slice(0, 60)}」 노트에서 만든 일`,
          body: sel.length > title.length ? sel.slice(0, 4000) : null,
        }),
      })
      const ref = `signal:${sig.id}`
      await api("/api/work/links", { method: "POST", body: JSON.stringify({ a: ref, b: workRef, label: "관련" }) }).catch(() => null)
      api("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          target: ref,
          kind: "draft",
          prompt: `이 일은 「${parentTitle}」에서 나온 일이야. 그 일의 노트:\n${noteText.slice(0, 3000)}\n\n${DRAFT_PROMPT}`,
          ...savedModel(),
        }),
      }).catch(() => null)
      refresh()
      toast("새 일로 만들었어요", { description: `${title} · AI가 노트 초안을 쓰는 중`, action: { label: "열기", onClick: () => onOpen(ref) } })
    } catch (e) {
      toast("새 일을 만들지 못했어요", { description: String((e as Error).message) })
    }
  }
  // AI 초안: 대화 목록에 안 남기고, 노트 위 스피너 → 끝나면 노트에 바로 렌더링
  const draftNote = async () => {
    if (draft) return
    setPane("note")
    try {
      await api("/api/runs", {
        method: "POST",
        body: JSON.stringify({ target: workRef, kind: "draft", prompt: DRAFT_PROMPT, ...savedModel() }),
      })
      await loadThreads()
    } catch (e) {
      toast("초안을 시작하지 못했어요", { description: String((e as Error).message) })
    }
  }



  const chatId = pane.startsWith("c:") ? pane.slice(2) : null
  const thread = chatId && chatId !== "new" ? threads.find((t) => t.id === chatId) || null : null
  const [lookup, setLookup] = useState<{ key: string; state: "loading" | "missing" | "other" | "error" | "ok" }>({ key: "", state: "loading" })
  const lookupKey = `${workRef}\0${chatId || ""}`
  const lookupCurrent = useRef(lookupKey)
  lookupCurrent.current = lookupKey
  const [lookupAttempt, setLookupAttempt] = useState(0)
  useEffect(() => {
    if (!chatId || chatId === "new" || thread) return
    let alive = true
    setLookup({ key: lookupKey, state: "loading" })
    api<{ runs: Run[] }>(`/api/runs?thread=${encodeURIComponent(chatId)}`, { signal: AbortSignal.timeout(15000) }).then(({ runs }) => {
      if (!alive || lookupCurrent.current !== lookupKey) return
      if (runs.some((r) => r.target !== workRef)) setLookup({ key: lookupKey, state: "other" })
      else if (!runs.length) setLookup({ key: lookupKey, state: "error" })
      else { mergeRuns(chatId, runs); setLookup({ key: lookupKey, state: "ok" }) }
    }).catch((e) => { if (alive && lookupCurrent.current === lookupKey) setLookup({ key: lookupKey, state: e instanceof ApiError && e.status === 404 ? "missing" : "error" }) })
    return () => { alive = false }
  }, [chatId, lookupKey, workRef, !!thread, mergeRuns, lookupAttempt]) // eslint-disable-line react-hooks/exhaustive-deps

  const page = mode === "page"
  if (!w && status === "loading") return <WorkLoading dialog={!page} />
  if (!w && status === "missing") return <ArchivedWorkView key={workRef} workRef={workRef} mode={mode} onClose={onClose} onOpen={onOpenDocument || onOpen} />
  if (!w) return <WorkUnavailable dialog={!page} message="일을 불러오지 못했어요" onClose={onClose} onRetry={status === "error" ? load : undefined} />

  const title = s?.title || w.self.title
  const center: "note" | "chat" | "chats" | "links" = chatId ? "chat" : pane === "chats" ? "chats" : pane === "links" ? "links" : "note"

  const navBtn = (on: boolean) => cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on && "bg-muted font-medium")
  // 함수로 그려요. 컴포넌트로 두면 매 렌더(실행 중 1초 폴링)마다 새 타입이 되어 목록이 다시 마운트되고 깜빡이며 스크롤이 처음으로 돌아가요
  const threadList = (big?: boolean) => (
    <div className="flex flex-col gap-0.5">
      {!hasData && threadsStatus === "loading" && <div aria-busy="true" className="delayed-show space-y-2 p-2"><span className="sr-only">대화를 불러오는 중이에요</span><div className="h-3 w-full animate-pulse rounded bg-muted" /><div className="h-3 w-3/4 animate-pulse rounded bg-muted" /></div>}
      {threadsStatus === "error" && <div role={big ? undefined : "alert"} className="flex flex-wrap items-center gap-2 px-2 py-1 text-xs text-muted-foreground"><span>{hasData ? "마지막으로 불러온 대화예요" : "대화를 불러오지 못했어요"}</span><Retry onRetry={loadThreads} /></div>}
      {hasData && threadsStatus === "ok" && threads.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">아직 대화가 없어요</p>}
      {threads.map((t) => (
        <button key={t.id} type="button" title={`${t.model} · ${t.runs.length}번`} aria-current={chatId === t.id ? "page" : undefined} onClick={() => setPane(`c:${t.id}`)} className={cn(navBtn(chatId === t.id), "items-start", big && "py-2.5")}>
          <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", t.running ? "animate-pulse bg-running" : t.status === "error" ? "bg-destructive" : "bg-muted-foreground/40")} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{t.title}</span>
            <span className="block truncate num text-2xs font-normal text-muted-foreground">{ago(t.updated)}</span>
          </span>
        </button>
      ))}
    </div>
  )

  return (
    <div className={cn("flex min-h-0 flex-col", page ? "h-[calc(100svh-3rem)]" : "h-full")}>
      {/* 머리 */}
      <div className={cn("flex items-start gap-3 border-b px-5 py-3.5", page && "md:px-6")}>
        {page && <Button variant="ghost" size="icon-sm" className="-ml-2 shrink-0" onClick={onClose} aria-label="뒤로"><ArrowLeft /></Button>}
        <div className="min-w-0 flex-1">
          <DialogTitleMaybe dialog={!page} className={cn("leading-snug font-semibold tracking-tight", page ? "text-xl" : "text-lg")}>{title}</DialogTitleMaybe>
          {s?.reason && <DialogDescMaybe dialog={!page} className="mt-0.5 text-sm text-muted-foreground">{s.reason}</DialogDescMaybe>}
          {s && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-muted-foreground">
              <Badge variant="secondary">{srcName(s.source)}</Badge>
              <Badge variant="outline">{s.status === "resolved" ? <><CircleCheck />처리됨</> : LANE_KO[s.lane] || s.lane}</Badge>
              {s.private && <Lock className="size-3.5" role="img" aria-label="개인" />}
              {s.needs_ai && <AiMark className="size-3.5 text-ai" role="img" aria-hidden={false} aria-label="AI 판단 대기" />}
              {s.sample && <span className="text-xs">샘플</span>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex items-center gap-1" inert={!fresh}>
          {s && s.status !== "resolved" && <Button size="sm" variant="outline" onClick={aiDone} title="AI가 처리한 걸로 닫아요"><Bot />AI가 처리함</Button>}
          {s && <Button size="sm" variant={s.status === "resolved" ? "outline" : "default"} onClick={resolve}>{s.status === "resolved" ? "다시 열기" : "처리함"}</Button>}
          {!s && <ItemSpaceSelect workRef={workRef} items={items} save={save} />}
          {!s && workRef.startsWith("item:") && setItemDone && (
            <Button size="sm" variant={w.self.status === "resolved" ? "outline" : "default"} onClick={toggleItem}>{w.self.status === "resolved" ? "다시 열기" : <><Check />끝냄</>}</Button>
          )}
          </div>
          <Button variant="ghost" size="icon-sm" className="hidden md:inline-flex" onClick={() => setSide((v) => !v)} aria-label="연결 패널" title="연결 패널"><PanelRight /></Button>
          {!page && onExpand && <Button variant="ghost" size="icon-sm" onClick={() => onExpand(pane)} aria-label="페이지로 열기" title="페이지로 열기"><Maximize2 /></Button>}
          {!page && <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="닫기"><X /></Button>}
        </div>
      </div>

      {(status === "error" || status === "missing") && <div role="alert" className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-5 py-2 text-sm text-muted-foreground"><span>{status === "error" ? "최신 내용을 불러오지 못했어요 · 마지막으로 불러온 내용을 보여줘요" : "이 일을 찾을 수 없어요. 지워졌거나 옮겨졌을 수 있어요"}</span>{status === "error" ? <Retry onRetry={load} /> : <Button variant="outline" size="sm" onClick={onClose}>{page ? "뒤로" : "닫기"}</Button>}</div>}
      {/* 모바일: 위쪽 탭 */}
      <div className="flex items-center gap-1 border-b px-3 md:hidden">
        {([["note", "노트"], ["chats", `대화${threads.length ? ` ${threads.length}` : ""}`], ["links", `연결${w.links.length ? ` ${w.links.length}` : ""}`]] as const).map(([k, l]) => (
          <button key={k} type="button" aria-current={center === k || (k === "chats" && center === "chat") ? "page" : undefined} onClick={() => setPane(k)} className="flex min-h-11 items-center text-sm"><span className={cn("rounded-full px-3 py-1", (center === k || (k === "chats" && center === "chat")) ? "bg-foreground text-background" : "text-muted-foreground")}>{l}</span></button>
        ))}
      </div>

      {/* 캐시로 그린 동안(fresh 전)은 보이기만 해요. inert 라 누르기·포커스·쓰기가 한꺼번에 막혀요 */}
      <div inert={!fresh} aria-busy={!fresh || undefined} className={cn("grid min-h-0 flex-1 grid-cols-1", side ? "md:grid-cols-[232px_minmax(0,1fr)_280px]" : "md:grid-cols-[232px_minmax(0,1fr)]")}>
        {/* 왼쪽: 노트 + AI랑 풀기 */}
        <nav aria-label="일 패널" className="scroll-pane hidden min-h-0 flex-col gap-4 overflow-y-auto border-r bg-muted/30 p-2 md:flex">
          <button type="button" aria-current={center === "note" ? "page" : undefined} onClick={() => setPane("note")} className={navBtn(center === "note")}><FileText className="size-4 text-muted-foreground" />요약 노트</button>
          <div>
            <div className="flex items-center px-2 pb-1">
              <span className="flex flex-1 items-center gap-1.5 text-xs font-medium text-muted-foreground"><MessageSquare className="size-3.5" />AI랑 풀기</span>
              <Button variant="ghost" size="icon-xs" onClick={() => setPane("c:new")} aria-label="새 대화" title="새 대화"><Plus /></Button>
            </div>
            {threadList()}
          </div>
        </nav>

        {/* 가운데 */}
        <div className="relative min-h-0 overflow-hidden">
          <div className={cn("scroll-pane h-full overflow-y-auto pb-(--tray-space)", center !== "note" && "hidden")}>
            <div className="mx-auto w-full max-w-[720px] px-6 py-6 md:px-10">
              {w.self.type === "goal" && items && save && (
                <GoalOverview workRef={workRef} items={items} boards={boards ?? []} save={save} patchSignal={patchSignal} onOpen={onOpen} onSubtaskAdded={refresh} linkedRefs={w.links.map((l) => l.other.ref)} />
              )}
              {w.self.type === "goal" && <h2 className="mb-2 text-xs font-semibold text-muted-foreground">왜 · 노트</h2>}
              {s?.body && <p className="mb-4 rounded-lg bg-muted/50 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{s.body}</p>}
              <div className="mb-6 flex flex-wrap items-center gap-2">
                {s?.url && <Button variant="outline" size="sm" asChild><a href={s.url} target="_blank" rel="noopener"><ExternalLink />원본 열기</a></Button>}
                <Button variant="outline" size="sm" onClick={draftNote} disabled={!!draft}>{draft ? <Loader2 className="animate-spin" /> : <AiMark />}AI로 초안 쓰기</Button>
                <Button variant="ghost" size="sm" onClick={() => setPane("c:new")}><MessageSquare />새 대화</Button>
                {s && s.status === "open" && <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={mute}>이런 소식은 안 와도 돼</Button>}
              </div>
              {draft && (draft.status === "error" || draft.status === "stopped" || (draft.status === "done" && !draft.output?.trim())) && <div role="alert" className="mb-4 rounded-md border p-3 text-sm"><p>AI 초안을 만들지 못했어요{draft.status === 'done' ? ' · 결과가 비어 있어요' : draft.error ? ` · ${draft.error}` : ''}</p><Button className="mt-2" size="sm" variant="outline" disabled={closingDraft} onClick={async () => { setClosingDraft(true); try { await api(`/api/runs/${encodeURIComponent(draft.id)}`, {method:"PATCH", body:JSON.stringify({applied:true})}); await loadThreads() } catch {toast("초안 상태를 닫지 못했어요")} finally {setClosingDraft(false)} }}>확인 후 다시 시도</Button></div>}
              {draft?.status === "done" && !!draft.output?.trim() && <details className="mb-4 rounded-md border p-3 text-sm"><summary>AI 초안 보기</summary><pre className="mt-2 whitespace-pre-wrap break-words">{draft.output}</pre><Button className="mt-3" size="sm" variant="outline" disabled={!editorReady || !!noteRef.current?.hasDraftRun(draft.id)} onClick={() => { if (noteRef.current?.fillMarkdown(draft.output, draft.id)) setDraftRevision((n) => n + 1) }}>노트에 넣기</Button><p className="mt-2 text-xs text-muted-foreground">노트 저장을 확인한 뒤 초안을 적용 처리해요.</p></details>}
              {/* 편집기는 이 화면이 받은 최신 응답으로만 만들고(fresh), 만든 뒤에는 다시 받아도 그대로 둬요. 그 전과 편집기 코드를 받는 동안은 같은 모양의 읽기 전용 미리보기 */}
              {fresh ? <LoadErrorBoundary><Suspense fallback={<NotePreview html={w.note?.html || ""} />}><NoteEditor key={workRef} ref={noteRef} workRef={workRef} initialHtml={w.note?.html || ""} initialVersion={noteVersion(w.noteVersioning, w.note)} updatedAt={w.note?.updated_at || null} onSaved={load} onReady={onEditorReady} onDraftSaved={async (id) => { await api(`/api/runs/${encodeURIComponent(id)}`, {method:"PATCH", body:JSON.stringify({applied:true})}); await loadThreads() }} drafting={draft?.status === "running" ? {steps:draft.steps || []} : null} onMakeWork={makeWork} onAsk={askAbout} /></Suspense></LoadErrorBoundary> : <NotePreview html={w.note?.html || ""} />}
              {onOpenDocument && <Button variant="ghost" size="sm" onClick={() => onOpenDocument(workRef)}>문서로 열기</Button>}
              <DocLinks key={workRef} docRef={workRef} onOpen={onOpenDocument || onOpen} />
            </div>
          </div>
          {center === "chat" && chatId !== "new" && !thread ? (
            lookup.key !== lookupKey || lookup.state === "loading" || lookup.state === "ok" ? <div aria-busy="true" className="space-y-3 p-6"><span className="sr-only">대화를 확인하는 중이에요</span><div className="h-4 w-1/2 animate-pulse rounded bg-muted" /><div className="h-20 animate-pulse rounded bg-muted" /></div> :
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground"><p>{lookup.state === "missing" ? "대화를 찾을 수 없어요" : lookup.state === "other" ? "다른 일의 대화예요" : "대화를 열지 못했어요"}</p><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setPane("chats")}>대화 목록으로</Button>{lookup.state === "error" && <Button variant="outline" size="sm" onClick={() => setLookupAttempt((n) => n + 1)}>다시 시도</Button>}</div></div>
          ) : center === "chat" && (
            <ChatPane
              key={chatId!}
              target={workRef}
              thread={thread}
              reload={loadThreads}
              onCreated={(id) => setPane(`c:${id}`, true)}
              onToNote={toNote}
              onSeen={() => onChanged?.()}
              quote={chatId === "new" ? quote : null}
              onQuoteClear={() => setQuote(null)}
              contextHint="이 일의 제목·내용·노트를 알고 시작해요"
            />
          )}
          {center === "chats" && (
            <div className="h-full overflow-y-auto p-3 pb-[calc(0.75rem+var(--tray-space,0px))]">
              <Button className="mb-2 w-full" variant="outline" onClick={() => setPane("c:new")}><Plus />새 대화</Button>
              {threadList(true)}
            </div>
          )}
          {center === "links" && <div className="scroll-pane h-full overflow-y-auto pb-(--tray-space)"><Side w={w} onOpen={onOpen} refresh={refresh} /></div>}
        </div>

        {side && <aside className="scroll-pane hidden min-h-0 overflow-y-auto border-l bg-muted/30 md:block"><Side w={w} onOpen={onOpen} refresh={refresh} /></aside>}
      </div>
    </div>
  )
}

function Side({ w, onOpen, refresh }: { w: Work; onOpen: (ref: string) => void; refresh: () => void }) {
  const s = w.signal
  const [allLog, setAllLog] = useState(false)
  const unlink = async (id: string) => {
    await api(`/api/work/links/${id}`, { method: "DELETE" }).catch(() => null)
    refresh()
  }
  const grouped: [string, Brief[]][] = (() => {
    const g: Record<string, Brief[]> = {}
    for (const f of w.flow) (g[f.why] ||= []).push(f.item)
    return Object.entries(g)
  })()
  return (
    <div className="flex flex-col gap-5 px-3 py-4">
      <section>
        <div className="mb-1.5 flex items-center gap-1.5 px-2">
          <Link2 className="size-3.5 text-muted-foreground" />
          <h3 className="flex-1 text-xs font-medium text-muted-foreground">연결 {w.links.length > 0 && <span className="num">{w.links.length}</span>}</h3>
          <AddLink self={w.ref} onDone={refresh} />
        </div>
        {w.links.length === 0 && <p className="px-2 text-xs text-muted-foreground">없음</p>}
        {w.links.map((l) => (
          <WorkRow key={l.id} b={l.other} onOpen={onOpen}
            sub={<span className="flex items-center gap-0.5 font-medium text-foreground/70">{l.dir === "out" ? <ArrowRight className="size-3" /> : <ArrowLeft className="size-3" />}{l.label || "관련"} ·</span>}
            right={<Button variant="ghost" size="icon-xs" className="opacity-0 group-hover/wr:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" onClick={() => unlink(l.id)} aria-label="연결 끊기"><X /></Button>} />
        ))}
      </section>
      {grouped.length > 0 && (
        <section>
          <div className="mb-1.5 flex items-center gap-1.5 px-2"><ArrowLeftRight className="size-3.5 text-muted-foreground" /><h3 className="text-xs font-medium text-muted-foreground">같은 흐름</h3></div>
          {grouped.map(([why, list]) => (
            <div key={why} className="mb-1">
              <div className="px-2 pt-1 text-2xs text-muted-foreground/80">{why}</div>
              {list.map((b) => <WorkRow key={b.ref} b={b} onOpen={onOpen} />)}
            </div>
          ))}
        </section>
      )}
      {s && (
        <section className="px-2">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">정보</h3>
          <dl className="grid grid-cols-[64px_1fr] gap-y-1.5 text-xs">
            {s.agent && (<><dt className="text-muted-foreground">에이전트</dt><dd className="truncate">{s.agent}</dd></>)}
            {s.area && (<><dt className="text-muted-foreground">영역</dt><dd>{s.area}</dd></>)}
            {s.task && (<><dt className="text-muted-foreground">일 묶음</dt><dd className="truncate font-mono text-2xs">{s.task}</dd></>)}
            {s.due && (<><dt className="text-muted-foreground">마감</dt><dd>{W.long(isoLocal(s.due))}</dd></>)}
            <dt className="text-muted-foreground">처음</dt><dd>{new Date(s.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</dd>
          </dl>
        </section>
      )}
      {w.timeline.length > 0 && (
        <section className="px-2">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">기록</h3>
          <ol className="flex flex-col gap-2.5">
            {(allLog ? w.timeline : w.timeline.slice(0, 6)).map((t, i) => (
              <li key={i} className="relative pl-4 text-xs">
                <span className={cn("absolute top-1 left-0 size-2 rounded-full", t.kind === "resolved" ? "bg-done" : t.kind === "run" || t.kind === "answer" ? "bg-ai" : t.kind === "link" ? "bg-running" : t.kind === "note" ? "bg-warn" : "bg-muted-foreground/50")} />
                <div title={t.text}>{t.text.split(" · ")[0]}</div>
                <div className="num text-2xs text-muted-foreground">{ago(t.at)}</div>
              </li>
            ))}
          </ol>
          {w.timeline.length > 6 && <button type="button" aria-expanded={allLog} className="mt-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setAllLog((v) => !v)}>{allLog ? "접기" : <><span className="num">{w.timeline.length - 6}</span>개 더</>}</button>}
        </section>
      )}
    </div>
  )
}

/* 팝업 안에서는 접근성을 위해 DialogTitle 을 써야 한다 */
function DialogTitleMaybe({ dialog, className, children }: { dialog: boolean; className?: string; children: React.ReactNode }) {
  return dialog ? <DialogTitle className={className}>{children}</DialogTitle> : <h1 tabIndex={-1} data-page-title className={cn(className, "outline-none")}>{children}</h1>
}
function DialogDescMaybe({ dialog, className, children }: { dialog: boolean; className?: string; children: React.ReactNode }) {
  return dialog ? <DialogDescription className={className}>{children}</DialogDescription> : <p className={className}>{children}</p>
}

/** 가운데 큰 팝업 */
export function WorkDialog({
  workRef, onOpenRef, onOpenDocument, onClose, onExpand, onChanged, patchSignal, setItemDone, items, boards, save, initialPane, onReturnFocus,
}: {
  workRef: string | null
  initialPane?: Pane
  onOpenRef: (ref: string) => void
  onOpenDocument?: (ref: string) => void
  onReturnFocus: () => void
  onClose: () => void
  onExpand: (ref: string, pane: Pane) => void
  onChanged?: () => void
  patchSignal: (id: string, body: Record<string, unknown>) => Promise<void>
  setItemDone?: (ref: string, done: boolean) => Promise<boolean | "failed">
  items?: Item[]
  boards?: Board[]
  save?: (it: Item) => Promise<boolean> | void
}) {
  return (
    <Dialog open={!!workRef} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus() }} className="flex h-[min(820px,90vh)] w-[min(1200px,95vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        {workRef && (
          <WorkView key={workRef} workRef={workRef} mode="dialog" initialPane={initialPane} onOpen={onOpenRef} onOpenDocument={onOpenDocument} onClose={onClose} onExpand={(p) => onExpand(workRef, p)} onChanged={onChanged} patchSignal={patchSignal} setItemDone={setItemDone} items={items} boards={boards} save={save} />
        )}
      </DialogContent>
    </Dialog>
  )
}
