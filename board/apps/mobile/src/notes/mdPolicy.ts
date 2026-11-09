// iOS 가 새로 쓰는 노트 초안의 허용 문법(레인 1·2 공용, 순수 TS). 서버가 md 로 만든 html 이 웹 편집기의 허용 서식 안에
// 머물러야 웹 편집기가 읽기 전용으로 떨어지지 않아요. 밖의 문법은 보내지 않고 그 줄과 이유를 알려요(초안은 그대로).
export type PolicyResult = { ok: true } | { ok: false; line: number; reason: string }

const SAFE_HREF = /^(?:https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(\[(?: |x|X)\]\s)?/
const indentOf = (line: string) => line.length - line.trimStart().length

export function checkMarkdown(md: string): PolicyResult {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  let fence: string | null = null
  // 서버 변환(notes.ts mdToNoteHtml)은 할 일 항목 본문을 <p> 하나로 감싸서, 할 일 아래 하위 목록·이어지는 글·빈 줄 낀 할 일은 태그가 엇갈려요
  let task: { indent: number; blank: boolean } | null = null
  // 같은 목록(같은 들여쓰기·같은 글머리 표지)에 할 일과 일반 글머리를 섞으면 서버가 <ul> 안 taskItem 을 만들어 웹 편집기가 거절해요.
  // 들여쓰기별로 지금 열린 목록의 표지와 할 일 여부를 들고 있다가, 사이에 빈 줄 뒤 문단·제목이 오면 그 깊이부터 목록이 끝난 걸로 봐요
  const lists = new Map<number, { marker: string; task: boolean }>()
  let prevBlank = true
  const fail = (i: number, reason: string): PolicyResult => ({ ok: false, line: i + 1, reason })
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const f = FENCE.exec(line)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null
      continue
    }
    if (f) {
      if (f[2].trim()) return fail(i, '언어를 적은 코드 블록은 iOS 에서 저장할 수 없어요. ``` 뒤의 이름을 지워 주세요')
      fence = f[1]
      lists.clear()
      continue
    }
    // 인용 안의 목록도 같은 규칙: 인용 표시(>)를 벗긴 본문으로 들여쓰기를 봐요
    const body = line.replace(/^(?: {0,3}> ?)+/, '')
    if (!body.trim()) {
      if (task) task.blank = true
      prevBlank = true
      continue
    }
    const item = ITEM.exec(body)
    if (task) {
      const indent = item ? item[1].length : indentOf(body)
      if (indent > task.indent) return fail(i, item ? '할 일 아래 하위 목록은 iOS 에서 저장할 수 없어요' : '할 일 아래 이어지는 글은 iOS 에서 저장할 수 없어요')
      if (item && task.blank && indent === task.indent) return fail(i, '빈 줄을 사이에 둔 할 일 목록은 iOS 에서 저장할 수 없어요. 빈 줄을 지워 주세요')
      if (task.blank || item) task = null
    }
    if (!task && !item && /^ {4,}\S/.test(line) && (i === 0 || !lines[i - 1].trim())) continue
    if (item?.[3]) {
      if (/\d/.test(item[2])) return fail(i, '번호 목록의 할 일은 iOS 에서 저장할 수 없어요. - [ ] 로 써 주세요')
      task = { indent: item[1].length, blank: false }
    }
    if (item) {
      const indent = item[1].length
      const marker = /\d/.test(item[2]) ? 'ordered' : item[2]
      const isTask = !!item[3]
      const open = lists.get(indent)
      if (open && open.marker === marker && marker !== 'ordered' && open.task !== isTask)
        return fail(i, '할 일과 일반 글머리는 한 목록에 섞을 수 없어요. 다른 글머리 표지(- 와 *)를 쓰거나 사이에 문단을 넣어 목록을 나눠 주세요')
      for (const k of lists.keys()) if (k > indent) lists.delete(k)
      lists.set(indent, { marker, task: isTask })
    } else if (prevBlank || /^ {0,3}#{1,6}(\s|$)/.test(body)) {
      const at = indentOf(body)
      for (const k of lists.keys()) if (k >= at) lists.delete(k)
    }
    prevBlank = false
    if (/<\/?[A-Za-z!]/.test(line.replace(/`[^`]*`/g, ''))) return fail(i, 'HTML 태그·꺾쇠 주소는 iOS 에서 저장할 수 없어요')
    if (/^\s*\|.*\|\s*$/.test(line) || /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)) return fail(i, '표는 iOS 에서 저장할 수 없어요')
    if (/^\s*\[\^[^\]]+\]:/.test(line) || /\[\^[^\]]+\]/.test(line)) return fail(i, '각주는 iOS 에서 저장할 수 없어요')
    if (/^ {0,3}\[[^\]]+\]:\s*\S/.test(line) || /\]\[[^\]]*\]/.test(line)) return fail(i, '참조 링크는 iOS 에서 저장할 수 없어요. [글](주소) 로 써 주세요')
    // 문단 바로 아래의 === / --- 줄은 밑줄 제목이 돼요(가로줄은 빈 줄 다음에)
    if (/^ {0,3}(=+|-+)\s*$/.test(line) && i > 0 && lines[i - 1].trim() && !/^\s*([-*+]|\d+[.)])\s/.test(lines[i - 1]))
      return fail(i, '밑줄 제목(=== ---)은 iOS 에서 저장할 수 없어요. # 제목으로 쓰거나 가로줄 앞에 빈 줄을 둬요')
    for (const m of line.replace(/`[^`]*`/g, '').matchAll(/(!?)\[(?:\\.|[^\]])*\]\(<?([^)\s>]*)>?/g)) {
      const href = m[2]
      if (!SAFE_HREF.test(href)) return fail(i, `${m[1] ? '이미지' : '링크'} 주소는 http(s)·mailto·tel·/·# 로 시작해야 해요`)
      if (m[1] && /^data:/i.test(href)) return fail(i, 'data: 이미지는 저장할 수 없어요')
    }
  }
  return { ok: true }
}
