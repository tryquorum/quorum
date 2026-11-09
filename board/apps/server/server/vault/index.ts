import type { DocRecord, VaultSink } from "@direction-board/contracts/docs"
import { document, entry, hash, indexes, key } from "./model"
import { commit, load, validateRebuild, verifyIndexes, verifyManaged } from "./journal"
import { serial } from "./storage"
import { htmlToMarkdown, htmlToMarkdownLenient } from "./html-to-markdown"
import { resolve } from 'node:path'
export { htmlToMarkdown }

function decodeEntities(text: string): string {
  return text.replace(/&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]*);/g, ref => {
    const collect = (value: unknown): string => {
      if (typeof value === "string") return value
      if (Array.isArray(value)) return value.map(collect).join("")
      if (value && typeof value === "object" && "props" in value) return collect((value as {props?:{children?:unknown}}).props?.children)
      return ""
    }
    return collect(Bun.markdown.react(ref)) || ref
  })
}

// Numeric references keep recognized named entities intact through the lenient parser.
export function normalizeNamedEntities(html: string): string {
  return html.replace(/&[a-zA-Z][\da-zA-Z]*;/g, ref => {
    const decoded = decodeEntities(ref)
    if (decoded === ref) return ref
    return Array.from(decoded, char => `&#${char.codePointAt(0)};`).join("")
  })
}

const blocks = new Set(["p","div","h1","h2","h3","h4","h5","h6","br","hr","li","ul","ol","blockquote","pre","table","tr","td","th","section","article"])
const hidden = new Set(["script","style","template"])
const punctuation = new Set(Array.from("\\`*_[]<>&#+-!|~.:@(){}="))
const space = (c:string) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f"

function literal(text:string):string {
  const parts:string[] = []
  for (const c of decodeEntities(text)) parts.push(c === "." || c === ":" || c === "@" ? `\`${c}\`<!-- -->` : punctuation.has(c) ? `&#${c.codePointAt(0)};` : c)
  return parts.join("")
}

function destination(value:string):string {
  let result = ""
  for (const c of decodeEntities(value)) {
    const code = c.codePointAt(0)!
    result += code <= 32 || code === 127 || c === "<" || c === ">" || c === "\\" ? encodeURIComponent(c) : c === "&" ? "&amp;" : c
  }
  return result
}

/** Linear, conservative conversion for HTML rejected by both converters. */
export function plainHtmlToMarkdown(html: string): string {
  const output:string[] = []
  let anchor:{href:string; parts:string[]} | null = null
  const suppressed:string[] = []
  const emit = (value:string) => { if (value) (anchor ? anchor.parts : output).push(value) }
  const closeAnchor = () => {
    if (!anchor) return
    const {href,parts} = anchor
    const label = parts.join("")
    anchor = null
    output.push(href ? `[${label || literal(href)}](<${destination(href)}>)` : label)
  }
  let pos = 0
  while (pos < html.length) {
    if (html[pos] !== "<") {
      let end = html.indexOf("<",pos)
      if (end < 0) end = html.length
      if (!suppressed.length) emit(literal(html.slice(pos,end)))
      pos = end
      continue
    }
    if (html.startsWith("<!--",pos)) {
      const end = html.indexOf("-->",pos+4)
      pos = end < 0 ? html.length : end+3
      continue
    }
    let end = pos+1, quote = ""
    while (end < html.length) {
      const c = html[end]
      if (quote) { if (c === quote) quote = "" }
      else if (c === '"' || c === "'") quote = c
      else if (c === ">") break
      end++
    }
    if (end === html.length) { if (!suppressed.length) emit(literal(html.slice(pos))); break }
    let cursor=pos+1
    while (cursor<end && space(html[cursor])) cursor++
    const closing=html[cursor] === "/"
    if (closing) { cursor++; while (cursor<end && space(html[cursor])) cursor++ }
    const start=cursor
    while (cursor<end) {
      const c=html.charCodeAt(cursor)
      if (!(c>=65 && c<=90 || c>=97 && c<=122 || c>=48 && c<=57 || c===45)) break
      cursor++
    }
    const tag=html.slice(start,cursor).toLowerCase()
    if (!tag || !(html.charCodeAt(start)>=65 && html.charCodeAt(start)<=90 || html.charCodeAt(start)>=97 && html.charCodeAt(start)<=122)) {
      if (!suppressed.length) emit(literal(html.slice(pos,end+1)))
      pos=end+1
      continue
    }
    const attrs:Record<string,string> = Object.create(null)
    while (cursor<end) {
      while (cursor<end && (space(html[cursor]) || html[cursor]==="/")) cursor++
      const keyStart=cursor
      while (cursor<end && !space(html[cursor]) && html[cursor]!=="=" && html[cursor]!=="/") cursor++
      if (cursor===keyStart) { cursor++; continue }
      const key=html.slice(keyStart,cursor).toLowerCase()
      while (cursor<end && space(html[cursor])) cursor++
      let value=""
      if (html[cursor]==="=") {
        cursor++
        while (cursor<end && space(html[cursor])) cursor++
        const q=html[cursor]
        if (q==='"' || q==="'") {
          cursor++; const valueStart=cursor
          while (cursor<end && html[cursor]!==q) cursor++
          value=html.slice(valueStart,cursor); if (cursor<end) cursor++
        } else {
          const valueStart=cursor
          while (cursor<end && !space(html[cursor])) cursor++
          value=html.slice(valueStart,cursor)
        }
      }
      if (!(key in attrs)) attrs[key]=value
    }
    if (suppressed.length) {
      const current=suppressed[suppressed.length-1]
      if (closing && tag===current) suppressed.pop()
      else if (!closing && current==="template" && hidden.has(tag)) suppressed.push(tag)
    } else if (!closing && hidden.has(tag)) {
      suppressed.push(tag)
    } else if (tag==="a") {
      if (closing) closeAnchor()
      else { closeAnchor(); anchor={href:attrs.href || "",parts:[]} }
    } else if (!closing && tag==="img") {
      const alt=literal(attrs.alt || ""), src=attrs.src || ""
      emit(src ? `![${alt}](<${destination(src)}>)` : alt)
    } else if (blocks.has(tag)) emit("\n")
    pos=end+1
  }
  closeAnchor()
  return output.join("").trim() || "&#8203;"
}

