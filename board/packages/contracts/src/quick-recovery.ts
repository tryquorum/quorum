// 빠른 추가(한 줄·상세 시트·목표 할 일)의 복구 기록과 다음 행동 판단. 웹(lib/quick-slot.ts)과 iOS(features/board/quick)가 같이 써요(PR #39 리뷰 16).
// 규칙(리뷰 3): 결과 불명·부분 완료로 남는 기록은 시작 범위(scope = 서버 주소 + 로그인 주체)를 같이 저장하고, 재개는 그 범위로만.
// 결과 불명이거나 앞 단계가 저장됐으면 내용을 고정해요 — 바꾼 글이 이미 저장된 항목에 조용히 무시되지 않게.
// 기록을 지우는 길은 둘뿐이에요: 끝(done)과 사람의 버리기(확인창). 닫기·뒤로·화면 내리기·새로고침은 기록을 그대로 둬요.
import { assertNever, checkCreate, nextStepOf, type Call, type CheckResult, type CreateResult, type Draft, type Step } from './quick-add.ts'

/**
 * unknown: 그 단계의 결과를 모름 — 다음 누름은 **읽어서 확인만** 해요(리뷰 9). checked "absent": 확인했더니 그 단계가 서버에 없음 — 다음 누름이 같은 id 로 다시 보내요.
 * checked "differs": 저장된 할 일이 사람 손으로 바뀌어 있음 — 아직 안 보낸 뒤 단계(from, 노트 등)는 사람이 눌러야 보내요.
 *   보낼 뒤 단계가 없으면 from "item" 으로 남고, 다음 누름은 다시 확인(읽기)만 해요(리뷰 15: done 이 아니면 기록을 지우지 않아요).
 * checked "conflict": 보내려던 노트·속성이 서버에서 이미 다른 내용 — 덮지 않고, 다음 누름도 다시 확인(읽기)만 해요(리뷰 10).
 * 모두 사람이 버리기 전까지 지우지 않고(초안 = 아직 안 보낸 노트도 그대로) 입력도 잠가요.
 */
export type Pending = { id: string; from: Step; draft: Draft; text: string; ref: string | null; unknown?: true; checked?: 'absent' | 'differs' | 'conflict'; stopped?: 'scope'; scope: string }
export type Resume = { id: string; from: Step; scope: string }

/**
 * 사람이 바꿔 둔 단계(at)를 만난 기록(리뷰 10: differs 는 완료가 아니에요). 항목만 바뀌었으면 아직 안 보낸 뒤 단계부터 "differs"(사람이 골라 보내요),
 * 노트·속성이 다르면 그 단계에서 "conflict"(덮지 않음). 항목만 있고 보낼 뒤 단계가 없어도 기록은 남아요(from "item" — 열어 보고 버리기는 사람이, 리뷰 15)
 */
export function differsPending(p: { id: string; draft: Draft; text: string; scope: string }, at: Step): Pending {
  const ref = 'item:' + p.draft.boardId + ':' + p.id
  const base = { id: p.id, draft: p.draft, text: p.text, scope: p.scope, ref }
  if (at !== 'item') return { ...base, from: at, checked: 'conflict' }
  return { ...base, from: nextStepOf(p.draft, 'item') ?? 'item', checked: 'differs' }
}

/** 리뷰 18 전의 자리 이름(bar·sheet·goal:<목표 id>) — 이 PR 의 개발 빌드에만 있던 기록이에요 */
export const legacySlotKind = (k: string): 'bar' | 'sheet' | 'goal' | null => (k === 'bar' || k === 'sheet' ? k : /^goal:[^:]+$/.test(k) ? 'goal' : null)
const legacySlot = legacySlotKind
const newSlotOf = (kind: 'bar' | 'sheet' | 'goal', legacy: string, t: QuickTarget): string =>
  kind === 'goal' ? slotFor('goal', { boardId: t.boardId, goalId: t.goalId || legacy.slice(5) }) : kind === 'bar' ? slotFor('bar', { boardId: t.boardId, space: t.space }) : slotFor('sheet', t)
/**
 * 읽을 때 옛 자리 이름의 기록을 그 초안의 대상으로 새 자리에 옮겨요(리뷰 19 P2). 새 자리에 이미 기록이 있으면 옛 것을 지우지 않고 그대로 둬요
 * (덮지 않음). 옮긴 묶음은 다음 쓰기 때 저장돼요
 */
