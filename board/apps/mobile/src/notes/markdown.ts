// 노트 마크다운을 읽기 화면용 작은 트리로 바꿔요(레인 1·2 공용, 순수 TS). 서버 mdToNoteHtml 이 받는 문법과 같은 범위:
// 제목·문단·목록(번호·할 일·중첩)·인용·코드 블록·가로줄과 굵게·기울임·취소선·코드·링크·[[링크]]·이미지·줄바꿈.
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b' | 'i' | 'd'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'wiki'; term: string; label: string }
  | { t: 'img'; src: string; alt: string }
  | { t: 'br' }
export type ListItem = { checked: boolean | null; line: number; blocks: Block[] }
export type Block =
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'hr' }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/
const QUOTE = /^ {0,3}> ?(.*)$/
const TASK = /^\[( |x|X)\]\s+/

/** md 를 블록 트리로. line 은 원문 줄 번호(0부터)라 할 일 체크를 원문에 되돌릴 수 있어요 */
export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  return parseLines(lines.map((text, i) => ({ text, line: i })))
}

type Line = { text: string; line: number }
function parseLines(lines: Line[]): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const { text } = lines[i]
    if (!text.trim()) {
      i++
      continue
    }
    const fence = FENCE.exec(text)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].text.trimStart().startsWith(fence[1])) body.push(lines[i++].text)
      i++
      out.push({ t: 'code', lang: fence[2] ?? '', v: body.join('\n') })
      continue
    }
    const heading = HEADING.exec(text)
    if (heading) {
      out.push({ t: 'h', level: heading[1].length, c: parseInline(heading[2] ?? '') })
      i++
      continue
    }
    if (HR.test(text)) {
      out.push({ t: 'hr' })
      i++
      continue
    }
    if (QUOTE.test(text)) {
      const body: Line[] = []
      let q: RegExpExecArray | null
      while (i < lines.length && lines[i].text.trim() && (q = QUOTE.exec(lines[i].text))) body.push({ text: q[1], line: lines[i++].line })
      out.push({ t: 'quote', blocks: parseLines(body) })
      continue
    }
    const item = ITEM.exec(text)
    if (item) {
      const indent = item[1].length
      const ordered = /\d/.test(item[2])
      const list: Block & { t: 'list' } = { t: 'list', ordered, start: ordered ? parseInt(item[2], 10) : 1, items: [] }
      while (i < lines.length) {
        const m = ITEM.exec(lines[i].text)
        if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break
        const first = m[3] ?? ''
        const task = TASK.exec(first)
        const body: Line[] = [{ text: task ? first.slice(task[0].length) : first, line: lines[i].line }]
        const itemLine = lines[i].line
        i++
        // 더 들여쓴 줄(하위 목록·이어지는 글)과 그 사이 빈 줄은 이 항목 몫
        while (i < lines.length) {
          const next = lines[i].text
          const deeper = next.length - next.trimStart().length > indent
          if (next.trim() && !deeper) break
          if (!next.trim() && !(i + 1 < lines.length && lines[i + 1].text.length - lines[i + 1].text.trimStart().length > indent)) break
          body.push({ text: next.slice(Math.min(next.length - next.trimStart().length, indent + 2)), line: lines[i].line })
          i++
        }
        list.items.push({ checked: task ? task[1] !== ' ' : null, line: itemLine, blocks: parseLines(body) })
      }
      out.push(list)
      continue
    }
    if (/^ {4,}\S/.test(text)) {
      const body: string[] = []
      while (i < lines.length && (/^ {4,}/.test(lines[i].text) || !lines[i].text.trim())) body.push(lines[i++].text.slice(4))
      out.push({ t: 'code', lang: '', v: body.join('\n').replace(/\n+$/, '') })
      continue
    }
    const para: string[] = []
    while (i < lines.length) {
      const t = lines[i].text
      if (!t.trim() || FENCE.test(t) || HEADING.test(t) || HR.test(t) || QUOTE.test(t) || (para.length && ITEM.test(t))) break
      para.push(t)
      i++
    }
    // 줄 끝 \\ 나 공백 두 칸은 줄바꿈, 그 밖의 줄 나눔은 띄어쓰기
    const joined = para.map((p, n) => (n === para.length - 1 ? p.trim() : /(\\| {2,})$/.test(p) ? p.trim().replace(/\\$/, '') + '\n' : p.trim() + ' ')).join('')
    out.push({ t: 'p', c: parseInline(joined) })
  }
  return out
}

/** 글줄 안의 서식 */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const push = (node: Inline) => {
    if (text) out.push({ t: 'text', v: text })
    text = ''
    out.push(node)
  }
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    let m: RegExpExecArray | null
    if (rest.startsWith('\\\n') || rest.startsWith('  \n')) {
      push({ t: 'br' })
      i += rest.startsWith('\\') ? 2 : 3
      while (src[i] === ' ') i++
    } else if (src[i] === '\n') {
      push({ t: 'br' })
      i++
    } else if (src[i] === '\\' && i + 1 < src.length && /[\\`*_{}\[\]()#+\-.!|~>]/.test(src[i + 1])) {
      text += src[i + 1]
      i += 2
    } else if ((m = /^`+/.exec(rest))) {
      const close = src.indexOf(m[0], i + m[0].length)
      if (close < 0) {
        text += m[0]
        i += m[0].length
      } else {
        push({ t: 'code', v: src.slice(i + m[0].length, close).replace(/^ (.*) $/, '$1') })
        i = close + m[0].length
      }
    } else if ((m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(rest))) {
      push({ t: 'wiki', term: m[1].trim(), label: (m[2] ?? m[1]).trim() })
      i += m[0].length
    } else if ((m = /^!\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/.exec(rest))) {
      push({ t: 'img', alt: m[1], src: m[2] })
      i += m[0].length
    } else if ((m = /^\[((?:\\.|[^\]])+)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/.exec(rest))) {
      push({ t: 'link', href: m[2], c: parseInline(m[1]) })
      i += m[0].length
    } else if ((m = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest))) {
      push({ t: 'b', c: parseInline(m[2]) })
      i += m[0].length
    } else if ((m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest))) {
      push({ t: 'd', c: parseInline(m[1]) })
      i += m[0].length
    } else if ((m = /^([*_])(?=\S)([\s\S]*?\S)\1(?!\1)/.exec(rest)) && (m[1] === '*' || !/\w/.test(src[i - 1] ?? ''))) {
      push({ t: 'i', c: parseInline(m[2]) })
      i += m[0].length
    } else {
      text += src[i]
      i++
    }
  }
  if (text) out.push({ t: 'text', v: text })
  return out
}

/** 원문의 그 줄 할 일 표시를 뒤집어요(체크 한 번이 그 줄만 바꾸게) */
export function toggleTask(md: string, line: number): string {
  const lines = md.split('\n')
  const target = lines[line]
  if (target === undefined) return md
  lines[line] = target.replace(/^(\s*(?:[-*+]|\d{1,9}[.)])\s+)\[( |x|X)\]/, (_, head: string, mark: string) => `${head}[${mark === ' ' ? 'x' : ' '}]`)
  return lines.join('\n')
}
