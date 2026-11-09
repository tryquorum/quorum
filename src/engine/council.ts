// 의회 한 번: run.start → recall → proposal → critique → verdict → execute → memory.saved → board.posted → run.end
// 바깥 도구(Aside, codex, gbrain, 방향판)는 모두 deps 로 받아서, 시험은 가짜 deps 로 돌려요(aside exec 는 유료라 시험에서 부르지 않아요).
import type { EventType, Role } from "../contract"
import { DEFAULT_REUSE_THRESHOLD, dedupProposals, pickReuse } from "./dedup"
import { decide, RULES_VERSION } from "./rules"
import { CRITICS, PROPOSERS, critiquePrompt, parseBotJson, proposalPrompt, readCritiques, readProposals, type BoardHit, type CritiqueDraft, type ProposalDraft } from "./roles"
import type { MemoryRecord, Recalled, StoredDecision } from "../executors/gbrain"

export type Proposal = ProposalDraft & { proposalId: string; alsoBy: string[] }
export type ExecOutcome = { summary: string; data?: Record<string, unknown> }
export type Executor = (p: Proposal, ctx: { runId: string; request: string }) => Promise<ExecOutcome>
export type PostResult = { posted: false; reason: string } | { posted: true; ref: string }

export type CouncilDeps = {
  /** 봇 한 번 호출. actor 는 "bot:scout" 같은 이름, 답은 원문 텍스트 */
  ask: (actor: string, prompt: string) => Promise<string>
  recall?: (request: string) => Promise<Recalled[]>
  remember?: (rec: MemoryRecord) => Promise<string>
  boardContext?: (request: string) => Promise<BoardHit[]>
  /** 방향판 쓰기. QUORUM_BOARD_WRITE=1 일 때만 넣어요 */
  boardPost?: (input: { title: string; body: string; tags?: string[] }) => Promise<PostResult>
  boardDecide?: (input: { title: string; body: string }) => Promise<PostResult>
  executors: Partial<Record<"aside" | "codex" | "board", Executor>>
  proposers?: number
  reuseThreshold?: number
  now?: () => number
}

export type Emit = (type: EventType, actor: string, text: string, data?: Record<string, unknown>) => void
export type CouncilResult = { status: "done" | "error"; decisions: StoredDecision[]; reusedFrom?: string }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const kindOf = (e: unknown) => (e && typeof e === "object" && "kind" in e ? String((e as { kind: unknown }).kind) : undefined)
const firstLine = (s: string, n = 140) => (s.split("\n").find((l) => l.trim()) || "").trim().slice(0, n)

function tallyText(d: StoredDecision[]) {
  const n = (k: string) => d.filter((x) => x.decision === k).length
  return "통과 " + n("pass") + " · 보류 " + n("hold") + " · 거절 " + n("reject")
}