export function migrateSlots(slots: Record<string, Pending>): Record<string, Pending> {
  let out = slots
  for (const [k, p] of Object.entries(slots)) {
    const kind = legacySlot(k)
    if (!kind) continue
    const nk = newSlotOf(kind, k, { boardId: p.draft.boardId, goalId: p.draft.goalId ?? null, space: p.draft.space ?? null })
    if (nk in out) continue
    if (out === slots) out = { ...slots }
    out[nk] = p
    delete out[k]
  }
  return out
}
/** 편집 초안도 같은 규칙(대상(판)을 모르는 옛 초안은 옮길 수 없어 그대로 — 보이지 않아요) */
export function migrateEdits(edits: Record<string, QuickEdit>): Record<string, QuickEdit> {
  let out = edits
  for (const [k, e] of Object.entries(edits)) {
    const kind = legacySlot(k)
    if (!kind || !e.boardId) continue
    const nk = newSlotOf(kind, k, { boardId: e.boardId, goalId: e.goalId ?? null, space: e.space ?? null })
    if (nk in out) continue
    if (out === edits) out = { ...edits }
    out[nk] = e
    delete out[k]
  }
  return out
}

/** 기록·편집 초안의 대상(리뷰 18): 판·목표·공간. 자리 이름에도, 초안 안에도 들어가 복원 때 그대로 적용돼요 */
export type QuickTarget = { boardId?: string | null; goalId?: string | null; space?: string | null }
/**
 * 자리 이름 = 자리 + 대상. 대상이 다르면 기록·편집 초안도 따로예요(개인 목표에서 쓴 초안이 회사 판 시트에 나타나지 않게).
 * 범위(서버 주소 + 주체)는 저장 이름(웹 localStorage 키·iOS 범위별 폴더)이 이미 나눠요
 */
export function slotFor(kind: 'bar' | 'sheet' | 'goal', t: QuickTarget): string {
  return `${kind}:${t.boardId || '-'}:${t.goalId || '-'}:${t.space || '-'}`
}
/**
 * 대상이 지금 범위에서 보이는지(제출 전에). 판 목록을 아직 못 받았으면(null) null(제출은 다른 조건이 막아요), 받았는데 비어 있으면 없는 판.
 * 판이나 목표가 없으면 안내 글 — 화면은 제출을 막고 버리기만 열어 둬요
 */
export function targetProblem(t: QuickTarget, boards: { id: string }[] | null, items: { boardId: string; id: string; type: string; deleted?: boolean }[] | null): string | null {
  if (!boards || !t.boardId) return null
  // 판 목록을 받았는데 비어 있어도(리뷰 19) 그 판이 없는 거예요
  if (!boards.some((b) => b.id === t.boardId)) return '이 추가의 판을 지금 계정에서 찾을 수 없어요 · 그 판을 볼 수 있는 계정에서 이어 주세요(버리기는 할 수 있어요)'
  if (t.goalId && items && !items.some((i) => i.boardId === t.boardId && i.id === t.goalId && i.type === 'goal' && !i.deleted)) return '이 추가를 붙일 목표를 지금 찾을 수 없어요 · 목표를 확인한 뒤 이어 주세요(버리기는 할 수 있어요)'
  return null
}

/**
 * 편집 중 초안(리뷰 17): 자리마다 "제출 기록(Pending, 고정)"과 따로, 아직 보내지 않은 입력을 범위별로 둬요.
 * 화면은 짧은 지연으로 저장하고 닫기·화면 내리기(웹 pagehide)에서 바로 저장해요. 다시 열면 편집 초안이 먼저예요 —
 * 단 결과 불명·부분 완료(잠긴 기록)면 편집할 수 없고 기록의 초안으로만 이어요. 지우는 길은 done·버리기(그리고 사람이 칸을 다 비움).
 * text 는 한 줄·목표 할 일의 글이자 시트의 제목. at·areaId 의 undefined 는 "제목에서 알아본 것"이에요(JSON 에서는 빠져요)
 */
