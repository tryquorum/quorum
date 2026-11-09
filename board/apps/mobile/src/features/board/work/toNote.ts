// 대화 답을 일 노트에 넣기(웹 chat-pane "노트에 넣기")의 화면 입구와 일 화면의 AI 실행 모델. 레인 3 의 대화 화면(Thread)이 부르는 입구예요.
import { useCallback } from 'react'
import { useWriteScope } from '../../../api/scope'
import { getPrefs } from '../../settings/prefs'
import { withIntent } from '../intents'
import { useIntents } from '../useIntents'
import { answerToNoteWith, type AnswerRun } from './answerWith'

/**
 * 대화 답을 이 일 노트 끝에. 이 훅을 쓴 화면(대화)을 연 시점의 범위 고정 클라이언트로 보내서(규칙 A), 그 뒤 서버·로그인이 바뀌면
 * 어떤 요청도 보내지 않고 ScopeChangedError 로 멈춰요(다른 계정의 같은 ref·같은 버전 노트를 덮지 않게).
 * 먼저 기록(규칙 B): 보내기 전에 ref·답을 기록해 결과를 모르거나 앱이 꺼져도 홈에서 같은 onceKey(run:<id>)로 다시 확인해요.
 */
export function useAnswerToNote() {
  const c = useWriteScope()
  const intents = useIntents()
  const journal = intents.journal
  return useCallback(
    (ref: string, run: AnswerRun) => {
      const keep: AnswerRun = { id: run.id, prompt: run.prompt, output: run.output, target: run.target, ...(run.applied !== undefined ? { applied: run.applied } : {}) }
      return withIntent(journal, { key: `answer:${run.id}:${ref}`, kind: 'answer', scope: c.scope, at: Date.now(), label: '대화 답을 노트에 넣기', payload: { ref, run: keep } }, () => answerToNoteWith(c, ref, keep))
    },
    [c, journal],
  )
}

/** 대화 화면에서 "노트 보기": 바로 아래가 그 일 화면이면 돌아가고, 아니면 그 일을 새로 열어요 */
export function showWorkNote(nav: { getState: () => { routes: readonly { name: string; params?: object }[] }; goBack: () => void; push: (name: 'Work', params: { ref: string }) => void }, ref: string) {
  const routes = nav.getState().routes
  const below = routes[routes.length - 2]
  if (below?.name === 'Work' && (below.params as { ref?: string } | undefined)?.ref === ref) nav.goBack()
  else nav.push('Work', { ref })
}

/** 일 화면에서 시작하는 AI 실행의 모델(웹 work-view savedModel: 고른 기본 모델, 없으면 서버 기본) */
export function savedModel(): { provider?: string; model?: string; effort?: string } {
  const c = getPrefs().model
  return c ? { provider: c.provider, model: c.model, effort: c.effort } : {}
}
