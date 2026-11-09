import type { HtmlToMarkdown } from "@direction-board/contracts/docs"

type Text = { type: "text"; value: string }
type Element = { type: "element"; tag: string; attrs: Record<string, string>; children: Node[] }
export type Node = Text | Element

const voidTags = new Set(["br", "hr", "img", "input"])
const allowedTags = new Set(["p", "div", "span", "label", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "ul", "ol", "li", "input", "a", "img", "strong", "b", "em", "i", "s", "del", "strike", "code", "pre", "blockquote"])
const markTags = new Set(["strong", "b", "em", "i", "s", "del", "strike"])
const blockTags = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "ul", "ol", "pre", "blockquote"])
const extraBlockTags = new Set(["section", "article", "aside", "header", "footer", "figure", "figcaption", "details", "summary", "dl", "dt", "dd", "main", "nav", "address", "hgroup", "form", "fieldset", "legend", "dialog", "menu", "dir", "center", "noscript", "search", "table"])
const extraVoidTags = new Set(["area", "base", "col", "embed", "link", "meta", "param", "source", "track", "wbr"])

function decode(value: string): string {
  return value.replace(/&(?:#x[\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]*);?|&/g, (ref) => {
    const named: Record<string, string> = {
      "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&nbsp;": "\u00a0", "&apos;": "'",
      "&copy;": "©", "&reg;": "®", "&trade;": "™", "&hellip;": "…", "&mdash;": "—", "&ndash;": "–",
      "&lsquo;": "‘", "&rsquo;": "’", "&ldquo;": "“", "&rdquo;": "”",
    }
    if (ref in named) return named[ref]
    if (/^&#(?:x[\da-f]+|\d+);$/i.test(ref)) {
      const number = ref[2].toLowerCase() === "x" ? parseInt(ref.slice(3, -1), 16) : parseInt(ref.slice(2, -1), 10)
      if (number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)) return String.fromCodePoint(number)
    }
    if (ref === "&") return ref
    throw new Error(`Unsupported or invalid HTML entity: ${ref}`)
  })
}

function decodeLenient(value: string): string {
  return value.replace(/&(?:#x[\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]*);?|&/g, (ref) => {
    try { return decode(ref) } catch { return ref }
  })
}

function skipSuppressed(html: string, start: number, tag: string): number {
  if (tag !== "template") {
    const close = new RegExp(`<\\/\\s*${tag}\\s*>`, "ig")
    close.lastIndex = start
    const match = close.exec(html)
    return match ? close.lastIndex : html.length
  }
  let pos = start
  let depth = 1
  while (pos < html.length) {
    const next = html.indexOf("<", pos)
    if (next < 0) return html.length
    if (html.startsWith("<!--", next)) {
      const end = html.indexOf("-->", next + 4)
      if (end < 0) return html.length
      pos = end + 3
      continue
    }
    let end = next + 1
    let quote = ""
    for (; end < html.length; end++) {
      const char = html[end]
      if (quote) { if (char === quote) quote = "" }
      else if (char === '"' || char === "'") quote = char
      else if (char === ">") break
    }
    if (end === html.length) return html.length
    const content = html.slice(next + 1, end)
    const nested = /^\s*(\/?)\s*(template|script|style)(?=\s|\/|$)/i.exec(content)
    pos = end + 1
    if (!nested) continue
    const name = nested[2].toLowerCase()
    if (name === "template") {
      if (nested[1]) { if (--depth === 0) return pos }
      else if (!/\/\s*$/.test(content)) depth++
    } else if (!nested[1] && !/\/\s*$/.test(content)) {
      pos = skipSuppressed(html, pos, name)
    }
  }
  return html.length
}

function closeImplicitTableElements(stack: Element[], tag: string): void {
  if (!["tr", "td", "th", "thead", "tbody", "tfoot"].includes(tag)) return
  let table = stack.length - 1
  while (table > 0 && stack[table].tag !== "table") table--
  if (table === 0) return
  const wanted = tag === "td" || tag === "th" ? new Set(["td", "th"])
    : tag === "tr" ? new Set(["tr"]) : new Set(["thead", "tbody", "tfoot"])
  for (let i = stack.length - 1; i > table; i--) {
    if (wanted.has(stack[i].tag)) { stack.length = i; return }
  }
}

