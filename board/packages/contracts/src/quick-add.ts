// 빠른 추가: 한 줄 글을 할 일로 바꾸고, 공개 주소에서도 열린 경로(항목 PUT·노트 PUT·태그·속성)로 만든다.
// 화면과 떨어진 순수 함수라 웹(apps/web/src/lib/quick-add.test.ts)과 iOS 가 같은 규칙을 써요.
import { normTitle, SAME_TITLE_MIN } from "./text.ts"
import type { Item, SpaceId } from "./api.ts"
import type { PropType, PropValue } from "./docs.ts"

export type QuickArea = { id: string; name: string; color: string }
export type WhenParse = (t: string) => { at: string; title: string; spans: [number, number][] } | null
export type Parsed = { title: string; at: string | null; area: QuickArea | null; tags: string[] }
export type DraftProp = { key: string; type: PropType; value: string }
export type Draft = { boardId: string; kind: "todo" | "goal"; title: string; at: string | null; areaId: string | null; goalId?: string | null; tags: string[]; note: string; props: DraftProp[]; space?: SpaceId }
export type Step = "item" | "note" | "tags" | "props"
/**
 * 빠른 추가 한 번의 결과(판별 유니온, iOS PR #39 리뷰 15). 소비처는 kind 로 switch 하고 끝에 assertNever 를 둬요 — 새 kind 가 생기면 타입 오류.
 * 닫기·onCreated·초안 지우기·기록 지우기는 "done" 일 때만이에요.
 * - done: 모든 단계를 보냈어요(existed: 결과를 몰랐던 추가를 확인했더니 이미 다 저장돼 있었어요).
 * - differs: 이미 있는 항목이 사람 손으로 바뀌어 있어 덮지 않았어요. left 는 아직 안 보낸 첫 단계(없으면 null) — 보내기는 사람이 골라요.
 * - conflict: 그 단계(노트·속성)가 서버에서 이미 사람이 넣은 다른 값이라 덮지 않고 멈췄어요.
 * - failed: 그 단계에서 확실히 실패(앞 단계는 끝남). unknown: 그 단계의 결과를 몰라요. scope: 범위(서버·로그인)가 바뀌어 그 단계부터 보내지 않았어요.
 */
export type CreateResult =
  | { kind: "done"; ref: string; id: string; item: Item | null; existed?: true }
  | { kind: "differs"; ref: string; id: string; at: "item"; left: Step | null }
  | { kind: "conflict"; ref: string; id: string; at: Step }
  | { kind: "failed" | "unknown" | "scope"; ref: string | null; id: string; at: Step }
/** switch 의 끝: 처리하지 않은 kind 가 있으면 타입 오류(실행 중에 오면 던져요) */
export function assertNever(x: never): never {
  throw new Error("처리하지 않은 결과: " + JSON.stringify(x))
}
/** save 는 true(저장됨)·false(거절됨)·"unknown"(결과를 모름) */
export type CreateDeps = { save: (it: Item) => Promise<boolean | "unknown"> | void; call: Call; id: () => string; now: () => number }
/** 요청 하나. 웹은 lib/api.ts 의 api, iOS 는 api/work.ts 가 넘겨요 */
export type Call = <T>(path: string, init: { method: string; body?: string }) => Promise<T>

const TAG = /(^|\s)#([^\s#]{1,40})/gu

/**
 * "#말" 을 뽑는다. 판 영역 이름과 같은 첫 말은 영역(같은 일 판정과 같은 정규화), 나머지는 태그.
 * withTags=false(회사 판: 문서 색인 밖이라 태그를 못 붙임)면 영역이 아닌 "#말" 은 제목에 그대로 둔다
 */
export function parseTags(text: string, areas: QuickArea[], withTags = true): { rest: string; area: QuickArea | null; tags: string[] } {
  let area: QuickArea | null = null
  const tags: string[] = []
  const rest = text.replace(TAG, (m: string, lead: string, word: string) => {
    const hit = areas.find((a) => normTitle(a.name) === normTitle(word))
    if (hit && !area) { area = hit; return lead }
    if (!withTags) return m
    if (!tags.some((t) => normTitle(t) === normTitle(word))) tags.push(word)
    return lead
  })
  return { rest: rest.replace(/\s+/g, " ").trim(), area, tags }
}

