// The landing's workspace preview: the real Workspace UI (site/web/src/workspace) on recorded data, with no network.
// It answers the same /api/ws/* and /api/runs calls the Quorum server answers, from memory:
// - items and signals are a small demo board plus the real request from the c0mpiled-17 Seoul run (live-seoul.json);
// - Send to agent on that request replays the recorded council (25 contract events, mode "replay"), and verdicts become
//   Workspace signals with the same rules as src/workspace/council.ts (hold → decide, pass → running → review, reject → info);
// - everything else is read-only and says so.
import { ApiError, type Item, type Meta, type Note, type NowView, type Signal, type Transport } from "@/workspace/api"
import type { QuorumEvent } from "@/lib/contract"
import { SEOUL_EVENTS, SEOUL_REQUEST, SEOUL_REQUEST_EN } from "@/lib/seoul"

const READ_ONLY = "This preview is read-only. Open your workspace to change things."
const ONLY_SEOUL = "In this preview only the recorded Seoul request can be sent. Open your workspace to send your own."

const localDay = (ms: number) => { const d = new Date(ms), p = (n: number) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) }
const whenOf = (i: Item) => i.due ?? i.remindAt ?? null

type Run = { id: string; events: QuorumEvent[]; done: boolean; listeners: Set<() => void> }

