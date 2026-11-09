import { useCallback } from 'react'
import { Alert } from 'react-native'
import type { Draft } from '@direction-board/contracts/quick-add'
import { useSaveItem } from '../../../api/board'
import { ScopeChangedError, UnknownWriteError } from '../../../api/client'
import { useWriteScope } from '../../../api/scope'
import { createWithRecord, uid, type Done } from './createScoped'
import type { Pending } from './recovery'

export { uid }
export { STEP_KO, stepFailureText } from '@direction-board/contracts/quick-recovery'

/**
 * 빠른 추가 한 번(한 줄·상세 시트·목표 할 일 공용). 규칙은 recovery.ts(실패 기록·다시 시도 판단)와 createScoped.ts(범위 고정 단계).
 * submit(text, makeDraft, pending): 기록이 있으면 그 초안·id·시작 범위로 잇고(지금 범위가 다르면 보내지 않고 안내), 없으면 새로 만들어요.
 * 새 추가의 범위는 이 훅을 쓴 화면·시트를 연 시점(useWriteScope, 규칙 A).
 * 먼저 기록(규칙 B): 보내기 전에 그 자리에 id·초안·단계·시작 범위를 "결과 불명" 기록으로 남기고 기기에 닿은 뒤에만 보내요
 * (앱이 도중에 꺼져도 다시 열면 같은 id 로 서버를 먼저 확인해 이어요). 기록을 못 남기면 보내지 않아요(not-sent).
 * 결과는 끝남(done) 또는 새 실패 기록(pending) 또는 보내지 않음(other-scope·not-sent).
 */
export function useCreateWork() {
  const save = useSaveItem()
  const scope = useWriteScope()
  return useCallback(
    (text: string, makeDraft: () => Draft, pending: Pending | null, writeAhead: (p: Pending) => Promise<boolean>) =>
      createWithRecord({
        text,
        makeDraft,
        pending,
        writeAhead,
        scope,
        save: (it) =>
          save(it).then(
            () => true as const,
            (e: unknown) => (e instanceof ScopeChangedError ? Promise.reject(e) : e instanceof UnknownWriteError ? ('unknown' as const) : false),
          ),
      }),
    [save, scope],
  )
}

/** 결과를 몰랐던(또는 부분 완료) 기록을 사람이 버릴 때의 확인. 버리기만이 그 기록을 지워요(리뷰 9) */
/** 버리기 확인창. message 는 무엇이 버려지는지 밝히는 글(여러 기록을 담은 파일이면 그 범위 — PR #43 리뷰) */
export function confirmDiscard(onDiscard: () => void, message = '앞에서 보낸 것이 이미 저장됐을 수 있어요. 버린 뒤에는 목록에서 직접 확인해 주세요.') {
  Alert.alert('이 기록을 버릴까요?', message, [
    { text: '남겨 두기', style: 'cancel' },
    { text: '버리기', style: 'destructive', onPress: onDiscard },
  ])
}

/** 끝난(done) 결과 알림 글(웹 reportCreated). 멈춘 결과는 기록 안내(stepFailureText)로 보여요 */
export function createdText(r: Done): string {
  return r.existed ? '앞에서 보낸 할 일이 이미 저장돼 있어요(다시 보내지 않았어요)' : '추가했어요'
}

/** 상세 시트를 여는 요청(직접 추가의 초안·목표 할 일처럼 라우트 인자로 넘기기 어려운 것). 시트가 열리면서 가져가요 */
export type SheetRequest = { text?: string; draft?: Draft | null; onCreated?: () => void }
let pendingSheet: SheetRequest | null = null
export function requestSheet(req: SheetRequest) {
  pendingSheet = req
}
export function takeSheet(): SheetRequest | null {
  const r = pendingSheet
  pendingSheet = null
  return r
}