export type QuickEdit = { text: string; note?: string; kind?: 'todo' | 'goal'; at?: string | null; areaId?: string | null; tags?: string[]; props?: { key: string; type: string; value: string }[]; space?: string; boardId?: string; goalId?: string }
export const EDITS = 'quickEdit'
export const isEdit = (v: unknown): v is QuickEdit => {
  if (!v || typeof v !== 'object') return false
  const e = v as QuickEdit
  return typeof e.text === 'string' && (e.note === undefined || typeof e.note === 'string') && (e.kind === undefined || e.kind === 'todo' || e.kind === 'goal') &&
    (e.at === undefined || e.at === null || typeof e.at === 'string') && (e.areaId === undefined || e.areaId === null || typeof e.areaId === 'string') &&
    (e.tags === undefined || (Array.isArray(e.tags) && e.tags.every((t) => typeof t === 'string'))) &&
    (e.props === undefined || (Array.isArray(e.props) && e.props.every((p) => !!p && typeof p.key === 'string' && typeof p.type === 'string' && typeof p.value === 'string'))) &&
    (e.space === undefined || typeof e.space === 'string') && (e.boardId === undefined || typeof e.boardId === 'string') && (e.goalId === undefined || typeof e.goalId === 'string')
}
export const isEdits = (v: unknown): v is Record<string, QuickEdit> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isEdit)
/** 사람이 칸을 다 비운 초안(저장하지 않고 그 자리를 비워요) */
/**
 * 편집 초안의 뜻이 같은지 견줄 열쇠(규칙 E, 리뷰 22): 빈 초안은 "초안 없음"과 같고, 기본값(빈 노트·할 일·빈 태그·빈 속성)과 필드 순서는 무시해요.
 * 처음 읽은 값과 같으면 화면이 다시 쓰지 않아요(복원 직후의 저장이 사람 손 없이 저장소를 바꾸지 않게)
 */
export const editMeaning = (e: QuickEdit | null | undefined): string =>
  !e || editEmpty(e) ? 'null' : JSON.stringify([e.text, e.note ?? '', e.kind ?? 'todo', e.at ?? null, e.areaId ?? null, e.tags ?? [], (e.props ?? []).map((p) => [p.key, p.type, p.value]), e.space ?? null, e.boardId ?? null, e.goalId ?? null])
export const editEmpty = (e: QuickEdit) => !e.text.trim() && !(e.note ?? '').trim() && !(e.tags ?? []).length && !(e.props ?? []).some((p) => p.key.trim() || p.value.trim())
/** 자리 하나의 편집 초안을 바꾼 새 묶음(null 이거나 빈 초안이면 그 자리를 비움) */
export function putEdit(edits: Record<string, QuickEdit>, slot: string, e: QuickEdit | null): Record<string, QuickEdit> {
  const next = { ...edits }
  if (e && !editEmpty(e)) next[slot] = e
  else delete next[slot]
  return next
}
/** 다시 열 때 칸에 보일 것: 잠긴 기록이면 그 초안(편집 불가), 아니면 편집 초안이 먼저, 없으면 기록의 초안, 그것도 없으면 null(넘긴 글·초안) */
export function restoreSource(p: Pending | null, e: QuickEdit | null): { from: 'record'; draft: Draft } | { from: 'edit'; edit: QuickEdit } | null {
  if (p && inputLocked(p)) return { from: 'record', draft: p.draft }
  if (e) return { from: 'edit', edit: e }
  if (p) return { from: 'record', draft: p.draft }
  return null
}

/**
 * 규칙 C(리뷰 21) "입력 가능 = 준비 완료": 범위·대상·그 자리의 기록 읽기·편집 초안 읽기·복원이 모두 끝나야 입력·제출을 받아요.
 * 복원이 사람의 입력을 덮을 길 자체가 없게요. 웹·iOS 빠른 추가 세 화면(한 줄·시트·목표)이 같은 함수로 판정해요
 */
export const inputReady = (s: { scope: boolean; target: boolean; record: boolean; edit: boolean; restored: boolean }) => s.scope && s.target && s.record && s.edit && s.restored
/** 규칙 C 동안 칸에 보이는 글 */
export const LOADING_TEXT = '불러오는 중…'
/**
 * 준비 신호(범위·판 목록·기기 저장)가 이만큼 안 오면 원인 안내와 다시 시도를 보여요(리뷰 22 P2). 시험은 값을 줄여 써요
 */
