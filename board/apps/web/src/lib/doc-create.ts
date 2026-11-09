// 문서 만들기(새 문서 한 줄·상세 시트)의 순수 부분. 화면과 떨어져 있어 bun test 로 시험해요 (doc-create.test.ts).
// 단계: doc(본문·영역·태그·링크를 한 번에, 클라이언트 id) → props(있을 때만, 만든 버전 기준).
import { normTitle, SAME_TITLE_MIN, type DocProp, type PropType, type PropValue } from "@direction-board/contracts"
import { filledProps, propValue, type DraftProp } from "./quick-add"

/** parent: 그 문서 아래에 만들기(계층). null 이면 맨 위 */
export type DocDraft = { id: string; title: string; md: string; area: string | null; tags: string[]; links: string[]; props: DraftProp[]; parent?: string | null }
export type DocCreateDeps = {
  create: (input: { id: string; title: string; md: string; area?: string; tags?: string[]; links?: string[]; parent?: string }) => Promise<{ ref: string; version: number }>
  setProps: (ref: string, body: { set: Record<string, PropValue>; types: Record<string, PropType>; expectedVersion: number }) => Promise<{ version: number }>
  readMeta: (ref: string) => Promise<{ version: number; props: DocProp[] }>
}
/** 다시 시도할 자리. props 는 만든 문서와 그때 버전을 들고 간다 */
export type DocResume = { step: "doc" } | { step: "props"; ref: string; version: number }
export type DocCreateResult =
  | { status: "done"; ref: string }
  /** 만들기 실패. retry=true 는 결과를 모르는 경우(같은 id 로 다시 보내도 안전), false 는 고쳐야 하는 오류 */
  | { status: "failed"; step: "doc"; retry: boolean; message: string }
  /** 문서는 만들었고 속성을 못 넣음. retry=false 는 고쳐야 하는 오류 */
  | { status: "failed"; step: "props"; ref: string; version: number; retry: boolean; message: string }
  /** 문서는 만들었고, 그 사이 다른 곳에서 바뀌어 속성을 덮지 않음 */
  | { status: "conflict"; ref: string }

