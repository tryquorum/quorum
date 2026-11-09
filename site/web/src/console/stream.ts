import { asset } from "@/lib/base"
import type { Decision, Executor, QuorumEvent, Role, Stance } from "@/lib/contract"

// Pure fold of contract v1 events into what the console draws. Unknown or partial data is kept in the
// raw log and never invented: a missing field stays missing on screen.
export type Critique = { seq: number; actor: string; role?: Role; stance?: Stance; reason: string }
export type ExecStep = { seq: number; type: "execute.start" | "execute.result"; actor: string; text: string; ok?: boolean; summary?: string; items: string[] }
export type Proposal = {
  id: string
  seq: number
  actor: string
  title: string
  executor?: Executor
  why?: string
  critiques: Critique[]
  verdict?: { decision: Decision; reason?: string; reusedFrom?: string; seq: number }
  exec: ExecStep[]
}
export type RecallHit = { id: string; summary: string; decision?: string; score?: number }
export type RecipeStep = { seq: number; type: "recipe.run" | "recipe.broken" | "recipe.repaired"; actor: string; text: string; recipeId?: string; version?: number; endpoint?: string; status?: number; reason?: string }
export type RunStatus = "idle" | "connecting" | "running" | "done" | "error"

export type RunView = {
  runId?: string
  request?: string
  mode?: "live" | "replay"
  status: RunStatus
  events: QuorumEvent[]
  order: string[]
  proposals: Record<string, Proposal>
  recall?: { seq: number; hits: RecallHit[] }
  recipe: RecipeStep[]
  memory: QuorumEvent[]
  board: QuorumEvent[]
  errors: QuorumEvent[]
  notes: QuorumEvent[]
  end?: QuorumEvent
  failure?: string
}

export const emptyRun = (): RunView => ({ status: "idle", events: [], order: [], proposals: {}, recipe: [], memory: [], board: [], errors: [], notes: [] })

const str = (v: unknown) => (typeof v === "string" ? v : undefined)
const num = (v: unknown) => (typeof v === "number" ? v : undefined)

function proposalFor(view: RunView, id: string | undefined, e: QuorumEvent): Proposal | undefined {
  if (!id) return undefined
  if (!view.proposals[id]) {
    // A critique or verdict for a proposal we never saw (reused verdicts may skip proposals).
    view.proposals[id] = { id, seq: e.seq, actor: "council", title: id, critiques: [], exec: [] }
    view.order.push(id)
  }
  return view.proposals[id]
}

