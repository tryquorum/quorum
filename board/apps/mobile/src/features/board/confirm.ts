// 결과를 모르는 쓰기의 확인 — 읽기만(PR #39 리뷰 9: 결과가 불명인 쓰기는 앱이 스스로 다시 쓰지 않는다. 확인만 한다).
// 이 파일에는 쓰기가 없어요(writeRules.test.ts 가 소스로 고정). 다시 보내기는 사람이 눌렀을 때 replays.ts RESEND 가 해요.
import type { CreateInput, Item, NoteSource } from '@direction-board/contracts'
import { ApiError, ConflictError, type Client } from '../../api/client'
import { workOps } from '../../api/work'
import { runByClientKey } from './quick/captureApi'
import type { Intent, IntentKind } from './intents'
import type { AnswerRun } from './work/answerWith'
import type { MakeWorkArgs } from './work/makeWork'
import { quoteRef } from './work/makeWork'
import { answerToNote } from './work/noteQuote'

export type RunBody = Record<string, unknown> & { prompt: string }
/** 확인 결과. done: 이미 들어가 있음(open 은 열 곳) · absent: 서버에 없음(사람이 다시 보낼 수 있음) · partial: 앞 단계는 있고 남은 단계가 있음 */
export type Seen = { kind: 'done'; open?: string } | { kind: 'absent' } | { kind: 'partial'; open: string; remaining: ('link' | 'draft')[] }
/** 읽어서 판정하려면 필요한 서버 약속(없으면 unsupported — 확인할 수 없어 사람이 확인 뒤 버리기). 키로 실행을 찾는 읽기는 runClientKey 가 있어야 걸러져요 */
export const NEEDS: Record<IntentKind, string | null> = { run: 'runClientKey', work: 'runClientKey', note: null, answer: null, doc: null, item: null }

const missing = (e: unknown) => e instanceof ApiError && !(e instanceof ConflictError) && e.status === 404
/** 읽기: 404 면 null, 그 밖의 오류는 그대로(결과 불명) */
const orNull = <T,>(p: Promise<T>): Promise<T | null> => p.catch((e: unknown) => (missing(e) ? null : Promise.reject(e)))

/**
 * 노트에 그 쓰기가 들어갔는지: 서버가 onceKey 적용 여부를 알려 주면 그것으로(onceApplied), 모르는 옛 서버는 본문에 그 글이 있는지로.
 * 노트가 없으면(404) 들어가지 않은 것
 */
export async function noteHas(read: () => Promise<NoteSource>, body: string): Promise<boolean> {
  const s = await orNull(read())
  if (!s) return false
  if (typeof s.onceApplied === 'boolean') return s.onceApplied
  return s.md.includes(body.trim())
}

export const CONFIRM: { [K in IntentKind]: (c: Client, i: Intent) => Promise<Seen> } = {
  run: async (c, i) => {
    const run = await runByClientKey(c, i.key)
    return run ? { kind: 'done', open: `run:${run.thread || run.id}` } : { kind: 'absent' }
  },
  // 새 일: 같은 ref 의 사건을 찾고(다시 만들지 않아요), 잇기·초안 실행이 있는지 읽어 남은 단계를 알려요
  work: async (c, i) => {
    const a = (i.payload as { a: MakeWorkArgs }).a
    const w = workOps(c)
    const ref = quoteRef(i.key)
    const sig = (await w.signalsByRef(ref)).signals.find((s) => s.ref === ref)
    if (!sig) return { kind: 'absent' }
    const open = `signal:${sig.id}`
    const work = await w.work(open)
    const remaining: ('link' | 'draft')[] = []
    if (!work.links.some((l) => l.other.ref === a.ref)) remaining.push('link')
    if (!(await runByClientKey(c, `${i.key}:draft`))) remaining.push('draft')
    return remaining.length ? { kind: 'partial', open, remaining } : { kind: 'done', open }
  },
  note: async (c, i) => {
    const p = i.payload as { ref: string; draft: { id: string; output: string } }
    return (await noteHas(() => workOps(c).noteOnce(p.ref, `run:${p.draft.id}`), p.draft.output)) ? { kind: 'done', open: p.ref } : { kind: 'absent' }
  },
  answer: async (c, i) => {
    const p = i.payload as { ref: string; run: AnswerRun }
    const body = answerToNote(p.run)?.md ?? p.run.output
    return (await noteHas(() => workOps(c).noteOnce(p.ref, `run:${p.run.id}`), body)) ? { kind: 'done', open: p.ref } : { kind: 'absent' }
  },
  doc: async (c, i) => {
    const ref = `doc:${(i.payload as { input: CreateInput & { id: string } }).input.id}`
    return (await orNull(workOps(c).docMeta(ref))) ? { kind: 'done', open: ref } : { kind: 'absent' }
  },
  item: async (c, i) => {
    const it = (i.payload as { item: Item }).item
    const ref = `item:${it.boardId}:${it.id}`
    return (await orNull(workOps(c).work(ref))) ? { kind: 'done', open: ref } : { kind: 'absent' }
  },
}
