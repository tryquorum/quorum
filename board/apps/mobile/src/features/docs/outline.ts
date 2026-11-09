// 문서 본문을 제목(1~3단) 자리에서 나눠요. 문서 페이지가 조각마다 자리를 재서 개요에서 그 제목으로 스크롤해요(웹 개요 패널).
// 코드 블록 안의 # 은 제목이 아니에요(서버 headings 와 같은 규칙).
export type Section = { start: number; md: string; heading: { level: number; title: string } | null }

export function splitSections(md: string): Section[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: Section[] = []
  let cur: Section = { start: 0, md: '', heading: null }
  let buf: string[] = []
  let fence: { char: string; size: number } | null = null
  lines.forEach((line, i) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (marker) {
      if (!fence) fence = { char: marker[1][0], size: marker[1].length }
      else if (fence.char === marker[1][0] && marker[1].length >= fence.size) fence = null
    }
    const h = !fence && !marker ? /^ {0,3}(#{1,3})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line) : null
    if (h && (buf.length || cur.heading)) {
      out.push({ ...cur, md: buf.join('\n') })
      cur = { start: i, md: '', heading: null }
      buf = []
    }
    if (h) cur.heading = { level: h[1].length, title: h[2].trim() }
    buf.push(line)
  })
  out.push({ ...cur, md: buf.join('\n') })
  return out.filter((s) => s.md.trim() || s.heading)
}
