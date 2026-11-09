// 본문 [[링크]] 를 눌렀을 때 열 문서 판정(웹 document-page.tsx navigateWiki 와 같은 규칙).
// ref 모양이면 바로, 아니면 열린 것과 보관을 각 5쪽까지 찾아 ref·제목이 정확히 같은 것만: 하나뿐이고 끝까지 찾았으면 열기, 여럿이면 고르기, 없으면 안내.
import type { SearchHit } from '@direction-board/contracts'
import type { DocFilters } from '../../api/docs'

type Search = (f: DocFilters) => Promise<{ results: SearchHit[]; nextCursor?: string }>
export type WikiResult = { type: 'open'; ref: string; title: string } | { type: 'choose'; hits: SearchHit[]; partial: boolean } | { type: 'none'; partial: boolean }

const REF = /^(doc|item|signal|run):\S+$/

export async function resolveWiki(term: string, search: Search): Promise<WikiResult> {
  const t = term.trim()
  if (REF.test(t)) return { type: 'open', ref: t, title: t }
  const exact: SearchHit[] = []
  let partial = false
  for (const status of ['', 'archived'] as const) {
    let cursor: string | undefined
    for (let page = 0; page < 5; page++) {
      const r = await search({ q: t, includeAi: true, status, cursor })
      for (const hit of r.results) if ((hit.ref === t || hit.title === t) && !exact.some((x) => x.ref === hit.ref)) exact.push(hit)
      cursor = r.nextCursor
      if (!cursor) break
    }
    if (cursor) partial = true
  }
  if (exact.length === 1 && !partial) return { type: 'open', ref: exact[0].ref, title: exact[0].title }
  if (exact.length) return { type: 'choose', hits: exact, partial }
  return { type: 'none', partial }
}

export function wikiMessage(r: Exclude<WikiResult, { type: 'open' }>): string {
  if (r.type === 'choose') return r.partial ? '검색 결과가 많아 일부만 확인했어요. 같은 제목의 문서가 더 있을 수 있으니 맞는 문서를 골라 주세요.' : '같은 제목의 문서가 여러 개예요. 열 문서를 골라 주세요.'
  return r.partial ? '검색 결과가 많아 일부만 확인했고 일치하는 문서를 찾지 못했어요. 문서 목록에서 검색해 주세요.' : '일치하는 문서를 찾지 못했어요.'
}
