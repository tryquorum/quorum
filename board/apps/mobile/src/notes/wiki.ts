// [[링크]] 가 ref 모양이면 바로 열 화면(레인 0). 제목으로 찾기(웹 navigateWiki 의 검색)는 레인 2 가 더해요.
export function wikiTarget(term: string): { route: 'Doc' | 'Work'; ref: string } | null {
  const ref = term.trim()
  if (/^(?:doc|run):\S+$/.test(ref)) return { route: 'Doc', ref }
  if (/^(?:item:[^:\s]+:\S+|signal:\S+)$/.test(ref)) return { route: 'Work', ref }
  return null
}

/** 노트 안 링크 중 앱 밖 브라우저로 열 것(http·https) */
export const externalLink = (href: string) => /^https?:\/\//i.test(href)
