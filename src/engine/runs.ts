// 실행 관리: 이벤트에 번호를 매겨 저장하고(.quorum/quorum.db), 구독자(SSE)에게 흘려 보내고, 녹화를 다시 틀어요.
// 서버 재시작 때 "하는 중"으로 남은 실행을 끊긴 것으로 닫는 처리는 board/apps/server/server/runs.ts initRuns 에서 가져왔어요.
import type { EventType, QuorumEvent } from "../contract"
import { runCouncil, type CouncilDeps, type Emit } from "./council"
import type { Store } from "./store"

type Listener = (e: QuorumEvent | null) => void
export type RunManagerOptions = { replaySpeed?: number; maxGapMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number }

export class RunManager {
  private subs = new Map<string, Set<Listener>>()
  private live = new Set<string>()
  private seqs = new Map<string, number>()

  constructor(private store: Store, private makeDeps: (runId: string) => CouncilDeps, private opts: RunManagerOptions = {}) {}

  newId(): string {
    return "r" + (this.opts.now ?? Date.now)().toString(36) + crypto.randomUUID().replace(/-/g, "").slice(0, 6)
  }

  isLive(runId: string) {
    return this.live.has(runId)
  }

  subscribe(runId: string, fn: Listener): () => void {
    let set = this.subs.get(runId)
    if (!set) { set = new Set(); this.subs.set(runId, set) }
    set.add(fn)
    return () => { set?.delete(fn) }
  }

  private emitter(runId: string, mode: "live" | "replay"): Emit {
    return (type: EventType, actor: string, text: string, data?: Record<string, unknown>) => {
      const seq = this.seqs.get(runId) ?? 0
      this.seqs.set(runId, seq + 1)
      const e: QuorumEvent = { runId, seq, at: new Date((this.opts.now ?? Date.now)()).toISOString(), mode, type, actor, text, ...(data ? { data } : {}) }
      this.store.appendEvent(e)
      for (const fn of this.subs.get(runId) || []) fn(e)
    }
  }

  private finish(runId: string, status: "done" | "error") {
    this.store.finishRun(runId, status)
    this.live.delete(runId)
    this.seqs.delete(runId)
    for (const fn of this.subs.get(runId) || []) fn(null)
    this.subs.delete(runId)
  }

  /** 실제 의회를 열어요. 끝을 기다리지 않고 runId 를 돌려줘요. done 은 시험이 기다릴 때 써요 */
  start(request: string): { runId: string; done: Promise<void> } {
    const runId = this.newId()
    this.store.createRun({ runId, request, mode: "live", startedAt: new Date((this.opts.now ?? Date.now)()).toISOString(), kind: "council" })
    this.live.add(runId)
    const emit = this.emitter(runId, "live")
    const done = (async () => {
      try {
        const r = await runCouncil(runId, request, this.makeDeps(runId), emit)
        this.finish(runId, r.status)
      } catch (e) {
        emit("error", "council", "의회가 멈췄어요: " + (e instanceof Error ? e.message : String(e)), { stage: "council" })
        emit("run.end", "council", "오류로 끝났어요", { status: "error" })
        this.finish(runId, "error")
      }
    })()
    return { runId, done }
  }

  /** 의회가 아닌 실행(레시피)도 같은 저장·SSE 흐름에 태워요 */
  startCustom(request: string, body: (emit: Emit) => Promise<"done" | "error">): { runId: string; done: Promise<void> } {
    const runId = this.newId()
    this.store.createRun({ runId, request, mode: "live", startedAt: new Date((this.opts.now ?? Date.now)()).toISOString(), kind: "custom" })
    this.live.add(runId)
    const emit = this.emitter(runId, "live")
    const done = (async () => {
      try {
        this.finish(runId, await body(emit))
      } catch (e) {
        emit("error", "council", e instanceof Error ? e.message : String(e), { stage: "custom" })
        emit("run.end", "council", "오류로 끝났어요", { status: "error" })
        this.finish(runId, "error")
      }
    })()
    return { runId, done }
  }

  /** 녹화된 실행을 다시 틀어요. 모든 이벤트는 mode:"replay" 예요(가짜 성공 금지) */
  replay(replayId: string): { runId: string; done: Promise<void> } | { error: string; status: number } {
    const src = this.store.getRun(replayId)
    if (!src) return { error: "replayId not found", status: 404 }
    if (this.live.has(replayId) || src.status === "running") return { error: "그 실행은 아직 끝나지 않았어요", status: 409 }
    const events = this.store.getEvents(replayId)
    if (!events.length) return { error: "녹화된 이벤트가 없어요", status: 409 }
    const runId = this.newId()
    this.store.createRun({ runId, request: src.request, mode: "replay", startedAt: new Date((this.opts.now ?? Date.now)()).toISOString(), replayOf: replayId, kind: "replay" })
    this.live.add(runId)
    const emit = this.emitter(runId, "replay")
    const speed = this.opts.replaySpeed ?? Number(process.env.QUORUM_REPLAY_SPEED || 4)
    const maxGap = this.opts.maxGapMs ?? 1500
    const sleep = this.opts.sleep ?? ((ms: number) => Bun.sleep(ms))
    const done = (async () => {
      let prev = Date.parse(events[0].at)
      for (const e of events) {
        const t = Date.parse(e.at)
        const gap = Math.min(maxGap, Math.max(0, (t - prev) / speed))
        prev = t
        if (gap > 0) await sleep(gap)
        emit(e.type, e.actor, e.text, e.type === "run.start" ? { ...(e.data || {}), replayOf: replayId } : e.data)
      }
      this.finish(runId, src.status === "error" ? "error" : "done")
    })()
    return { runId, done }
  }
}
