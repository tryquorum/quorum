// 노트 HTML 의 서식 모델: 블록 구조, 글자 서식(굵게·기울임·취소선·코드·링크), 줄바꿈, 이미지, 할 일 체크.
// iOS 마크다운 편집 가능 판정(ops.ts markdownEditable)이 "원래 HTML" 과 "md 로 다시 만든 HTML" 의 모델을 비교해요.
// 엄격 변환기가 조용히 버리는 서식(낱말 안 굵게, 맞붙은 강조, span 스타일)을 여기서 잡아요. 모르는 태그·속성이면 null(편집 막음).
import { parse, type Node } from '../vault/html-to-markdown.ts'

type El = Extract<Node, { type: 'element' }>
const MARK: Record<string, string> = { strong: 'b', b: 'b', em: 'i', i: 'i', s: 'd', del: 'd', strike: 'd' }
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const ATTRS: Record<string, Set<string>> = {
  // 값까지 모델에 넣거나(href·title·src·alt·class·start·data-checked) 값을 고정해요(VALUES). md 로 다시 만들 때 사라지는 속성은 두지 않아요
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title']),
  ol: new Set(['start']),
  ul: new Set(['data-type']),
  li: new Set(['data-type', 'data-checked']),
  code: new Set(['class']),
  input: new Set(['type', 'checked', 'disabled']),
  label: new Set(['contenteditable']),
}
const VALUES: Record<string, (value: string) => boolean> = {
  'a.target': (v) => v === '_blank',
  'a.rel': (v) => v === 'noopener noreferrer nofollow' || v === 'noopener noreferrer' || v === 'noopener',
  'ul.data-type': (v) => v === 'taskList',
  'li.data-type': (v) => v === 'taskItem',
  'li.data-checked': (v) => v === 'true' || v === 'false',
  'input.type': (v) => v === 'checkbox',
  'label.contenteditable': (v) => v === 'false',
}
class Unsupported extends Error {}

function attrsOk(el: El) {
  const allowed = ATTRS[el.tag]
  for (const [key, value] of Object.entries(el.attrs)) {
    if (!allowed?.has(key)) throw new Unsupported(el.tag + '[' + key + ']')
    const check = VALUES[el.tag + '.' + key]
    if (check && !check(value)) throw new Unsupported(el.tag + '[' + key + '=' + value + ']')
  }
}

/** Tiptap 의 할 일 체크 감싸개: label(contenteditable=false) 안에 checkbox input 과 빈 span 만, 체크가 data-checked 와 같아야 해요 */
function taskLabelOk(label: El, checked: boolean) {
  attrsOk(label)
  for (const child of label.children) {
    if (child.type === 'text') {
      if (child.value.trim()) throw new Unsupported('text in task label')
    } else if (child.tag === 'input') {
      attrsOk(child)
      if (child.attrs.type !== 'checkbox' || ('checked' in child.attrs) !== checked) throw new Unsupported('task checkbox')
    } else if (child.tag === 'span') {
      if (Object.keys(child.attrs).length || child.children.some((c) => c.type === 'element' || c.value.trim())) throw new Unsupported('task span')
    } else throw new Unsupported('task label ' + child.tag)
  }
}

/** 모델 문자열. 같은 모델이면 서식이 같아요 */
export function noteModel(html: string): string | null {
  try {
    const out: string[] = []
    blocks(parse(html), out)
    return out.join('')
  } catch {
    return null
  }
}

function blocks(nodes: Node[], out: string[]) {
  let inlineRun: Node[] = []
  const flush = () => {
    const body = inline(inlineRun)
    if (body) out.push('<p>' + body + '</p>')
    inlineRun = []
  }
  for (const node of nodes) {
    if (node.type === 'element' && node.tag === 'br-block') {
      flush()
      continue
    }
    if (node.type === 'text' || MARK[node.tag] || ['a', 'code', 'br', 'img', 'span'].includes(node.tag)) {
      inlineRun.push(node)
      continue
    }
    flush()
    block(node, out)
  }
  flush()
}

