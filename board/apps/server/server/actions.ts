// AI가 방향판을 직접 갱신하는 입구: POST /api/act { actions: [...] }
// AI 대화(aside exec)가 일을 하면서 할 일을 닫고, 고치고, 노트에 덧붙이고, 새 할 일을 만든다.
// 새 할 일은 반드시 노트(내용)와 같이 만들어야 한다. 노트 없는 할 일은 거절한다.
import type { Database } from "bun:sqlite"
import { writeAgentNote } from "./notes.ts"
import { DONE_RECENT_MS, findSameTodo, normTitle } from "./dedup.ts"
import { createDocsOps, createDocument } from "./docs/ops.ts"
import { DocsError, type MetaInput, type PropsInput } from "@direction-board/contracts/docs"
import { SAME_TITLE_MIN } from "@direction-board/contracts/text"
import type { CaptureEffectOp } from "@direction-board/contracts"
import { resolveRef } from "./works.ts"
import { markDocsChanged } from "./docs/index.ts"
import { withDocsTx } from "./docs/storage.ts"
import { inLineage, lineage, markTouched, recordEffect, type CaptureCtx } from "./capture.ts"
import { PERSONAL, resolveSpace, spaceOfRef } from "./spaces.ts"
import { spaceMoveProblem } from "./docs/scope.ts"
import { trimLog } from "./item-log.ts"
import { GOAL_SPACE_MISMATCH, goalSpaceOf } from "./goal-space.ts"

type U = { email: string; agent: boolean }
type Deps = {
  personalBoard: (owner: string) => { id: string; areas: { id: string; name: string }[] } | null
  /** 회사 판(파일럿). 있으면 워크스페이스 공간 일을 여기에 둬요 */
  companyBoard?: () => { id: string; areas: { id: string; name: string }[] } | null
  readItem: (bid: string, iid: string) => { data: Record<string, unknown> } | null
  /** space 를 주지 않으면 항목의 기존 공간을 지켜요 */
  putItem: (bid: string, iid: string, data: Record<string, unknown>, actor: string, space?: string) => void
  /** 사건 넣기(signals.ingest). 없으면 decide 를 못 한다. 문자열이면 거절 사유 */
  ingest?: (owner: string, raw: Record<string, unknown>) => unknown
}
type Action = Record<string, unknown>
type Result = { ok: boolean; do: string; ref?: string; error?: string; existing?: boolean; unchanged?: boolean }
type LogLine = { by: string; at: number; text: string }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })
const err = (status: number, message: string) => json({ error: message }, status)
const now = () => Date.now()
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "")
const WHEN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