export function parse(html: string, lenient = false): Node[] {
  const root: Element = { type: "element", tag: "root", attrs: {}, children: [] }
  const stack = [root]
  let pos = 0
  // Beyond this depth retain literal tag text instead of recursing through an
  // unbounded malformed tree. This is a visible, loss-preserving approximation.
  const maxLenientDepth = 96
  let overflow = 0
  while (pos < html.length) {
    if (html[pos] !== "<") {
      const end = html.indexOf("<", pos)
      const next = end < 0 ? html.length : end
      stack[stack.length - 1].children.push({ type: "text", value: (lenient ? decodeLenient : decode)(html.slice(pos, next)) })
      pos = next
      continue
    }
    if (html.startsWith("<!--", pos)) {
      const end = html.indexOf("-->", pos + 4)
      if (end < 0) { if (lenient) break; throw new Error("Unclosed HTML comment") }
      pos = end + 3
      continue
    }
    let end = pos + 1
    let quote = ""
    for (; end < html.length; end++) {
      const char = html[end]
      if (quote) { if (char === quote) quote = "" }
      else if (char === '"' || char === "'") quote = char
      else if (char === ">") break
    }
    if (end === html.length || quote) {
      if (!lenient) throw new Error("Unclosed HTML tag")
      stack[stack.length - 1].children.push({ type: "text", value: decodeLenient(html.slice(pos)) })
      break
    }
    const content = html.slice(pos + 1, end)
    const closing = /^\s*\/\s*([\w-]+)\s*$/.exec(content)
    if (closing) {
      const tag = closing[1].toLowerCase()
      if (lenient && overflow) {
        stack[stack.length - 1].children.push({ type: "text", value: html.slice(pos, end + 1) })
        overflow--
        pos = end + 1
        continue
      }
      if (stack.length === 1 || stack[stack.length - 1].tag !== tag) {
        if (!lenient) throw new Error(`Unexpected closing tag: ${tag}`)
        let index = stack.length - 1
        while (index > 0 && stack[index].tag !== tag) index--
        if (index > 0) stack.length = index
      } else stack.pop()
      pos = end + 1
      continue
    }
    const opening = /^\s*([a-zA-Z][\w-]*)(?=\s|\/|$)/.exec(content)
    if (!opening) {
      if (!lenient) throw new Error("Invalid HTML tag")
      stack[stack.length - 1].children.push({ type: "text", value: decodeLenient(html.slice(pos, end + 1)) })
      pos = end + 1
      continue
    }
    const tag = opening[1].toLowerCase()
    if (lenient && (tag === "script" || tag === "style" || tag === "template")) {
      pos = skipSuppressed(html, end + 1, tag)
      continue
    }
    if (!lenient && !allowedTags.has(tag)) throw new Error(`Unsupported HTML tag: ${tag}`)
    if (lenient && (overflow || stack.length >= maxLenientDepth)) {
      stack[stack.length - 1].children.push({ type: "text", value: html.slice(pos, end + 1) })
      if (!voidTags.has(tag) && !extraVoidTags.has(tag) && !/\/\s*$/.test(content)) overflow++
      pos = end + 1
      continue
    }
    if (lenient) closeImplicitTableElements(stack, tag)
    const attrs: Record<string, string> = {}
    let rest = content.slice(opening[0].length)
    const selfClosing = /(?:^|\s|["'])\/\s*$/.test(rest)
    if (selfClosing) rest = rest.replace(/\/\s*$/, "")
    while (rest.trim()) {
      const attr = /^\s+([^\s=<>"'`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>"'`=]+)))?/.exec(rest)
      if (!attr) {
        if (!lenient) throw new Error(`Invalid attribute on ${tag}`)
        rest = rest.replace(/^\s*\S+/, "")
        continue
      }
      const name = attr[1].toLowerCase()
      if (Object.hasOwn(attrs, name) && !lenient) throw new Error(`Duplicate attribute: ${name}`)
      if (!Object.hasOwn(attrs, name)) attrs[name] = (lenient ? decodeLenient : decode)(attr[2] ?? attr[3] ?? attr[4] ?? "")
      rest = rest.slice(attr[0].length)
    }
    if (selfClosing && !voidTags.has(tag) && !lenient) throw new Error(`Unsupported self-closing tag: ${tag}`)
    const element: Element = { type: "element", tag, attrs, children: [] }
    stack[stack.length - 1].children.push(element)
    if (!voidTags.has(tag) && !(lenient && extraVoidTags.has(tag)) && !selfClosing) stack.push(element)
    pos = end + 1
  }
  if (stack.length !== 1 && !lenient) throw new Error(`Unclosed HTML tag: ${stack[stack.length - 1].tag}`)
  return root.children
}

function codeText(nodes: Node[]): string {
  return nodes.map((node) => {
    if (node.type !== "text") throw new Error(`Unsupported element inside code: ${node.tag}`)
    return node.value
  }).join("")
}

function urlBoundary(value: string): number {
  let open = 0
  let close = 0
  for (const char of value) {
    if (char === "(") open++
    else if (char === ")") close++
  }
  let end = value.length
  while (end > 0) {
    const char = value[end - 1]
    if (/[?!.,:*_~"'“”‘’]/.test(char)) { end--; continue }
    if (char === ")" && close > open) { close--; end--; continue }
    if (char === ";") {
      const start = value.lastIndexOf("&", end - 1)
      if (start >= 0 && /^&(?:[a-z][a-z\d]*|#\d+|#x[\da-f]+);$/i.test(value.slice(start, end))) {
        end = start
        continue
      }
    }
    break
  }
  return end
}

function validWww(value: string): boolean {
  const host = value.split(/[/?#:]/, 1)[0]
  const labels = host.split(".")
  return labels.length >= 2 && labels[0].toLowerCase() === "www" &&
    labels.every((label) => /^[\p{L}\p{N}_-]+$/u.test(label)) &&
    labels.slice(-2).every((label) => !label.includes("_"))
}

const autolinkPattern = /(?<![\p{L}\p{N}+.-])[a-z][a-z\d+-]*:\/\/[^\s]+|(?<![\p{L}\p{N}/@:])www\.[^\s]+|(?<![a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-])[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/giu
type AutoLink = { url: string; href: string; suffix: string }

function resolveAutoLink(candidate: string, previous: string): AutoLink | undefined {
  const split = urlBoundary(candidate)
  const url = candidate.slice(0, split)
  const schemeMatch = /^([a-z][a-z\d+-]*):\/\//i.exec(candidate)
  const scheme = !!schemeMatch
  const www = !scheme && /^www\./i.test(candidate)
  const blocked = www ? /^[\p{L}\p{N}/@:]$/u : /^[\p{L}\p{N}+.-]$/u
  const gluedHttp = !!schemeMatch && /https?$/i.test(schemeMatch[1]) && !/^https?$/i.test(schemeMatch[1])
  if (blocked.test(previous) || gluedHttp || (scheme && /^[a-z][a-z\d+-]*:\/\/$/i.test(url)) || (www && !validWww(url))) return
  return { url, href: scheme ? url : www ? `http://${url}` : `mailto:${url}`, suffix: candidate.slice(split) }
}

function autoLinkMarkdown(url: string, href: string): string {
  const label = url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_[\]~|]/g, "\\$&")
  const target = encodeURI(href).replace(/%25([\da-f]{2})/gi, "%$1").replace(/&/g, "&amp;")
  return `[${label}](<${target}>)`
}

function escapeText(value: string, lineStart = false, before = "", after = "", inLink = false): string {
  const text = value.replace(/[\t\n\r\f ]+/g, " ")
  const entity = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const escapeChars = (s: string) => s.replace(/[&<>\\`*[\]~|_]/g, (char, offset: number) => {
    if (char === "&" || char === "<" || char === ">") return entity(char)
    if (char === "_" && /^[\p{L}\p{N}]$/u.test(s[offset - 1] ?? "") && /^[\p{L}\p{N}]$/u.test(s[offset + 1] ?? "")) return char
    return `\\${char}`
  })
  // [[문서 링크]] 는 그대로 둔다: 이스케이프하면 본문 링크(관계·역링크)가 사라진다
  const plain = (s: string) => {
    let out = "", at = 0
    for (const m of s.matchAll(/\[\[[^[\]\n]+\]\]/g)) {
      out += escapeChars(s.slice(at, m.index ?? 0)) + entity(m[0])
      at = (m.index ?? 0) + m[0].length
    }
    return out + escapeChars(s.slice(at))
  }
  let result = ""
  let pos = 0
  void after
  for (const match of inLink ? [] : text.matchAll(autolinkPattern)) {
    const start = match.index!, candidate = match[0], link = resolveAutoLink(candidate, text[start - 1] ?? before)
    if (!link) { result += plain(text.slice(pos, start + candidate.length)); pos = start + candidate.length; continue }
    result += plain(text.slice(pos, start)) + autoLinkMarkdown(link.url, link.href) + plain(link.suffix)
    pos = start + candidate.length
  }
  result += plain(text.slice(pos))
  if (lineStart) {
    result = result.replace(/^( {0,3})(#{1,6})(?=\s|$)/, "$1\\$2")
      .replace(/^( {0,3})([+-])(?=\s|$)/, "$1\\$2")
      .replace(/^( {0,3})((?:-\s*){3,})$/, "$1\\$2")
      .replace(/^( {0,3}\d{1,9})([.)])(?=\s|$)/, "$1\\$2")
  }
  return result
}

function fenceFor(value: string, minimum: number): string {
  let longest = 0
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return "`".repeat(Math.max(minimum, longest + 1))
}

function destination(value: string): string {
  if (/[\x00-\x1f\x7f-\x9f<>]|\s/u.test(value.replace(/ /g, ""))) throw new Error("Unsupported link destination") // oxlint-disable-line no-control-regex -- CommonMark 링크 목적지에서 허용하지 않는 제어 문자(0x00–0x1F, 0x7F–0x9F) 검사
  return value.replace(/&/g, "&amp;").replace(/ /g, "%20").replace(/[\\()]/g, "\\$&")
}

function lenientDestination(value: string): string {
  return value.replace(/[\s\x00-\x1f\x7f-\x9f<>]/gu, (char) => encodeURIComponent(char)) // oxlint-disable-line no-control-regex -- 관대한 변환에서는 링크 목적지의 제어 문자(0x00–0x1F, 0x7F–0x9F)를 퍼센트 인코딩한다
    .replace(/&/g, "&amp;").replace(/[\\()]/g, "\\$&")
}

function title(value: string | undefined): string {
  return value === undefined ? "" : ` "${value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`
}

type Boundary = { first: string; last: string; nonspaceFirst: string; nonspaceLast: string }
type RenderContext = { boundaries: WeakMap<Node, Boundary>; lenient?: boolean }
function boundary(node: Node, ctx: RenderContext): Boundary {
  const cached = ctx.boundaries.get(node)
  if (cached) return cached
  let result: Boundary
  if (node.type === "text" || node.tag === "br") {
    const value = node.type === "text" ? node.value : "\n"
    const trimmed = value.trim()
    const firstChar = (s: string) => s ? String.fromCodePoint(s.codePointAt(0)!) : ""
    const lastChar = (s: string) => s ? Array.from(s).at(-1)! : ""
    result = { first: firstChar(value), last: lastChar(value), nonspaceFirst: firstChar(trimmed), nonspaceLast: lastChar(trimmed) }
  } else {
    result = { first: "", last: "", nonspaceFirst: "", nonspaceLast: "" }
    for (const child of node.children) {
      const part = boundary(child, ctx)
      result.first ||= part.first
      result.last = part.last || result.last
      result.nonspaceFirst ||= part.nonspaceFirst
      result.nonspaceLast = part.nonspaceLast || result.nonspaceLast
    }
  }
  ctx.boundaries.set(node, result)
  return result
}

function codeSpan(value: string): string {
  if (!value) return ""
  const fence = fenceFor(value, 1)
  const pad = /^`|`$/.test(value) || (/^ | $/.test(value) && /[^ ]/.test(value)) ? " " : ""
  return `${fence}${pad}${value}${pad}${fence}`
}

// Remove non-semantic wrappers and join adjacent text before looking for links.
function normalizeInline(nodes: Node[], lenient = false): Node[] {
  const out: Node[] = []
  const append = (node: Node) => {
    if (node.type === "element" && (node.tag === "span" || node.tag === "label" || (lenient && (node.tag === "li" || (!allowedTags.has(node.tag) && !extraBlockTags.has(node.tag)))))) {
      for (const child of node.children) append(child)
    } else if (node.type === "text") {
      const last = out.at(-1)
      if (last?.type === "text") last.value += node.value
      else out.push({ ...node })
    } else {
      out.push(node.children.length ? { ...node, children: normalizeInline(node.children, lenient) } : node)
    }
  }
  for (const node of nodes) append(node)
  return out
}

type InlineLeaf = { start: number; end: number; anchor?: Element; code?: Element }
type CrossLink = { start: number; end: number; link: AutoLink }

function prepareInline(nodes: Node[], lenient = false): Node[] {
  const normalized = normalizeInline(nodes, lenient)
  const parts: string[] = []
  const leaves: InlineLeaf[] = []
  let length = 0
  const collect = (items: Node[], anchor?: Element, code?: Element) => {
    for (const node of items) {
      if (node.type === "text") {
        if (node.value) leaves.push({ start: length, end: length + node.value.length, anchor, code })
        parts.push(node.value)
        length += node.value.length
      } else if (node.tag === "br" || node.tag === "img" || node.tag === "input") {
        parts.push("\n")
        length++
      } else {
        collect(node.children, node.tag === "a" ? node : anchor, node.tag === "code" ? node : code)
      }
    }
  }
  collect(normalized)
  const text = parts.join("")
  // A URL beginning immediately after a code span or existing link is a new
  // candidate, not a scheme assembled from the preceding atomic node's text.
  const boundaries = new Set<number>()
  for (let i = 1; i < leaves.length; i++) {
    const prev = leaves[i - 1]
    const next = leaves[i]
    if (prev.end !== next.start || !(prev.anchor || prev.code) || next.anchor || next.code) continue
    boundaries.add(next.start)
  }
  let scanText = text
  if (boundaries.size) {
    const mask = (positions: Set<number>) => Array.from({ length: text.length }, (_, i) => positions.has(i + 1) ? "\n" : text[i]).join("")
    const tentative = mask(boundaries)
    const separators = new Set<number>()
    for (const match of tentative.matchAll(autolinkPattern)) {
      if (boundaries.has(match.index!) && resolveAutoLink(match[0], "")) separators.add(match.index!)
    }
    if (separators.size) {
      // Masking must not hide a URL that started outside and already entered an anchor.
      let first = 0
      for (const match of text.matchAll(autolinkPattern)) {
        const start = match.index!
        const link = resolveAutoLink(match[0], text[start - 1] ?? "")
        if (!link) continue
        const end = start + link.url.length
        while (first < leaves.length && leaves[first].end <= start) first++
        if (first >= leaves.length) continue
        const owner = leaves[first].anchor ?? leaves[first].code
        if (owner) {
          for (let i = first + 1; i < leaves.length && leaves[i].start < end; i++) {
            const stillInside = leaves[first].anchor ? leaves[i].anchor === owner : leaves[i].code === owner
            if (stillInside) continue
            const prefix = text.slice(start, leaves[i].start)
            if (/^(?:[a-z][a-z\d+-]*:\/\/|www\.|[a-z\d.!#$%&'*+/=?^_`{|}~-]+@)/i.test(prefix)) {
              throw new Error(leaves[first].anchor ? "URL crosses an existing link boundary" : "URL starts inside code and crosses its boundary")
            }
            break
          }
          continue
        }
        for (let i = first; i < leaves.length && leaves[i].start < end; i++) {
          if (!leaves[i].anchor) continue
          const prefix = text.slice(start, leaves[i].start)
          if (/^(?:[a-z][a-z\d+-]*:\/\/|www\.|[a-z\d.!#$%&'*+/=?^_`{|}~-]+@)/i.test(prefix)) {
            throw new Error("URL crosses an existing link boundary")
          }
          break
        }
      }
      scanText = mask(separators)
    }
  }
  const cross: CrossLink[] = []
  let leafIndex = 0
  for (const match of scanText.matchAll(autolinkPattern)) {
    const start = match.index!
    const link = resolveAutoLink(match[0], scanText[start - 1] ?? "")
    if (!link) continue
    const end = start + link.url.length
    while (leafIndex < leaves.length && leaves[leafIndex].end <= start) leafIndex++
    let last = leafIndex
    while (last < leaves.length && leaves[last].start < end) last++
    if (last === leafIndex) continue
    const firstLeaf = leaves[leafIndex]
    const touched = leaves.slice(leafIndex, last)
    if (touched.some((leaf) => leaf.anchor)) {
      if (firstLeaf.anchor && touched.every((leaf) => leaf.anchor === firstLeaf.anchor)) continue
      throw new Error("URL crosses an existing link boundary")
    }
    if (firstLeaf.code) {
      if (touched.every((leaf) => leaf.code === firstLeaf.code)) continue
      throw new Error("URL starts inside code and crosses its boundary")
    }
    if (touched.length > 1) cross.push({ start, end, link })
  }
  if (!cross.length) return normalized

  let cursor = 0
  let rangeIndex = 0
  const rewrite = (items: Node[]): Node[] => {
    const out: Node[] = []
    for (const node of items) {
      if (node.type === "text") {
        const start = cursor
        const end = start + node.value.length
        cursor = end
        let pos = start
        while (rangeIndex < cross.length && cross[rangeIndex].start < end) {
          const range = cross[rangeIndex]
          if (range.end <= pos) { rangeIndex++; continue }
          if (pos < range.start) out.push({ type: "text", value: node.value.slice(pos - start, range.start - start) })
          if (range.start >= start) out.push({ type: "element", tag: "autolink", attrs: { href: range.link.href }, children: [{ type: "text", value: range.link.url }] })
          pos = Math.min(end, range.end)
          if (range.end <= end) rangeIndex++
          else break
        }
        if (pos < end) out.push({ type: "text", value: node.value.slice(pos - start) })
      } else if (node.tag === "br" || node.tag === "img" || node.tag === "input") {
        cursor++
        out.push(node)
      } else {
        const children = rewrite(node.children)
        let group: Node[] = []
        const flush = () => { if (group.length) out.push({ ...node, children: group }); group = [] }
        for (const child of children) {
          if (child.type === "element" && child.tag === "autolink") { flush(); out.push(child) }
          else group.push(child)
        }
        flush()
      }
    }
    return out
  }
  return rewrite(normalized)
}

function inline(nodes: Node[], ctx: RenderContext): string {
  try {
    return renderInline(prepareInline(nodes, !!ctx.lenient), ctx)
  } catch (error) {
    if (!ctx.lenient || !(error instanceof Error) || !["URL crosses an existing link boundary", "URL starts inside code and crosses its boundary"].includes(error.message)) throw error
    // Keep the original anchor and code rather than inventing a partial destination.
    return renderInline(normalizeInline(nodes, true), ctx, { lineStart: true, inLink: false, previous: "", suppressAutolinks: true })
  }
}

function renderInline(nodes: Node[], ctx: RenderContext, state = { lineStart: true, inLink: false, previous: "", suppressAutolinks: false }): string {
  const before: string[] = [], after: string[] = [], edges: { left: boolean; right: boolean }[] = []
  const word = (c: string) => /^[\p{L}\p{N}]$/u.test(c)
  const firstChar = (s: string) => (s ? String.fromCodePoint(s.codePointAt(0) ?? 0) : "")
  const lastChar = (s: string) => (s ? Array.from(s).at(-1) ?? "" : "")
  let adjacent = ""
  for (let i = 0; i < nodes.length; i++) { before[i] = adjacent; adjacent = boundary(nodes[i], ctx).last || adjacent }
  adjacent = ""
  for (let i = nodes.length - 1; i >= 0; i--) { after[i] = adjacent; adjacent = boundary(nodes[i], ctx).first || adjacent }
  const parts = nodes.map((node, index): string => {
    if (node.type === "text") {
      let text = escapeText(node.value, state.lineStart, state.previous, after[index], state.inLink || state.suppressAutolinks)
      if (state.suppressAutolinks && !state.inLink) {
        text = text.replace(/([a-z][a-z\d+-]*):\/\//gi, "$1&#58;//").replace(/@/g, "&#64;")
        // remark-gfm can link `www` across character references. Split the
        // token with an emphasis node; visible text and existing href survive.
        text = text.replace(/www\./gi, (value) => `${value[0]}**${value[1]}**${value[2]}.`)
      }
      if (/[^\t\n\r\f ]/.test(node.value)) state.lineStart = false
      if (node.value) state.previous = node.value.replace(/[\t\n\r\f ]+/g, " ").at(-1)!
      return text
    }
    const { tag, attrs, children } = node
    if (tag === "br") { state.lineStart = true; state.previous = "\n"; return "\\\n" }
    if (tag === "autolink") {
      const value = codeText(children)
      state.lineStart = false
      state.previous = value.at(-1) ?? state.previous
      return autoLinkMarkdown(value, attrs.href)
    }
    if (tag === "input") {
      if (!ctx.lenient) throw new Error("Unexpected input outside task control")
      const value = attrs.type?.toLowerCase() === "checkbox" ? `[${"checked" in attrs ? "x" : " "}]` : attrs.value ?? attrs.alt ?? ""
      if (value) { state.lineStart = false; state.previous = value.at(-1)! }
      return escapeText(value, false, "", "", true)
    }
    if (tag === "img") {
      if (!("src" in attrs)) {
        if (!ctx.lenient) throw new Error("Image missing src")
        return escapeText(attrs.alt ?? "", false, "", "", true)
      }
      state.lineStart = false
      state.previous = ")"
      return `![${escapeText(attrs.alt ?? "", false, "", "", true)}](${(ctx.lenient ? lenientDestination : destination)(attrs.src)}${title(attrs.title)})`
    }
    if (tag === "code") {
      if (ctx.lenient && children.some((child) => child.type === "element")) return renderInline(children, ctx, state)
      const value = codeText(children).replace(/\r\n?/g, "\n").replace(/\n/g, " ")
      if (!value) return ""
      state.lineStart = false
      state.previous = "`"
      return codeSpan(value)
    }
    if (tag === "a") {
      if (!("href" in attrs)) {
        if (!ctx.lenient) throw new Error("Link missing href")
        return renderInline(children, ctx, state)
      }
      const old = state.inLink
      state.inLink = true
      const text = renderInline(children, ctx, state)
      state.inLink = old
      state.previous = ")"
      return `[${text}](${(ctx.lenient ? lenientDestination : destination)(attrs.href)}${title(attrs.title)})`
    }
    const markers: Record<string, string> = { strong: "**", b: "**", em: "*", i: "*", s: "~~", del: "~~", strike: "~~" }
    if (tag in markers) {
      const value = renderInline(children, ctx, state)
      const [, lead = "", inner = "", trail = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(value) ?? []
      const previousMark = !lead && !/\s/.test(before[index]) && nodes[index - 1]?.type === "element" && markTags.has((nodes[index - 1] as Element).tag)
      const nextMark = !trail && !/\s/.test(after[index]) && nodes[index + 1]?.type === "element" && markTags.has((nodes[index + 1] as Element).tag)
      const marker = markers[tag]
      const innerStart = firstChar(marker === "~~" ? inner : inner.replace(/^\*+/, ""))
      const innerEnd = lastChar(marker === "~~" ? inner : inner.replace(/(?<!\\)\*+$/, ""))
      const safe = !!inner && !!innerStart && !!innerEnd && !previousMark && !nextMark && !value.includes("\\\n")
      if (safe) edges[index] = { left: !lead && (marker === "~~" || !word(innerStart)), right: !trail && (marker === "~~" || !word(innerEnd)) }
      return safe ? `${lead}${marker}${inner}${marker}${trail}` : value
    }
    if (tag === "span" || tag === "label") return renderInline(children, ctx, state)
    if (ctx.lenient) return renderInline(children, ctx, state)
    throw new Error(`Unexpected inline element: ${tag}`)
  })
  edges.forEach((edge, i) => {
    const prev = lastChar(parts[i - 1] ?? ""), next = firstChar(parts[i + 1] ?? "")
    if (edge.left && i > 0 && word(prev)) parts[i - 1] = `${parts[i - 1].slice(0, -prev.length)}&#${prev.codePointAt(0)};`
    if (edge.right && i + 1 < parts.length && word(next)) parts[i + 1] = `&#${next.codePointAt(0)};${parts[i + 1].slice(next.length)}`
  })
  return parts.join("")
}

function finishInline(value: string): string {
  const cleaned = value.replace(/[ \t\r\n\f]*\\\n[ \t\r\n\f]*/g, "\\\n").replace(/^\s+/, "").replace(/\\\n\s*$|\s+$/g, (m) => (m.startsWith("\\\n") ? "\\\n" : ""))
  const result = cleaned.replace(/^( {0,3}\d{1,9})([.)])(?=\s|$)/gm, "$1\\$2")
  return result.endsWith("\\\n") ? `${result}&nbsp;` : result
}

function blockCode(node: Element): string {
  const code = node.children.length === 1 && node.children[0].type === "element" && node.children[0].tag === "code" ? node.children[0] : node
  const value = codeText(code.children).replace(/\r\n?/g, "\n")
  const fence = fenceFor(value, 3)
  const language = /(?:^|\s)language-([\w+-]+)(?:\s|$)/.exec(code.attrs.class ?? "")?.[1] ?? ""
  // A fenced block cannot distinguish a missing final newline from the required closing-fence newline.
  return `${fence}${language}\n${value}${value.endsWith("\n") || !value ? "" : "\n"}${fence}`
}

function labelCheckbox(label: Element): Element {
  let checkbox: Element | undefined
  const inspect = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.type === "text") {
        if (node.value.trim()) throw new Error("Task label contains content")
      } else if (node.tag === "input" && node.attrs.type?.toLowerCase() === "checkbox" && !checkbox) {
        checkbox = node
      } else if (node.tag === "span") {
        inspect(node.children)
      } else throw new Error("Unsupported task label content")
    }
  }
  inspect(label.children)
  if (!checkbox) throw new Error("Task label missing checkbox")
  return checkbox
}

function stripTaskControl(children: Node[]): { content: Node[]; checkbox?: Element } {
  const content = [...children]
  const first = content.findIndex((node) => node.type !== "text" || node.value.trim())
  if (first < 0) return { content }
  const node = content[first]
  if (node.type !== "element") return { content }
  if (node.tag === "label") {
    const checkbox = labelCheckbox(node)
    content.splice(first, 1)
    return { content, checkbox }
  }
  if (node.tag === "input" && node.attrs.type?.toLowerCase() === "checkbox") {
    content.splice(first, 1)
    return { content, checkbox: node }
  }
  if (node.tag === "p" || node.tag === "div") {
    const nested = stripTaskControl(node.children)
    if (nested.checkbox) {
      content[first] = { ...node, children: nested.content }
      return { content, checkbox: nested.checkbox }
    }
  }
  return { content }
}

function list(node: Element, ctx: RenderContext): string {
  let number = 1
  if (node.tag === "ol" && "start" in node.attrs) {
    if (!/^-?\d+$/.test(node.attrs.start)) { if (!ctx.lenient) throw new Error("Invalid ordered-list start") }
    else {
      number = Number(node.attrs.start)
      if (!Number.isSafeInteger(number) || number < 0 || number > 999999999) {
        if (!ctx.lenient) throw new Error("Unsupported ordered-list start")
        number = 1
      }
    }
  }
  const items = node.children.filter((child) => child.type !== "text" || child.value.trim())
  return items.map((item) => {
    const marker = node.tag === "ol" ? `${number <= 999999999 ? number++ : 1}. ` : "- "
    if (item.type !== "element" || item.tag !== "li") {
      if (!ctx.lenient) throw new Error("List contains non-item content")
      return marker + joinBlocks(blocks([item], ctx)).replace(/\n/g, `\n${" ".repeat(marker.length)}`)
    }
    let controls: { content: Node[]; checkbox?: Element }
    try { controls = stripTaskControl(item.children) } catch (error) {
      if (!ctx.lenient || !(error instanceof Error) || !["Task label contains content", "Unsupported task label content", "Task label missing checkbox"].includes(error.message)) throw error
      controls = { content: item.children }
    }
    const { content, checkbox } = controls
    let checked: string | undefined = item.attrs["data-checked"]
    if (checked !== undefined && checked !== "true" && checked !== "false") {
      if (!ctx.lenient) throw new Error("Invalid task checked state")
      checked = undefined
    }
    const task = checked !== undefined || item.attrs["data-type"] === "taskItem" || !!checkbox
    const prefix = task ? `${marker}[${checked !== undefined ? checked === "true" ? "x" : " " : checkbox && "checked" in checkbox.attrs ? "x" : " "}] ` : marker
    const parts = blocks(content, ctx)
    if (!parts.length) return prefix.trimEnd()
    const first = parts[0]
    let result = prefix + first.text.replace(/\n/g, `\n${" ".repeat(marker.length)}`)
    for (let index = 1; index < parts.length; index++) {
      const part = parts[index]
      const indent = " ".repeat(marker.length)
      result += (part.list && parts[index - 1].list === part.list ? `\n\n${indent}&nbsp;\n` : part.list ? "\n" : "\n\n") + part.text.split("\n").map((line) => indent + line).join("\n")
    }
    return result
  }).join("\n")
}

type Block = { text: string; list?: "ul" | "ol" | "task" }
function joinBlocks(parts: Block[]): string {
  return parts.map((part, i) => {
    const prev = parts[i - 1]?.list
    const sep = !i ? "" : part.list && prev === part.list ? "\n\n&nbsp;\n\n" : (part.list === "ul" && prev === "task") || (part.list === "task" && prev === "ul") ? "\n" : "\n\n"
    return sep + part.text
  }).join("")
}

function tableBlocks(node: Element, ctx: RenderContext): Block[] {
  const out: Block[] = []
  const visit = (children: Node[]) => {
    for (const child of children) {
      if (child.type === "text") {
        if (child.value.trim()) out.push(...blocks([child], ctx))
      } else if (child.tag === "tr") {
        const cells = child.children.filter((cell) => cell.type !== "text" || cell.value.trim())
        const text = cells.map((cell) => {
          const contents = cell.type === "element" && (cell.tag === "td" || cell.tag === "th") ? cell.children : [cell]
          return blocks(contents, ctx).map((part) => part.text.replace(/\\\n(?:&nbsp;)?/g, " ")).join(" ")
        }).join(" | ")
        out.push({ text: text || "&nbsp;" })
      } else if (["thead", "tbody", "tfoot"].includes(child.tag)) visit(child.children)
      else out.push(...blocks(child.children, ctx))
    }
  }
  visit(node.children)
  return out
}

function hasBlock(nodes: Node[]): boolean {
  return nodes.some((node) => node.type === "element" && (blockTags.has(node.tag) || extraBlockTags.has(node.tag) || hasBlock(node.children)))
}

function expandBlockWrappers(nodes: Node[]): Node[] {
  const out: Node[] = []
  const expandAnchor = (anchor: Element): Node[] => {
    const expanded = expandBlockWrappers(anchor.children)
    const result: Node[] = []
    let group: Node[] = []
    const flush = () => { if (group.length) result.push({ ...anchor, children: group }); group = [] }
    for (const child of expanded) {
      if (child.type === "element" && (blockTags.has(child.tag) || extraBlockTags.has(child.tag))) {
        flush()
        result.push({ ...child, children: expandAnchor({ ...anchor, children: child.children }) })
      } else group.push(child)
    }
    flush()
    return result
  }
  for (const node of nodes) {
    if (node.type !== "element" || blockTags.has(node.tag) || extraBlockTags.has(node.tag) || !hasBlock(node.children)) {
      out.push(node)
    } else if (node.tag === "a") {
      out.push(...expandAnchor(node))
    } else {
      out.push(...expandBlockWrappers(node.children))
    }
  }
  return out
}

function blocks(nodes: Node[], ctx: RenderContext): Block[] {
  const out: Block[] = []
  let pending: Node[] = []
  const flush = () => {
    const empty = pending.length > 0 && pending.every((c) => (c.type === "text" ? !c.value.trim() : c.tag === "br")) && pending.some((c) => (c.type === "text" ? c.value.includes("\u00a0") : c.tag === "br"))
    const breaks = pending.filter((c) => c.type === "element" && c.tag === "br").length
    const text = empty ? Array(Math.max(1, breaks)).fill("&nbsp;").join("\\\n") : finishInline(inline(pending, ctx)).trim()
    if (text) out.push({ text })
    pending = []
  }
  for (const node of ctx.lenient ? expandBlockWrappers(nodes) : nodes) {
    if (node.type === "text" || !(blockTags.has(node.tag) || (ctx.lenient && extraBlockTags.has(node.tag)))) { pending.push(node); continue }
    flush()
    const { tag, children } = node
    if (tag === "div") out.push(...blocks(children, ctx))
    else if (tag === "p") {
      if (ctx.lenient && hasBlock(children)) { out.push(...blocks(children, ctx)); continue }
      const empty = children.every((child) => child.type === "text" ? !child.value.trim() : child.tag === "br")
      const breaks = children.filter((child) => child.type === "element" && child.tag === "br").length
      const text = empty ? Array(Math.max(1, breaks)).fill("&nbsp;").join("\\\n") : finishInline(inline(children, ctx)).trim()
      out.push({ text })
    }
    else if (/^h[1-6]$/.test(tag)) out.push({ text: `${"#".repeat(Number(tag[1]))} ${finishInline(inline(children, ctx)).trim()}` })
    else if (tag === "ul" || tag === "ol") { const text = list(node, ctx); if (text) out.push({ text, list: tag === "ol" ? "ol" : /^-\s\[[ x]\]/.test(text) ? "task" : "ul" }) }
    else if (tag === "hr") out.push({ text: "---" })
    else if (tag === "pre") {
      const code = children.length === 1 && children[0].type === "element" && children[0].tag === "code" ? children[0] : node
      if (ctx.lenient && code.children.some((child) => child.type === "element")) out.push(...blocks(code.children, ctx))
      else out.push({ text: blockCode(node) })
    }
    else if (tag === "blockquote") {
      const text = joinBlocks(blocks(children, ctx))
      out.push({ text: text.split("\n").map((line) => line ? `> ${line}` : ">").join("\n") })
    }
    else if (ctx.lenient && tag === "table") out.push(...tableBlocks(node, ctx))
    else if (ctx.lenient && extraBlockTags.has(tag)) out.push(...blocks(children, ctx))
  }
  flush()
  return out
}

export const htmlToMarkdown: HtmlToMarkdown = (html) => joinBlocks(blocks(parse(html), { boundaries: new WeakMap() }))

export function htmlToMarkdownLenient(html: string): string {
  // Repair isolated UTF-16 surrogates so URI encoding can handle imported HTML.
  const wellFormed = html.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD")
  return joinBlocks(blocks(parse(wellFormed, true), { boundaries: new WeakMap(), lenient: true }))
}