export const stallTimer = { ms: 8000 }
/** 받침이 있으면 을·이, 없으면 를·가 */
const josa = (w: string, withB: string, without: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00
  return c >= 0 && c <= 11171 && c % 28 !== 0 ? withB : without
}
/** 낱말 + 을/를 */
export const withEul = (w: string) => w + josa(w, '을', '를')
/** 준비가 늦을 때의 안내 글 */
export const stallText = (what: string) => `${what}${josa(what, '을', '를')} 아직 받지 못했어요 · 연결을 확인하고 다시 시도해 주세요`
/** 기기 저장 하나의 상태(규칙 E, 리뷰 22): 읽는 중 · 잘 읽음 · 읽기 실패 · 깨짐. ok 만 준비 완료예요 */
export type StoreStatus = 'loading' | 'ok' | 'read' | 'corrupt'
/** 읽지 못했거나 깨진 기기 저장의 안내 글(다시 읽기·버리고 새로와 함께) */
export const storeProblemText = (what: string, problem: 'read' | 'corrupt') =>
  problem === 'read' ? `${what}${josa(what, '을', '를')} 기기에서 읽지 못했어요 · 다시 읽거나, 버리고 새로 쓸 수 있어요` : `${what}${josa(what, '이', '가')} 기기에서 깨져 있어요 · 다시 읽거나, 버리고 새로 쓸 수 있어요`
/** 규칙 D(리뷰 21) "저장 실패면 화면 상태를 바꾸지 않음": 편집 초안·기록을 기기에 저장하지 못했을 때의 안내(전환·닫기·옮기기를 하지 않았어요) */
export const SAVE_FAILED = '기기에 저장하지 못했어요 · 쓰던 글은 칸에 그대로 있어요'
/** 쓰던 초안의 전제(known)나 지금 초안을 기기에서 읽지 못해 저장하지 않았을 때(PR #43 리뷰 6) — 다른 곳의 초안을 덮지 않게 멈춰요 */
export const EDIT_READ_FAILED_TEXT = '쓰던 초안을 기기에서 읽지 못해 저장하지 않았어요 · 다른 곳의 초안을 덮지 않게 멈췄어요. 쓰던 글은 칸에 그대로 있어요'

export const STEP_KO: Record<Step, string> = { item: '할 일', note: '노트', tags: '태그', props: '속성' }
/** 남은 기록의 한 줄 안내(실패·결과 불명·확인했더니 없음·남은 단계·사람 값과 다름·범위 바뀜을 나눠요). 웹·iOS 같은 글 */
export function stepFailureText(f: { from: Step; unknown?: boolean; checked?: 'absent' | 'differs' | 'conflict'; stopped?: 'scope' }): string {
  const after = f.from !== 'item'
  if (f.stopped === 'scope') return `로그인이 바뀌어 ${STEP_KO[f.from]} 단계부터 보내지 않았어요${after ? ' · 앞 단계는 저장됐어요' : ''} · 원래 계정에서 다시 시도해 주세요`
  if (f.unknown) return `${STEP_KO[f.from]} 저장 결과를 확인하지 못했어요 · 확인을 누르면 서버에서 읽어 보기만 해요(다시 보내지 않아요)`
  if (f.checked === 'differs') return after ? `이미 저장된 할 일과 내용이 달라요(그사이 바뀌었어요) · 열어서 확인하고, 아직 안 보낸 ${STEP_KO[f.from]}부터 보내거나 버려 주세요` : '이미 저장된 할 일과 내용이 달라요(그사이 바뀌었어요) · 덮지 않았어요 · 열어서 확인한 뒤 버려 주세요(보낼 남은 단계는 없어요)'
  if (f.checked === 'conflict') return `서버의 ${STEP_KO[f.from]}가 보내려던 내용과 달라요 · 덮지 않았어요 · 열어서 확인한 뒤 다시 확인하거나 버려 주세요(보내려던 내용은 그대로 남아 있어요)`
  if (f.checked && !after) return '서버에 할 일이 없어요(보내지 않은 것 같아요) · 다시 보내기를 누르면 같은 내용으로 보내요'
  if (f.checked) return `할 일은 이미 있어요 · ${STEP_KO[f.from]}가 서버에 없어요 · 이어 하기를 누르면 그 단계부터 보내요`
  return after ? `할 일은 저장됐어요 · ${STEP_KO[f.from]} 단계부터 남았어요 · 이어 하기를 누르면 보내요(사람이 바꾼 값이 있으면 멈춰요)` : `${STEP_KO[f.from]} 저장에 실패했어요`
}