function block(el: El, out: string[]) {
  attrsOk(el)
  const tag = el.tag
  if (tag === 'p') out.push('<p>' + inline(el.children) + '</p>')
  else if (HEADINGS.has(tag)) out.push('<' + tag + '>' + inline(el.children) + '</' + tag + '>')
  else if (tag === 'hr') out.push('<hr>')
  else if (tag === 'blockquote') {
    out.push('<q>')
    blocks(el.children, out)
    out.push('</q>')
  } else if (tag === 'pre') {
    const code = el.children.find((c): c is El => c.type === 'element' && c.tag === 'code')
    if (code) attrsOk(code)
    out.push('<pre ' + (code?.attrs.class ?? '') + '>' + text(code ? code.children : el.children).replace(/\n$/, '') + '</pre>')
  } else if (tag === 'ul' || tag === 'ol') {
    const task = el.attrs['data-type'] === 'taskList'
    out.push(tag === 'ol' ? '<ol ' + (el.attrs.start ?? '1') + '>' : task ? '<tasks>' : '<ul>')
    for (const li of el.children) {
      if (li.type === 'text') {
        if (li.value.trim()) throw new Unsupported('text in list')
        continue
      }
      if (li.tag !== 'li') throw new Unsupported('list child ' + li.tag)
      attrsOk(li)
      const checked = li.attrs['data-checked'] === 'true'
      if (task !== (li.attrs['data-type'] === 'taskItem')) throw new Unsupported('task item outside task list')
      out.push(task ? '<li ' + checked + '>' : '<li>')
      // Tiptap 의 할 일 감싸개(label·input·span·div)와 목록 안 문단은 서식이 아니라 모양이에요
      const content = li.children.filter((c) => {
        if (c.type === 'element' && c.tag === 'label') {
          if (!task) throw new Unsupported('label outside task item')
          taskLabelOk(c, checked)
          return false
        }
        return true
      })
      blocks(unwrap(content), out)
      out.push('</li>')
    }
    out.push('</' + (tag === 'ol' ? 'ol' : task ? 'tasks' : 'ul') + '>')
  } else if (tag === 'div') blocks(el.children, out)
  else throw new Unsupported(tag)
}

/** 목록 항목 안의 div·p 를 벗겨 문단과 하위 목록을 한 층에 놓아요(빽빽한 목록과 문단 목록을 같게) */
function unwrap(nodes: Node[]): Node[] {
  return nodes.flatMap((n) => {
    if (n.type === 'element' && (n.tag === 'div' || n.tag === 'p') && Object.keys(n.attrs).length === 0) return [...unwrap(n.children), { type: 'element', tag: 'br-block', attrs: {}, children: [] } as El]
    return [n]
  })
}

function text(nodes: Node[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.value : n.tag === 'br' ? '\n' : text(n.children))).join('')
}

type Run = { text: string; marks: string }
function inline(nodes: Node[]): string {
  const runs: Run[] = []
  const walk = (list: Node[], marks: string[]) => {
    for (const n of list) {
      if (n.type === 'text') runs.push({ text: n.value.replace(/\s+/g, ' '), marks: [...marks].sort().join(',') })
      else if (n.tag === 'br-block') runs.push({ text: ' ', marks: '' })
      else {
        attrsOk(n)
        if (n.tag === 'br') runs.push({ text: '\n', marks: '' })
        else if (n.tag === 'img') runs.push({ text: '[img ' + JSON.stringify([n.attrs.src ?? '', n.attrs.alt ?? '', n.attrs.title ?? '']) + ']', marks: '' })
        else if (MARK[n.tag]) walk(n.children, [...marks, MARK[n.tag]])
        else if (n.tag === 'code') walk(n.children, [...marks, 'c=' + (n.attrs.class ?? '')])
        else if (n.tag === 'a') walk(n.children, [...marks, 'a=' + JSON.stringify([n.attrs.href ?? '', n.attrs.title ?? ''])])
        else throw new Unsupported(n.tag)
      }
    }
  }
  walk(nodes, [])
  const merged: Run[] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && last.marks === r.marks) last.text += r.text
    else merged.push({ ...r })
  }
  const parts = merged.map((r) => {
    if (!r.marks) return r.text
    if (/^[bid](?:,[bid])*$/.test(r.marks)) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text)
      if (m) return m[1] + (m[2] ? '{' + r.marks + ':' + m[2] + '}' : '') + m[3]
    }
    return '{' + r.marks + ':' + r.text + '}'
  })
  return parts.join('').replace(/ ?\n ?/g, '\n').trim()
}
