// 문서 만들기(새 문서 시트)의 순수 부분. 웹 apps/web/src/lib/doc-create.ts 와 같은 단계·규칙이에요:
// doc(본문·영역·태그·연결·부모를 한 번에, 클라이언트 id) → props(있을 때만, 만든 버전 기준). 결과를 모르면 같은 초안(같은 id)으로만 다시 보내요.
// 웹 쪽은 웹 빠른 추가의 속성 초안에 묶여 있어 따로 둬요. 두 구현이 갈라지지 않게 시험 사례를 웹과 맞춰요(create.test.ts).
import { normTitle, SAME_TITLE_MIN, type DocProp, type PropType, type PropValue } from '@direction-board/contracts'
import { ConflictError, UnknownWriteError } from '../../api/client'

export type DraftProp = { key: string; type: PropType; value: string }
export type DocDraft = { id: string; title: string; md: string; area: string | null; tags: string[]; links: string[]; props: DraftProp[]; parent?: string | null }
export type DocCreateDeps = {
  create: (input: { id: string; title: string; md: string; area?: string; tags?: string[]; links?: string[]; parent?: string }) => Promise<{ ref: string; version: number }>
  setProps: (ref: string, body: { set: Record<string, PropValue>; types: Record<string, PropType>; expectedVersion: number }) => Promise<{ version: number }>
  readMeta: (ref: string) => Promise<{ version: number; props: DocProp[] }>
}
export type DocResume = { step: 'doc' } | { step: 'props'; ref: string; version: number }
export type DocCreateResult =
  | { status: 'done'; ref: string }
  | { status: 'failed'; step: 'doc'; retry: boolean; message: string }
  | { status: 'failed'; step: 'props'; ref: string; version: number; retry: boolean; message: string }
  | { status: 'conflict'; ref: string }

/** 웹 빠른 추가(quick-add.ts propValue)와 같은 값 해석: 목록은 쉼표로 나눠요 */
export function propValue(p: DraftProp): PropValue {
  const v = p.value.trim()
  if (p.type === 'number') return Number(v)
  if (p.type === 'checkbox') return v === 'true' || v === '1' || v === '예'
  if (p.type === 'list') return v.split(',').map((x) => x.trim()).filter(Boolean)
  return v
}
export const filledProps = (props: DraftProp[]) => props.filter((p) => p.key.trim() && p.value.trim())

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : '알 수 없는 오류')
/** 응답이 없거나 서버 오류면 결과를 몰라요(같은 요청을 다시 보내야 알아요) */
const unknownResult = (e: unknown) => e instanceof UnknownWriteError || (!(e instanceof Error && 'status' in e) && !(e instanceof ConflictError))

const normKey = (k: string) => k.normalize('NFC').trim()
function storedAs(type: PropType, v: PropValue): PropValue {
  if (v === null) return null
  if ((type === 'select' || type === 'url') && typeof v === 'string') return v.trim()
  if (type === 'list' && Array.isArray(v)) return [...new Set(v.map((x) => x.trim()))]
  return v
}
function propsBody(d: DocDraft) {
  const props = filledProps(d.props)
  return { set: Object.fromEntries(props.map((p) => [p.key.trim(), propValue(p)])), types: Object.fromEntries(props.map((p) => [p.key.trim(), p.type])) }
}
/** 응답을 놓친 속성 저장이 이미 들어갔는지: 서버가 저장했을 값·타입과 정확히 같은지(다른 편집이 끼었으면 false) */
export function propsApplied(saved: DocProp[], set: Record<string, PropValue>, types: Record<string, PropType>): boolean {
  const byKey = new Map(saved.map((p) => [normKey(p.key), p]))
  return Object.entries(set).every(([k, v]) => {
    const got = byKey.get(normKey(k))
    const type = types[k]
    return !!got && got.type === type && JSON.stringify(got.value) === JSON.stringify(storedAs(type, v))
  })
}

export async function createDocSteps(d: DocDraft, deps: DocCreateDeps, resume?: DocResume): Promise<DocCreateResult> {
  let ref: string
  let version: number
  if (resume?.step === 'props') ({ ref, version } = resume)
  else {
    try {
      ;({ ref, version } = await deps.create({ id: d.id, title: d.title.trim(), md: d.md, ...(d.area ? { area: d.area } : {}), ...(d.tags.length ? { tags: d.tags } : {}), ...(d.links.length ? { links: d.links } : {}), ...(d.parent ? { parent: d.parent } : {}) }))
    } catch (e) {
      return { status: 'failed', step: 'doc', retry: unknownResult(e), message: message(e) }
    }
  }
  const body = propsBody(d)
  if (!Object.keys(body.set).length) return { status: 'done', ref }
  if (resume?.step === 'props') {
    let meta: { version: number; props: DocProp[] }
    try {
      meta = await deps.readMeta(ref)
    } catch (e) {
      return { status: 'failed', step: 'props', ref, version, retry: true, message: message(e) }
    }
    if (propsApplied(meta.props, body.set, body.types)) return { status: 'done', ref }
    if (meta.version !== version) return { status: 'conflict', ref }
  }
  try {
    await deps.setProps(ref, { ...body, expectedVersion: version })
    return { status: 'done', ref }
  } catch (e) {
    // 409(버전 어긋남)도 결과를 다시 읽어 판정해요
    return { status: 'failed', step: 'props', ref, version, retry: unknownResult(e) || e instanceof ConflictError, message: message(e) }
  }
}

export type SameCheck = { key: string; state: 'loading' } | { key: string; state: 'ok'; hits: { ref: string; title: string; status: string }[] } | { key: string; state: 'error' }
export const titleKey = (title: string) => normTitle(title)
export function findSameDoc(hits: { ref: string; title: string; status: string }[], title: string) {
  const want = normTitle(title)
  if (want.length < SAME_TITLE_MIN) return null
  return hits.find((h) => h.status !== 'archived' && normTitle(h.title) === want) ?? null
}
/** 만들기를 눌렀을 때: go 면 만들고, same·unknown 이면 경고, 같은 제목으로 한 번 더 누르면 만들어요. wait 는 확인이 아직 안 끝남 */
export function gate(title: string, check: SameCheck | null, confirmed: string | null): 'go' | 'wait' | 'same' | 'unknown' {
  const key = titleKey(title)
  if (key.length < SAME_TITLE_MIN) return 'go'
  if (!check || check.key !== key || check.state === 'loading') return 'wait'
  const verdict = check.state === 'error' ? 'unknown' : findSameDoc(check.hits, title) ? 'same' : 'go'
  return verdict !== 'go' && confirmed === verdict + ':' + key ? 'go' : verdict
}
export const confirmKey = (verdict: 'same' | 'unknown', title: string) => verdict + ':' + titleKey(title)
export function emptyDraft(newId: () => string, ctx: { title?: string; area?: string | null; links?: string[]; parent?: string | null } = {}): DocDraft {
  return { id: newId(), title: ctx.title ?? '', md: '', area: ctx.area ?? null, tags: [], links: ctx.links ?? [], props: [], ...(ctx.parent ? { parent: ctx.parent } : {}) }
}
/** 결과를 모르는 실패면 같은 초안으로 다시 보낼 자리 */
export function resumeOf(r: Exclude<DocCreateResult, { status: 'done' }>): DocResume | null {
  if (r.status === 'conflict' || !r.retry) return null
  return r.step === 'props' ? { step: 'props', ref: r.ref, version: r.version } : { step: 'doc' }
}