/** 한 줄 글 → 제목·날짜·영역·태그. 날짜는 옛 보드와 같은 when.js 규칙 */
export function parseQuick(text: string, areas: QuickArea[], when: WhenParse, withTags = true): Parsed {
  const { rest, area, tags } = parseTags(text, areas, withTags)
  const w = rest ? when(rest) : null
  const title = (w ? w.title : rest).trim()
  return { title: title || rest || text.trim(), at: w?.at ?? null, area, tags }
}

/**
 * 목표에 붙일 새 할 일 초안: 목표의 판·영역·공간을 물려받아요. 서버도 goalId 로 공간을 물려받고 다르게 보내면 400 이에요(PR #39 리뷰 5).
 * 공간을 모르는 옛 서버의 목표면 space 를 보내지 않아요. 웹 목표 한 줄·상세 시트, iOS 목표 할 일·상세 시트가 같이 써요
 */
export function goalTodoDraft(goal: Item, p: { title: string; at: string | null; areaId?: string | null; tags: string[] }): Draft {
  return {
    boardId: goal.boardId, kind: "todo", title: p.title, at: p.at, areaId: p.areaId ?? (typeof goal.area === "string" ? goal.area : null),
    goalId: goal.id, tags: p.tags, note: "", props: [], ...(goal.space ? { space: goal.space } : {}),
  }
}

