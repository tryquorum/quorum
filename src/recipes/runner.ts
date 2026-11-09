// runRecipe(id, ctx, emit): 레시피를 부르고, 깨지면 새 경로를 찾아 검증된 것만 새 버전으로 저장하고, 이전 버전과 깨진 이유를 gbrain 에 남겨요.
// 모든 단계는 계약(src/contract.ts)의 QuorumEvent 로 내보내요. 실패는 조용히 넘기지 않고 error 이벤트로 드러내요.
import type { EventType, QuorumEvent } from "../contract"
import { callRecipe } from "./call"
import { discover, type Attempt } from "./discover"
import { RecipeError } from "./errors"
import { noteSlug, repairNote } from "./memory"
import { endpointOf } from "./spec"
import type { Emit, RecipeCtx, RecipeDef, RunOutcome } from "./types"

type Data = Record<string, unknown>

export function recipeEmitter(ctx: RecipeCtx, emit: Emit) {
  let seq = ctx.seqStart ?? 1
  const send = (type: EventType, actor: string, text: string, data?: Data) => {
    const e: QuorumEvent = { runId: ctx.runId, seq: seq++, at: new Date().toISOString(), mode: ctx.mode ?? "live", type, actor, text, ...(data ? { data } : {}) }
    emit(e)
  }
  return { send, next: () => seq }
}

const countOf = (r: unknown) => (Array.isArray(r) ? r.length : r && typeof r === "object" ? 1 : 0)

export async function runRecipe(id: string, ctx: RecipeCtx, emit: Emit): Promise<RunOutcome> {
  const ev = recipeEmitter(ctx, emit)
  const actor = `recipe:${id}`
  let def: RecipeDef
  try { def = ctx.store.current(id) }
  catch (e) {
    ev.send("error", actor, `레시피를 열지 못했어요: ${(e as Error).message}`, { recipeId: id, reason: (e as Error).message })
    return { ok: false, version: 0, endpoint: "", reason: (e as Error).message, nextSeq: ev.next() }
  }
  const base = (d: RecipeDef, extra: Data = {}) => ({ recipeId: id, version: d.version, endpoint: endpointOf(d.request), ...extra })
  ev.send("recipe.run", actor, `${def.intent} — v${def.version} 호출`, base(def))
  let broken: RecipeError
  try {
    const r = await callRecipe(def, ctx.vars, ctx.fetch, ctx.timeoutMs)
    ctx.store.heartbeat(id, true, `HTTP ${r.status} · ${countOf(r.result)}개`)
    ev.send("recipe.run", actor, `v${def.version} 정상 (HTTP ${r.status}, ${countOf(r.result)}개)`, base(def, { status: r.status, count: countOf(r.result) }))
    return { ok: true, version: def.version, endpoint: endpointOf(def.request), result: r.result, repaired: false, nextSeq: ev.next() }
  } catch (e) {
    if (!(e instanceof RecipeError)) throw e
    if (e.kind === "missing_var") {
      ev.send("error", actor, e.message, base(def, { reason: e.message }))
      return { ok: false, version: def.version, endpoint: endpointOf(def.request), reason: e.message, nextSeq: ev.next() }
    }
    broken = e
  }
  const reason = broken.message
  ev.send("recipe.broken", actor, `v${def.version} 깨짐: ${reason}`, base(def, { status: broken.status, reason, kind: broken.kind }))

  const onAttempt = (a: Attempt) =>
    ev.send("recipe.run", a.via === "aside" ? "aside" : actor, a.ok ? `후보 통과: ${a.endpoint}` : `후보 탈락: ${a.endpoint} — ${a.reason}`,
      { recipeId: id, version: def.version, endpoint: a.endpoint, status: a.status, reason: a.reason, phase: "discover", via: a.via, ok: a.ok })
  const out = await discover(def, ctx, onAttempt)
  if (out.asideError) ev.send("error", "aside", `Aside 로 새 경로를 찾지 못했어요: ${out.asideError}`, base(def, { reason: out.asideError }))
  if (!out.found) {
    const why = `검증을 통과한 새 경로가 없어요 (후보 ${out.attempts.length}개)`
    ctx.store.heartbeat(id, false, `${reason} · ${why}`)
    ev.send("error", actor, `${def.intent} 수리 실패: ${why}`, base(def, { reason: `${reason}; ${why}`, attempts: out.attempts }))
    return { ok: false, version: def.version, endpoint: endpointOf(def.request), reason, nextSeq: ev.next() }
  }

  const { version: _old, ...rest } = def
  const previousEndpoint = endpointOf(def.request)
  const next = ctx.store.saveRepair({ ...rest, request: out.found.candidate.request, parse: out.found.candidate.parse || def.parse }, reason, previousEndpoint)
  ctx.store.heartbeat(id, true, `v${def.version} → v${next.version} 고침`)
  ev.send("recipe.repaired", actor, `v${next.version}로 고쳤어요: ${endpointOf(next.request)} (${countOf(out.found.result)}개)`,
    base(next, { status: out.found.status, reason, previousEndpoint, previousVersion: def.version, via: out.found.via, count: countOf(out.found.result) }))

  const slug = noteSlug(id, next.version)
  if (!ctx.memory) {
    ev.send("error", "gbrain", "기억 저장소가 연결되지 않아 수리 기록을 남기지 못했어요", { recipeId: id, version: next.version, endpoint: endpointOf(next.request), reason: "memory disabled" })
  } else {
    try {
      await ctx.memory.put(slug, repairNote({ recipeId: id, site: def.site, intent: def.intent, fromVersion: def.version, toVersion: next.version, previousEndpoint, endpoint: endpointOf(next.request), reason, at: new Date().toISOString() }), `recipe ${id} repaired v${def.version}->v${next.version}`)
      ev.send("memory.saved", "gbrain", `수리 기록을 남겼어요: ${slug}`, { recipeId: id, version: next.version, endpoint: endpointOf(next.request), slug })
    } catch (e) {
      const msg = (e as Error).message
      ev.send("error", "gbrain", `수리 기록을 남기지 못했어요: ${msg.slice(0, 200)}`, { recipeId: id, version: next.version, endpoint: endpointOf(next.request), reason: msg })
    }
  }
  return { ok: true, version: next.version, endpoint: endpointOf(next.request), result: out.found.result, repaired: true, reason, nextSeq: ev.next() }
}
