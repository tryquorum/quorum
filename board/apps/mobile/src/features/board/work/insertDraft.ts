// 일 노트에 AI 초안 넣기(웹 work-view "노트에 넣기"). 범위 고정 클라이언트를 받아 bun 으로 시험해요(NotePane 이 부름).
import type { NoteSource, Run } from '@direction-board/contracts'
import { ApiError, ConflictError, UnknownWriteError, type Client } from '../../../api/client'
import { workOps } from '../../../api/work'
import { noteOps } from '../../../notes/api'
import { noteHas } from '../confirm'
import { planNoteAdd, UNSAFE_APPEND_TEXT, unsafeAppend } from './noteJoin'

const missing = (e: unknown) => e instanceof ApiError && !(e instanceof ConflictError) && e.status === 404
const ATTEMPTS = 3

/**
 * 노트 끝에 초안을 읽은 버전을 보낸 append 로 붙여요(서버가 기존 md·HTML 을 그대로 두고 가로줄 뒤에, noteJoin.ts — 리뷰 11 불변식). onceKey "run:<초안 id>" 로
 * 서버가 같은 초안을 한 번만 적용해요(다른 기기에서 넣은 것도 duplicate). 409(확실한 거절)면 다시 읽어 최신 노트 위에 다시 해요.
 * 결과를 모르면 다시 쓰지 않고 읽어서 확인만 해요(리뷰 9): 들어가 있으면 넣은 것, 아니면 결과 불명 그대로(먼저 기록이 남아 홈에서 확인).
 * 노트가 없으면 빈 노트부터. 저장 뒤 적용 표시는 따로 결과를 알려요. 범위가 바뀌면 클라이언트가 ScopeChangedError 로 멈춰요.
 */
export async function insertDraftNote(c: Client, ref: string, draft: Pick<Run, 'id' | 'output'>): Promise<{ saved: 'added' | 'already'; applied: boolean }> {
  const n = noteOps(c)
  const w = workOps(c)
  const once = `run:${draft.id}`
  const out = draft.output.trim()
  const read = async (): Promise<NoteSource> => {
    try {
      return await n.source(ref)
    } catch (e) {
      if (!missing(e)) throw e
      await w.startNote(ref).catch((x: unknown) => {
        if (!(x instanceof ConflictError)) throw x
      })
      return n.source(ref)
    }
  }
  let saved: 'added' | 'already' | null = null
  let confirmed = false
  for (let attempt = 0; attempt < ATTEMPTS && !saved; attempt++) {
    const src = await read()
    // 쓰기 직전에 방금 읽은 노트로 판정해요(충돌 뒤 다시 읽은 노트도): 끝이 열린 코드 펜스·HTML 블록이면 멈추고, 아니면 append
    const plan = planNoteAdd(src.md)
    if (plan.kind === 'stop') throw new Error(plan.reason)
    try {
      const r = await w.appendNote(ref, out, src.version, once)
      saved = r.duplicate || !r.applied ? 'already' : 'added'
    } catch (e) {
      if (unsafeAppend(e)) throw new Error(UNSAFE_APPEND_TEXT) // 서버의 최종 판정 거절: 쓰기 0건(결과 불명 아님)
      if (e instanceof ConflictError) continue
      if (!(e instanceof UnknownWriteError)) throw e
      // 결과를 모름: 다시 쓰지 않고 읽어서 확인만(onceKey 적용 여부, 옛 서버는 본문)
      if (!(await noteHas(() => w.noteOnce(ref, once), out).catch(() => false))) throw e
      saved = 'added'
      confirmed = true
    }
  }
  if (!saved) throw new Error('노트가 계속 바뀌고 있어요. 잠시 뒤 다시 넣어 주세요')
  // 확인 길(결과를 몰랐다가 읽어서 들어간 것을 앎)에서는 적용 표시를 보내지 않아요(리뷰 10). 초안 카드는 남고, 사람이 다시 누르면 서버가 duplicate 로 답한 뒤 표시해요
  if (confirmed) return { saved, applied: false }
  const applied = await w.markApplied(draft.id).then(
    () => true,
    () => false,
  )
  return { saved, applied }
}