export const ACT_GUIDE = (origin: string, target: string | null) => `[방향판 도구]
일을 하면서 방향판도 직접 갱신해. 이 맥 안에서만 열려 있어서 인증은 필요 없어. 여러 개를 한 번에 보내도 돼:
curl -s -X POST ${origin}/api/act -H 'content-type: application/json' --data-binary @act.json
act.json = {"actions":[ ... ]}
- 끝낸 일 닫기: {"do":"done","ref":"<ref>","why":"무엇을 해서 끝났는지 한 줄"}
- 할 일 고치기: {"do":"update","ref":"<ref>","title":"새 제목(선택)","remindAt":"YYYY-MM-DDTHH:MM(선택)","done":false}
- 노트에 덧붙이기: {"do":"note","ref":"<ref>","md":"마크다운"}
- 문서 찾기·읽기: 먼저 GET ${origin}/api/docs/search?q=핵심어 로 찾고, 읽을 때는 GET ${origin}/api/docs/<ref>?view=outline 다음 &view=section&section=제목 으로 필요한 부분만 읽어.
- 문서 만들기: {"do":"doc","title":"제목","md":"마크다운","tags":["태그"],"area":"영역","link":"<ref>"}
- 문서는 parent 로 계층을 가져요. 옮기기는 move, 하위 문서는 doc 에 parent 를 넣어요.
- 태그 고치기: {"do":"tag","ref":"<ref>","add":["태그"],"remove":["태그"]}
- 속성으로 거르고 고치기: GET ${origin}/api/docs/search?props=단계:eq:계약,금액:gte:1000000&sort=-prop:금액 로 거르고(값은 URL 인코딩, 키·타입은 GET ${origin}/api/docs/schema 의 props), 사용자 속성은 {"do":"props","ref":"<ref>","set":{"단계":"계약"},"types":{"단계":"select"},"remove":["옛키"]}, 기본 메타(제목·영역·상태·날짜)는 {"do":"meta","ref":"<ref>","title":"새 제목","area":"영역","status":"done","due":"YYYY-MM-DD"} 로 고쳐(사건·대화는 status 만, version 을 알면 expectedVersion 도).
- 새 할 일 만들기: {"do":"task","title":"내가 할 행동 한 줄(동사로 끝나게)","note":"## 상황\\n왜 생겼는지 1~2줄\\n\\n## 다음 할 일\\n- [ ] ...","remindAt":"(선택)","area":"(선택)","link":"<관련된 일 ref>","space":"(선택) personal 또는 회사 공간 id·이름"}
  space 를 빼면 link 한 일의 공간을 따르고, 없으면 개인이에요. 공간 목록: GET ${origin}/api/spaces. 옮기기는 update 에 "space".
  note 는 필수야. 내용 없는 할 일은 거절돼.
- 사용자가 골라야 하는 것: {"do":"decide","title":"질문 한 줄","body":"선택지·장단점·추천","link":"<관련 ref>"} 로 결정 칸에 올려(같은 질문은 같은 사건을 갱신).
  새 할 일을 만들기 전에 먼저 GET ${origin}/api/work/search?q=핵심어 로 이미 있는지 찾아. 같은 일이 있으면 만들지 말고 그 ref 에 note/update 해.
  제목이 같은 열린 할 일이 이미 있으면 서버가 새로 만들지 않고 그 할 일 노트에 덧붙인 뒤 existing:true 로 알려 줘.
${target ? `지금 이 일의 ref: ${target}\n` : ""}다른 일의 ref 는 GET ${origin}/api/work/search?q=검색어 로 찾아 (results[].ref).
규칙: 실제로 끝낸 것만 done. 내가 결정하거나 보내야 하는 건 닫지 말고 note 로 남겨. 확인 못 한 건 "확인 필요"라고 적어. 갱신했으면 마지막 답에 무엇을 바꿨는지 한 줄 적어.

`

function boardVisible(db: Database, owner: string, bid: string) {
  const b = db.query("SELECT kind, owner FROM boards WHERE id=? AND deleted=0").get(bid) as { kind: string; owner: string } | null
  return !!b && (b.kind === "company" || b.owner === owner)
}
function signalOf(db: Database, owner: string, ref: string) {
  return db.query("SELECT id, status FROM signals WHERE id=? AND owner=?").get(ref.slice(7), owner) as { id: string; status: string } | null
}
const pushLog = (prev: unknown, text: string): LogLine[] => trimLog([...(Array.isArray(prev) ? (prev as LogLine[]) : []), { by: "agent", at: now(), text }]) // 사람 기록은 지우지 않아요(item-log.ts)

