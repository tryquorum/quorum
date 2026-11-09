// 카드·갤러리 미리보기용 평문 요약과 대표 이미지. 목록 API 는 본문 전체를 주지 않아서 검색 때 본문에서 계산해요.
// 저장 칸을 따로 두지 않아요(색인이 바뀌면 다음 검색부터 바로 맞아요). 설계: docs/internals/docs-layer.md

export const EXCERPT_CHARS = 160

const FENCE = /^\s{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\s{0,3}\1[^\n]*$|(?![\s\S]))/gm

/** 마크다운 앞부분의 평문 요약(최대 160자). 코드 블록·이미지·표시 기호를 빼고 [[ref|표시]] 는 표시만 남겨요 */
export function plainExcerpt(md: string, max = EXCERPT_CHARS): string {
  const text = md
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(FENCE, ' ')
    .replace(/!\[\[[^\]\n]*\]\]/g, ' ')
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, ' ')
    .replace(/\[\[[^\]|\n]+\|([^\]\n]+)\]\]/g, '$1')
    .replace(/\[\[([^\]\n]+)\]\]/g, '$1')
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, ' ')
    .replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm, ' ')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|~~|`|\*)/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : text
}

/** 본문의 첫 이미지 주소. http(s) 또는 서버 경로(/…)만, 코드 블록 안은 빼요. 없으면 null */
export function firstImage(md: string): string | null {
  const body = md.replace(FENCE, ' ')
  for (const m of body.matchAll(/!\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"'\n]*["'])?\s*\)|<img\b[^>]*?\bsrc=["']([^"']+)["']/gi)) {
    const url = (m[1] || m[2] || '').trim()
    if (url.length <= 2000 && (/^https?:\/\/[^\s]+$/i.test(url) || /^\/(?!\/)\S*$/.test(url))) return url
  }
  return null
}