const statusOf = (e: unknown) => (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number" ? (e as { status: number }).status : 0)
const messageOf = (e: unknown) => (e instanceof Error && e.message ? e.message : "알 수 없는 오류")
/** 응답이 없거나 서버 오류면 결과를 모른다(같은 요청을 다시 보내야 안다) */
const unknownResult = (e: unknown) => { const s = statusOf(e); return s === 0 || s >= 500 }

/** 서버(props.ts normalizeKey·coerceValue)가 이 요청을 저장했을 때의 값. 키는 NFC+trim, select·url 은 trim, 목록은 항목 trim 뒤 중복 제거, 글·날짜·숫자·체크는 그대로 */
const normKey = (k: string) => k.normalize("NFC").trim()
function storedAs(type: PropType, v: PropValue): PropValue {
  if (v === null) return null
  if ((type === "select" || type === "url") && typeof v === "string") return v.trim()
  if (type === "list" && Array.isArray(v)) return [...new Set(v.map((x) => x.trim()))]
  return v
}
const propsBody = (d: DocDraft) => {
  const props = filledProps(d.props)
  return { set: Object.fromEntries(props.map((p) => [p.key.trim(), propValue(p)])), types: Object.fromEntries(props.map((p) => [p.key.trim(), p.type])) }
}
/** 응답을 놓친 속성 저장이 이미 들어갔는지: 서버가 저장했을 값·타입과 정확히 같은지(다른 편집이 끼었으면 false) */
export function propsApplied(saved: DocProp[], set: Record<string, PropValue>, types: Record<string, PropType>): boolean {
  const byKey = new Map(saved.map((p) => [normKey(p.key), p]))
  return Object.entries(set).every(([k, v]) => {
    const got = byKey.get(normKey(k)), type = types[k]
    return !!got && got.type === type && JSON.stringify(got.value) === JSON.stringify(storedAs(type, v))
  })
}

/**
 * 문서 하나를 만든다. 앞 단계가 실패하면 뒤 단계는 보내지 않는다.
 * resume 이 props 면 먼저 지금 속성·버전을 읽어: 다 들어가 있으면 끝, 버전이 그대로면 같은 버전으로 다시, 아니면 덮지 않고 conflict.
 * 다시 시도는 같은 초안(같은 id)으로 해야 한다 — 서버가 같은 id·같은 요청이면 처음 결과를 돌려준다.
 */
export async function createDocSteps(d: DocDraft, deps: DocCreateDeps, resume?: DocResume): Promise<DocCreateResult> {
  let ref: string, version: number
  if (resume?.step === "props") ({ ref, version } = resume)
  else {
    try {
      ;({ ref, version } = await deps.create({ id: d.id, title: d.title.trim(), md: d.md, ...(d.area ? { area: d.area } : {}), ...(d.tags.length ? { tags: d.tags } : {}), ...(d.links.length ? { links: d.links } : {}), ...(d.parent ? { parent: d.parent } : {}) }))
    } catch (e) {
      return { status: "failed", step: "doc", retry: unknownResult(e), message: messageOf(e) }
    }
  }
  const body = propsBody(d)
  const keys = Object.keys(body.set)
  if (!keys.length) return { status: "done", ref }
  if (resume?.step === "props") {
    let meta: { version: number; props: DocProp[] }
    try { meta = await deps.readMeta(ref) } catch (e) { return { status: "failed", step: "props", ref, version, retry: true, message: messageOf(e) } }
    if (propsApplied(meta.props, body.set, body.types)) return { status: "done", ref }
    if (meta.version !== version) return { status: "conflict", ref }
  }
  try {
    await deps.setProps(ref, { ...body, expectedVersion: version })
    return { status: "done", ref }
  } catch (e) {
    // 409(버전 어긋남)도 결과를 다시 읽어 판정한다
    return { status: "failed", step: "props", ref, version, retry: unknownResult(e) || statusOf(e) === 409, message: messageOf(e) }
  }
}

/** 같은 제목 확인 상태 */
export type SameCheck = { key: string; state: "loading" } | { key: string; state: "ok"; hits: { ref: string; title: string; status: string }[] } | { key: string; state: "error" }
export const titleKey = (title: string) => normTitle(title)
/** 서버가 준 결과 중 열린(보관 아님) 같은 제목 문서 */
export function findSameDoc(hits: { ref: string; title: string; status: string }[], title: string) {
  const want = normTitle(title)
  if (want.length < SAME_TITLE_MIN) return null
  return hits.find((h) => h.status !== "archived" && normTitle(h.title) === want) ?? null
}
/**
 * 만들기를 눌렀을 때: go 면 만든다. same·unknown 이면 경고를 보이고, 같은 제목으로 한 번 더 누르면(confirmed 가 그 키) 만든다.
 * wait 는 확인이 아직 안 끝난 것(끝나면 다시 판정).
 */
export function gate(title: string, check: SameCheck | null, confirmed: string | null): "go" | "wait" | "same" | "unknown" {
  const key = titleKey(title)
  if (key.length < SAME_TITLE_MIN) return "go"
  if (!check || check.key !== key || check.state === "loading") return "wait"
  const verdict = check.state === "error" ? "unknown" : findSameDoc(check.hits, title) ? "same" : "go"
  return verdict !== "go" && confirmed === verdict + ":" + key ? "go" : verdict
}
export const confirmKey = (verdict: "same" | "unknown", title: string) => verdict + ":" + titleKey(title)

/** 빈 초안. id 는 만들 때마다 새로(다시 시도는 같은 초안을 그대로 쓴다) */
export function emptyDraft(newId: () => string, ctx: { title?: string; area?: string | null; links?: string[]; parent?: string | null } = {}): DocDraft {
  return { id: newId(), title: ctx.title ?? "", md: "", area: ctx.area ?? null, tags: [], links: ctx.links ?? [], props: [], ...(ctx.parent ? { parent: ctx.parent } : {}) }
}
