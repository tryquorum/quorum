// 제목 바꾸기(웹 use-doc-rename.ts 와 같은 순서): 먼저 최신 제목과 version 을 함께 읽고, 그 제목으로 입력을 열고, 그 version 으로 저장해요.
// 입력하는 동안 다른 기기가 제목을 바꿨으면 409 가 나고, 입력값을 그대로 담아 새 version 으로만 다시 보낼 수 있게 해요. 결과를 모르면 다시 보내지 않아요.
import { Alert } from 'react-native'
import { ApiError, ConflictError, errorMessage, UnknownWriteError } from '../../api/client'
import { docsApi } from '../../api/docs'
import type { ScopedClient } from '../../api/client'
import { docsChanged } from './events'

/** 제목을 고칠 수 있는 문서: 할 일·목표·문서·사건, 보관 아님(서버 meta.ts) */
export const canRename = (doc: { kind: string; status: string }) => ['doc', 'todo', 'goal', 'signal'].includes(doc.kind) && doc.status !== 'archived'

/** alive: 저장 직전에 확인(입력하는 동안 서버·계정이 바뀌었으면 보내지 않아요) */
export async function renameDoc(origin: string, scope: ScopedClient, ref: string, notify: (message: string) => void, alive: () => boolean = () => true) {
  let meta
  try {
    meta = await docsApi.meta(origin, ref)
  } catch (e) {
    notify(`제목을 확인하지 못했어요: ${errorMessage(e)}`)
    return
  }
  ask(origin, scope, ref, meta.title, meta.title, meta.version, notify, alive)
}

function ask(origin: string, scope: ScopedClient, ref: string, original: string, value: string, version: number, notify: (message: string) => void, alive: () => boolean, note?: string) {
  Alert.prompt(
    '제목 바꾸기',
    note,
    [
      { text: '취소', style: 'cancel' },
      {
        text: '저장',
        onPress: (input?: string) => {
          const title = (input ?? '').replace(/\r?\n/g, ' ').trim()
          if (!title || title === original) return
          if (!alive()) return notify('서버나 계정이 바뀌어 제목을 보내지 않았어요')
          void docsApi.patchMeta(scope, ref, { title, expectedVersion: version }).then(
            () => {
              notify('제목을 바꿨어요')
              docsChanged()
            },
            async (e: unknown) => {
              if (e instanceof ConflictError) {
                try {
                  const now = await docsApi.meta(origin, ref)
                  ask(origin, scope, ref, now.title, title, now.version, notify, alive, `다른 곳에서 바뀌었어요. 지금 서버 제목: ${now.title}\n저장하면 입력한 제목으로 바꿔요.`)
                } catch {
                  notify('다른 곳에서 바뀌었어요. 목록을 새로 읽어 주세요')
                }
                docsChanged()
              } else if (e instanceof UnknownWriteError) {
                notify('제목 저장 결과를 확인하지 못했어요. 다시 보내지 않고 목록을 새로 읽었어요')
                docsChanged()
              } else notify(e instanceof ApiError ? `제목을 바꾸지 못했어요: ${e.message}` : errorMessage(e))
            },
          )
        },
      },
    ],
    'plain-text',
    value,
  )
}