export function applyEvent(prev: RunView, e: QuorumEvent): RunView {
  if (prev.events.some((x) => x.seq === e.seq && x.runId === e.runId)) return prev // SSE reconnect can resend
  const view: RunView = {
    ...prev,
    events: [...prev.events, e],
    order: [...prev.order],
    proposals: Object.fromEntries(Object.entries(prev.proposals).map(([k, p]) => [k, { ...p, critiques: [...p.critiques], exec: [...p.exec] }])),
    recipe: [...prev.recipe],
    memory: [...prev.memory],
    board: [...prev.board],
    errors: [...prev.errors],
    notes: [...prev.notes],
    runId: prev.runId ?? e.runId,
    mode: e.mode,
    status: prev.status === "idle" || prev.status === "connecting" ? "running" : prev.status,
  }
  const d = e.data ?? {}
  switch (e.type) {
    case "run.start":
      view.request = str(d.request) ?? view.request
      break
    case "recall": {
      const hits = Array.isArray(d.hits) ? d.hits : []
      view.recall = {
        seq: e.seq,
        hits: hits.map((h) => {
          const o = (h ?? {}) as Record<string, unknown>
          return { id: str(o.id) ?? "?", summary: str(o.summary) ?? "", decision: str(o.decision), score: num(o.score) }
        }),
      }
      break
    }
    case "proposal": {
      const id = str(d.proposalId) ?? `seq-${e.seq}`
      const existing = view.proposals[id]
      view.proposals[id] = {
        id, seq: e.seq, actor: e.actor,
        title: str(d.title) ?? e.text,
        executor: str(d.executor) as Executor | undefined,
        why: str(d.why),
        critiques: existing?.critiques ?? [],
        verdict: existing?.verdict,
        exec: existing?.exec ?? [],
      }
      if (!existing) view.order.push(id)
      break
    }
    case "critique":
      proposalFor(view, str(d.proposalId), e)?.critiques.push({ seq: e.seq, actor: e.actor, role: str(d.role) as Role | undefined, stance: str(d.stance) as Stance | undefined, reason: str(d.reason) ?? e.text })
      break
    case "verdict": {
      const p = proposalFor(view, str(d.proposalId), e)
      const decision = str(d.decision) as Decision | undefined
      if (p && decision) p.verdict = { decision, reason: str(d.reason) ?? e.text, reusedFrom: str(d.reusedFrom), seq: e.seq }
      else view.notes.push(e)
      break
    }
    case "execute.start":
    case "execute.result": {
      const p = proposalFor(view, str(d.proposalId), e)
      const items = Array.isArray(d.items) ? d.items.map(String) : []
      const step: ExecStep = { seq: e.seq, type: e.type, actor: e.actor, text: e.text, ok: typeof d.ok === "boolean" ? d.ok : undefined, summary: str(d.summary), items }
      if (p) p.exec.push(step)
      else view.notes.push(e)
      break
    }
    case "recipe.run":
    case "recipe.broken":
    case "recipe.repaired":
      view.recipe.push({ seq: e.seq, type: e.type, actor: e.actor, text: e.text, recipeId: str(d.recipeId), version: num(d.version), endpoint: str(d.endpoint), status: num(d.status), reason: str(d.reason) })
      break
    case "memory.saved":
      view.memory.push(e)
      break
    case "board.posted":
      view.board.push(e)
      break
    case "error":
      view.errors.push(e)
      break
    case "run.end":
      view.end = e
      view.status = view.errors.length ? "error" : "done"
      break
    default:
      view.notes.push(e)
  }
  return view
}

export type Fixture = { runId: string; request: string; mode: "replay"; recordedAt?: string; events: QuorumEvent[] }

export const FIXTURES: Record<string, { file: string; label: string }> = {
  seoul: { file: asset("fixtures/live-seoul.json"), label: "Recorded live · c0mpiled-17 Seoul · 11:31 KST" },
  "1": { file: asset("fixtures/sample-run.json"), label: "Scripted sample: event announcements" },
  reuse: { file: asset("fixtures/sample-reuse.json"), label: "Scripted sample: memory reuse" },
}

export type StopFn = () => void

// Demo pacing for ?demo=seoul: fixed dwell per event type, tuned so the recorded run reads well in a
// 2-minute video. The recording's own timestamps are not used (critiques arrived in one batch).
const DEMO_DWELL: Partial<Record<QuorumEvent["type"], number>> = {
  "run.start": 1500, recall: 2600, proposal: 2200, critique: 1100, verdict: 2000,
  "execute.start": 2400, "execute.result": 3800, "memory.saved": 1600, "run.end": 1200,
}

/** Plays a recorded run. Every event is forced to mode "replay" so nothing recorded can pass as live. */
export async function playFixture(key: string, speed: number, onEvent: (e: QuorumEvent) => void, onDone: () => void, onError: (m: string) => void, opts: { demo?: boolean } = {}): Promise<StopFn> {
  const meta = FIXTURES[key] ?? FIXTURES.seoul
  let stopped = false
  const timers: number[] = []
  try {
    const res = await fetch(meta.file)
    if (!res.ok) throw new Error(`${meta.file} returned HTTP ${res.status}`)
    const fx = (await res.json()) as Fixture
    // Recordings may carry a stray non-event entry; only well-formed contract events are played.
    const events = fx.events
      .filter((e) => e && typeof e.type === "string" && typeof e.seq === "number")
      .sort((a, b) => a.seq - b.seq)
      .map((e) => ({ ...e, runId: e.runId ?? fx.runId, mode: "replay" as const }))
    let at = 300
    events.forEach((e, i) => {
      if (i > 0) {
        const gap = opts.demo
          ? DEMO_DWELL[events[i - 1].type] ?? 1200
          : Math.min(1200, Math.max(160, Date.parse(e.at) - Date.parse(events[i - 1].at) || 600))
        at += gap / speed
      }
      timers.push(window.setTimeout(() => { if (!stopped) onEvent(e) }, at))
    })
    timers.push(window.setTimeout(() => { if (!stopped) onDone() }, at + 200))
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err))
  }
  return () => { stopped = true; timers.forEach((t) => window.clearTimeout(t)) }
}

