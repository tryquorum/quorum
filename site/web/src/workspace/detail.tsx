// 항목 팝업. 출처: board/apps/web/src/components/work-view.tsx 의 배치(머리: 종류·제목·날짜·영역 → 요약·노트 → AI 실행 버튼과 실행 진행(run-view.tsx) → 사람 기록 입력·완료),
// note-preview.tsx(노트 앞부분 미리보기). Quorum 판: 요약 아래 "gbrain remembers"(비슷한 지난 판정), 가운데 주 버튼 "Send to agent" 는
// POST /api/runs 로 의회에 보내고 그 자리에서 gstack 네 역할(CEO·Reviewer·QA·CSO) 반박 → 판정 → Aside/Codex 실행 요약을 보여요. hold 는 여기서 Approve/Reject.
import { useEffect, useState } from "react"
import { Bot, Brain, Check, CircleAlert, ExternalLink, Gavel, Loader2, Send, Target, User, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { Proposal } from "@/console/stream"
import { ApiError, call, ws, type Area, type GoalView, type Item, type Note, type Signal } from "./api"
import { Md } from "./md"
import { ALERT, CHIP, DECIDE, LATE } from "./tone"
import { SourceChip, dueLabel, isLate, whenOf } from "./rows"
import { useMemory, useRunWatch } from "./run-watch"
import { dday } from "./views"

export type Open = { kind: "item"; id: string } | { kind: "signal"; id: string } | null
type Loaded = { kind: "item"; item: Item; note: Note | null } | { kind: "signal"; signal: Signal; note: Note | null }
type Acts = { approve: (s: Signal) => Promise<void>; reject: (s: Signal) => Promise<void>; resolve: (s: Signal) => Promise<void>; done: (i: Item) => Promise<void>; ask: (i: Item) => Promise<void> }
const AUTO = new Set(["agent", "goat", "system"])
const ROLES = [["ceo", "CEO"], ["reviewer", "Reviewer"], ["qa", "QA"], ["cso", "CSO"]] as const
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
// 판정·반박 칩: 보류와 escalate 만 빨간 바탕에 흰 글씨, 나머지는 한 톤(./tone)
const DECISION = { pass: "border border-border text-foreground", hold: DECIDE, reject: CHIP } as const
const STANCE = { keep: "border-border text-foreground", cut: "border-border text-muted-foreground", escalate: "border-transparent " + DECIDE } as const

function requestFor(d: Loaded, goal: GoalView | null): string {
  if (d.kind === "signal") return [d.signal.title, d.signal.body ?? ""].filter(Boolean).join("\n\n").slice(0, 4000)
  const it = d.item
  if (it.type === "goal") return ("목표: " + it.text + (it.due ? " (마감 " + it.due + ")" : "") + (goal?.open.length ? "\n남은 할 일:\n" + goal.open.slice(0, 15).map((t) => "- " + t.text.split("\n")[0]).join("\n") : "")).slice(0, 4000)
  const w = whenOf(it)
  return ((it.raw ?? it.text) + (w ? "\n(기한 " + w + ")" : "")).slice(0, 4000)
}

export function Detail({ open, onClose, onChanged, act, areaOf, goalOf, returnFocus }: {
  open: Open; onClose: () => void; onChanged: () => void; act: Acts; returnFocus?: () => void
  areaOf: (i: Item) => Area | null; goalOf: (id: string) => GoalView | null
}) {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [md, setMd] = useState("")
  // 노트 저장이 거절됐을 때(409 그사이 바뀜, 413 너무 김): 이유와, 다시 불러온 뒤에도 남겨 둘 내 초안
  const [noteProblem, setNoteProblem] = useState<{ status: number; text: string } | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [line, setLine] = useState("")
  const [title, setTitle] = useState("")
  const [saved, setSaved] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) { setData(null); setError(null); return }
    let live = true
    const load = open.kind === "item" ? ws.item(open.id).then((r) => ({ kind: "item" as const, ...r })) : ws.signal(open.id).then((r) => ({ kind: "signal" as const, ...r }))
    load.then((d) => { if (!live) return; setData(d); setError(null); setMd((cur) => (tick === 0 || cur === "" ? d.note?.md ?? "" : cur)); if (d.kind === "item") setTitle(d.item.text) })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tick])
  useEffect(() => { setTick(0); setSaved(null); setLine("") }, [open])

  const goal = data?.kind === "item" && data.item.type === "goal" ? goalOf(data.item.id) : null
  const runId = data ? (data.kind === "item" ? data.item.runId : (data.signal.meta?.askRunId ?? data.signal.meta?.runId)) : undefined
  const run = useRunWatch(runId)
  const memQ = data ? (data.kind === "item" ? data.item.text : data.signal.title).split("\n")[0] : ""
  const memory = useMemory(memQ)
  const ref = data ? (data.kind === "item" ? "item:" + data.item.id : "signal:" + data.signal.id) : ""

  // hold 판정의 사건(Approve/Reject 대상). 실행이 도는 동안 2.5초마다 다시 읽어요(읽기가 의회 판정을 Workspace 로 옮겨요)
  const [runSignals, setRunSignals] = useState<Signal[]>([])
  const holds = run ? run.order.filter((id) => run.proposals[id].verdict?.decision === "hold").length : 0
  // 다시 읽을 일이 있을 때만 2.5초마다: 의회가 도는 중, 승인한 일이 실행 중, 아직 사건이 안 된 판정이 있을 때. 끝나면 한 번만 읽어요
  const verdicts = run ? run.order.filter((id) => run.proposals[id].verdict).length : 0
  const pending = !!run && (run.status === "running" || run.status === "connecting" || runSignals.some((s) => s.status === "running") || runSignals.filter((s) => s.meta?.proposalId).length < verdicts)
  useEffect(() => {
    if (!runId) { setRunSignals([]); return }
    let live = true
    const load = () => call<Signal[]>("/api/ws/signals?run=" + encodeURIComponent(runId)).then((s) => { if (live) setRunSignals(s) }).catch(() => {})
    void load()
    if (!pending) return () => { live = false }
    const t = window.setInterval(load, 2500)
    return () => { live = false; window.clearInterval(t) }
  }, [runId, holds, pending])

  const refresh = (msg?: string) => { if (msg) setSaved(msg); setTick((t) => t + 1); onChanged() }
  const run_ = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); refresh(msg) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const saveNote = async () => {
    if (!data) return
    setNoteProblem(null)
    try {
      await ws.saveNote(ref, md, data.note?.updatedAt ?? 0)
      setDraft(null)
      refresh("Note saved")
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0
      setNoteProblem({ status, text: status === 409 ? "The council added to this note while you were editing, so nothing was saved. Reload it, then add your change." : e instanceof Error ? e.message : String(e) })
    }
  }
  /** 저장이 409 로 거절됐을 때: 최신 노트를 불러오고, 내 초안은 따로 남겨 둬요 */
  const reloadNote = async () => {
    if (!data) return
    const fresh = data.kind === "item" ? await ws.item(data.item.id).then((r) => ({ kind: "item" as const, ...r })) : await ws.signal(data.signal.id).then((r) => ({ kind: "signal" as const, ...r }))
    setDraft(md)
    setData(fresh)
    setMd(fresh.note?.md ?? "")
    setNoteProblem(null)
  }
  const send = async () => {
    if (!data || sending) return
    setSending(true)
    setError(null)
    try {
      if (data.kind === "item") await ws.ask({ ...data.item, raw: requestFor(data, goal) })
      else {
        const r = await call<{ runId: string }>("/api/runs", { method: "POST", body: { request: requestFor(data, null) } })
        await call("/api/ws/signals/" + data.signal.id + "/link", { method: "POST", body: { runId: r.runId } })
      }
      refresh("Sent to the council")
    } catch (e) { setError("Not sent: " + (e instanceof Error ? e.message : String(e))) }
    finally { setSending(false) }
  }

  const head = data ? headOf(data, areaOf) : null
  return (
    <Dialog open={!!open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent onCloseAutoFocus={(e) => { if (returnFocus) { e.preventDefault(); returnFocus() } }} className="max-h-[90svh] grid-cols-[minmax(0,1fr)] gap-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-2xl max-sm:inset-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none">
        {!data && (
          <div className="flex flex-col gap-3 p-5">
            <DialogTitle className="text-sm text-muted-foreground">{error ? "Couldn't open this" : "Loading…"}</DialogTitle>
            {error && <p role="alert" className={"rounded-lg px-2.5 py-1.5 text-sm " + ALERT}>{/not found/.test(error) ? "This item is gone or was not copied yet. It may have been deleted in Direction Board." : error}</p>}
            {error && <Button variant="outline" size="sm" className="self-start rounded-full" onClick={onClose}>Back to the list</Button>}
          </div>
        )}
        {data && head && (
          <>
            {/* 머리 + 요약 */}
            <div className="flex flex-col gap-3 border-b p-5 pb-4">
              <div className="flex flex-wrap items-center gap-1.5 pr-8 text-2xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">{head.icon}{head.kind}</span>
                <SourceChip item={data.kind === "item" ? data.item : data.signal} />
                {head.when && <span className={cn("rounded-full border px-2 py-0.5 font-mono", head.late && LATE)}>{head.when}</span>}
                {head.area && <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"><span className="size-1.5 rounded-full" style={{ background: head.area.color }} />{head.area.name}</span>}
                {head.status && <span className="rounded-full border px-2 py-0.5 text-muted-foreground">{head.status}</span>}
              </div>
              {data.kind === "item" ? (
                <form onSubmit={(e) => { e.preventDefault(); if (title.trim() && title.trim() !== data.item.text) void run_(() => ws.patch(data.item.id, { text: title, seq: data.item.seq }), "Title saved") }} className="flex items-start gap-2">
                  <DialogTitle asChild>
                    <textarea value={title} onChange={(e) => setTitle(e.target.value)} rows={Math.min(3, Math.max(1, Math.ceil(title.length / 48)))} aria-label="Title"
                      className="min-w-0 flex-1 resize-none bg-transparent text-lg leading-7 font-semibold outline-none" />
                  </DialogTitle>
                  {title.trim() !== data.item.text && <Button type="submit" size="sm">Save</Button>}
                </form>
              ) : <DialogTitle className="text-lg leading-7">{data.signal.title}</DialogTitle>}
              <DialogDescription className="sr-only">Summary, what gbrain remembers, and send to the council</DialogDescription>
              {data.kind === "signal" && data.signal.reason && <p className="text-xs text-muted-foreground">{data.signal.reason}</p>}
              {data.kind === "item" && data.item.raw && data.item.raw !== data.item.text && <p className="text-xs text-muted-foreground">You wrote: “{data.item.raw}”</p>}
              {goal && <GoalProgress g={goal} />}
              {data.kind === "signal" && data.signal.body && <div className="max-h-40 overflow-auto rounded-xl bg-muted/40 p-3 text-xs leading-5"><Md text={data.signal.body} /></div>}
              {data.note?.md && <NotePreview md={data.note.md} by={data.note.personEdited ? "you" : "the council"} />}
              {data.kind === "item" && data.item.log.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {data.item.log.slice(-3).map((l, i) => (
                    <li key={l.id ?? i} className="flex items-start gap-2 text-xs">
                      {AUTO.has(l.by) ? <Bot className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <User className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                      <span className={cn("min-w-0 flex-1", AUTO.has(l.by) && "text-muted-foreground")}>{l.text}</span>
                      <span className="shrink-0 font-mono text-2xs text-muted-foreground">{when(l.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Remembers memory={memory} />
            </div>

            {/* 가운데: 에이전트에게 보내기 + 진행 */}
            <div className="flex flex-col gap-3 border-b bg-muted/20 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void send()} disabled={sending || (data.kind === "item" && data.item.done)} className="h-9 rounded-full px-4">
                  {sending ? <Loader2 className="animate-spin" /> : <Send />}{runId ? "Send to agent again" : "Send to agent"}
                </Button>
                <span className="text-2xs leading-4 text-muted-foreground">gstack CEO · Reviewer · QA · CSO argue it, Aside or Codex runs only what passes, gbrain remembers the verdict.</span>
              </div>
              {run && <RunPanel run={run} signals={runSignals} act={act} onDone={() => refresh()} />}
              {/* 이 사건의 제안 카드가 위 진행에 이미 있으면 거기 Approve/Reject 하나만 둬요(같은 버튼이 두 번 나오지 않게) */}
              {data.kind === "signal" && <SignalActions s={data.signal} act={act} onDone={(m) => refresh(m)} inCard={!!run && runId === data.signal.meta?.runId && !!run.proposals[String(data.signal.meta?.proposalId)]} />}
            </div>

            {/* 아래: 사람 기록 */}
            <div className="flex flex-col gap-3 p-5">
              {data.kind === "item" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => void run_(() => data.item.done ? ws.patch(data.item.id, { done: false }) : act.done(data.item), data.item.done ? "Reopened" : "Done")}>
                    <Check />{data.item.done ? "Reopen" : "Mark done"}
                  </Button>
                  {data.item.runId && <a href="/app" className="inline-flex items-center gap-1 font-mono text-2xs text-muted-foreground hover:text-foreground hover:underline max-md:min-h-11 [@media(pointer:coarse)]:min-h-11">{data.item.runId}<ExternalLink className="size-3" /></a>}
                </div>
              )}
              {data.kind === "item" && (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (line.trim()) void run_(() => ws.log(data.item.id, line).then(() => setLine("")), "Logged") }}>
                  <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="Add to the log — what happened, what's next" aria-label="Add log line" className="min-w-0 flex-1 rounded-lg border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-foreground/40" />
                  <Button type="submit" size="sm" variant="secondary" disabled={!line.trim()}>Add</Button>
                </form>
              )}
              <details className="group/note" open={!data.note?.md || draft !== null || !!noteProblem}>
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none hover:text-foreground max-md:py-3.5 [@media(pointer:coarse)]:py-3.5">Note {data.note && <span className="font-normal">· {data.note.personEdited ? "edited by you" : "written by the council"} · {when(data.note.updatedAt)}</span>}</summary>
                <Textarea value={md} onChange={(e) => setMd(e.target.value)} placeholder="Markdown. The council only appends here; it never rewrites what you wrote." className="mt-2 min-h-28 font-mono text-xs leading-5" />
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" variant="secondary" disabled={md === (data.note?.md ?? "")} onClick={() => void saveNote()}>Save note</Button>
                  {data.note?.overflow ? <span className="text-2xs text-muted-foreground">{data.note.overflow} council result(s) kept separately — the note is full</span> : null}
                </div>
                {noteProblem && (
                  <div role="alert" className={"mt-2 flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs " + ALERT}>
                    <span className="min-w-0 flex-1">{noteProblem.text}</span>
                    {noteProblem.status === 409 && <Button size="sm" variant="outline" className="rounded-full" onClick={() => void reloadNote()}>Reload the note</Button>}
                  </div>
                )}
                {draft !== null && (
                  <div className="mt-2">
                    <p className="mb-1 text-2xs text-muted-foreground">Your unsaved draft (copy what you need into the note above)</p>
                    <Textarea readOnly value={draft} aria-label="Your unsaved draft" className="min-h-20 font-mono text-xs leading-5" />
                  </div>
                )}
              </details>
              {(saved || error) && <p role="status" className={cn("text-2xs", error ? "rounded px-1.5 py-0.5 " + ALERT : "text-muted-foreground")}>{error ?? saved}</p>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function headOf(d: Loaded, areaOf: (i: Item) => Area | null) {
  if (d.kind === "item") {
    const it = d.item
    const w = it.type === "goal" ? it.due : whenOf(it)
    return { kind: it.type === "goal" ? "Goal" : "Task", icon: it.type === "goal" ? <Target className="size-3" /> : <Check className="size-3" />, when: w ? (it.type === "goal" ? dday(w).t + " · " + w : dueLabel(w)) : null, late: !it.done && isLate(w), area: areaOf(it), status: it.done ? "done" : null }
  }
  const s = d.signal
  const council = !!s.meta?.runId && !!s.meta?.proposalId
  const status = s.status === "running" ? "running" : s.status === "resolved" ? "closed" : s.lane === "review" ? "to review" : ["decide", "now", "main"].includes(s.lane) ? "needs you" : s.lane
  return { kind: council ? "Council result" : "Signal", icon: <Gavel className="size-3" />, when: null, late: false, area: null, status }
}

function GoalProgress({ g }: { g: GoalView }) {
  const pct = g.total ? Math.round((g.done / g.total) * 100) : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-foreground" style={{ width: pct + "%" }} /></div><span className="num font-mono text-2xs text-muted-foreground">{g.done}/{g.total} · {pct}%</span></div>
      {g.open.length > 0 && <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">{g.open.slice(0, 4).map((t) => <li key={t.id} className="truncate">○ {t.text.split("\n")[0]}{whenOf(t) && <span className="ml-1.5 font-mono text-2xs">{dueLabel(whenOf(t)!)}</span>}</li>)}{g.open.length > 4 && <li className="text-2xs">+{g.open.length - 4} more</li>}</ul>}
    </div>
  )
}

/** 노트 앞부분 미리보기(board note-preview.tsx 처럼 몇 줄만) */
function NotePreview({ md, by }: { md: string; by: string }) {
  const lines = md.split("\n").filter((l) => l.trim()).slice(0, 6).join("\n")
  return (
    <div className="rounded-xl border p-3 text-xs leading-5">
      <p className="mb-1 text-2xs text-muted-foreground">Note · {by}</p>
      <Md text={lines} />
    </div>
  )
}

function Remembers({ memory }: { memory: ReturnType<typeof useMemory> }) {
  return (
    <section aria-label="gbrain remembers" className="rounded-xl border bg-muted/30 p-3">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-muted-foreground uppercase"><Brain className="size-3.5" />gbrain remembers</h3>
      {memory.hits === null ? <p className="text-2xs text-muted-foreground">Searching past verdicts…</p>
        : memory.error ? <p className="text-2xs text-muted-foreground">gbrain is unavailable: {memory.error}</p>
        : !memory.hits.length ? <p className="text-2xs text-muted-foreground">Nothing similar yet. The council's verdict will be remembered.</p>
        : (
          <ul className="flex flex-col gap-1.5">
            {memory.hits.map((h) => (
              <li key={h.slug} className="flex min-w-0 items-start gap-2 text-xs">
                {h.decision ? <span className={cn("shrink-0 rounded px-1 font-mono text-2xs", DECISION[h.decision])}>{h.decision}</span> : <span className="shrink-0 rounded bg-muted px-1 font-mono text-2xs text-muted-foreground">fact</span>}
                <span className="min-w-0 flex-1"><span className="block truncate">{h.title || h.snippet.slice(0, 80)}</span><span className="block truncate font-mono text-2xs text-muted-foreground">{h.slug}</span></span>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

/** 의회 진행(run-view.tsx 자리): 제안마다 네 역할 반박 칩 → 판정 → 실행 요약. hold 는 Approve/Reject */
function RunPanel({ run, signals, act, onDone }: { run: NonNullable<ReturnType<typeof useRunWatch>>; signals: Signal[]; act: Acts; onDone: () => void }) {
  const props = run.order.map((id) => run.proposals[id])
  const live = run.status === "running" || run.status === "connecting"
  const replay = run.mode === "replay"
  return (
    <div className="flex flex-col gap-2.5">
      <p className="flex items-center gap-2 text-2xs text-muted-foreground">
        {live ? <Loader2 className="size-3 animate-spin" /> : run.status === "error" ? <CircleAlert className={"size-3.5 text-red-400"} /> : <Check className="size-3 text-foreground" />}
        <span className="font-mono">{run.runId}</span>
        <span>{live ? (props.length ? "council is arguing…" : run.recall ? "proposing…" : "recalling memory…") : run.end?.text ?? run.status}</span>
        {replay && <span className={"rounded px-1 font-mono font-semibold " + CHIP}>REPLAY</span>}
      </p>
      {run.failure && <p role="alert" className={"rounded-lg px-2.5 py-1.5 text-xs " + ALERT}>{run.failure}</p>}
      {props.map((p) => <ProposalCard key={p.id} p={p} signal={signals.find((s) => s.meta?.proposalId === p.id) ?? null} act={act} onDone={onDone} />)}
      {run.errors.length > 0 && !live && <p className={"rounded px-1.5 py-0.5 text-2xs " + ALERT}>{run.errors.length} error(s): {run.errors[run.errors.length - 1].text}</p>}
    </div>
  )
}

function ProposalCard({ p, signal, act, onDone }: { p: Proposal; signal: Signal | null; act: Acts; onDone: () => void }) {
  const byRole = new Map(p.critiques.filter((c) => c.role).map((c) => [c.role!, c]))
  const result = [...p.exec].reverse().find((x) => x.type === "execute.result")
  const running = p.exec.some((x) => x.type === "execute.start") && !result
  const waiting = signal && signal.status === "open" && ["decide", "now"].includes(signal.lane)
  const [busy, setBusy] = useState(false)
  const go = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); onDone() } finally { setBusy(false) } }
  const after = signal && signal.meta?.decidedBy ? (signal.status === "running" ? "approved · running" : signal.meta.decision === "reject" ? "rejected by you" : "approved by you") : null
  return (
    <div className="rounded-xl border bg-background/60 p-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm leading-5 font-medium">{p.title}</p>
        {p.executor && <span className="shrink-0 rounded bg-muted px-1 font-mono text-2xs text-muted-foreground">{p.executor}</span>}
        {p.verdict && <span className={cn("shrink-0 rounded px-1.5 font-mono text-2xs", DECISION[p.verdict.decision])}>{p.verdict.decision}</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {ROLES.map(([role, label]) => {
          const c = byRole.get(role)
          return (
            <span key={role} title={c?.reason ?? "waiting"} className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-2xs", c?.stance ? STANCE[c.stance] : "border-dashed text-muted-foreground/60")}>
              {label}{c?.stance ? " · " + c.stance : ""}
            </span>
          )
        })}
      </div>
      {p.verdict?.reason && <p className="mt-1.5 text-2xs text-muted-foreground">{p.verdict.reason}</p>}
      {running && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />{p.executor} is running…</p>}
      {result && (
        <div className={cn("mt-2 rounded-lg p-2.5 text-xs leading-5", result.ok === false ? ALERT : "bg-muted/50")}>
          <Md text={result.summary || result.text} />
        </div>
      )}
      {waiting && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button size="sm" className="rounded-full" disabled={busy} onClick={() => void go(() => act.approve(signal))}><Check />{signal.kind === "error" ? "Retry" : "Approve"}</Button>
          <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => void go(() => act.reject(signal))}><X />{signal.kind === "error" ? "Dismiss" : "Reject"}</Button>
          <span className="text-2xs text-muted-foreground">{signal.kind === "error" ? "Retry runs it on " + String(signal.meta?.executor) + " again." : "Approve runs it on " + String(signal.meta?.executor) + " now."}</span>
        </div>
      )}
      {p.verdict?.decision === "hold" && !signal && <p className="mt-2 text-2xs text-muted-foreground">Waiting for the workspace to pick up this hold…</p>}
      {after && <p className="mt-2 text-2xs text-muted-foreground">{after}{signal?.body && signal.lane === "review" ? "" : ""}</p>}
      {signal && signal.meta?.decidedBy && signal.lane === "review" && signal.body && <div className="mt-2 rounded-lg bg-muted/50 p-2.5 text-xs leading-5"><Md text={signal.body} /></div>}
    </div>
  )
}

function SignalActions({ s, act, onDone, inCard }: { s: Signal; act: Acts; onDone: (m: string) => void; inCard?: boolean }) {
  const council = !!s.meta?.runId && !!s.meta?.proposalId
  const waiting = s.status === "open" && ["decide", "now", "main"].includes(s.lane)
  if (s.status !== "open") return null
  if (waiting && council && inCard) return null
  const items: [string, () => Promise<void>, string][] = []
  // 실행이 실패한 판정은 보류가 아니라서 "다시 실행 / 닫기"로 불러요(같은 승인·거절 길을 써요)
  if (waiting && council) items.push(s.kind === "error" ? ["Retry", () => act.approve(s), "Running again"] : ["Approve", () => act.approve(s), "Approved"], s.kind === "error" ? ["Dismiss", () => act.reject(s), "Dismissed"] : ["Reject", () => act.reject(s), "Rejected"])
  else items.push([s.lane === "review" ? "Mark reviewed" : "Mark handled", () => act.resolve(s), "Closed"])
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(([label, fn, msg]) => (
        <Button key={label} size="sm" variant={label === "Approve" || label === "Retry" ? "default" : "outline"} className="rounded-full" onClick={() => void fn().then(() => onDone(msg))}>
          {label === "Reject" || label === "Dismiss" ? <X /> : <Check />}{label}
        </Button>
      ))}
    </div>
  )
}