/** 같은 판·같은 공간에서 제목이 같은 열린 할 일·목표 (서버 dedup.findSameTodo 와 같은 비교, 끝낸 것은 보지 않음) */
export function findSameOpen(items: Item[], boardId: string, title: string, space?: SpaceId): Item | null {
  const want = normTitle(title)
  if (want.length < SAME_TITLE_MIN) return null
  return items.find((i) => i.boardId === boardId && (!space || (i.space ?? "personal") === space) && !i.deleted && !i.done && (i.type === "todo" || i.type === "goal") && normTitle(String(i.text || "")) === want) ?? null
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
/** 사람이 쓴 노트 글 → 노트 저장 본문. 빈 줄은 문단 구분 */
export function noteFromText(body: string): { html: string; text: string; md: string } {
  const text = body.replace(/\r\n?/g, "\n").trim()
  const html = text ? text.split(/\n{2,}/).map((p) => `<p>${p.split("\n").map(esc).join("<br>")}</p>`).join("") : ""
  return { html, text, md: text }
}

export const propValue = (p: DraftProp): PropValue => {
  const v = p.value.trim()
  if (p.type === "number") return Number(v)
  if (p.type === "checkbox") return v === "true" || v === "1" || v === "예"
  if (p.type === "list") return v.split(",").map((x) => x.trim()).filter(Boolean)
  return v
}

const STEPS: Step[] = ["item", "note", "tags", "props"]
const status = (e: unknown) => (e && typeof e === "object" && "status" in e ? Number((e as { status: unknown }).status) : 0)
/** 범위 고정 클라이언트가 범위가 바뀌어 보내지 않음(iOS ScopeChangedError 의 scopeChanged 표시) */
const scopeStop = (e: unknown) => !!e && typeof e === "object" && (e as { scopeChanged?: unknown }).scopeChanged === true
/** 결과를 모르는 쓰기(iOS UnknownWriteError 의 unknownWrite 표시) 또는 이 함수가 결과를 확인하지 못한 경우 */
class Unknown extends Error {}
/** 다시 시도에서 이미 있는 항목이 지금 초안과 달라요(앞의 추가가 저장돼 있었음). 덮어쓰지 않고 남은 단계도 보내지 않아요 */
class Differs extends Error {
  readonly at: Step
  constructor(at: Step) { super(at); this.at = at }
}
/** GET /api/work/:ref 의 self(제목 첫 줄·종류·날짜)가 만들려던 항목과 같은지 */
const sameAsSaved = (w: unknown, it: Item) => {
  const self = (w as { self?: { title?: unknown; type?: unknown; when?: unknown } } | null)?.self
  if (!self) return true // 모양을 모르는 옛 서버: 전처럼 이어요
  const when = it.type === "goal" ? (it.due ?? null) : (it.remindAt ?? null)
  const first = String(it.text ?? "").split("\n")[0] ?? ""
  return String(self.title ?? "").trim() === first.trim() && self.type === it.type && (self.when ?? null) === when
}
const unknownLike = (e: unknown) => e instanceof Unknown || (!!e && typeof e === "object" && (e as { unknownWrite?: unknown }).unknownWrite === true)

/** 쓴 속성 중 이름과 값이 있는 것만 */
export const filledProps = (props: DraftProp[]) => props.filter((p) => p.key.trim() && p.value.trim())

/** 초안으로 만들 항목(createWork·checkCreate 공용) */
function itemOf(d: Draft, id: string, z: number): Item {
  return {
    id, boardId: d.boardId, type: d.kind, text: d.title.trim(), x: 0, y: 0, w: 240, h: 90, z, done: false,
    ...(d.areaId ? { area: d.areaId } : {}),
    ...(d.at ? (d.kind === "goal" ? { due: d.at.slice(0, 10) } : { remindAt: d.at }) : {}),
    ...(d.kind === "todo" && d.goalId ? { goalId: d.goalId } : {}),
    ...(d.space ? { space: d.space } : {}),
  }
}
/** 초안에 필요한 단계(항목은 늘, 노트는 글·태그·속성이 있으면, 태그·속성은 있으면) */
function stepsOf(d: Draft): Step[] {
  const props = filledProps(d.props)
  return STEPS.filter((s) => s === "item" || (s === "note" ? !!d.note.trim() || d.tags.length > 0 || props.length > 0 : s === "tags" ? d.tags.length > 0 : props.length > 0))
}
const tagKey = (t: string) => t.replace(/^#/, "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40)
type Meta = { version?: number; frontmatter?: { tags?: unknown; props?: unknown } }
/** 속성 쓰기 본문(이름과 값이 있는 것만, 이름은 다듬어서) */
const propsBody = (list: DraftProp[]) => ({ set: Object.fromEntries(list.map((p) => [p.key.trim(), propValue(p)])), types: Object.fromEntries(list.map((p) => [p.key.trim(), p.type])) })
const metaProps = (m: Meta): { key: string; value: unknown }[] => (Array.isArray(m.frontmatter?.props) ? (m.frontmatter.props as { key: string; value: unknown }[]) : [])
const metaTags = (m: Meta): string[] => (Array.isArray(m.frontmatter?.tags) ? (m.frontmatter.tags as unknown[]).map((t) => tagKey(typeof t === "string" ? t : String((t as { tag?: unknown })?.tag ?? ""))) : [])
/** 초안의 속성이 서버 속성과 어떤지: 모두 같음·하나도 없음·다른 값이 있음(사람이 바꿈) */
function propsAgainst(d: Draft, m: Meta): "same" | "none" | "partial" | "differs" {
  const want = filledProps(d.props).map((p) => [p.key.trim(), JSON.stringify(propValue(p))] as const)
  const have = new Map(metaProps(m).map((p) => [p.key, JSON.stringify(p.value)]))
  if (want.some(([k, v]) => have.has(k) && have.get(k) !== v)) return "differs"
  const n = want.filter(([k]) => have.has(k)).length
  return n === want.length ? "same" : n === 0 ? "none" : "partial"
}

/** 그 초안에서 s 다음에 보낼 단계(없으면 null) */
export function nextStepOf(d: Draft, s: Step): Step | null {
  const steps = stepsOf(d)
  return steps[steps.indexOf(s) + 1] ?? null
}

export type CheckResult = { state: "done" } | { state: "partial"; from: Step } | { state: "absent"; from: Step } | { state: "differs"; at: Step } | { state: "unknown" }
/**
 * 결과를 모르는 단계(at.from)를 **읽기만으로** 확인한다(쓰기 0건, iOS PR #39 리뷰 9 — 결과가 불명인 쓰기는 앱이 스스로 다시 쓰지 않는다).
 * - done: 그 단계와 뒤 단계가 모두 서버에 있어요. partial: 그 단계까지 있고 from 부터 남았어요(이어 하기는 사람이 눌러요).
 * - absent: 그 단계가 서버에 없어요(from 부터 다시 보내기는 사람이 눌러요). differs: 그 단계(at)가 있는데 초안과 달라요(사람이 바꿈 — 덮지 않고 멈춰요. 끝난 것이 아니라 뒤 단계는 아직 안 보냈어요).
 * - unknown: 읽지 못했어요(기록은 그대로).
 */
export async function checkCreate(d: Draft, call: Call, at: { id: string; from: Step }): Promise<CheckResult> {
  const steps = stepsOf(d)
  const path = encodeURIComponent(`item:${d.boardId}:${at.id}`)
  const read = async <T,>(p: string): Promise<T | null | "unknown"> => {
    try { return await call<T>(p, { method: "GET" }) }
    catch (e) { if (scopeStop(e)) throw e; return status(e) === 404 ? null : "unknown" }
  }
  const work = await read<{ self?: unknown; note?: { text?: string } | null }>(`/api/work/${path}`)
  if (work === "unknown") return { state: "unknown" }
  if (!work) return at.from === "item" ? { state: "absent", from: "item" } : { state: "unknown" }
  // 그 단계부터 끝까지 읽어서 봐요(리뷰 17 P2 — 끝난 뒤 기록을 못 지운 추가도 "확인"만으로 끝이 정리돼요). 처음 단계가 없으면 absent, 뒤 단계가 없으면 partial
  let meta: Meta | null | "unknown" | undefined
  const metaOnce = async () => (meta === undefined ? (meta = await read<Meta>(`/api/docs/${path}?view=meta`)) : meta)
  for (let i = Math.max(0, steps.indexOf(at.from)); i < steps.length; i++) {
    const step = steps[i] as Step
    const miss = (): CheckResult => (step === at.from ? { state: "absent", from: step } : { state: "partial", from: step })
    if (step === "item") {
      if (!sameAsSaved(work, itemOf(d, at.id, 0))) return { state: "differs", at: "item" }
      continue
    }
    if (step === "note") {
      if (!work.note) return miss()
      if ((work.note.text ?? "") !== noteFromText(d.note).text) return { state: "differs", at: "note" }
      continue
    }
    const m = await metaOnce()
    if (m === "unknown" || !m) return { state: "unknown" }
    if (step === "tags") {
      const have = new Set(metaTags(m))
      if (!d.tags.every((t) => have.has(tagKey(t)))) return miss()
      continue
    }
    const p = propsAgainst(d, m)
    if (p === "differs") return { state: "differs", at: "props" }
    if (p !== "same") return miss()
  }
  return { state: "done" }
}

/**
 * 할 일·목표 하나를 만든다. 앞 단계가 실패하면 뒤 단계는 보내지 않는다.
 * 태그·속성은 문서 레코드(노트 행)가 있어야 붙어서, 노트가 비어 있어도 태그·속성이 있으면 빈 노트를 먼저 만든다.
 * resume 이면 같은 id 로 실패한 단계부터 잇는다(태그·속성은 반복해도 같다). 항목 단계부터 이으면 먼저 그 항목을 읽어,
 * 이미 있으면(앞 시도가 결과만 잃고 저장됨) 다시 PUT 하지 않는다 — 항목 PUT 은 upsert 라 그사이 고친 항목을 덮을 수 있어서.
 * 읽기도 결과를 모르면 저장하지 않고 결과 불명으로 멈춘다.
 * 다시 시도에서 노트가 409 면 서버 노트가 이번 글과 같을 때만 앞선 시도가 저장한 것으로 본다.
 * 부분 실패 뒤 다시 시도는 같은 초안으로 해야 한다(지난 단계는 다시 보내지 않으므로 화면에서 초안을 고정한다).
 */
export async function createWork(d: Draft, deps: CreateDeps, resume?: { id: string; from: Step }): Promise<CreateResult> {
  const id = resume?.id ?? deps.id()
  const from = STEPS.indexOf(resume?.from ?? "item")
  const item = itemOf(d, id, deps.now())
  const ref = `item:${d.boardId}:${id}`
  const path = encodeURIComponent(ref)
  const props = filledProps(d.props)
  const needsDoc = !!d.note.trim() || d.tags.length > 0 || props.length > 0
  const note = noteFromText(d.note)
  /** 노트 409 뒤 서버 노트가 이번 글과 같은지. 못 읽으면 "unknown"(사람 노트라고 단정하지 않아요) */
  const sameNote = async (): Promise<boolean | "unknown"> => {
    try { return ((await deps.call<{ note: { text: string } | null }>(`/api/work/${path}`, { method: "GET" })).note?.text ?? "") === note.text }
    catch (e) { if (scopeStop(e)) throw e; return "unknown" }
  }
  /** 태그·속성 쓰기 전 먼저 읽기(문서 버전·태그·속성). 쓰기 전이라 못 읽으면 확실한 실패예요(보낸 것이 없음) */
  const readMeta = async (): Promise<Meta> => {
    try { return await deps.call<Meta>(`/api/docs/${path}?view=meta`, { method: "GET" }) }
    catch (e) { if (scopeStop(e)) throw e; throw new Error("meta") }
  }
  /** 태그: 읽고 → 없는 것만(이미 있는 태그는 건드리지 않아요 — 태그는 서버에 버전이 없어요). 갓 만든 항목이든 이어 하기든 같은 함수 */
  const ensureTags = async () => {
    const have = new Set(metaTags(await readMeta()))
    const add = d.tags.filter((t) => !have.has(tagKey(t)))
    if (add.length) await deps.call(`/api/docs/${path}/tags`, { method: "POST", body: JSON.stringify({ add }) })
  }
  /**
   * 속성: 읽고 → 사람이 다른 값을 넣었으면 멈춤(덮지 않음) → 이미 같은 값은 빼고 남은 것만 읽은 문서 버전과 함께(서버 409) → 409 면 다시 읽어 같은 판단.
   * 갓 만든 항목이든 이어 하기든 같은 함수예요 — 앞 단계 응답이 늦는 동안에도 사람이 값을 넣을 수 있어요(iOS 리뷰 15)
   */
  const ensureProps = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const meta = await readMeta()
      if (propsAgainst(d, meta) === "differs") throw new Differs("props")
      const have = new Set(metaProps(meta).map((p) => p.key))
      const left = props.filter((p) => !have.has(p.key.trim()))
      if (!left.length) return
      try {
        await deps.call(`/api/docs/${path}/props`, { method: "POST", body: JSON.stringify({ ...propsBody(left), expectedVersion: meta.version }) })
        return
      } catch (e) {
        if (status(e) !== 409) throw e
      }
    }
    throw new Error("props")
  }
  const steps: [Step, (() => Promise<unknown>) | null][] = [
    ["item", async () => {
      if (resume && from === 0) {
        let exists: boolean
        let saved: unknown = null
        try { saved = await deps.call(`/api/work/${path}`, { method: "GET" }); exists = true }
        catch (e) { if (scopeStop(e)) throw e; if (status(e) !== 404) throw new Unknown("item"); exists = false }
        if (exists && !sameAsSaved(saved, item)) throw new Differs("item")
        if (exists) return
      }
      const saved = await deps.save(item)
      if (saved === false) throw new Error("item")
      if (saved === "unknown") throw new Unknown("item")
    }],
    ["note", needsDoc ? async () => {
      // 버전 0 PUT 은 노트가 없을 때만 만들어요. 409 면 이미 있는 노트가 이번 글과 같을 때만 들어간 것으로, 다르면 사람 노트라 덮지 않고 conflict
      try { await deps.call(`/api/work/${path}/note`, { method: "PUT", body: JSON.stringify({ ...note, expectedVersion: 0 }) }) }
      catch (e) {
        if (status(e) !== 409) throw e
        const same = await sameNote()
        if (same === "unknown") throw new Unknown("note")
        if (!same) throw new Differs("note")
      }
    } : null],
    ["tags", d.tags.length ? ensureTags : null],
    ["props", props.length ? ensureProps : null],
  ]
  for (const [i, [step, run]] of steps.entries()) {
    if (i < from || !run) continue
    try { await run() } catch (e) {
      if (e instanceof Differs) {
        if (e.at === "item") return { kind: "differs", ref, id, at: "item", left: nextStepOf(d, "item") }
        return { kind: "conflict", ref, id, at: e.at }
      }
      const kind = scopeStop(e) ? "scope" as const : unknownLike(e) ? "unknown" as const : "failed" as const
      return { kind, ref: step === "item" ? null : ref, id, at: step }
    }
  }
  return { kind: "done", ref, id, item }
}
