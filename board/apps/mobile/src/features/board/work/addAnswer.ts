// 대화 답을 일 노트 끝에 넣기(웹 chat-pane "노트에 넣기"). 입출력을 받아 bun 으로 시험해요. 화면 입구는 toNote.ts(범위 고정 클라이언트로 IO 를 만들어요).
import type { NoteSource, Run, WriteResult } from '@direction-board/contracts'
import { ApiError, ConflictError, UnknownWriteError } from '../../../api/client'
import { noteHas } from '../confirm'
import { planNoteAdd, UNSAFE_APPEND_TEXT, unsafeAppend } from './noteJoin'
import { answerToNote } from './noteQuote'

export type NoteIO = {
  /** 범위(서버·로그인) 이름. 같은 작업 묶기에 써요 */
  scope: string
  /** GET /api/docs/:ref/note(편집 원문 md·version·markdownEditable). 노트가 없으면 404 */
  source: () => Promise<NoteSource>
  /** GET /api/docs/:ref/note?onceKey(그 키가 이미 적용됐는지 onceApplied — 결과를 모를 때 읽어서 확인만) */
  seen: (onceKey: string) => Promise<NoteSource>
  /** docs write append(기존 md·HTML 은 그대로 앞에, 뒤에 가로줄 + 새 글). 읽은 버전·onceKey 를 함께 보내요 */
  append: (md: string, expectedVersion: number, onceKey: string) => Promise<WriteResult>
  /** 노트가 없는 일의 첫 빈 노트 */
  start: () => Promise<unknown>
  /** 서버 실행의 적용 표시(PATCH /api/runs/:id {applied}) */
  markApplied: () => Promise<unknown>
}
const missing = (e: unknown) => e instanceof ApiError && !(e instanceof ConflictError) && e.status === 404
const ATTEMPTS = 3
/** 같은 범위·노트·실행 작업은 하나로 묶어요(겹쳐 눌러도 서버에는 한 번) */
const inflight = new Map<string, Promise<'added' | 'already'>>()

/**
 * 웹은 편집기 끝에 <h3>질문 첫 줄</h3> + 답을 넣고 HTML·md 를 함께 저장해요. 앱은 늘 읽은 버전을 보낸 append 로 넣어요(noteJoin.ts):
 * 서버가 기존 md·HTML 을 한 글자도 바꾸지 않고 가로줄 뒤에 붙여요(리뷰 11 불변식). 끝이 열린 코드 펜스·HTML 블록이면 쓰기 0건으로 멈춰요.
 * 모든 쓰기에 onceKey "run:<실행 id>" 를 붙여요. 서버는 같은 (노트, 키) 를 노트 쓰기와 같은 트랜잭션에서 한 번만 적용하고,
 * 다시 오면 버전 검사보다 먼저 duplicate 로 답해요. 409(확실한 거절)면 다시 읽어 최신 노트 위에 다시 해요.
 * 결과를 모르면 다시 쓰지 않고 읽어서 확인만 해요(리뷰 9): 들어가 있으면 넣은 것, 아니면 결과 불명 그대로.
 * 서버 실행이 이 노트를 위해 이미 적용 표시돼 있으면 보내지 않아요. 범위가 바뀌면 IO(범위 고정 클라이언트)가 ScopeChangedError 를 던져 그 자리에서 멈춰요.
 */
export function addAnswerToNote(io: NoteIO, ref: string, run: Pick<Run, 'id' | 'prompt' | 'output' | 'target'> & { applied?: number }): Promise<'added' | 'already'> {
  const k = `${io.scope}|${ref}|${run.id}`
  const running = inflight.get(k)
  if (running) return running
  const p = add(io, ref, run).finally(() => {
    if (inflight.get(k) === p) inflight.delete(k)
  })
  inflight.set(k, p)
  return p
}

async function add(io: NoteIO, ref: string, run: Pick<Run, 'id' | 'prompt' | 'output' | 'target'> & { applied?: number }): Promise<'added' | 'already'> {
  const body = answerToNote(run)
  if (!body) throw new Error('넣을 답이 없어요')
  const forThis = run.target === ref
  if (forThis && !!run.applied) return 'already'
  const once = `run:${run.id}`
  const read = async () => {
    try {
      return await io.source()
    } catch (e) {
      if (!missing(e)) throw e
      // 노트 없음: 첫 노트를 만들어요(그사이 누가 만들었으면 409 라 그대로 이어가요)
      await io.start().catch((x: unknown) => {
        if (!(x instanceof ConflictError)) throw x
      })
      return io.source()
    }
  }
  const done = async (): Promise<'added'> => {
    if (forThis) await io.markApplied().catch(() => undefined)
    return 'added'
  }
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const src = await read()
    // 기존 md·HTML 은 한 글자도 바꾸지 않아요(noteJoin.ts): 끝이 열린 문맥이면 멈추고, 아니면 append
    const plan = planNoteAdd(src.md)
    if (plan.kind === 'stop') throw new Error(plan.reason)
    try {
      const r = await io.append(body.md, src.version, once)
      if (r.duplicate) return 'already'
      if (!r.applied) return 'already' // onceKey 를 모르는 옛 서버의 본문 같음 판정
      return await done()
    } catch (e) {
      if (unsafeAppend(e)) throw new Error(UNSAFE_APPEND_TEXT) // 서버의 최종 판정 거절: 쓰기 0건(결과 불명 아님)
      if (e instanceof ConflictError) continue
      if (!(e instanceof UnknownWriteError)) throw e
      // 결과를 모름: 다시 쓰지 않고 읽어서 확인만(onceKey 적용 여부, 옛 서버는 본문). 확인 길에서는 적용 표시(PATCH)도 보내지 않아요(리뷰 10)
      if (await noteHas(() => io.seen(once), body.md).catch(() => false)) return 'added'
      throw e
    }
  }
  throw new Error('노트가 계속 바뀌고 있어요. 잠시 뒤 다시 넣어 주세요')
}
