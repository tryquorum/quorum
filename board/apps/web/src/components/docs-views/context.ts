import { createContext, useContext } from 'react'
import type { SearchResult } from '@/lib/docs-api'

type Hit = SearchResult['results'][number]
/** 보기가 다루는 문서 한 개. 검색 결과(Hit) 또는 링크 열의 관계 노드(ref·종류·제목·상태만) */
export type DocLite = Pick<Hit, 'ref' | 'kind' | 'title' | 'status'> & Partial<Omit<Hit, 'ref' | 'kind' | 'title' | 'status'>>
export type RenameState = { ref: string; original: string; value: string; version: number | null; busy: boolean; error: string; conflict: boolean; serverTitle?: string }

/** 네 보기가 함께 쓰는 선택·열기·빠른 미리보기·제목 고치기 */
export type DocsViewApi = {
  selected: string | null
  select: (doc: DocLite | null) => void
  open: (ref: string) => void
  quickLook: (doc: DocLite) => void
  rename: RenameState | null
  startRename: (doc: DocLite) => void
  setRenameValue: (value: string) => void
  commitRename: () => void
  cancelRename: () => void
  refreshRename: () => void
}
export const DocsViewContext = createContext<DocsViewApi | null>(null)
export function useDocsView(): DocsViewApi {
  const value = useContext(DocsViewContext)
  if (!value) throw new Error('DocsViewContext 안에서 써야 해요')
  return value
}

/** 보기 안에서 문서를 가리키는 요소에 붙이는 표시. 제목 고치기가 끝나면 이 요소(또는 그 listbox)로 포커스를 돌려요 */
export const DOC_OPTION = 'data-doc-option'
export function focusDoc(ref: string) {
  const el = document.querySelector<HTMLElement>(`[${DOC_OPTION}="${CSS.escape(ref)}"]`)
  const target = el?.hasAttribute('tabindex') ? el : el?.closest<HTMLElement>('[role="listbox"]')
  target?.focus({ preventScroll: true })
}
/** 화면 순서의 문서 요소들. 아이콘 격자의 위·아래 이동처럼 배치를 보고 고를 때 써요 */
export function docOptions(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(`[${DOC_OPTION}]`)) : []
}
export const optionId = (prefix: string, ref: string) => `${prefix}-${ref.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`
