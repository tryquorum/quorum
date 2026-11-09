// 운영 순회 지시문을 ##·### 제목 단위 조각으로 나누고 다시 잇는다. 원본은 늘 글 하나이고 조각은 그 글의 [start,end) 구간이라
// 한 조각을 바꿔도 다른 조각은 바이트 그대로예요. 코드 펜스(\`\`\`·~~~) 안의 # 은 제목이 아니고, 닫히지 않은 펜스 뒤로는 나누지 않아요.

export type PromptPart = {
  start: number
  end: number
  /** 제목 줄(줄 끝 포함). 첫 제목 앞 머리글은 "" */
  head: string
  /** 제목 글자(### 뺀 것). 머리글은 null */
  title: string | null
  /** 2 = ##, 3 = ###, 0 = 머리글 */
  level: 0 | 2 | 3
  /** 제목 줄 다음부터 조각 끝까지 */
  body: string
}

const HEADING = /^(#{2,3}) +(.*?)\s*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/

export function splitPrompt(text: string): PromptPart[] {
  const parts: PromptPart[] = []
  let fence: string | null = null
  let cur: { start: number; head: string; title: string | null; level: 0 | 2 | 3 } = { start: 0, head: "", title: null, level: 0 }
  const close = (end: number) => {
    const body = text.slice(cur.start + cur.head.length, end)
    if (end > cur.start || cur.level === 0) parts.push({ ...cur, end, body })
  }
  let at = 0
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const bare = line.replace(/\r?\n$/, "")
    const f = bare.match(FENCE)
    if (f) {
      if (!fence) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
    } else if (!fence) {
      const h = bare.match(HEADING)
      if (h) {
        close(at)
        cur = { start: at, head: line, title: h[2], level: h[1].length as 2 | 3 }
      }
    }
    at += line.length
  }
  close(text.length)
  // 머리글이 비어 있으면 빼요(글이 제목으로 시작)
  return parts.filter((p, i) => !(i === 0 && p.level === 0 && p.end === 0 && parts.length > 1))
}

export const joinPrompt = (parts: PromptPart[], text: string) => parts.map((p) => text.slice(p.start, p.end)).join("")

/** index 번째 조각의 본문만 바꾼 글. 제목 줄과 다른 조각은 그대로. 뒤에 조각이 있으면 본문이 줄바꿈으로 끝나게 해서 다음 제목이 제 줄에 남아요 */
export function replaceBody(text: string, index: number, body: string): string {
  const p = splitPrompt(text)[index]
  if (!p) return text
  const sep = p.end < text.length && !body.endsWith("\n") ? "\n" : ""
  return text.slice(0, p.start + p.head.length) + body + sep + text.slice(p.end)
}

/** 확인할 곳 줄 수: "- "·"* "·"1. " 로 시작하는 목록 줄 */
export const checkLines = (body: string) => body.split("\n").filter((l) => /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(l)).length

/** textarea 는 줄바꿈을 LF 로 바꿔요. 편집은 LF 로 하고, 저장할 때 원본이 CRLF 만 썼으면 CRLF 로 되돌려요 */
export const toLF = (s: string) => s.replace(/\r\n?/g, "\n")
export function restoreEol(edited: string, original: string): string {
  const crlfOnly = original.includes("\r\n") && !/(^|[^\r])\n/.test(original)
  return crlfOnly ? toLF(edited).replace(/\n/g, "\r\n") : edited
}
