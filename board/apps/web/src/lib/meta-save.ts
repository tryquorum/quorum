import { ApiError } from './api'
import { fetchDocMeta, patchDocumentMeta } from './docs-api'

/** 메타데이터 저장 실패의 분류. 문서 속성 패널과 보기의 제목 바로 고치기가 같은 규칙을 써요 */
export type MetaConflict = { version?: number; md?: string; truncated?: boolean }
export type MetaSaveFailure = { kind: 'conflict'; current: MetaConflict } | { kind: 'rejected'; message: string } | { kind: 'unknown' }
export function classifyMetaSaveError(e: unknown): MetaSaveFailure {
  if (e instanceof ApiError && e.status === 409) {
    const body = e.body && typeof e.body === 'object' && 'current' in e.body ? e.body.current : null
    return { kind: 'conflict', current: body && typeof body === 'object' ? body : {} }
  }
  if (e instanceof ApiError && (e.status === 400 || e.status === 413)) return { kind: 'rejected', message: e.message }
  return { kind: 'unknown' }
}
export const META_SAVE_MESSAGE = {
  conflict: '다른 곳에서 변경됐어요. 입력한 값은 보존되며 자동으로 덮어쓰지 않아요.',
  rejected: (message: string) => `서버가 입력값을 거부했어요: ${message}`,
  unknown: '저장 결과를 확인하지 못했어요. 입력한 값을 복사하고 서버 상태를 확인해 주세요.',
}

/** 제목을 고칠 수 있는 종류(서버 meta 규칙과 같음): 문서·할 일·목표·사건. 보관은 복원 뒤에 */
export function titleEditBlock(doc: { kind: string; status: string }): string | null {
  if (doc.status === 'archived') return '보관된 문서는 복원한 뒤 제목을 바꿀 수 있어요.'
  if (doc.kind === 'run') return '대화 제목은 첫 질문이라 바꿀 수 없어요.'
  return ['doc', 'todo', 'goal', 'signal'].includes(doc.kind) ? null : '이 문서는 제목을 바꿀 수 없어요.'
}
/** 한 줄, 1~200자(서버 meta 규칙과 같음) */
export function cleanTitle(value: string): string | null {
  const next = value.replace(/\r?\n/g, ' ').trim()
  return next && Array.from(next).length <= 200 ? next : null
}
/** 고치기를 시작할 때의 version 을 읽어 둬요. 그 사이 다른 곳에서 바뀌면 저장이 409 로 막혀요 */
export async function startTitleEdit(ref: string) {
  const meta = await fetchDocMeta(ref)
  if (meta.ref !== ref || !Number.isSafeInteger(meta.version)) throw new Error('문서 버전을 확인하지 못했어요.')
  return { version: meta.version, title: meta.title }
}
export const saveTitle = (ref: string, title: string, expectedVersion: number) => patchDocumentMeta(ref, { title, expectedVersion })