export function createDemoServer(now = Date.now()): Transport {
  const today = localDay(now)
  const t0 = now - 3 * 3600e3
  const base = { log: [], textBy: "person" as const, by: "you", localEdited: false, source: "capture" as const, seq: 1 }
  const items: Item[] = [
    { ...base, id: "ship", type: "goal", text: "Ship Quorum at c0mpiled-17 Seoul", done: false, due: today, createdAt: t0, updatedAt: t0 },
    { ...base, id: "seoul-ask", type: "todo", text: SEOUL_REQUEST_EN, raw: SEOUL_REQUEST, done: false, due: today, goalId: "ship", createdAt: t0 + 60e3, updatedAt: t0 + 60e3 },
    { ...base, id: "demo-video", type: "todo", text: "Submit the demo video and the repo link", done: false, due: today, goalId: "ship", createdAt: t0 + 120e3, updatedAt: t0 + 120e3 },
    { ...base, id: "check-in", type: "todo", text: "Check in at COEX 2F", done: true, doneAt: t0 + 30e3, due: today, goalId: "ship", createdAt: t0, updatedAt: t0 + 30e3 },
    { ...base, id: "credits", type: "todo", text: "Credit Aside, gbrain (MIT), gstack (MIT) and Direction Board in the README", done: false, due: null, createdAt: t0 + 180e3, updatedAt: t0 + 180e3 },
  ]
  const signals: Signal[] = [{
    id: "recipe-luma", ref: "recipe:luma-blasts", source: "recipes", kind: "done", lane: "review", status: "open",
    title: "Recipe luma-blasts repaired: event/get-posts → event/get-blasts",
    body: "The recipe called api2.luma.com/event/get-posts, which now returns 404. Aside re-explored the signed-in Luma tab, found event/get-blasts, and the new version passed the recipe's check (7 announcements). gbrain keeps why the old one broke.",
    reason: "Repaired and verified · take a look", meta: { recipeId: "luma-blasts" }, created_at: t0 + 240e3, updated_at: t0 + 240e3, resolved_at: null,
  }]
  const notes = new Map<string, Note>()
  const runs = new Map<string, Run>()
  let runCount = 0

  const nowView = (): NowView => {
    const open = signals.filter((s) => s.status !== "resolved")
    const todos = items.filter((i) => !i.done && i.type === "todo")
    const needsYou = open.filter((s) => s.status === "open" && ["decide", "now", "main"].includes(s.lane))
    const running = open.filter((s) => s.status === "running" || s.lane === "running")
    const review = open.filter((s) => s.status === "open" && s.lane === "review")
    const byWhen = (a: Item, b: Item) => String(whenOf(a)).localeCompare(String(whenOf(b)))
    const dueToday = todos.filter((i) => { const w = whenOf(i); return !!w && w.slice(0, 10) <= today }).sort(byWhen)
    const inbox = todos.filter((i) => !whenOf(i) && !i.placed)
    const later = todos.filter((i) => { const w = whenOf(i); return !!w && w.slice(0, 10) > today }).sort(byWhen)
    const goals = items.filter((g) => g.type === "goal" && !g.done).map((goal) => {
      const ts = items.filter((t) => t.type === "todo" && t.goalId === goal.id)
      const openTs = ts.filter((t) => !t.done).sort(byWhen)
      return { goal, total: ts.length, done: ts.length - openTs.length, open: openTs, next: openTs[0] ? whenOf(openTs[0]) : null }
    })
    return { today, needsYou, running, dueToday, goals, review, inbox, later, counts: { needsYou: needsYou.length, dueToday: dueToday.length, review: review.length, inbox: inbox.length, running: running.length, goals: goals.length } }
  }
  const meta: Meta = { boards: [], spaces: [], me: { email: "Demo · recorded Seoul run" }, import: null }

  // Verdicts and results become signals, as src/workspace/council.ts applyEvent does on the real server.
  const proposals = new Map<string, { title: string; executor: string; task: string; why: string }>()
  const upsertSignal = (ref: string, patch: Partial<Signal> & Pick<Signal, "title">) => {
    const at = Date.now()
    const cur = signals.find((s) => s.ref === ref)
    if (cur) Object.assign(cur, patch, { updated_at: at, resolved_at: patch.status === "resolved" ? at : null })
    else signals.unshift({ id: "s" + (signals.length + 1), ref, source: "quorum", kind: "info", body: null, lane: "info", reason: null, status: "open", meta: {}, created_at: at, updated_at: at, resolved_at: null, ...patch })
    return signals.find((s) => s.ref === ref)!
  }
  const applyToBoard = (run: Run, e: QuorumEvent, itemId: string) => {
    const d = (e.data ?? {}) as Record<string, unknown>
    const pid = typeof d.proposalId === "string" ? d.proposalId : ""
    if (e.type === "proposal" && pid) proposals.set(pid, { title: String(d.title ?? pid), executor: String(d.executor ?? "none"), task: String(d.task ?? ""), why: String(d.why ?? "") })
    const p = proposals.get(pid)
    const ref = "quorum:" + run.id + ":" + pid
    const m = { runId: run.id, proposalId: pid, executor: p?.executor ?? "none", task: p?.task ?? "", why: p?.why ?? "", request: SEOUL_REQUEST, itemId }
    if (e.type === "verdict" && pid && p) {
      const reason = String(d.reason ?? "")
      if (d.decision === "hold") upsertSignal(ref, { title: p.title, kind: "approval", lane: "decide", status: "open", reason: "의회가 보류했어요 · 승인이 필요해요", body: "의회 보류: " + reason + (p.task ? "\n\n실행기: " + p.executor + "\n지시: " + p.task : ""), meta: m })
      else if (d.decision === "pass") upsertSignal(ref, { title: p.title, kind: "start", lane: "running", status: "running", reason: "통과 · " + p.executor + " 실행 중", body: reason, meta: m })
      else if (d.decision === "reject") upsertSignal(ref, { title: p.title, kind: "info", lane: "info", status: "resolved", reason: "의회가 거절했어요(기록만)", body: reason, meta: m })
    }
    if (e.type === "execute.result" && pid && p) {
      const summary = String(d.summary ?? e.text)
      const s = upsertSignal(ref, { title: p.title, kind: "done", lane: "review", status: "open", reason: "의회가 통과시켜 실행했어요 · 결과를 봐 주세요", body: summary.slice(0, 8000), meta: m })
      notes.set("signal:" + s.id, { ref: "signal:" + s.id, md: "## 실행 결과 (" + p.executor + ")\n\n" + summary.slice(0, 8000), by: "agent", updatedAt: Date.now(), personEdited: false })
    }
    if (e.type === "run.end") {
      const it = items.find((i) => i.id === itemId)
      if (it) it.log = [...it.log, { by: "agent", at: Date.now(), text: "의회 " + run.id + ": " + e.text }]
    }
  }

  // Pacing for watching: arguments read quickly, the execution takes a beat.
  const pause = (e: QuorumEvent) => e.type === "critique" ? 320 : e.type === "execute.result" ? 1600 : e.type === "execute.start" ? 900 : e.type === "recall" ? 900 : 600
  const startReplay = (itemId: string): Run => {
    const run: Run = { id: "replay-" + (++runCount) + "-seoul", events: [], done: false, listeners: new Set() }
    runs.set(run.id, run)
    let at = 300
    SEOUL_EVENTS.forEach((src, i) => {
      at += i === 0 ? 0 : pause(src)
      window.setTimeout(() => {
        const e: QuorumEvent = { ...src, runId: run.id, mode: "replay" }
        run.events.push(e)
        applyToBoard(run, e, itemId)
        if (i === SEOUL_EVENTS.length - 1) run.done = true
        run.listeners.forEach((f) => f())
      }, at)
    })
    return run
  }

  const route = (method: string, url: URL, body: unknown): unknown => {
    const path = url.pathname
    if (method === "GET") {
      if (path === "/api/ws/now") return nowView()
      if (path === "/api/ws/meta") return meta
      if (path === "/api/ws/items") return url.searchParams.get("done") === "1" ? items : items.filter((i) => !i.done)
      if (path === "/api/ws/signals") { const run = url.searchParams.get("run"); return run ? signals.filter((s) => s.meta?.runId === run) : signals }
      let m = /^\/api\/ws\/items\/([^/]+)$/.exec(path)
      if (m) { const it = items.find((i) => i.id === m![1]); if (!it) throw new ApiError(404, "not found"); return { item: it, note: notes.get("item:" + it.id) ?? null } }
      m = /^\/api\/ws\/signals\/([^/]+)$/.exec(path)
      if (m) { const s = signals.find((x) => x.id === m![1]); if (!s) throw new ApiError(404, "not found"); return { signal: s, note: notes.get("signal:" + s.id) ?? null } }
      if (path === "/api/memory") {
        const recall = SEOUL_EVENTS.find((e) => e.type === "recall")
        const hits = ((recall?.data as { hits?: { id: string; summary: string; decision?: string; score?: number }[] } | undefined)?.hits ?? [])
        return { results: hits.map((h) => ({ slug: h.id, title: h.summary, snippet: h.summary + (h.decision ? " · " + h.decision : ""), score: h.score ?? 0 })) }
      }
    }
    if (method === "POST" && path === "/api/runs") {
      const request = String((body as { request?: unknown } | undefined)?.request ?? "")
      const item = items.find((i) => i.id === "seoul-ask")!
      if (!request.startsWith(SEOUL_REQUEST)) throw new ApiError(403, ONLY_SEOUL)
      return { runId: startReplay(item.id).id }
    }
    if (method === "PATCH") {
      const m = /^\/api\/ws\/items\/([^/]+)$/.exec(path)
      const patch = (body ?? {}) as Record<string, unknown>
      // the only write the preview accepts: linking the replayed run to the item it was sent from
      if (m && Object.keys(patch).length === 1 && typeof patch.runId === "string" && runs.has(patch.runId)) {
        const it = items.find((i) => i.id === m[1])
        if (!it) throw new ApiError(404, "not found")
        Object.assign(it, { runId: patch.runId, updatedAt: Date.now() })
        return it
      }
    }
    throw new ApiError(403, READ_ONLY)
  }

  return {
    call: async (path, init) => route(init.method ?? "GET", new URL(path, "http://demo.invalid"), init.body),
    events: (path) => {
      const id = decodeURIComponent((/^\/api\/runs\/([^/]+)\/events/.exec(path) ?? [])[1] ?? "")
      return replayStream(runs.get(id) ?? null)
    },
  }
}

/** Just enough of EventSource for useRunWatch: onmessage per event, a "done" event at the end, close(). */
function replayStream(run: Run | null): EventSource {
  let sent = 0, closed = false
  const doneHandlers: (() => void)[] = []
  const es = {
    readyState: 1, onmessage: null as ((m: { data: string }) => void) | null, onerror: null as (() => void) | null,
    addEventListener: (type: string, fn: () => void) => { if (type === "done") doneHandlers.push(fn) },
    close: () => { closed = true; es.readyState = 2; run?.listeners.delete(flush) },
  }
  const flush = () => {
    if (closed || !run) return
    while (sent < run.events.length) es.onmessage?.({ data: JSON.stringify(run.events[sent++]) })
    if (run.done) doneHandlers.forEach((f) => f())
  }
  if (!run) queueMicrotask(() => { es.readyState = 2; es.onerror?.() })
  else { run.listeners.add(flush); queueMicrotask(flush) }
  return es as unknown as EventSource
}
