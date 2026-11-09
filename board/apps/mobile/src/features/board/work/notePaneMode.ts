// 일 상세 노트 갈래에서 편집 길을 열지(레인 0 notes 모듈의 판정을 따름). 순수 함수라 bun 으로 시험해요.
import type { NoteSource } from '@direction-board/contracts'
import { noteEditability } from '../../../notes/api'

export type NotePaneMode =
  /** 편집 화면(문서 페이지의 노트 편집기)으로 가도 됨 */
  | { kind: 'edit' }
  /** 노트가 아직 없어요: 빈 노트(버전 0)를 만든 뒤 편집으로 */
  | { kind: 'start' }
  /** 읽기만. reason 은 화면에 그대로 보여요 */
  | { kind: 'readonly'; reason: string; retry?: boolean }

/**
 * noteVersioning: GET /api/work 가 알려 준 버전 보호. 없으면(옛 서버) 버전 없는 덮어쓰기를 막으려고 읽기만.
 * source: GET /api/docs/:ref/note(markdownEditable 포함). sourceError: 'missing'(404) | 'error'(그 밖)
 */
export function notePaneMode(input: { noteVersioning?: boolean; hasNote: boolean; source?: NoteSource | null; sourceError?: 'missing' | 'error' | null }): NotePaneMode {
  if (input.noteVersioning !== true) return { kind: 'readonly', reason: '이 서버는 노트 버전 보호를 알리지 않아 앱에서 고칠 수 없어요. 웹에서 고쳐 주세요' }
  if (!input.hasNote) return { kind: 'start' }
  if (input.sourceError === 'missing') return { kind: 'readonly', reason: '노트 원문을 찾지 못해 고칠 수 없어요', retry: true }
  if (input.sourceError === 'error' || !input.source) return { kind: 'readonly', reason: '노트 편집 정보를 불러오지 못했어요', retry: true }
  const e = noteEditability(input.source)
  return e.editable ? { kind: 'edit' } : { kind: 'readonly', reason: e.reason }
}