async function failureText(res: Response, what: string) {
  const body = await res.text().catch(() => "")
  let detail = body
  try { detail = (JSON.parse(body) as { error?: string }).error ?? body } catch { /* plain text body */ }
  return `${what} returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`
}

/** Follows /api/runs/:id/events. The engine replays stored events first, so finished runs play back too. */
export function followRun(runId: string, onEvent: (e: QuorumEvent) => void, onDone: () => void, onError: (m: string) => void): StopFn {
  const es = new EventSource(asset(`api/runs/${encodeURIComponent(runId)}/events`))
  let finished = false
  es.onmessage = (m) => {
    try { onEvent(JSON.parse(m.data) as QuorumEvent) } catch { onError(`Unreadable event from the server: ${String(m.data).slice(0, 120)}`) }
  }
  es.addEventListener("done", () => { finished = true; es.close(); onDone() })
  es.onerror = () => {
    if (finished) return
    if (es.readyState === EventSource.CLOSED) onError("The event stream closed before the run finished")
    // otherwise the browser is reconnecting; duplicate seqs are dropped by applyEvent
  }
  return () => { finished = true; es.close() }
}

/** Starts a live run: POST /api/runs, then follow the SSE stream until the server sends event: done. */
export async function startLive(request: string, onRun: (runId: string) => void, onEvent: (e: QuorumEvent) => void, onDone: () => void, onError: (m: string) => void): Promise<StopFn> {
  let res: Response
  try {
    res = await fetch(asset("api/runs"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request, mode: "live" }) })
  } catch (err) {
    onError(`Could not reach the Quorum server: ${err instanceof Error ? err.message : String(err)}`)
    return () => {}
  }
  if (!res.ok) { onError(await failureText(res, "POST /api/runs")); return () => {} }
  const { runId } = (await res.json()) as { runId?: string }
  if (!runId) { onError("POST /api/runs did not return a runId"); return () => {} }
  onRun(runId)
  return followRun(runId, onEvent, onDone, onError)
}

export type RecipeSummary = { id: string; site: string; intent: string; version: number; endpoint: string; health: { ok: boolean; note?: string | null } | null }

export async function listRecipes(): Promise<{ recipes: RecipeSummary[] } | { problem: string }> {
  try {
    const res = await fetch(asset("api/recipes"))
    if (!res.ok) return { problem: await failureText(res, "GET /api/recipes") }
    const body = (await res.json()) as unknown
    return { recipes: Array.isArray(body) ? (body as RecipeSummary[]) : [] }
  } catch (err) {
    return { problem: `Could not reach the Quorum server: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export async function runRecipe(id: string, onRun: (runId: string) => void, onEvent: (e: QuorumEvent) => void, onDone: () => void, onError: (m: string) => void): Promise<StopFn> {
  let res: Response
  try {
    res = await fetch(asset(`api/recipes/${encodeURIComponent(id)}/run`), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  } catch (err) {
    onError(`Could not reach the Quorum server: ${err instanceof Error ? err.message : String(err)}`)
    return () => {}
  }
  if (!res.ok) { onError(await failureText(res, `POST /api/recipes/${id}/run`)); return () => {} }
  const { runId } = (await res.json()) as { runId?: string }
  if (!runId) { onError("The recipe run did not return a runId"); return () => {} }
  onRun(runId)
  return followRun(runId, onEvent, onDone, onError)
}