export async function runCouncil(runId: string, request: string, deps: CouncilDeps, emit: Emit): Promise<CouncilResult> {
  const now = deps.now || Date.now
  const t0 = now()
  emit("run.start", "council", "요청: " + firstLine(request, 120), { request })

  // 1) 기억과 방향판 맥락
  let candidates: Recalled[] = []
  if (deps.recall) {
    try { candidates = await deps.recall(request) } catch (e) { emit("error", "gbrain", "기억을 찾지 못했어요: " + msg(e), { stage: "recall", errorKind: kindOf(e) }) }
  }
  let board: BoardHit[] = []
  if (deps.boardContext) {
    try { board = await deps.boardContext(request) } catch (e) { emit("error", "board", "방향판을 읽지 못했어요: " + msg(e), { stage: "recall" }) }
  }
  const threshold = deps.reuseThreshold ?? DEFAULT_REUSE_THRESHOLD
  // 다른 규칙 버전으로 내린 판정은 재사용하지 않아요(규칙을 고친 뒤 옛 판정이 그대로 되풀이되지 않게)
  const current = candidates.filter((c) => c.rulesVersion === RULES_VERSION)
  const stale = candidates.length - current.length
  const { best, hits } = pickReuse(request, current, threshold)
  emit("recall", "gbrain", (hits.length ? "비슷한 판정 " + hits.length + "개 · 가장 가까운 것 " + Math.round(hits[0].score * 100) + "%" + (best ? " → 재사용" : "") : "비슷한 판정이 없어요") + (stale ? " (옛 규칙 판정 " + stale + "개는 건너뜀)" : ""), {
    hits: hits.slice(0, 5).map((h) => ({ id: h.id, summary: firstLine(h.request, 120), decision: tallyText(h.verdicts), score: Math.round(h.score * 1000) / 1000 })),
    threshold,
    rulesVersion: RULES_VERSION,
    stale,
    board: board.slice(0, 5),
  })

  let proposals: Proposal[] = []
  let decisions: StoredDecision[] = []
  const reusedFrom = best?.id

  if (best) {
    // 2a) 충분히 가까운 판정이 있으면 의회를 열지 않아요
    proposals = best.verdicts.map((v) => ({ proposalId: v.proposalId, title: v.title, executor: v.executor as Proposal["executor"], why: "기억에서 가져온 제안", task: v.task, risk: [], actor: "gbrain", alsoBy: [] }))
    for (const p of proposals) emit("proposal", "gbrain", p.title, { proposalId: p.proposalId, title: p.title, executor: p.executor, why: p.why, reused: true })
    decisions = best.verdicts.map((v) => ({ ...v }))
    for (const d of decisions) emit("verdict", "council", d.decision + " · " + d.title, { proposalId: d.proposalId, decision: d.decision, reason: "기억한 판정 재사용: " + d.reason, reusedFrom: best.id })
  } else {
    // 2b) 제안 봇들 병렬
    const personas = PROPOSERS.slice(0, Math.max(1, Math.min(PROPOSERS.length, deps.proposers ?? 3)))
    const drafts: ProposalDraft[] = []
    const res = await Promise.allSettled(personas.map((p) => deps.ask("bot:" + p.id, proposalPrompt(p, request, board)).then((t) => readProposals(parseBotJson(t), "bot:" + p.id))))
    res.forEach((r, i) => {
      if (r.status === "fulfilled") drafts.push(...r.value)
      else emit("error", "bot:" + personas[i].id, "제안 봇이 실패했어요: " + msg(r.reason), { stage: "proposal", errorKind: kindOf(r.reason) })
    })
    proposals = dedupProposals(drafts).slice(0, 5).map((p, i) => ({ ...p, proposalId: "p" + (i + 1) }))
    for (const p of proposals) emit("proposal", p.actor, p.title, { proposalId: p.proposalId, title: p.title, executor: p.executor, why: p.why, task: p.task, risk: p.risk, alsoBy: p.alsoBy })
    if (!proposals.length) {
      emit("run.end", "council", "제안이 하나도 없어 의회를 닫아요", { status: "error", durationMs: now() - t0 })
      return { status: "error", decisions: [] }
    }

    // 3) gstack 역할 반박 병렬
    const ids = new Set(proposals.map((p) => p.proposalId))
    const view = proposals.map(({ proposalId, title, executor, why, task, risk }) => ({ proposalId, title, executor, why, task, risk }))
    const critiques: CritiqueDraft[] = []
    const cr = await Promise.allSettled(CRITICS.map((c) => deps.ask("bot:" + c.role, critiquePrompt(c, request, view)).then((t) => readCritiques(parseBotJson(t), c.role, ids))))
    cr.forEach((r, i) => {
      const role: Role = CRITICS[i].role
      if (r.status === "rejected") return emit("error", "bot:" + role, "반박 봇이 실패했어요: " + msg(r.reason), { stage: "critique", errorKind: kindOf(r.reason) })
      for (const c of r.value) {
        critiques.push(c)
        emit("critique", "bot:" + role, c.stance + " · " + c.proposalId + " · " + c.reason, { proposalId: c.proposalId, role, stance: c.stance, reason: c.reason })
      }
    })

    // 4) 판정
    for (const p of proposals) {
      const ruling = decide(p, critiques.filter((c) => c.proposalId === p.proposalId))
      decisions.push({ proposalId: p.proposalId, title: p.title, executor: p.executor, task: p.task, decision: ruling.decision, reason: ruling.reason })
      emit("verdict", "council", ruling.decision + " · " + p.title, { proposalId: p.proposalId, decision: ruling.decision, reason: ruling.reason })
    }
  }

  // 5) 통과한 일만 실행
  const runnable = decisions.filter((d) => d.decision === "pass" && d.executor !== "none")
  await Promise.all(runnable.map(async (d) => {
    const p = proposals.find((x) => x.proposalId === d.proposalId)
    const ex = deps.executors[d.executor as "aside" | "codex" | "board"]
    if (!p || !ex) return emit("error", d.executor, "실행기 " + d.executor + " 를 쓸 수 없어요", { stage: "execute", proposalId: d.proposalId })
    emit("execute.start", d.executor, d.title, { proposalId: d.proposalId, executor: d.executor, task: d.task })
    try {
      const out = await ex(p, { runId, request })
      emit("execute.result", d.executor, firstLine(out.summary) || "끝났어요", { proposalId: d.proposalId, executor: d.executor, ok: true, summary: out.summary, ...(out.data || {}) })
    } catch (e) {
      emit("execute.result", d.executor, "실패: " + firstLine(msg(e)), { proposalId: d.proposalId, executor: d.executor, ok: false, error: msg(e), errorKind: kindOf(e) })
      emit("error", d.executor, msg(e), { stage: "execute", proposalId: d.proposalId, errorKind: kindOf(e) })
    }
  }))

  // 6) 기억
  if (deps.remember && decisions.length) {
    try {
      const id = await deps.remember({ quorumVerdict: 1, rulesVersion: RULES_VERSION, runId, request, at: new Date(now()).toISOString(), ...(reusedFrom ? { reusedFrom } : {}), verdicts: decisions })
      emit("memory.saved", "gbrain", "판정을 기억했어요", { id, ...(reusedFrom ? { reusedFrom } : {}) })
    } catch (e) {
      emit("error", "gbrain", "판정을 기억하지 못했어요: " + msg(e), { stage: "memory", errorKind: kindOf(e) })
    }
  }

  // 7) 방향판: 결과 문서 + 보류는 결정 칸 사건으로 (쓰기 플래그가 있을 때만 deps 가 들어와요)
  let boardNote = "skipped: QUORUM_BOARD_WRITE is not 1"
  if (deps.boardPost) {
    const body = ["요청: " + request, "", ...decisions.map((d) => "- **" + d.decision + "** " + d.title + " (" + d.executor + ") — " + d.reason), "", "Quorum run " + runId].join("\n")
    try {
      const r = await deps.boardPost({ title: "Quorum: " + firstLine(request, 60), body, tags: ["quorum"] })
      if (r.posted) { boardNote = "posted"; emit("board.posted", "board", "방향판에 결과를 올렸어요", { ref: r.ref, kind: "doc" }) } else boardNote = "skipped: " + r.reason
    } catch (e) {
      boardNote = "error"
      emit("error", "board", "방향판에 올리지 못했어요: " + msg(e), { stage: "board" })
    }
  }
  if (deps.boardDecide) {
    for (const d of decisions.filter((x) => x.decision === "hold")) {
      try {
        const r = await deps.boardDecide({ title: "Quorum 승인 대기: " + d.title, body: "요청: " + request + "\n이유: " + d.reason + "\n실행기: " + d.executor + "\n지시: " + d.task })
        if (r.posted) emit("board.posted", "board", "승인 대기로 올렸어요: " + d.title, { ref: r.ref, kind: "decide", proposalId: d.proposalId })
      } catch (e) {
        emit("error", "board", "승인 대기를 올리지 못했어요: " + msg(e), { stage: "board", proposalId: d.proposalId })
      }
    }
  }

  emit("run.end", "council", tallyText(decisions), {
    status: "done",
    pass: decisions.filter((d) => d.decision === "pass").length,
    hold: decisions.filter((d) => d.decision === "hold").length,
    reject: decisions.filter((d) => d.decision === "reject").length,
    ...(reusedFrom ? { reusedFrom } : {}),
    board: boardNote,
    durationMs: now() - t0,
  })
  return { status: "done", decisions, ...(reusedFrom ? { reusedFrom } : {}) }
}

export const DEFAULT_THRESHOLD = DEFAULT_REUSE_THRESHOLD
