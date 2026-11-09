// runRecipe(id, ctx, emit): 레시피를 부르고, 깨지면 새 경로를 찾아 검증된 것만 새 버전으로 저장하고, 이전 버전과 깨진 이유를 gbrain 에 남겨요.
// 모든 단계는 계약(src/contract.ts)의 QuorumEvent 로 내보내요. 실패는 조용히 넘기지 않고 error 이벤트로 드러내요.
import type { EventType, QuorumEvent } from "../contract"
import { callRecipe } from "./call"
import { discover, type Attempt } from "./discover"
import { RecipeError } from "./errors"
import { endpointsFromNote, MemoryError, noteSlug, repairNote, sameRepair, type Memory } from "./memory"
import { endpointOf, originOf, stripSecretParams } from "./spec"
import { asideRunner } from "./aside"
import { GbrainMemory } from "./memory"
import { defaultStore, RecipeStore, type RecipeSummary } from "./store"
import type { AsideRunner } from "./aside"
import type { Candidate, Emit, EngineEmit, EventEmit, RecipeCtx, RecipeDef, RunOutcome } from "./types"

type Data = Record<string, unknown>

/** 엔진 Emit(인자 3개 이상)이면 (type, actor, text, data) 로, 아니면 계약 QuorumEvent 로 내보내요 */
export function recipeEmitter(ctx: { runId?: string; seqStart?: number; mode?: "live" | "replay" }, emit: Emit, id = "recipe") {
  let seq = ctx.seqStart ?? 1
  const runId = ctx.runId || `recipe-${id}-${Date.now().toString(36)}`
  const engine = emit.length >= 3
  const send = (type: EventType, actor: string, text: string, data?: Data) => {
    if (engine) { seq++; (emit as EngineEmit)(type, actor, text, data); return }
    const e: QuorumEvent = { runId, seq: seq++, at: new Date().toISOString(), mode: ctx.mode ?? "live", type, actor, text, ...(data ? { data } : {}) }
    ;(emit as EventEmit)(e)
  }
  return { send, next: () => seq }
}

const countOf = (r: unknown) => (Array.isArray(r) ? r.length : r && typeof r === "object" ? 1 : 0)

type Resolved = RecipeCtx & { vars: Record<string, string>; store: RecipeStore; memory: Memory | null; aside: AsideRunner | null }

const strings = (o: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (o && typeof o === "object" && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) if (typeof v === "string" && /^[A-Za-z0-9_]{1,40}$/.test(k)) out[k] = v.slice(0, 500)
  return out
}

/**
 * ctx 정리. 엔진은 POST 본문을 그대로 넘기니 바깥 값으로 봐요: vars 는 문자열만(없으면 최상위 문자열 값),
 * store·memory·fetch·aside 는 진짜 객체·함수일 때만 쓰고 아니면 기본값(저장소, GbrainMemory, QUORUM_ASIDE=1 일 때 asideRunner).
 */
function resolveCtx(ctx: RecipeCtx): Resolved {
  const raw = (ctx || {}) as Record<string, unknown>
  const memory = raw.memory === null ? null : raw.memory && typeof (raw.memory as Memory).put === "function" && typeof (raw.memory as Memory).search === "function" ? (raw.memory as Memory) : new GbrainMemory()
  return {
    vars: raw.vars !== undefined ? strings(raw.vars) : strings(raw),
    runId: typeof raw.runId === "string" ? raw.runId : undefined,
    mode: raw.mode === "replay" ? "replay" : "live",
    seqStart: typeof raw.seqStart === "number" ? raw.seqStart : undefined,
    timeoutMs: typeof raw.timeoutMs === "number" && raw.timeoutMs > 0 ? Math.min(raw.timeoutMs, 60_000) : undefined,
    fetch: typeof raw.fetch === "function" ? (raw.fetch as typeof fetch) : undefined,
    store: raw.store instanceof RecipeStore ? raw.store : defaultStore(),
    memory,
    aside: typeof raw.aside === "function" ? (raw.aside as AsideRunner) : raw.aside === undefined && process.env.QUORUM_ASIDE === "1" ? asideRunner() : null,
  }
}

/** def.derive: 없는 값을 다른 레시피 결과에서 채워요(같은 이벤트 흐름 안에서). 깊이 2까지 */
async function deriveVars(def: RecipeDef, ctx: Resolved, ev: ReturnType<typeof recipeEmitter>, depth: number): Promise<Resolved> {
  const vars = { ...ctx.vars }
  for (const [name, d] of Object.entries(def.derive || {})) {
    if (vars[name] || depth >= 2) continue
    const out = await run(d.recipe, ctx, ev, depth + 1)
    const v = out.ok && out.result && typeof out.result === "object" ? (out.result as Record<string, unknown>)[d.field] : undefined
    if (typeof v === "string" && v) vars[name] = v
  }
  return { ...ctx, vars }
}

/** GET /api/recipes: 레시피 목록과 현재 버전·상태 */
export function listRecipes(store: RecipeStore = defaultStore()): RecipeSummary[] {
  return store.list()
}

export async function runRecipe(id: string, ctx: RecipeCtx, emit: Emit): Promise<RunOutcome> {
  const c = resolveCtx(ctx)
  const ev = recipeEmitter(c, emit, id)
  try { return await run(id, c, ev, 0) }
  catch (e) {
    // 예상하지 못한 오류(DB·코드 오류)도 조용히 던지지 않고 이벤트로 남겨요
    const msg = String((e as Error)?.message || e)
    ev.send("error", `recipe:${id}`, `레시피 실행 중 오류: ${msg.slice(0, 200)}`, { recipeId: id, reason: msg })
    return { ok: false, version: 0, endpoint: "", reason: msg, nextSeq: ev.next() }
  }
}

