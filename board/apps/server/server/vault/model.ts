import { createHash } from "node:crypto"
import { RESERVED_PROP_KEYS, type DocKind, type DocRecord } from "@direction-board/contracts/docs"

export const folders: Record<DocKind, string> = { todo: "할일", goal: "목표", signal: "사건", run: "대화", doc: "문서" }
export const INDEX = "_index.md", TAGS = "_tags.md", LEDGER = ".vault-ledger.json", INTENT = ".vault-intent.json", LOCK = ".vault-lock"
export type Entry = { owner: string; ref: string; path: string; hash: string; kind: DocKind; title: string; tags: string[]; updated: number; folders?:string[] }
export type Ledger = { version: 1; generation: number; entries: Entry[]; indexes: { index: string | null; tags: string | null } }
export const hash = (s: string) => createHash("sha256").update(s).digest("hex")
export const key = (owner: string, ref: string) => JSON.stringify([owner, ref])
export const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
// Upper-then-lower also catches multi-character folds such as ß/ss.
export const fold = (s: string) => s.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC")
export function docPath(doc: Pick<DocRecord,'owner'|'ref'|'kind'|'title'|'folders'>): string {
  if (!Object.hasOwn(folders, doc.kind)) throw new Error("invalid document kind")
  const parts=doc.folders ?? []
  if(!Array.isArray(parts) || parts.length>4 || parts.some(p=>typeof p!=='string' || !p || p==='.' || p==='..' || /[/\\\p{Cc}]/u.test(p))) throw new Error('invalid document folders')
  let slug = Array.from(doc.title.normalize("NFC").replace(/[<>:"/\\|?*\p{Cc}]/gu, "_")).slice(0, 60).join("").replace(/[. ]+$/g, "")
  if (!slug || /^\.+$/.test(slug)) slug = "untitled"
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(slug)) slug = `_${slug}`
  while (Buffer.byteLength(slug) > 180) slug = Array.from(slug).slice(0, -1).join("")
  return [folders[doc.kind],...parts,`${slug}--${hash(JSON.stringify([doc.owner, doc.ref])).slice(0, 16)}.md`].join('/')
}
export function document(doc: DocRecord): string {
  const data = { ref: doc.ref, kind: doc.kind, title: doc.title, area: doc.area, status: doc.status, tags: doc.tags.map(t => t.tag), links: [...new Set(doc.links.map(l => l.ref))], version: doc.version, created: doc.createdAt, updated: doc.updatedAt, source: doc.source, due: doc.due ?? null,...(doc.parent ? {parent:doc.parent} : {}) }
  // 사용자 속성은 키 그대로(옵시디언 속성으로 보임). 값은 JSON(= YAML 흐름 표기)
  const reserved=new Set(RESERVED_PROP_KEYS.map(k=>k.toLowerCase()))
  const props = (doc.props ?? []).map(p => `${yamlKey(reserved.has(p.key.toLowerCase()) ? `${p.key} (속성)` : p.key)}: ${JSON.stringify(p.value)}`)
  return `---\n${[...Object.entries(data).map(([k,v]) => `${k}: ${JSON.stringify(v)}`), ...props].join("\n")}\n---\n${doc.md}`
}
/** YAML 일반 문자열로 읽히면 그대로, 아니면(true·null·숫자처럼 보이는 키, 공백 끝 등) 따옴표 */
export function yamlKey(key: string): string {
  const plain = /^[\p{L}_][\p{L}\p{N} _\-./]*$/u.test(key) && !key.endsWith(" ") && !/^(true|false|null|yes|no|on|off|y|n)$/i.test(key)
  return plain ? key : JSON.stringify(key)
}
export function entry(doc: DocRecord): Entry {
  return { owner: doc.owner, ref: doc.ref, path: docPath(doc), hash: hash(document(doc)), kind: doc.kind, title: doc.title, tags: [...new Set(doc.tags.map(t => t.tag))], updated: doc.updatedAt,...(doc.folders?.length ? {folders:doc.folders} : {}) }
}
function link(e: Entry): string {
  const label = e.title.replace(/[\r\n]/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_~[\]#+.-]/g, "\\$&")
  return `- [${label}](${e.path.split("/").map(part => encodeURIComponent(part).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/")})`
}
export function indexes(entries: Entry[]): { index: string; tags: string } {
  const sorted = [...entries].sort((a,b) => b.updated - a.updated || compare(a.ref,b.ref) || compare(a.owner,b.owner))
  const byKind = Object.entries(folders).map(([kind, folder]) => `## ${folder}\n\n${sorted.filter(e => e.kind === kind).map(link).join("\n")}`).join("\n\n")
  const tags = [...new Set(sorted.flatMap(e => e.tags))].sort(compare)
  return { index: `# 문서 색인\n\n${byKind}\n`, tags: `# 태그\n\n${tags.map(tag => `## ${tag.replace(/[\r\n]/g, " ").replace(/[\\`*{}[\]()#+\-.!_<>|&~]/g, "\\$&")}\n\n${sorted.filter(e => e.tags.includes(tag)).map(link).join("\n")}`).join("\n\n")}\n` }
}