/** 일 사이 연결. 같은 두 일이 이미 이어져 있으면 다시 넣지 않는다 */
function addLink(db: Database, owner: string, a: string, b: string, label: string) {
  if (!b || a === b) return
  const has = db.query("SELECT 1 FROM work_links WHERE owner=? AND ((a=? AND b=?) OR (a=? AND b=?))").get(owner, a, b, b, a)
  if (has) return
  db.query("INSERT INTO work_links(id,owner,a,b,label,by,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(crypto.randomUUID().slice(0, 12), owner, a, b, label || "관련", "agent", now())
  markDocsChanged(db, owner, [a, b])
}

/** 결정 칸 사건. 같은 질문(제목 정규화)은 같은 사건을 갱신하고, 이미 닫힌 같은 질문은 다시 열지 않는다 */
function decide(db: Database, deps: Deps, owner: string, a: Action): Result {
  const title = str(a.title, 200)
  if (!title) return { ok: false, do: "decide", error: "title required" }
  if (!deps.ingest) return { ok: false, do: "decide", error: "decide is not available here" }
  const key = normTitle(title)
  if (key.length < SAME_TITLE_MIN) return { ok: false, do: "decide", error: "질문이 너무 짧아요" }
  const link = str(a.link, 120)
  // 공간: 보낸 값 → 연결한 일의 공간 → 개인. 워크스페이스 질문은 ref 를 나눠 같은 질문이 개인과 회사에 따로 설 수 있어요
  const asked = resolveSpace(db, a.space)
  if (asked === null) return { ok: false, do: "decide", error: "unknown space: GET /api/spaces 로 확인해요" }
  const space = asked ?? (link ? spaceOfRef(db, owner, link) : null) ?? PERSONAL
  const sref = space === PERSONAL ? `decide:${key.slice(0, 120)}` : `decide:${space}:${key.slice(0, 120)}`
  const prev = db.query("SELECT id, status FROM signals WHERE owner=? AND ref=?").get(owner, sref) as { id: string; status: string } | null
  if (prev && prev.status !== "open") return { ok: false, do: "decide", ref: `signal:${prev.id}`, error: "이미 결정한 같은 질문이 있어요" }
  const s = deps.ingest(owner, { ref: sref, source: "aside", kind: "question", lane: "decide", reason: "AI가 정리하다 결정이 필요해요", title, body: str(a.body, 4000) || undefined, work: link || undefined, agent: "AI 정리", space })
  const id = s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string" ? (s as { id: string }).id : null
  if (!id) return { ok: false, do: "decide", error: typeof s === "string" ? s : "결정을 올리지 못했어요" }
  if (link && resolveRef(db, owner, link)) addLink(db, owner, `signal:${id}`, link, "결정")
  return { ok: true, do: "decide", ref: `signal:${id}`, ...(prev ? { existing: true } : {}) }
}

function apply(db: Database, deps: Deps, owner: string, a: Action, ctx?: CaptureCtx): Result {
  const kind = str(a.do, 20)
  const ref = str(a.ref, 120)
  const why = str(a.why, 300)

  if (kind === "decide") return decide(db, deps, owner, a)
  if (kind === "doc" || kind === "tag" || kind === "meta" || kind === "props" || kind === "move") {
    const ops = createDocsOps(db, { act: (o, actions) => runActions(db, o, actions, deps), items: { readItem: deps.readItem, putItem: deps.putItem } })
    try {
      if(kind === "move") {
        if(!ref || (a.parent!==null && typeof a.parent!=="string") || (a.before!==undefined && typeof a.before!=="string") || (a.after!==undefined && typeof a.after!=="string")) return {ok:false,do:kind,error:"invalid move fields"}
        ops.move(owner,{ref,parent:a.parent as string|null,before:a.before as string|undefined,after:a.after as string|undefined},"agent")
        return {ok:true,do:kind,ref}
      }
      if (kind === "meta" || kind === "props") {
        if (!ref) return { ok: false, do: kind, error: "ref required" }
        if (kind === "meta") ops.meta(owner, { ref, title: a.title, area: a.area, status: a.status, due: a.due, expectedVersion: a.expectedVersion } as MetaInput, "agent")
        else ops.props(owner, { ref, set: a.set, types: a.types, remove: a.remove, expectedVersion: a.expectedVersion } as PropsInput, "agent")
        return { ok: true, do: kind, ref }
      }
      if (kind === "doc") {
        const title = str(a.title, 200), md = typeof a.md === "string" ? a.md : ""
        if (!title || !md.trim()) return { ok: false, do: kind, error: "title and md required" }
        if ((a.tags !== undefined && (!Array.isArray(a.tags) || !a.tags.every(x => typeof x === "string"))) || (a.area !== undefined && typeof a.area !== "string") || (a.link !== undefined && typeof a.link !== "string") || (a.parent!==undefined && a.parent!==null && typeof a.parent!=="string")) return { ok: false, do: kind, error: "invalid document fields" }
        const created = createDocument(db, owner, {title, md, tags: a.tags as string[] | undefined, area: a.area as string | undefined, links: a.link ? [a.link as string] : undefined,...(a.parent!==undefined ? {parent:a.parent as string} : {})}, "agent", {mergeTitle: true})
        return {ok:true, do:kind, ref:created.ref, ...(created.existing ? {existing:true} : {})}
      }
      if (!ref) return {ok:false, do:kind, error:"ref required"}
      if ((a.add !== undefined && (!Array.isArray(a.add) || !a.add.every(x => typeof x === "string"))) || (a.remove !== undefined && (!Array.isArray(a.remove) || !a.remove.every(x => typeof x === "string")))) return {ok:false, do:kind, ref, error:"invalid tags"}
      ops.tag(owner,ref,{add:a.add as string[] | undefined,remove:a.remove as string[] | undefined},"agent")
      return {ok:true,do:kind,ref}
    } catch (e) {
      if (e instanceof DocsError) return {ok:false,do:kind,...(ref ? {ref} : {}),error:e.message}
      throw e
    }
  }

  if (kind === "task") {
    const title = str(a.title, 200)
    const note = str(a.note, 8000)
    if (!title) return { ok: false, do: kind, error: "title required" }
    if (note.length < 10) return { ok: false, do: kind, error: "note required: 새 할 일은 내용(## 상황 / ## 다음 할 일)과 같이 만들어야 해요" }
    if (a.tags !== undefined && (!Array.isArray(a.tags) || !a.tags.every((x) => typeof x === "string"))) return { ok: false, do: kind, error: "tags must be an array of strings" }
    const pb = deps.personalBoard(owner)
    if (!pb) return { ok: false, do: kind, error: "personal board not found" }
    // 회사 판이 있으면(파일럿) 워크스페이스 공간 일은 회사 판에 둬요. 없으면(개인 방향판) 개인 판에 공간만 달아요
    const cb = deps.companyBoard?.() ?? null
    const boards = cb ? [pb, cb] : [pb]
    const remindAt = str(a.remindAt, 16)
    const due = str(a.due, 10)
    const goal = a.type === "goal"
    const link = str(a.link, 120)
    const [, linkBid, linkIid] = link.split(":")
    const linkGoal = !goal && link.startsWith("item:") && boards.some((b) => b.id === linkBid) && deps.readItem(linkBid, linkIid)?.data?.type === "goal" ? { bid: linkBid, iid: linkIid } : null
    const askedGoal = !goal ? str(a.goalId, 40) : ""
    // 붙일 목표(goalId 는 개인 판 → 회사 판 순서로 찾고, link 는 그 판): 있으면 목표의 공간을 따라요(goal-space.ts, REST 항목 쓰기와 같은 규칙)
    const goalAt = askedGoal
      ? (boards.map((b) => ({ bid: b.id, iid: askedGoal, space: goalSpaceOf(db, b.id, askedGoal) })).find((g) => g.space) ?? null)
      : linkGoal ? { ...linkGoal, space: goalSpaceOf(db, linkGoal.bid, linkGoal.iid) } : null
    const linkTarget = link || (goalAt ? `item:${goalAt.bid}:${goalAt.iid}` : askedGoal ? `item:${pb.id}:${askedGoal}` : "")
    const runLink = ctx ? `run:${ctx.thread}` : ""
    // 공간: 목표의 공간(다른 공간을 보내면 거절) → 보낸 값 → 연결한 일(사건 등)의 공간 → 개인
    const asked = resolveSpace(db, a.space)
    if (asked === null) return { ok: false, do: kind, error: "unknown space: GET /api/spaces 로 확인해요" }
    if (goalAt?.space && asked !== undefined && asked !== goalAt.space) return { ok: false, do: kind, error: GOAL_SPACE_MISMATCH }
    const space = goalAt?.space ?? asked ?? (linkTarget ? spaceOfRef(db, owner, linkTarget) : null) ?? PERSONAL
    const tb = space !== PERSONAL && cb ? cb : pb
    // 목표 연결(goalId)은 같은 판 안에서만. 목표의 공간이 그 판에 올 수 없으면(파일럿 회사 판의 공간 없는 옛 개인 목표) 회사로 보내지 않고 거절
    if (goalAt?.space && goalAt.bid !== tb.id) return { ok: false, do: kind, error: `이 목표는 ${goalAt.space === PERSONAL ? "개인" : "회사"} 공간인데 할 일을 둘 판과 달라 붙일 수 없어요(목표의 공간을 물려받아요). 목표 없이 만들거나 목표의 공간을 고쳐 주세요` }
    const goalId = goalAt?.space ? goalAt.iid : askedGoal || (linkGoal && linkGoal.bid === tb.id ? linkGoal.iid : "")
    // 이미 있는 같은 일(같은 판·같은 공간 안에서만): 열린 건 그 일에 덧붙이고, 최근에 끝낸 건 다시 만들지 않는다
    const same = findSameTodo(db, tb.id, title, { doneWithinMs: DONE_RECENT_MS, space })
    if (same && !same.done) {
      const changed = writeAgentNote(db, owner, same.ref, note, "append")
      if (changed || goalId) {
        const prev = deps.readItem(tb.id, same.iid)?.data
        if (prev) deps.putItem(tb.id, same.iid, { ...prev, ...(goalId ? { goalId } : {}), log: pushLog(prev.log, why || "AI가 같은 할 일에 내용을 덧붙였어요") }, "agent")
      }
      addLink(db, owner, same.ref, linkTarget, str(a.label, 40) || (goalId ? "위해서" : "관련"))
      if (runLink) addLink(db, owner, same.ref, runLink, "AI 정리")
      return { ok: true, do: kind, ref: same.ref, existing: true, ...(changed ? {} : { unchanged: true }) }
    }
    if (same && same.done)
      return { ok: false, do: kind, ref: same.ref, error: "최근에 끝낸 같은 할 일이 있어요. 다시 해야 하면 이 ref 를 update done:false 로 다시 열어요" }
    const area = tb.areas.find((x) => x.name.toLowerCase() === str(a.area, 40).toLowerCase())
    const iid = "ai-" + crypto.randomUUID().slice(0, 10)
    deps.putItem(tb.id, iid, {
      type: goal ? "goal" : "todo", text: title, done: false, x: 0, y: 0, w: 240, h: 90, z: now(), placed: false, agent: true,
      ...(ctx ? { capture: ctx.run } : {}),
      ...(goal ? (DAY.test(due) ? { due } : {}) : WHEN.test(remindAt) ? { remindAt } : {}),
      ...(area ? { area: area.id } : {}),
      ...(goalId ? { goalId } : {}),
      log: pushLog([], why || "AI가 만든 할 일"),
    }, "agent", space)
    const newRef = `item:${tb.id}:${iid}`
    writeAgentNote(db, owner, newRef, note, "draft")
    addLink(db, owner, newRef, linkTarget, str(a.label, 40) || (goalId ? "위해서" : "관련"))
    if (runLink) addLink(db, owner, newRef, runLink, "AI 정리")
    const tags = [...((a.tags as string[] | undefined) || []).slice(0, 10), ...(ctx ? ["AI 추가"] : [])]
    // 태그는 그 일의 문서 범위에 붙어요(파일럿 회사 공간 일은 워크스페이스 범위, docs/scope.ts)
    if (tags.length) createDocsOps(db, { act: (o, actions) => runActions(db, o, actions, deps), items: { readItem: deps.readItem, putItem: deps.putItem } }).tag(owner, newRef, { add: tags }, "agent")
    return { ok: true, do: kind, ref: newRef }
  }

  if (!ref) return { ok: false, do: kind, error: "ref required" }

  if (kind === "note") {
    const md = str(a.md, 8000)
    if (!md) return { ok: false, do: kind, ref, error: "md required" }
    if (ref.startsWith("signal:") ? !signalOf(db, owner, ref) : ref.startsWith("item:") ? !boardVisible(db, owner, ref.split(":")[1]) : !((ref.startsWith("doc:") || ref.startsWith("run:")) && resolveRef(db, owner, ref)))
      return { ok: false, do: kind, ref, error: "work not found" }
    const changed = writeAgentNote(db, owner, ref, md, "append")
    return { ok: true, do: kind, ref, ...(changed ? {} : { unchanged: true }) }
  }

  if (kind !== "done" && kind !== "update") return { ok: false, do: kind, ref, error: "do must be task|done|update|note|decide|doc|tag|meta|props" }
  const close = kind === "done" || a.done === true
  const reopen = kind === "update" && a.done === false

  if (ref.startsWith("signal:")) {
    if (a.space !== undefined) return { ok: false, do: kind, ref, error: "사건의 공간은 바꿀 수 없어요" }
    const s = signalOf(db, owner, ref)
    if (!s) return { ok: false, do: kind, ref, error: "signal not found" }
    const ts = now()
    if (close) db.query("UPDATE signals SET status='resolved', lane='auto', reason=?, needs_ai=0, updated_at=?, resolved_at=? WHERE id=?").run("AI가 처리함", ts, ts, s.id)
    else if (reopen) db.query("UPDATE signals SET status='open', updated_at=?, resolved_at=NULL WHERE id=?").run(ts, s.id)
    if (why) writeAgentNote(db, owner, ref, `AI: ${why}`, "append")
    return { ok: true, do: kind, ref }
  }

  if (ref.startsWith("item:")) {
    const [, bid, iid] = ref.split(":")
    if (!boardVisible(db, owner, bid)) return { ok: false, do: kind, ref, error: "board not visible" }
    const prev = deps.readItem(bid, iid)?.data
    if (!prev) return { ok: false, do: kind, ref, error: "item not found" }
    const moveTo = resolveSpace(db, a.space)
    if (moveTo === null) return { ok: false, do: kind, ref, error: "unknown space: GET /api/spaces 로 확인해요" }
    // 파일럿 회사 판: 개인 공간 금지, 노트·태그·속성이 있는 일의 범위 이동 거절(docs/scope.ts)
    const bad = spaceMoveProblem(db, bid, iid, moveTo)
    if (bad) return { ok: false, do: kind, ref, error: bad.error }
    const title = str(a.title, 200)
    const remindAt = str(a.remindAt, 16)
    deps.putItem(bid, iid, {
      ...prev,
      ...(title ? { text: title } : {}),
      ...(WHEN.test(remindAt) ? { remindAt } : {}),
      ...(close ? { done: true } : reopen ? { done: false } : {}),
      log: pushLog(prev.log, why || (close ? "AI가 끝낸 걸로 표시했어요" : "AI가 고쳤어요")),
    }, "agent", moveTo)
    return { ok: true, do: kind, ref }
  }
  return { ok: false, do: kind, ref, error: "ref must start with signal: or item:" }
}

/** 실행 결과로 남길 종류. 바뀐 게 없으면 남기지 않는다 */
function effectOp(kind: string, r: Result): CaptureEffectOp | null {
  if (r.unchanged) return null
  if (kind === "task" || kind === "doc") return r.existing ? "merged" : "created"
  if (kind === "decide") return "decision"
  if (kind === "note") return "merged"
  return "updated"
}
class Rollback extends Error { constructor(readonly result: Result) { super("rollback") } }

/** AI 정리 실행에 묶인 액션 하나: 실행이 아직 도는지 다시 보고, 적용과 결과 기록을 한 트랜잭션으로. 실패면 남기지 않는다 */
function applyInRun(db: Database, deps: Deps, owner: string, a: Action, ctx: CaptureCtx): Result {
  const kind = str(a.do, 20)
  try {
    return withDocsTx(db, () => {
      const live = db.query("SELECT status FROM runs WHERE id=?").get(ctx.run) as { status: string } | null
      if (live?.status !== "running") throw new Rollback({ ok: false, do: kind, error: "이 AI 정리 실행은 끝났어요" })
      markTouched(db, owner, ctx.lineage)
      const r = apply(db, deps, owner, a, ctx)
      if (!r.ok) throw new Rollback(r)
      const op = effectOp(kind, r)
      // 계보 밖에서 이미 열려 있던 결정을 다시 쓴 것은 이 실행이 만든 게 아니라서 되돌리지 않는다
      if (op && r.ref) recordEffect(db, owner, ctx, r.ref, op, resolveRef(db, owner, r.ref)?.title || str(a.title, 200) || r.ref, kind === "decide" && !!r.existing && !inLineage(db, owner, ctx.lineage, r.ref))
      return r
    })
  } catch (e) {
    if (e instanceof Rollback) return e.result
    return { ok: false, do: kind, error: `기록하지 못해 되돌렸어요: ${String(e instanceof Error ? e.message : e).slice(0, 160)}` }
  }
}

export function runActions(db: Database, owner: string, actions: Action[], deps: Deps, ctx?: CaptureCtx): {results: Result[]} {
  return {results: actions.slice(0,30).map((a) => (a && typeof a === "object" && !Array.isArray(a) ? (ctx ? applyInRun(db, deps, owner, a, ctx) : apply(db, deps, owner, a)) : { ok: false, do: "?", error: "action must be an object" }))}
}

export async function actionsApi(db: Database, req: Request, parts: string[], u: U, loopback: boolean, deps: Deps): Promise<Response | null> {
  if (parts[1] !== "act" || parts.length !== 2 || req.method !== "POST") return null
  // AI 정리 실행에 묶기: 이 맥 안(로컬 리스너), 에이전트 토큰 아님, 같은 주인의 도는 capture 실행만
  const runId = new URL(req.url).searchParams.get("run")
  let ctx: CaptureCtx | undefined
  if (runId !== null) {
    if (u.agent) return err(403, "에이전트 토큰으로는 AI 정리 실행에 묶어 쓸 수 없어요")
    if (!loopback) return err(403, "AI 정리 실행에는 이 맥 안에서만 쓸 수 있어요")
    const run = db.query("SELECT id, owner, kind, status, thread FROM runs WHERE id=?").get(runId) as { id: string; owner: string; kind: string; status: string; thread: string | null } | null
    if (!run || run.owner !== u.email || run.kind !== "capture") return err(404, "AI 정리 실행을 찾을 수 없어요")
    if (run.status !== "running") return err(409, "이 AI 정리 실행은 끝났어요")
    ctx = { run: run.id, thread: run.thread || run.id, lineage: lineage(db, u.email, run.id) }
  }
  if (!loopback && !u.agent) return err(403, "actions are accepted only by the local server or the agent token")
  const body = (await req.json().catch(() => null)) as { actions?: unknown } | null
  const list = Array.isArray(body?.actions) ? (body.actions as Action[]).slice(0, 30) : []
  if (!list.length) return err(400, "actions[] required")
  const {results} = runActions(db, u.email, list, deps, ctx)
  return json({ results }, results.some((r) => r.ok) ? 200 : 400)
}
