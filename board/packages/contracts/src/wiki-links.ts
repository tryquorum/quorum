// 웹·iOS 공용(웹 apps/web/src/lib/wiki-links.ts 는 다시 내보내기).
/** 서버 관계 해석(server/docs/relations.ts 의 withoutCode·wikiLinks)과 같은 규칙으로 본문 [[링크]] 를 찾는다.
 *  펜스 코드 블록(앞 공백 3칸까지, 닫히지 않은 펜스는 끝까지)과 인라인 코드 안은 링크가 아니다. */
export function withoutCode(md: string): string {
  let fence: { char: string; size: number } | null = null
  return md.split('\n').map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      const value = marker[1]
      if (!fence) fence = { char: value[0], size: value.length }
      else if (fence.char === value[0] && value.length >= fence.size) fence = null
      return ''
    }
    if (fence) return ''
    return line.replace(/(`+)([\s\S]*?)\1/g, '')
  }).join('\n')
}

export function wikiLinks(md: string): string[] {
  return [...new Set([...withoutCode(md).matchAll(/\[\[([^\]\n]+)\]\]/g)].map((m) => m[1].trim()).filter(Boolean))]
}