/** 화면이 받는 결과. done 은 createWork 의 "done" 만(리뷰 15) — 닫기·onCreated·기록 지우기는 이때만이에요 */
export type Done = Extract<CreateResult, { kind: 'done' }>
export type Submitted = { kind: 'done'; result: Done; draft: Draft } | { kind: 'pending'; pending: Pending; note?: string } | { kind: 'other-scope'; message: string } | { kind: 'not-sent'; message: string }
const NOT_YET = '아직 확인하지 못했어요 · 잠시 뒤 다시 확인해 주세요'

/**
 * 결과 불명 기록의 확인 결과(contracts checkCreate — 읽기만) → 화면 결과(리뷰 9). 다 있으면 끝(이미 있어요), 앞 단계가 있으면 남은 단계부터
 * (이어 하기는 사람이 눌러요), 없으면 "다시 보내기" 상태로. 사람이 바꿨으면 덮지 않고 기록 유지(리뷰 10·15). 못 읽으면 기록 그대로
 */
export function settleCheck(seen: CheckResult, p: Pending): Submitted {
  const ref = 'item:' + p.draft.boardId + ':' + p.id
  switch (seen.state) {
    case 'done':
      return { kind: 'done', result: { kind: 'done', ref, id: p.id, item: null, existed: true }, draft: p.draft }
    case 'differs':
      return { kind: 'pending', pending: differsPending(p, seen.at) }
    case 'unknown':
      return { kind: 'pending', pending: p, note: NOT_YET }
    case 'partial':
      return { kind: 'pending', pending: { id: p.id, draft: p.draft, text: p.text, scope: p.scope, from: seen.from, ref } }
    case 'absent':
      return { kind: 'pending', pending: { id: p.id, draft: p.draft, text: p.text, scope: p.scope, from: seen.from, ref: seen.from === 'item' ? null : ref, checked: 'absent' } }
    default:
      return assertNever(seen)
  }
}

/**
 * 빠른 추가 한 번(웹·iOS 공용 흐름, 리뷰 16). 기록이 있으면 그 초안·id·시작 범위로 잇고(지금 범위가 다르면 보내지 않음), 없으면 새로.
 * - 결과 불명·서버가 다른 내용(conflict)·보낼 것 없는 differs 기록이면 **읽기만**(check) — 쓰기 0건, 이어 하기·다시 보내기는 확인 뒤 사람이 한 번 더 눌러요.
 * - 먼저 기록(규칙 B): 보내기 전에 그 자리에 id·초안·단계·시작 범위를 "결과 불명" 기록으로 남기고 저장이 닿은 뒤에만 보내요. 못 남기면 보내지 않아요.
 * - 결과가 done 이 아니면 모두 기록으로(pendingFrom). 예상하지 못한 오류면 먼저 남긴 기록(결과 불명) 그대로.
 * check·create 는 기록의 시작 범위로 보내는 쪽이 넘겨요(iOS 는 범위 고정 클라이언트, 웹은 같은 출처 api)
 */
export async function submitWithRecord(a: {
  text: string
  makeDraft: () => Draft
  pending: Pending | null
  writeAhead: (p: Pending) => Promise<boolean>
  /** 화면·시트를 연 시점의 범위 */
  scope: string
  /** 지금도 그 범위인지(보내기·확인 직전에 봐요) */
  same: () => boolean
  check: (p: Pending) => Promise<CheckResult>
  create: (draft: Draft, id: string, resume?: Resume) => Promise<CreateResult & { scope: string }>
  id: () => string
}): Promise<Submitted> {
  const plan = retryPlan(a.pending, a.text, a.scope)
  if (plan.kind === 'other-scope') return plan
  if (plan.kind === 'resume' && a.pending && checkOnly(a.pending)) {
    if (!a.same()) return { kind: 'not-sent', message: '서버나 계정이 바뀌어 확인하지 않았어요. 화면을 다시 열어 주세요' }
    try {
      return settleCheck(await a.check(a.pending), a.pending)
    } catch {
      return { kind: 'pending', pending: a.pending, note: NOT_YET }
    }
  }
  const draft = plan.kind === 'resume' ? plan.draft : a.makeDraft()
  const id = plan.kind === 'resume' ? plan.resume.id : a.id()
  const start = plan.kind === 'resume' ? plan.resume.from : 'item'
  const ahead: Pending = { id, from: start, draft, text: a.text, ref: start === 'item' ? null : 'item:' + draft.boardId + ':' + id, unknown: true, scope: plan.kind === 'resume' ? plan.resume.scope : a.scope }
  if (!a.same()) return { kind: 'not-sent', message: '서버나 계정이 바뀌어 보내지 않았어요. 화면을 다시 열어 주세요' }
  if (!(await a.writeAhead(ahead))) return { kind: 'not-sent', message: '이어서 할 기록을 남기지 못해 보내지 않았어요' }
  try {
    const r = await a.create(draft, id, plan.kind === 'resume' ? plan.resume : undefined)
    if (r.kind === 'done') return { kind: 'done', result: r, draft }
    return { kind: 'pending', pending: pendingFrom(r, draft, a.text) }
  } catch {
    return { kind: 'pending', pending: ahead }
  }
}

