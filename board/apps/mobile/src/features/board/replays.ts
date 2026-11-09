// 끝나지 않은 요청(intents.ts)의 확인과 다시 보내기. 화면 훅 없이 실제 클라이언트로 시험해요(replays.test.ts·review11.test.ts).
// 원칙(PR #39 리뷰 9): 결과가 불명인 쓰기는 앱이 스스로 다시 쓰지 않아요.
// - confirmIntent: 읽기만(confirm.ts CONFIRM). 들어가 있으면 기록을 지우고, 없거나 남은 단계가 있으면 그 상태를 알려요(기록은 남김).
// - resendIntent: 사람이 "다시 보내기·이어 하기"를 눌렀을 때만. 보내기 직전에 다시 읽어 확인하고, 없을 때만·남은 단계만 보내요.
//   사건은 다시 만들지 않아요(같은 ref 가 있으면 그대로). 다시 보낸 결과가 거절·결과 불명이어도 기록을 지우지 않아요(버리기는 사람이).
import type { CreateInput, Item, Run } from '@direction-board/contracts'
import { api, ConflictError, type ScopedClient } from '../../api/client'
import { docsApi } from '../../api/docs'
import { workOps } from '../../api/work'
import { CONFIRM, NEEDS, type RunBody, type Seen } from './confirm'
import { unknownLike, type Intent, type Journal } from './intents'
import { answerToNoteWith, type AnswerRun } from './work/answerWith'
import { insertDraftNote } from './work/insertDraft'
import { draftRunBody, makeWorkFromQuote, type MakeWorkArgs } from './work/makeWork'

export type { RunBody }

/** 사람이 누른 다시 보내기 — 확인(seen)이 absent·partial 일 때만 불려요 */
const RESEND: { [K in Intent['kind']]: (c: ScopedClient, i: Intent, seen: Seen) => Promise<unknown> } = {
  run: (c, i) => c.write<Run>('/api/runs', 'POST', { ...(i.payload as { body: RunBody }).body, clientKey: i.key }),
  work: async (c, i, seen) => {
    const a = (i.payload as { a: MakeWorkArgs }).a
    if (seen.kind === 'partial') {
      // 사건은 이미 있어요: 다시 만들지 않고(사람이 고치거나 끝낸 것을 덮지 않게) 남은 단계만
      const w = workOps(c)
      if (seen.remaining.includes('link')) await w.link(seen.open, a.ref, '관련').catch((e: unknown) => (e instanceof ConflictError ? null : Promise.reject(e)))
      if (seen.remaining.includes('draft')) await w.startRun(draftRunBody(a, seen.open, i.key))
      return
    }
    const r = await makeWorkFromQuote(c, a, i.key)
    if (r.kind === 'unknown') throw Object.assign(new Error('새 일을 만들었는지 아직 확인하지 못했어요'), { unknownWrite: true })
    if (r.kind === 'scope') throw Object.assign(new Error(r.error), { scopeChanged: true })
    if (r.kind === 'failed') throw r.error
    // 만든 뒤 잇기·초안이 실패하거나 결과를 모르면 끝으로 치지 않아요(기록을 남겨 다음 확인이 남은 단계를 알려요)
    if (r.linked !== 'ok' || r.drafted !== 'ok') throw Object.assign(new Error('새 일은 만들었고 남은 단계를 끝내지 못했어요'), { unknownWrite: true })
  },
  note: (c, i) => {
    const p = i.payload as { ref: string; draft: { id: string; output: string } }
    return insertDraftNote(c, p.ref, p.draft)
  },
  answer: (c, i) => {
    const p = i.payload as { ref: string; run: AnswerRun }
    return answerToNoteWith(c, p.ref, p.run)
  },
  doc: (c, i) => docsApi.create(c, (i.payload as { input: CreateInput & { id: string } }).input),
  item: (c, i) => api.saveItem(c, (i.payload as { item: Item }).item),
}

export type ReplayResult = Seen | { kind: 'unsupported' } | { kind: 'unknown'; message: string } | { kind: 'failed'; message: string }
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

/** 읽어서 확인만. 필요한 서버 약속이 없으면 unsupported(읽어도 판정할 수 없어요). caps 를 못 읽으면 약속이 없는 것으로 봐요 */
async function seenOf(c: ScopedClient, i: Intent, caps: () => Promise<string[]>): Promise<ReplayResult> {
  const need = NEEDS[i.kind]
  if (need && !(await caps().catch(() => [] as string[])).includes(need)) return { kind: 'unsupported' }
  try {
    return await CONFIRM[i.kind](c, i)
  } catch (e) {
    return { kind: 'unknown', message: errText(e, '아직 확인하지 못했어요') }
  }
}

/** 확인(읽기만, 쓰기 0건). 들어가 있으면 기록을 지워요. 그 밖에는 기록 그대로 */
export async function confirmIntent(j: Journal, c: ScopedClient, i: Intent, caps: () => Promise<string[]>): Promise<ReplayResult> {
  const r = await seenOf(c, i, caps)
  if (r.kind === 'done') j.drop(i.key)
  return r
}

/**
 * 사람이 누른 다시 보내기·이어 하기. 먼저 다시 읽어(그사이 들어갔으면 보내지 않고 끝) 없을 때만·남은 단계만 보내요.
 * 성공이면 기록을 지우고, 거절·결과 불명이면 남겨요(이미 적용됐을 수 있어 버리기는 사람이)
 */
export async function resendIntent(j: Journal, c: ScopedClient, i: Intent, caps: () => Promise<string[]>): Promise<ReplayResult> {
  const seen = await seenOf(c, i, caps)
  if (seen.kind === 'done') {
    j.drop(i.key)
    return seen
  }
  if (seen.kind !== 'absent' && seen.kind !== 'partial') return seen
  try {
    await RESEND[i.kind](c, i, seen)
    j.drop(i.key)
    return { kind: 'done', ...(seen.kind === 'partial' ? { open: seen.open } : {}) }
  } catch (e) {
    const message = errText(e, '보내지 못했어요')
    return unknownLike(e) || (!!e && typeof e === 'object' && 'scopeChanged' in e) ? { kind: 'unknown', message } : { kind: 'failed', message }
  }
}