/** gbrain 에서 이 레시피의 지난 수리 기록을 찾아 recall 이벤트로 보여 주고, 기록된 새 경로를 후보로 돌려줘요 */
async function recall(id: string, def: RecipeDef, ctx: Resolved, ev: ReturnType<typeof recipeEmitter>): Promise<Candidate[]> {
  if (!ctx.memory) return []
  try {
    const hits = (await ctx.memory.search(`recipes/${id}`, 5)).filter((h) => h.slug.startsWith(`recipes/${id}-v`))
    ev.send("recall", "gbrain", hits.length ? `지난 수리 기록 ${hits.length}개를 찾았어요` : "지난 수리 기록이 없어요",
      { recipeId: id, version: def.version, endpoint: endpointOf(def.request), hits: hits.map((h) => ({ id: h.slug, summary: h.snippet.split("\n")[0].slice(0, 120), decision: "repair", score: h.score })) })
    // 기록은 바깥 자료라, 레시피에 이미 적힌 호스트로 가는 경로만 써요(쿠키 머리글이 다른 곳으로 새지 않게)
    // 출처(scheme+host+port) 기준: http:// 로 바꾼 기록이 쿠키를 받지 못하게
    const hostOf = originOf
    const declared = [def.request, ...(def.discover.http?.candidates || []).map((c) => c.request)]
    const allowed = new Set(declared.map((q) => hostOf(q.url)).filter(Boolean))
    // 머리글(쿠키)은 같은 호스트로 선언된 요청의 것만 붙여요
    const headersFor = (url: string) => declared.find((q) => q.headers && hostOf(q.url) === hostOf(url))?.headers
    const seen = new Set<string>()
    const out: Candidate[] = []
    for (const h of hits) for (const found of endpointsFromNote(h.snippet)) {
      // 기록 속 비밀 질의값은 저장소로 옮기지 않아요(후보는 이 URL 로 다시 검증돼요)
      const e = { ...found, url: stripSecretParams(found.url) }
      const key = `${e.method} ${e.url}`
      if (seen.has(key) || !allowed.has(hostOf(e.url))) continue
      seen.add(key)
      const headers = headersFor(e.url)
      out.push({ request: { method: e.method, url: e.url, ...(headers ? { headers } : {}) }, note: "gbrain" })
    }
    return out
  } catch (e) {
    ev.send("error", "gbrain", `지난 수리 기록을 찾지 못했어요: ${String((e as Error).message).slice(0, 200)}`, { recipeId: id, version: def.version, endpoint: endpointOf(def.request), reason: String((e as Error).message) })
    return []
  }
}

async function run(id: string, ctx: Resolved, ev: ReturnType<typeof recipeEmitter>, depth: number): Promise<RunOutcome> {
  const actor = `recipe:${id}`
  let def: RecipeDef
  try { def = ctx.store.current(id) }
  catch (e) {
    ev.send("error", actor, `레시피를 열지 못했어요: ${(e as Error).message}`, { recipeId: id, reason: (e as Error).message })
    return { ok: false, version: 0, endpoint: "", reason: (e as Error).message, nextSeq: ev.next() }
  }
  if (def.derive) ctx = await deriveVars(def, ctx, ev, depth)
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
  const out = await discover(def, ctx, onAttempt, await recall(id, def, ctx, ev))
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
    const note = repairNote({ recipeId: id, site: def.site, intent: def.intent, fromVersion: def.version, toVersion: next.version, previousEndpoint, endpoint: endpointOf(next.request), reason, at: new Date().toISOString() })
    const where = { recipeId: id, version: next.version, endpoint: endpointOf(next.request) }
    try {
      const saved = await saveNote(ctx.memory, slug, note, `recipe ${id} repaired v${def.version}->v${next.version}`, ctx.runId || Date.now().toString(36))
      ev.send("memory.saved", "gbrain", saved.duplicate ? `같은 수리 기록이 이미 있어요: ${saved.slug}` : `수리 기록을 남겼어요: ${saved.slug}`, { ...where, slug: saved.slug, duplicate: saved.duplicate })
    } catch (e) {
      const msg = (e as Error).message
      ev.send("error", "gbrain", `수리 기록을 남기지 못했어요: ${msg.slice(0, 200)}`, { ...where, reason: msg })
    }
  }
  return { ok: true, version: next.version, endpoint: endpointOf(next.request), result: out.found.result, repaired: true, reason, nextSeq: ev.next() }
}

/** 다른 기기가 같은 버전 번호로 먼저 기록했으면(슬러그 충돌) 같은 수리인지 보고, 같으면 중복으로, 다르면 실행 id 를 붙여 따로 남겨요 */
async function saveNote(memory: Memory, slug: string, note: string, reason: string, runId: string): Promise<{ slug: string; duplicate: boolean }> {
  try {
    await memory.put(slug, note, reason)
    return { slug, duplicate: false }
  } catch (e) {
    if (!(e instanceof MemoryError && e.conflict && memory.get)) throw e
    const existing = await memory.get(slug)
    if (existing !== null && sameRepair(existing, note)) return { slug, duplicate: true }
    const alt = `${slug}-${runId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 16) || Date.now().toString(36)}`
    await memory.put(alt, note, reason)
    return { slug: alt, duplicate: false }
  }
}