/** 기록의 초안을 같은 출처 호출로 읽어 확인(웹 — iOS 는 시작 범위의 클라이언트로 같은 checkCreate) */
export const checkWith = (call: Call) => (p: Pending) => checkCreate(p.draft, call, { id: p.id, from: p.from })


/** 끝나지 않은 createWork 결과(done 밖의 모든 kind) */
export type NotDone = Exclude<CreateResult, { kind: 'done' }>
/** createWork 결과 → 남길 기록. done 밖의 kind 는 모두 기록으로 남아요(사람이 버리기 전까지). 새 kind 가 생기면 assertNever 에서 타입 오류 */
export function pendingFrom(r: NotDone & { scope: string }, draft: Draft, text: string): Pending {
  const base = { id: r.id, draft, text, scope: r.scope }
  switch (r.kind) {
    case 'differs':
      return differsPending(base, 'item')
    case 'conflict':
      return differsPending(base, r.at)
    case 'failed':
      return { ...base, from: r.at, ref: r.ref }
    case 'unknown':
      return { ...base, from: r.at, ref: r.ref, unknown: true }
    case 'scope':
      return { ...base, from: r.at, ref: r.ref, stopped: 'scope' }
    default:
      return assertNever(r)
  }
}

/** 할 일이 바뀌어 있고 보낼 뒤 단계가 없는 기록(누르면 다시 확인만) */
const differsNothingLeft = (p: Pending) => p.checked === 'differs' && p.from === 'item'
/** 입력을 잠글지: 결과를 모르거나·몰랐거나(이미 저장됐을 수 있음) 앞 단계가 저장됐으면(같은 초안으로 이어야 함) */
export const inputLocked = (p: Pending | null) => !!p && (!!p.unknown || !!p.checked || p.from !== 'item')
/** 다시 누를 단추의 글: 결과 불명이면 "확인"(읽기만), 서버가 다른 내용이면 "다시 확인"(읽기만), 할 일이 바뀌어 있으면 "남은 노트·단계 보내기", 확인했더니 없으면 "다시 보내기", 앞 단계가 저장됐으면 "이어 하기" */
export const retryLabel = (p: Pending) =>
  p.unknown ? '확인' : p.checked === 'conflict' || differsNothingLeft(p) ? '다시 확인' : p.checked === 'differs' ? (p.from === 'note' ? '남은 노트 보내기' : '남은 단계 보내기') : p.checked && p.from === 'item' ? '다시 보내기' : p.from !== 'item' ? '이어 하기' : '다시 시도'
/** 누르면 읽기만 하는 기록(결과 불명·서버가 다른 내용·할 일이 바뀌어 있고 보낼 것이 없음) */
export const checkOnly = (p: Pending | null) => !!p && (!!p.unknown || p.checked === 'conflict' || differsNothingLeft(p))

export type Plan = { kind: 'new' } | { kind: 'resume'; draft: Draft; resume: Resume } | { kind: 'other-scope'; message: string }

/**
 * 누른 때의 판단. 기록이 없거나, 항목이 확실히 거절된 기록인데 글을 바꿨으면 새 추가.
 * 그 밖에는 기록의 초안·id·단계로 이어가되, 지금 범위가 기록의 범위와 다르면 보내지 않고 안내해요.
 */
export function retryPlan(p: Pending | null, text: string, scope: string): Plan {
  if (!p) return { kind: 'new' }
  if (!inputLocked(p) && p.text !== text) return { kind: 'new' }
  if (p.scope !== scope) return { kind: 'other-scope', message: '다른 계정에서 시작한 추가예요 · 그 계정으로 돌아가면 이어서 저장해요' }
  return { kind: 'resume', draft: p.draft, resume: { id: p.id, from: p.from, scope: p.scope } }
}

