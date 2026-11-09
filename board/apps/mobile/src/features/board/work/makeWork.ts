// 노트에서 고른 부분으로 새 일(웹 work-view makeWork). 범위 고정 클라이언트를 받아 bun 으로 시험해요(Work 가 부름).
import { ConflictError, ScopeChangedError, UnknownWriteError, type Client } from '../../../api/client'
import { workOps } from '../../../api/work'
import { outcomeOf, workFromQuote, type Outcome } from './noteQuote'
import { DRAFT_PROMPT } from './draftPrompt'

const settle = (p: Promise<unknown>): Promise<Outcome> => p.then(() => 'ok' as const, outcomeOf)

export type MakeWorkArgs = { ref: string; sel: string; noteText: string; parentTitle: string; model: Record<string, string | undefined> }
export type MakeWorkResult =
  | { kind: 'made'; next: string; title: string; linked: Outcome; drafted: Outcome }
  | { kind: 'unknown' }
  | { kind: 'scope'; error: string }
  | { kind: 'failed'; error: unknown }

/** 먼저 기록에 남길지(결과를 모르는 단계가 있으면 같은 키로 다시 확인해요) */
export const makeWorkUnknown = (r: MakeWorkResult) => r.kind === 'unknown' || (r.kind === 'made' && (r.linked === 'unknown' || r.drafted === 'unknown'))

/** 새 일 노트 초안 실행 요청(처음 만들 때와 홈의 이어 하기가 같은 본문·같은 clientKey "<key>:draft") */
export const draftRunBody = (a: MakeWorkArgs, next: string, key?: string) => ({
  target: next,
  kind: 'draft' as const,
  prompt: `이 일은 「${a.parentTitle}」에서 나온 일이야. 그 일의 노트:\n${a.noteText.slice(0, 3000)}\n\n${DRAFT_PROMPT}`,
  ...a.model,
  ...(key ? { clientKey: `${key}:draft` } : {}),
})
/** 새 일의 사건 ref(먼저 기록의 키로 정해져요 — 복구는 이 ref 로 찾고 다시 만들지 않아요) */
export const quoteRef = (key: string) => `note-quote:${key}`

/**
 * 사건 만들기 → 이 일과 "관련"으로 잇기 → 새 일의 노트 초안 실행. 단계마다 범위 고정 클라이언트로 보내서,
 * 만든 뒤 범위가 바뀌면 잇기·초안은 보내지 않고 scope 로 알려요(끝난 단계·남은 단계를 그대로).
 * key(먼저 기록의 키, 규칙 B)를 주면 단계마다 서버에서 멱등이라 같은 키로 다시 보내도 하나만 생겨요:
 * 사건은 ref "note-quote:<key>"(같은 ref 는 갱신), 잇기는 이미 있으면 409(이어진 것), 초안 실행은 clientKey "<key>:draft".
 */
export async function makeWorkFromQuote(c: Client, a: MakeWorkArgs, key?: string): Promise<MakeWorkResult> {
  const w = workOps(c)
  const body = { ...workFromQuote(a.sel, a.parentTitle), ...(key ? { ref: quoteRef(key) } : {}) }
  let next: string
  try {
    next = `signal:${(await w.createSignal(body)).id}`
  } catch (e) {
    if (e instanceof ScopeChangedError) return { kind: 'scope', error: e.message }
    if (e instanceof UnknownWriteError) return { kind: 'unknown' }
    return { kind: 'failed', error: e }
  }
  const linked = await settle(w.link(next, a.ref, '관련').catch((e: unknown) => (e instanceof ConflictError ? null : Promise.reject(e))))
  const drafted = await settle(w.startRun(draftRunBody(a, next, key)))
  return { kind: 'made', next, title: body.title, linked, drafted }
}