/** Preserve note content when strict conversion rejects editor HTML. */
export function noteHtmlToMarkdown(html: string): string {
  try { return htmlToMarkdown(html) }
  catch {
    console.warn("[vault] strict HTML conversion failed")
    try { return htmlToMarkdownLenient(normalizeNamedEntities(html)) }
    catch {
      return plainHtmlToMarkdown(html)
    }
  }
}

export function createVaultSink(rootDir: string): VaultSink {
  function selected(doc:DocRecord):DocRecord {
    const parts=(doc.folders || []).slice(0,4)
    let candidate={...doc,folders:parts}
    while(Buffer.byteLength(resolve(rootDir,entry(candidate).path))>1000 && parts.length) {parts.pop();candidate={...doc,folders:parts}}
    if(Buffer.byteLength(resolve(rootDir,entry(candidate).path))>1000) throw new Error('vault document path exceeds 1000 bytes')
    return candidate
  }
  return {
    async upsert(doc) {
      const e = entry(selected(doc)), content = document(doc)
      return serial(rootDir, async store => {
        const { raw, ledger } = await load(store)
        const previous = ledger.entries.find(x => key(x.owner,x.ref) === key(doc.owner,doc.ref))
        if (previous) {
          const exists = await verifyManaged(store, previous)
          if (previous.path === e.path && previous.hash === e.hash && previous.kind === e.kind && previous.title === e.title && previous.updated === e.updated && JSON.stringify(previous.tags) === JSON.stringify(e.tags)) {
            const missingIndexes = await verifyIndexes(store, ledger)
            const rendered = indexes(ledger.entries)
            if (exists && missingIndexes.length === 0 && ledger.indexes.index === hash(rendered.index) && ledger.indexes.tags === hash(rendered.tags)) return { path: e.path }
            await commit(store, raw, ledger, doc.owner, ledger.entries, new Map([[e.path, content]]), exists ? [] : [e.path])
            return { path: e.path }
          }
        }
        const entries = ledger.entries.filter(x => key(x.owner,x.ref) !== key(doc.owner,doc.ref)).concat(e)
        await commit(store, raw, ledger, doc.owner, entries, new Map([[e.path, content]]))
        return { path: e.path }
      })
    },
    async remove(owner, ref) {
      await serial(rootDir, async store => {
        const { raw, ledger } = await load(store)
        const previous = ledger.entries.find(e => key(e.owner,e.ref) === key(owner,ref))
        if (previous) await verifyManaged(store, previous)
        const entries = ledger.entries.filter(e => key(e.owner,e.ref) !== key(owner,ref))
        await commit(store, raw, ledger, owner, entries, new Map())
      })
    },
    async rebuild(owner, docs) {
      const seen = new Set<string>()
      for (const doc of docs) {
        if (doc.owner !== owner || seen.has(doc.ref)) throw new Error("rebuild has duplicate refs or mismatched owner")
        seen.add(doc.ref)
      }
      const replacements = docs.map(doc=>entry(selected(doc)))
      const contents = new Map(docs.map((doc, i) => [replacements[i].path, document(doc)]))
      return serial(rootDir, async store => {
        const { raw, ledger } = await load(store)
        const restore = await validateRebuild(store, ledger, owner, replacements)
        const removed = ledger.entries.filter(e => e.owner === owner && !seen.has(e.ref)).length
        const entries = ledger.entries.filter(e => e.owner !== owner).concat(replacements)
        await commit(store, raw, ledger, owner, entries, contents, restore)
        return { written: docs.length, removed }
      })
    },
  }
}