/** 범위별 기기 저장(SmallStore = 서버·로그인 범위)에서 빠른 추가 실패 기록을 담는 이름. 자리(slot)별로: 'bar' | 'sheet' | 'goal:<목표 id>' */
export const SLOTS = 'quickPending'
const isDraft = (d: unknown): d is Draft => !!d && typeof d === 'object' && typeof (d as Draft).boardId === 'string' && typeof (d as Draft).title === 'string' && Array.isArray((d as Draft).tags) && Array.isArray((d as Draft).props)
const STEPS = ['item', 'note', 'tags', 'props']
export const isPending = (v: unknown): v is Pending => {
  if (!v || typeof v !== 'object') return false
  const p = v as Pending
  return typeof p.id === 'string' && !!p.id && STEPS.includes(p.from) && isDraft(p.draft) && typeof p.text === 'string' && (p.ref === null || typeof p.ref === 'string') && typeof p.scope === 'string' && (p.checked === undefined || ['absent', 'differs', 'conflict'].includes(p.checked)) && (p.unknown === undefined || p.unknown === true)
}
export const isSlots = (v: unknown): v is Record<string, Pending> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isPending)
/** 자리 하나를 바꾼 새 기록 묶음(null 이면 그 자리를 지움) */
export function putSlot(slots: Record<string, Pending>, slot: string, p: Pending | null): Record<string, Pending> {
  const next = { ...slots }
  if (p) next[slot] = p
  else delete next[slot]
  return next
}
/**
 * 닫거나 이탈할 때 확인할 글(리뷰 16): 기록이 있으면 결과 종류와 무관하게 — 확실한 거절(failed)이어도 아직 안 보낸 초안이 기록에 있어요.
 * 화면은 "계속 쓰기 / 닫기(기록 남김) / 버리기(확인창)" 를 보여요. 닫기는 기록을 지우지 않아요
 */
export const closeGuard = (p: Pending | null): string | null =>
  !p ? null : inputLocked(p) ? '결과를 확인하지 못한 추가가 있어요 · 닫아도 기록은 남아 다음에 같은 내용으로 이어서 해요' : '저장하지 못한 추가가 있어요 · 닫아도 기록(쓴 내용)은 남아 다음에 열면 이어서 써요'
/** ✦ AI 정리를 허락할지: 기록이 있는 동안은 막아요(✦ 가 기록을 지우거나 같은 일을 두 갈래로 보내지 않게 — 먼저 끝내거나 버려요, 리뷰 16) */
export const aiAllowed = (p: Pending | null) => !p

export type SlotNotice = { kind: 'read' | 'corrupt' | 'write'; text: string }
/**
 * 기록 자리의 상태로 새 제출을 허락할지(리뷰 6). 읽기 전·읽기 실패·깨짐은 "기록 없음"이 아니라서 막아요(앞의 결과 불명 추가를
 * 모른 채 새로 보내면 중복). 사람이 다시 읽거나 버리고 새로 쓰면 풀려요. 기록을 못 남긴 쓰기 실패는 막지 않고 확인을 요청해요
 */
export function slotGate(s: { ready: boolean; problem: 'read' | 'corrupt' | null; writeFailed: boolean }, what = '빠른 추가'): { canSubmit: boolean; notice: SlotNotice | null } {
  if (!s.ready) return { canSubmit: false, notice: null }
  if (s.problem === 'read') return { canSubmit: false, notice: { kind: 'read', text: `${what} 복구 기록을 읽지 못했어요 · 다시 읽거나, 버리고 새로 쓸 수 있어요(앞의 요청이 저장됐을 수 있어요)` } }
  if (s.problem === 'corrupt') return { canSubmit: false, notice: { kind: 'corrupt', text: `${what} 복구 기록이 깨져 있어요 · 다시 읽거나, 버리고 새로 쓸 수 있어요(앞의 요청이 저장됐을 수 있어요)` } }
  if (s.writeFailed) return { canSubmit: true, notice: { kind: 'write', text: `${what} 이어서 할 기록을 기기에 남기지 못했어요 · 앱을 닫으면 이어서 할 수 없어요. 목록에서 저장됐는지 확인해 주세요` } }
  return { canSubmit: true, notice: null }
}
