// 노트 쓰기 공용: 마크다운 → 노트(Tiptap) HTML, 에이전트가 노트를 넣거나 덧붙이기
import type { Database } from "bun:sqlite"
import { reindexRef } from './docs/index.ts'
import { withDocsTx } from './docs/storage.ts'
import { scopeOf } from './docs/scope.ts'
import { parse, type Node } from './vault/html-to-markdown.ts'

type El = Extract<Node, { type: 'element' }>
const VOID = new Set(['br', 'hr', 'img', 'input'])
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'ul', 'ol', 'pre', 'blockquote'])
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function serialize(nodes: Node[]): string {
  return nodes.map((n) => {
    if (n.type === 'text') return esc(n.value)
    const attrs = Object.entries(n.attrs).map(([k, v]) => (v === '' && (k === 'disabled' || k === 'checked') ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('')
    return VOID.has(n.tag) ? `<${n.tag}${attrs}>` : `<${n.tag}${attrs}>${serialize(n.children)}</${n.tag}>`
  }).join('')
}

function trimInline(nodes: Node[]): Node[] {
  const out = nodes.map((n) => ({ ...n }))
  if (out[0]?.type === 'text') out[0].value = out[0].value.replace(/^[\t\n\r\f ]+/, '')
  const last = out.at(-1)
  if (last?.type === 'text') last.value = last.value.replace(/[\t\n\r\f ]+$/, '')
  return out.filter((n) => n.type !== 'text' || n.value.length > 0)
}

function taskInput(li: El): { checked: boolean; rest: Node[] } | null {
  if (li.attrs.class !== 'task-list-item') return null
  const rest = [...li.children]
  const i = rest.findIndex((c) => c.type !== 'text' || /[^\t\n\r\f ]/.test(c.value))
  const first = rest[i]
  if (!first || first.type !== 'element') return null
  if (first.tag === 'input' && first.attrs.type === 'checkbox') {
    rest.splice(i, 1)
    return { checked: 'checked' in first.attrs, rest }
  }
  if (first.tag === 'p') {
    const pRest = [...first.children]
    const pi = pRest.findIndex((c) => c.type !== 'text' || /[^\t\n\r\f ]/.test(c.value))
    const pf = pRest[pi]
    if (pf?.type === 'element' && pf.tag === 'input' && pf.attrs.type === 'checkbox') {
      pRest.splice(pi, 1)
      rest[i] = { ...first, children: trimInline(pRest) }
      return { checked: 'checked' in pf.attrs, rest }
    }
  }
  return null
}

function transformTaskBlocks(children: Node[]): Node[] {
  const out: Node[] = []
  let run: Node[] = []
  const flush = () => {
    const trimmed = trimInline(run)
    if (trimmed.length) out.push({ type: 'element', tag: 'p', attrs: {}, children: trimmed })
    run = []
  }
  for (const child of children) {
    if (child.type === 'element' && BLOCK.has(child.tag)) {
      flush()
      out.push(...transformNode(child))
    } else run.push(child)
  }
  flush()
  return out.length ? out : [{ type: 'element', tag: 'p', attrs: {}, children: [] }]
}

function transformNode(node: Node): Node[] {
  if (node.type === 'text') return [node]
  if (node.tag !== 'ul') return [{ ...node, children: node.children.flatMap(transformNode) }]
  const groups: { task: boolean; items: Node[] }[] = []
  for (const child of node.children) {
    if (child.type === 'text') {
      if (groups.length) groups[groups.length - 1].items.push(child)
      continue
    }
    const info = child.tag === 'li' ? taskInput(child) : null
    const item: Node = info
      ? { type: 'element', tag: 'li', attrs: { 'data-type': 'taskItem', 'data-checked': String(info.checked) }, children: transformTaskBlocks(info.rest) }
      : { ...child, children: child.children.flatMap(transformNode) }
    const last = groups.at(-1)
    if (!last || last.task !== !!info) groups.push({ task: !!info, items: [item] })
    else last.items.push(item)
  }
  return groups.length
    ? groups.map((g) => ({ type: 'element', tag: 'ul', attrs: g.task ? { ...node.attrs, 'data-type': 'taskList' } : { ...node.attrs }, children: g.items }))
    : [{ ...node, children: [] }]
}

/** 마크다운 → 노트(Tiptap) HTML. 체크리스트는 Tiptap 모양(taskList/taskItem)으로 바꾸고 섞인 목록은 나눈다 */
export function mdToNoteHtml(md: string) {
  const raw = Bun.markdown.html(md)
  if (!raw.includes('class="task-list-item"')) return raw
  try {
    return serialize(parse(raw).flatMap(transformNode))
  } catch {
    return raw
      .replace(/<ul>(\s*<li class="task-list-item")/g, '<ul data-type="taskList">$1')
      .replace(/<li class="task-list-item"><input([^>]*)>([\s\S]*?)<\/li>/g, (_m, attrs: string, body: string) =>
        `<li data-type="taskItem" data-checked="${/\bchecked\b/.test(attrs)}"><p>${body.trim()}</p></li>`)
  }
}

type NoteRow = { html: string; text: string; by: string | null; md?:string|null; person_edited?:number }

/**
 * 에이전트가 노트를 쓴다.
 * - draft: 비었거나 에이전트가 쓴 노트만 덮는다 (내가 고친 노트는 그대로)
 * - append: 기존 노트 아래에 구분선을 두고 덧붙인다
 */
export function writeAgentNote(db: Database, person: string, ref: string, md: string, mode: "draft" | "append"): boolean {
  const owner = scopeOf(db, person, ref) // 파일럿 회사 공간 일은 워크스페이스 범위(docs/scope.ts)
  const text = md.trim().slice(0, 8000)
  if (!text) return false
  const modern = (db.query('PRAGMA table_info(work_notes)').all() as {name:string}[]).some(c=>c.name==='person_edited')
  return withDocsTx(db,()=>{
    const prev = db.query(modern ? 'SELECT html,text,by,md,person_edited FROM work_notes WHERE owner=? AND ref=?' : 'SELECT html,text,by FROM work_notes WHERE owner=? AND ref=?').get(owner,ref) as NoteRow|null
    let html=mdToNoteHtml(text), plain=text, markdown=text
    if (prev && mode==='draft' && (prev.by!=='agent' || prev.person_edited)) return false
    if (prev && mode==='append' && (prev.text.includes(text) || (prev.md ?? '').includes(text))) return false
    if (prev && mode==='append') {
      // 표현마다 따로 이어 붙인다: text 가 비어도 사람의 html·md 는 그대로 앞에 남는다
      const prevMd = prev.md ?? prev.text
      if (prev.html.trim()) html=`${prev.html}<hr>${html}`
      if (prev.text.trim()) plain=`${prev.text}\n\n${text}`
      if (prevMd.trim()) markdown=`${prevMd}\n\n${text}`
    }
    const now=Date.now()
    if (modern) {
      db.query(`INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,version,created_at,person_edited) VALUES (?,?,?,?,?,?,?,1,?,0)
        ON CONFLICT(owner,ref) DO UPDATE SET html=excluded.html,text=excluded.text,by=excluded.by,updated_at=excluded.updated_at,md=excluded.md,version=work_notes.version+1`).run(owner,ref,html,plain.slice(0,50000),'agent',now,markdown,now)
      reindexRef(db,owner,ref)
    } else db.query('INSERT INTO work_notes(owner,ref,html,text,by,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(owner,ref) DO UPDATE SET html=excluded.html,text=excluded.text,by=excluded.by,updated_at=excluded.updated_at').run(owner,ref,html,plain.slice(0,50000),'agent',now)
    return true
  })
}
