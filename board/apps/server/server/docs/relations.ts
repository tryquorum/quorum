import type { Database } from "bun:sqlite"
import { withDocsTx } from "./storage.ts"

function withoutCode(md: string): string {
  const lines = md.split('\n')
  let fence: {char:string; size:number} | null = null
  return lines.map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      const value = marker[1]
      if (!fence) fence = {char:value[0],size:value.length}
      else if (fence.char === value[0] && value.length >= fence.size) fence = null
      return ''
    }
    if (fence) return ''
    return line.replace(/(`+)([\s\S]*?)\1/g, '')
  }).join('\n')
}

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40)
}

export function extractBodyTags(md: string): string[] {
  const result = new Set<string>()
  for (const line of withoutCode(md).split('\n')) {
    if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) continue
    // 태그는 글자로 시작해야 한다: "PR #2561", "#10번째" 같은 번호는 태그가 아니다
    for (const match of line.matchAll(/(?:^|[^\p{L}\p{N}_#])#([\p{L}_][\p{L}\p{N}_/-]*)/gu)) {
      // 영문 태그 뒤에 붙은 한국어 조사는 뗀다: "#ax_align에서" → ax_align
      const tag = normalizeTag(match[1].replace(/^([A-Za-z0-9_/-]*[A-Za-z][A-Za-z0-9_/-]*)[가-힣]{1,3}$/, "$1"))
      if (tag) result.add(tag)
    }
  }
  return [...result]
}

export function extractBodyLinks(md: string): string[] {
  return [...new Set([...withoutCode(md).matchAll(/\[\[([^\]\n]+)\]\]/g)].map(m => m[1].trim()).filter(Boolean))]
}

export function reconcileRelations(db: Database, owner: string, affected?: string[]): void {
  withDocsTx(db, () => {
    const docs = db.query("SELECT i.ref,i.title,COALESCE(n.md,n.text) AS md FROM doc_index i JOIN work_notes n ON n.owner=i.owner AND n.ref=i.ref WHERE i.owner=?").all(owner) as {ref:string;title:string;md:string}[]
    const refs = new Set(docs.map(d => d.ref))
    const orphaned = db.query("SELECT id,a FROM work_links WHERE owner=? AND by='body'").all(owner) as {id:string;a:string}[]
    for (const edge of orphaned) if (!refs.has(edge.a) && (!affected || affected.includes(edge.a))) db.query('DELETE FROM work_links WHERE id=?').run(edge.id)
    const titles = new Map<string,string[]>()
    for (const doc of docs) titles.set(doc.title, [...(titles.get(doc.title) || []), doc.ref])
    const insert = db.query("INSERT INTO work_links(id,owner,a,b,label,by,created_at) VALUES (?,?,?,?, '언급','body',?)")
    for (const doc of docs) {
      if (affected && !affected.includes(doc.ref)) continue
      const targets = new Set<string>()
      for (const target of extractBodyLinks(doc.md || '')) {
        const matches = titles.get(target) || []
        const ref = refs.has(target) ? target : matches.length === 1 ? matches[0] : null
        if (ref && ref !== doc.ref) targets.add(ref)
      }
      const existing = db.query("SELECT id,b FROM work_links WHERE owner=? AND a=? AND by='body'").all(owner,doc.ref) as {id:string;b:string}[]
      for (const edge of existing) if (!targets.has(edge.b)) db.query('DELETE FROM work_links WHERE id=?').run(edge.id)
      for (const ref of targets) if (!existing.some(e=>e.b===ref)) insert.run(crypto.randomUUID(),owner,doc.ref,ref,Date.now())
    }
  })
}
