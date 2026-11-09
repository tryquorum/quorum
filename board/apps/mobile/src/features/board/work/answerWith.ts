// 대화 답을 일 노트에 넣기 한 번(범위 고정 클라이언트 하나로). 화면 훅(toNote.ts)과 홈의 다시 확인(replays.ts)이 같이 써요. 규칙은 addAnswer.ts.
import type { Run } from '@direction-board/contracts'
import type { ScopedClient } from '../../../api/client'
import { workOps } from '../../../api/work'
import { noteOps } from '../../../notes/api'
import { addAnswerToNote } from './addAnswer'

export type AnswerRun = Pick<Run, 'id' | 'prompt' | 'output' | 'target'> & { applied?: number }

export function answerToNoteWith(c: ScopedClient, ref: string, run: AnswerRun) {
  const w = workOps(c)
  const n = noteOps(c)
  return addAnswerToNote(
    {
      scope: c.scope,
      source: () => n.source(ref),
      seen: (key) => w.noteOnce(ref, key),
      append: (md, v, key) => w.appendNote(ref, md, v, key),
      start: () => w.startNote(ref),
      markApplied: () => w.markApplied(run.id),
    },
    ref,
    run,
  )
}
