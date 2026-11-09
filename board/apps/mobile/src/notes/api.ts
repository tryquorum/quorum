// 노트 읽기·저장 경로(레인 1·2 공용). 같은 REST 계약(packages/contracts)이에요.
import type { NoteSource, WriteResult } from '@direction-board/contracts'
import { byOrigin, type Client } from '../api/client'

const path = (ref: string) => `/api/docs/${encodeURIComponent(ref)}`
export const noteOps = (c: Client) => ({
  /** 편집 원문 md·version 과 iOS 편집 허락(markdownEditable). 노트가 없으면 404 */
  source: (ref: string) => c.request<NoteSource>(path(ref) + '/note'),
  /** 노트 전체를 md 로 바꿔 써요. 서버가 html 을 만들고, expectedVersion 이 다르면 409(current 포함). onceKey 는 같은 키를 한 번만 적용(서버 docs write) */
  replace: (ref: string, md: string, expectedVersion: number, onceKey?: string) =>
    c.write<WriteResult>(path(ref) + '/write', 'POST', { mode: 'replace', md, expectedVersion, ...(onceKey ? { onceKey } : {}) }),
})
/** 읽기만 notesApi.x(origin, ...). 쓰기(replace)는 noteOps(useWriteScope()) — 화면을 연 시점의 서버·계정으로만 */
export const notesApi = byOrigin(noteOps, ['source'])

/**
 * 이 노트를 iOS 에서 고칠 수 있는지. 서버가 엄격 변환으로 웹 서식을 지킬 수 있다고 한 노트(markdownEditable: true)만이에요.
 * 필드가 없는 옛 서버도 막아요. 클라이언트에서 HTML 을 다시 판정하지 않아요(docs/internals/mobile-ia.md "노트 편집").
 */
export function noteEditability(source: NoteSource | null | undefined): { editable: true } | { editable: false; reason: string } {
  if (!source) return { editable: false, reason: '노트를 불러오지 못해 고칠 수 없어요' }
  if (source.markdownEditable !== true) return { editable: false, reason: '웹 편집기의 서식 중 iOS 가 그대로 지킬 수 없는 것이 있어 편집을 막았어요. 웹에서 고쳐 주세요' }
  return { editable: true }
}
