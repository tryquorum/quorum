// copied from board/apps/server/server/vault/html-to-markdown.test.ts (Direction Board 2ee6e8a).
// Dropped: the mdToNoteHtml round-trip case (board notes renderer is not part of recipes).
import { describe, expect, test } from "bun:test"
import { htmlToMarkdown, htmlToMarkdownLenient } from "./html-to-markdown"

const lenientRendered = (html: string) => Bun.markdown.html(htmlToMarkdownLenient(html))

// The converter emits backtick fences and same-line spans, including inside lists and quotes.
// Remove only matching delimiters; an unmatched backtick cannot hide a raw tag.
function outsideCode(md: string): string {
  const withoutBlocks = md.replace(/^[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?(`{3,})[^\n]*\n[\s\S]*?^[ \t]*(?:>[ \t]*)*\1[ \t]*$/gm, "")
  const withoutDestinations = withoutBlocks.replace(/(?<!\\)(\[(?:\\.|[^\]\\])*\])\(<(?:\\.|[^<>\\\n])*>\)/g, "$1()")
  return withoutDestinations.split("\n").map((line) => {
    let result = ""
    for (let i = 0; i < line.length;) {
      if (line[i] === "\\" && i + 1 < line.length) { result += line.slice(i, i + 2); i += 2; continue }
      if (line[i] !== "`") { result += line[i++]; continue }
      let end = i
      while (line[end] === "`") end++
      const length = end - i
      let close = end
      while (close < line.length) {
        if (line[close] !== "`") { close++; continue }
        let after = close
        while (line[after] === "`") after++
        if (after - close === length) break
        close = after
      }
      if (close === line.length) { result += line.slice(i, end); i = end; continue }
      i = close + length
    }
    return result
  }).join("\n")
}

const markdown = (html: string) => {
  const md = htmlToMarkdown(html)
  expect(outsideCode(md)).not.toMatch(/<\/?[a-zA-Z]|<!--/)
  return md
}
const rendered = (html: string) => Bun.markdown.html(markdown(html))

describe("htmlToMarkdown", () => {
  test("lenient: unsupported inline wrapper preserves an image", () => {
    const html = '<u>Look <img src="https://example.com/a.png" alt="diagram"></u>'
    const out = lenientRendered(html)
    expect(out).toContain('Look <img src="https://example.com/a.png" alt="diagram"')
    expect(() => htmlToMarkdown(html)).toThrow()
  })

  test("lenient: inline wrappers preserve links and text", () => {
    const out = lenientRendered('<p><u>under</u> <a href="https://x.org">x</a> <mark>highlight</mark> H<sub>2</sub>O x<sup>2</sup></p>')
    expect(out).toContain('under <a href="https://x.org">x</a> highlight H2O x2')
  })

  test("lenient: table rows become separate paragraphs with cell formatting and links", () => {
    const out = lenientRendered('<table><thead><tr><th><strong>Head</strong></th><th>More</th></tr></thead><tbody><tr><td><a href="https://x.org">link</a></td><td><em>value</em></td></tr></tbody></table>')
    expect(out).toContain('<p><strong>Head</strong> | More</p>')
    expect(out).toContain('<p><a href="https://x.org">link</a> | <em>value</em></p>')
  })

  test("lenient: additional block elements retain boundaries and descendants", () => {
    const out = lenientRendered('<section><p>first</p><article><p>second</p></article></section><aside>third</aside>')
    expect(out).toMatch(/<p>first<\/p>\s*<p>second<\/p>\s*<p>third<\/p>/)
  })

  test("lenient: blocks nested inside transparent wrappers still form paragraphs", () => {
    expect(lenientRendered('<u><section>first</section><section>second</section></u>')).toMatch(/<p>first<\/p>\s*<p>second<\/p>/)
    expect(lenientRendered('<p>before <section>block</section>after</p>')).toMatch(/<p>before<\/p>\s*<p>block<\/p>\s*<p>after<\/p>/)
  })

  test("lenient: script style and template contents are removed", () => {
    const out = lenientRendered('<p>before</p><script>ignored &bogus; <b>unsafe</b></script><style>unsafe</style><template><p>unsafe</p></template><p>after</p>')
    expect(out).toMatch(/<p>before<\/p>\s*<p>after<\/p>/)
    expect(out).not.toContain('unsafe')
    const nested = lenientRendered('<p>before</p><template><template>hidden</template><script>"</template>"</script>hidden</template><p>after</p>')
    expect(nested).toMatch(/<p>before<\/p>\s*<p>after<\/p>/)
    expect(nested).not.toContain('hidden')
  })

  test("lenient: malformed tags and unsupported entities retain visible text", () => {
    const out = lenientRendered('<p>one <b>two</p><p>&bogus; three')
    expect(out).toContain('one')
    expect(out).toContain('two')
    expect(out).toContain('&amp;bogus; three')
  })

  test("lenient: a URL crossing an existing anchor preserves its text and href", () => {
    const html = '<p>https://exa<a href="https://target.example">mple</a>.org/x</p>'
    const out = lenientRendered(html)
    expect(out).toContain('https://exa')
    expect(out).toContain('<a href="https://target.example">mple</a>')
    expect(out).toContain('.org/x')
    expect(() => htmlToMarkdown(html)).toThrow()
    for (const prefix of ['www.exa', 'https://exa', 'user@exa']) {
      const md = htmlToMarkdownLenient(`<p>${prefix}<a href="https://target">mple</a>.org</p>`)
      const out = Bun.markdown.html(md, { autolinks: true })
      const text = out.replace(/<[^>]+>/g, '').replace(/\n/g, '')
      expect(text).toBe(`${prefix}mple.org`)
      expect([...out.matchAll(/<a href="([^"]+)">/g)].map((match) => match[1])).toEqual(['https://target'])
      expect(out).toContain('<a href="https://target">mple</a>')
    }
    const nested = htmlToMarkdownLenient('<p><strong>www.exa</strong><a href="https://target">mple</a>.org</p>')
    const nestedOut = Bun.markdown.html(nested, { autolinks: true })
    expect(nestedOut.replace(/<[^>]+>/g, '').replace(/\n/g, '')).toBe('www.example.org')
    expect([...nestedOut.matchAll(/<a href="([^"]+)">/g)].map((match) => match[1])).toEqual(['https://target'])
  })

  test("lenient: malformed seeded HTML yields strings without exceptions", () => {
    const corpus = ['<p title="unterminated', '<a href="\ud800">x</a>', '<p>https://example.org/\ud800</p>', '<div>'.repeat(3000) + 'visible', '<section>'.repeat(3000) + 'text', '<p><li>x</li></p>', '<h1><img src="https://x/a" alt="pic"></h1>', '<pre><a href="https://x">x</a></pre>', '<h1><ul><li>nested</li></ul></h1>', '<table><pre><table><tr><td>x</table></pre></table>', '<p><a><h1>x</h1></a></p>']
    let seed = 42
    const pieces = ['<p>', '</p>', '<a href="https://x">', '</a>', '<code>', '</code>', '<li>', '</li>', '<table>', '<td>', '<br>', '<x>', '</x>', '<!--', '>', '&bad;', '\ud800', 'word', '<script>', '</script>']
    for (let i = 0; i < 1000; i++) {
      let html = ''
      for (let j = 0; j < 30; j++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; html += pieces[seed % pieces.length] }
      corpus.push(html)
    }
    for (const html of corpus) expect(typeof htmlToMarkdownLenient(html)).toBe('string')
  })

  test("lenient: hostile inputs near 200KB scale close to linearly", () => {
    const cases: [string, (n: number) => string][] = [
      ['unclosed tags', (n) => '<x>'.repeat(n)],
      ['long attribute', (n) => '<p x="' + 'a'.repeat(n) + '">text</p>'],
      ['nested wrappers', (n) => '<span>'.repeat(n) + 'x' + '</span>'.repeat(n)],
      ['suppressed', (n) => '<template><script>x</script></template>'.repeat(n)],
    ]
    for (const [name, make] of cases) {
      const unit = name === 'long attribute' ? 100_000 : name === 'unclosed tags' ? 33_000 : name === 'nested wrappers' ? 7_000 : 2_500
      const measure = (n: number) => { const input = make(n); const start = performance.now(); htmlToMarkdownLenient(input); return performance.now() - start }
      measure(Math.ceil(unit / 10))
      const small = measure(unit), large = measure(unit * 2)
      console.log(`lenient ${name}: ${small.toFixed(2)}ms -> ${large.toFixed(2)}ms`)
      expect(large).toBeLessThan(3000)
      expect(large).toBeLessThan(Math.max(small, 10) * 8)
    }
  }, 30000)

  test("lenient: a nested image in code preserves its destination and alt", () => {
    const out = lenientRendered('<p><code><img src="https://example.com/a.png" alt="diagram"></code></p>')
    expect(out).toContain('<img src="https://example.com/a.png" alt="diagram"')
  })

  test("lenient: link, image and task content survives non-editor HTML", () => {
    const out = lenientRendered('<section><a href="https://x.org/a&#9;b">link</a> <img src="https://x.org/a&#9;b" alt="diagram"></section>')
    expect(out).toContain('href="https://x.org/a%09b"')
    expect(out).toContain('src="https://x.org/a%09b" alt="diagram"')
    const task = lenientRendered('<ul><li><label><input type="checkbox">important</label><div><p>body</p></div></li></ul>')
    expect(task).toContain('important')
    expect(task).toContain('body')
  })

  test("lenient: implicit table cells and rows retain each cell", () => {
    const out = lenientRendered('<table><tr><td>one<td>two<tr><td>three<td><a href="https://x.org">four</a></table>')
    expect(out).toContain('<p>one | two</p>')
    expect(out).toContain('<p>three | <a href="https://x.org">four</a></p>')
  })

  for (const [name, html] of [
    ['code', '<p><code>https://exa</code>mple.orghttps://example.org</p>'],
    ['link', '<p><a href="https://target">https://exa</a>mple.orghttps://example.org</p>'],
    ['code with www', '<p><code>www.exa</code>mple.orghttps://example.org</p>'],
    ['link with email', '<p><a href="https://target">me@exa</a>mple.orghttps://example.org</p>'],
  ]) {
    test(`regression U3: a URL starting in ${name} cannot cross into adjacent text`, () => {
      expect(() => htmlToMarkdown(html)).toThrow()
    })
  }

  test("regression U3: domain-like or glued scheme prefixes stay ordinary text", () => {
    for (const text of ['xhttps://example.org', 'nothttps://example.org', 'mple.orghttps://example.org', 'foo.bar://example.org']) {
      const md = markdown(`<p>${text}</p>`)
      for (const autolinks of [true, false]) expect(Bun.markdown.html(md, { autolinks })).toBe(`<p>${text}</p>\n`)
    }
  })

  test("regression U2: a URL immediately after an existing link is independent", () => {
    const html = '<p><a href="https://target">read</a>https://example.org</p>'
    const md = markdown(html)
    expect(md).toBe('[read](https://target)[https://example.org](<https://example.org>)')
    for (const autolinks of [true, false]) {
      expect(Bun.markdown.html(md, { autolinks })).toBe('<p><a href="https://target">read</a><a href="https://example.org">https://example.org</a></p>\n')
    }
    expect(rendered('<p><a href="https://t">read</a>https://example.org</p>')).toBe('<p><a href="https://t">read</a><a href="https://example.org">https://example.org</a></p>\n')
    expect(rendered('<p>prefix<a href="https://target">read</a>https://example.org</p>')).toBe('<p>prefix<a href="https://target">read</a><a href="https://example.org">https://example.org</a></p>\n')
  })

  test("regression U2: a URL immediately after inline code is independent", () => {
    const html = '<p><code>read</code>https://example.org</p>'
    const md = markdown(html)
    expect(md).toBe('`read`[https://example.org](<https://example.org>)')
    for (const autolinks of [true, false]) {
      expect(Bun.markdown.html(md, { autolinks })).toBe('<p><code>read</code><a href="https://example.org">https://example.org</a></p>\n')
    }
  })

  test("an adjacent URL can itself cross later formatting boundaries", () => {
    const html = '<p><code>read</code>https://exa<strong>mple</strong>.org/x</p>'
    expect(rendered(html)).toBe('<p><code>read</code><a href="https://example.org/x">https://example.org/x</a></p>\n')
  })

  test("atomic boundaries also separate adjacent www and email", () => {
    for (const [html, expected] of [
      ['<p><a href="https://target">read</a>www.example.org</p>', '<p><a href="https://target">read</a><a href="http://www.example.org">www.example.org</a></p>\n'],
      ['<p><code>read</code>me@example.org</p>', '<p><code>read</code><a href="mailto:me@example.org">me@example.org</a></p>\n'],
      ['<p><code>https://exa</code>.</p>', '<p><code>https://exa</code>.</p>\n'],
    ]) {
      const md = markdown(html)
      for (const autolinks of [true, false]) expect(Bun.markdown.html(md, { autolinks })).toBe(expected)
    }
  })

  for (const [name, html, text, target, suffix] of [
    ['span HTTPS', '<p>https://exa<span>mple.org</span>/path</p>', 'https://example.org/path', 'https://example.org/path', ''],
    ['span www', '<p>www.exa<span>mple.org</span>/path</p>', 'www.example.org/path', 'http://www.example.org/path', ''],
    ['span email', '<p>me@exa<span>mple.org</span></p>', 'me@example.org', 'mailto:me@example.org', ''],
    ['label HTTPS', '<p>https://exa<label>mple.org</label>/path</p>', 'https://example.org/path', 'https://example.org/path', ''],
    ['span general scheme', '<p>git+<span>ssh://example.org</span></p>', 'git+ssh://example.org', 'git+ssh://example.org', ''],
    ['strong', '<p>https://exa<strong>mple</strong>.org/x</p>', 'https://example.org/x', 'https://example.org/x', ''],
    ['em and punctuation', '<p>https://exa<em>mple</em>.org/x,</p>', 'https://example.org/x', 'https://example.org/x', ','],
    ['code crossing', '<p>https://exa<code>mple</code>.org/x</p>', 'https://example.org/x', 'https://example.org/x', ''],
  ]) {
    test(`regression: URL across inline boundaries stays whole: ${name}`, () => {
      const md = markdown(html)
      for (const autolinks of [true, false]) {
        const out = Bun.markdown.html(md, { autolinks })
        expect(out).toBe(`<p><a href="${target}">${text}</a>${suffix}</p>\n`)
      }
    })
  }

  test("URL crossing an existing link boundary throws instead of producing a partial link", () => {
    expect(() => htmlToMarkdown('<p>https://exa<a href="https://target.example">mple</a>.org/x</p>')).toThrow()
    expect(() => htmlToMarkdown('<p><a href="https://target.example">https://exa</a>mple.org/x</p>')).toThrow()
    expect(() => htmlToMarkdown('<p>https://exa<a href="https://target.example">m</a>https://example.org</p>')).toThrow()
    expect(() => htmlToMarkdown('<p>https://<a href="https://target.example">e</a>https://example.org</p>')).toThrow()
    expect(() => htmlToMarkdown('<p><a href="https://target">https://exa</a>https://example.org</p>')).toThrow()
  })

  test("a URL starting in code and crossing its boundary fails rather than partially linking", () => {
    expect(() => htmlToMarkdown('<p><code>https://exa</code>mple.org/x</p>')).toThrow()
    expect(() => htmlToMarkdown('<p><code>https://exa</code>https://example.org</p>')).toThrow()
  })

  test("two cross-boundary URLs and surrounding marked text survive in order", () => {
    const html = '<p>https://exa<strong>mple.org tail</strong> and www.exa<em>mple</em>.org</p>'
    const out = rendered(html)
    expect(out).toBe('<p><a href="https://example.org">https://example.org</a> <strong>tail</strong> and <a href="http://www.example.org">www.example.org</a></p>\n')
  })

  test("standalone code and adjacent existing links keep their original semantics", () => {
    expect(rendered('<p><code>https://example.org</code> after</p>')).toBe('<p><code>https://example.org</code> after</p>\n')
    expect(rendered('<p><code>intro</code> https://example.org</p>')).toBe('<p><code>intro</code> <a href="https://example.org">https://example.org</a></p>\n')
    expect(rendered('<p>https://example.org <a href="https://target.example">other</a></p>')).toBe('<p><a href="https://example.org">https://example.org</a> <a href="https://target.example">other</a></p>\n')
    expect(rendered('<p><a href="https://target.example">https://example.org</a></p>')).toBe('<p><a href="https://target.example">https://example.org</a></p>\n')
  })

  for (const [input, target, suffix] of [
    ['ftp://www.example.org', 'ftp://www.example.org', ''],
    ['ftp://example.org/a_b.', 'ftp://example.org/a_b', '.'],
    ['sftp://host/x', 'sftp://host/x', ''],
    ['x://www.example.com', 'x://www.example.com', ''],
    ['git+ssh://user@example.org/a_b', 'git+ssh://user@example.org/a_b', ''],
  ]) {
    test(`regression: a full scheme address keeps its original destination: ${input}`, () => {
      const md = markdown(`<p>${input}</p>`)
      for (const autolinks of [true, false]) {
        const out = Bun.markdown.html(md, { autolinks })
        const match = /^<p><a href="([^"]*)">([^<>]*)<\/a>([^<>]*)<\/p>\n$/.exec(out)
        expect(match).not.toBeNull()
        expect(decodeURIComponent(match![1])).toBe(target)
        expect(match![2] + match![3]).toBe(input)
        expect(match![3]).toBe(suffix)
      }
    })
  }

  test("invalid www candidates remain literal in conversion and Bun", () => {
    // The app's remark-gfm independently autolinks www. and www.. when rendered literally.
    for (const text of ['www..', 'www.', 'awww.example.com']) {
      const md = markdown(`<p>${text}</p>`)
      expect(md).toBe(text)
      for (const autolinks of [true, false]) {
        expect(Bun.markdown.html(md, { autolinks })).toBe(`<p>${text}</p>\n`)
      }
    }
  })

  test("underscore in either final domain label does not create an explicit link", () => {
    // Bun's optional autolinker is more permissive here than the app's remark-gfm.
    for (const text of ['www.foo_bar.com', 'www.example.c_m']) {
      const md = markdown(`<p>${text}</p>`)
      expect(md).toBe(text)
      expect(Bun.markdown.html(md, { autolinks: false })).toBe(`<p>${text}</p>\n`)
    }
  })

  test("valid www domains include earlier underscore labels and Unicode", () => {
    for (const text of ['www.example', 'www.example.com', 'www.foo_bar.example.com', 'www.點看.com']) {
      const md = markdown(`<p>${text}</p>`)
      for (const autolinks of [true, false]) {
        const out = Bun.markdown.html(md, { autolinks })
        const match = /^<p><a href="([^"]*)">([^<>]*)<\/a><\/p>\n$/.exec(out)
        expect(match).not.toBeNull()
        expect(decodeURIComponent(match![1])).toBe(`http://${text}`)
        expect(match![2]).toBe(text)
      }
    }
  })

  test("www following slash, at-sign or colon never becomes an explicit link", () => {
    for (const text of ['x/www.example.com', 'x@www.example.com', 'x:www.example.com']) {
      const md = markdown(`<p>${text}</p>`)
      expect(md).not.toContain('](<http://www.')
    }
  })

  for (const [input, visible, target] of [
    ['https://example.org*', 'https://example.org*', 'https://example.org'],
    ['https://example.org~', 'https://example.org~', 'https://example.org'],
    ['https://example.org_', 'https://example.org_', 'https://example.org'],
    ['https://example.org&amp;copy;', 'https://example.org&copy;', 'https://example.org'],
    ['See https://example.org.', 'See https://example.org.', 'https://example.org'],
    ['www.example.com/x', 'www.example.com/x', 'http://www.example.com/x'],
    ['me@example.com', 'me@example.com', 'mailto:me@example.com'],
  ]) {
    test(`regression: every autolink is explicit and preserves suffix: ${input}`, () => {
      const md = markdown(`<p>${input}</p>`)
      expect(md).toMatch(/\[(?:\\.|[^\]\\])+\]\(<[^<>]+>\)/)
      for (const autolinks of [true, false]) {
        const out = Bun.markdown.html(md, { autolinks })
        const match = /^<p>([^<>]*)<a href="([^"]*)">([^<>]*)<\/a>([^<>]*)<\/p>\n$/.exec(out)
        expect(match).not.toBeNull()
        const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        expect(decodeURIComponent(decode(match![2]))).toBe(target)
        expect(decode(match![1] + match![3] + match![4])).toBe(visible)
      }
    })
  }

  test("ordinary text near www and URL-like substrings never gains a link", () => {
    for (const [input, visible] of [
      ['wwwx.example.org', 'wwwx.example.org'],
      ['www_example.org', 'www_example.org'],
      ['www*example.org', 'www*example.org'],
      ['www\\example.org', 'www\\example.org'],
      ['www&amp;example.org', 'www&amp;example.org'],
      ['xwww.example.org', 'xwww.example.org'],
      ['x<span>www.example.org</span>', 'xwww.example.org'],
    ]) {
      const md = markdown(`<p>${input}</p>`)
      for (const autolinks of [true, false]) {
        expect(Bun.markdown.html(md, { autolinks })).toBe(`<p>${visible}</p>\n`)
      }
    }
  })

  test("explicit targets encode Unicode without double-encoding existing escapes", () => {
    for (const [text, target] of [
      ['https://example.org/a%20b', 'https://example.org/a%20b'],
      ['https://example.org/한글', 'https://example.org/%ED%95%9C%EA%B8%80'],
    ]) {
      const md = markdown(`<p>${text}</p>`)
      expect(md).toContain(`](<${target}>)`)
      for (const autolinks of [true, false]) {
        expect(Bun.markdown.html(md, { autolinks })).toBe(`<p><a href="${target}">${text}</a></p>\n`)
      }
    }
  })

  for (const [text, target] of [
    ['See https://example.org/a_b.', 'https://example.org/a_b'],
    ['x https://example.org/a_b, y', 'https://example.org/a_b'],
    ['(https://example.org/a_b)', 'https://example.org/a_b'],
    ['https://example.org/wiki/A_(b)', 'https://example.org/wiki/A_(b)'],
    ['https://example.org/a_b?', 'https://example.org/a_b'],
    ['"https://example.org/*x*"', 'https://example.org/*x'],
  ]) {
    test(`regression: URL punctuation boundary: ${text}`, () => {
      const md = markdown(`<p>${text}</p>`)
      for (const autolinks of [true, false]) {
        const out = Bun.markdown.html(md, { autolinks })
        const match = /^<p>([^<>]*)<a href="([^"]*)">([^<>]*)<\/a>([^<>]*)<\/p>\n$/.exec(out)
        expect(match).not.toBeNull()
        const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        expect(decodeURIComponent(decode(match![2]))).toBe(target)
        expect(decode(match![1] + match![3] + match![4])).toBe(text)
      }
    })
  }

  test("URL boundaries retain balanced parentheses and leave trailing punctuation and entities in text", () => {
    for (const [input, target, suffix] of [
      ['https://example.org/a_b((c))).', 'https://example.org/a_b((c))', ').'],
      ['https://example.org/a_b!?', 'https://example.org/a_b', '!?'],
      ['https://example.org/a_b:_~', 'https://example.org/a_b', ':_~'],
      ['https://example.org/a_b&amp;copy;.', 'https://example.org/a_b', '&amp;copy;.'],
      ['https://example.org/a_b&amp;#123;!', 'https://example.org/a_b', '&amp;#123;!'],
    ]) {
      const md = markdown(`<p>${input}</p>`)
      for (const autolinks of [true, false]) {
        const out = Bun.markdown.html(md, { autolinks })
        expect(out).toBe(`<p><a href="${target}">${target}</a>${suffix}</p>\n`)
      }
    }
    const explicit = markdown('<p>https://example.org/path.</p>')
    expect(explicit).toBe('[https://example.org/path](<https://example.org/path>).')
    for (const autolinks of [true, false]) {
      expect(Bun.markdown.html(explicit, { autolinks })).toBe('<p><a href="https://example.org/path">https://example.org/path</a>.</p>\n')
    }
  })

  for (const [url, target] of [
    ['https://example.org/*secret*', 'https://example.org/*secret'],
    ['https://example.org/a_b_c', 'https://example.org/a_b_c'],
    ['https://example.org/~x~', 'https://example.org/~x'],
    ['https://example.org/`x`', 'https://example.org/`x`'],
    ['https://example.org/[abc](https://evil.example)', 'https://example.org/[abc](https://evil.example)'],
    ['https://example.org/a(b)c', 'https://example.org/a(b)c'],
    ['www.example.com/*x*', 'http://www.example.com/*x'],
  ]) {
    test(`regression: Markdown characters in URL stay within one link: ${url}`, () => {
      const md = markdown(`<p>${url}</p>`)
      for (const autolinks of [true, false]) {
        const out = Bun.markdown.html(md, { autolinks })
        const match = /^<p><a href="([^"]*)">([^<]*)<\/a>([^<>]*)<\/p>\n$/.exec(out)
        expect(match).not.toBeNull()
        expect(match![2] + match![3]).toBe(url)
        expect(decodeURIComponent(match![1])).toBe(target)
      }
    })
  }

  test("URL ampersands, angle brackets and backslashes retain text and target", () => {
    for (const [input, visible] of [
      ['https://example.org/?a=1&amp;b=2', 'https://example.org/?a=1&b=2'],
      ['https://example.org/a&lt;b&gt;c', 'https://example.org/a<b>c'],
      ['https://example.org/a\\b', 'https://example.org/a\\b'],
    ]) {
      const md = markdown(`<p>${input}</p>`)
      for (const autolinks of [true, false]) {
        const out = Bun.markdown.html(md, { autolinks })
        const match = /^<p><a href="([^"]*)">([^<]*)<\/a><\/p>\n$/.exec(out)
        expect(match).not.toBeNull()
        const decode = (value: string) => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        expect(decode(match![2])).toBe(visible)
        expect(decodeURIComponent(decode(match![1]))).toBe(visible)
      }
    }
  })

  test("regression B1: safe URLs become explicit links with the same destination", () => {
    for (const [sourceText, href] of [
      ['https://example.org', 'https://example.org'],
      ['www.example.org', 'http://www.example.org'],
      ['me@example.org', 'mailto:me@example.org'],
    ]) {
      const source = `<p>${sourceText}</p>`
      const md = markdown(source)
      expect(md).toBe(`[${sourceText}](<${href}>)`)
      for (const autolinks of [true, false]) {
        const out = Bun.markdown.html(md, { autolinks })
        expect(out).toBe(`<p><a href="${href}">${sourceText}</a></p>\n`)
      }
    }
  })

  test("regression B1: ordinary punctuation and intraword underscores remain literal", () => {
    for (const text of ['a.b (c)', 'snake_case_name']) {
      expect(markdown(`<p>${text}</p>`)).toBe(text)
      expect(rendered(`<p>${text}</p>`)).toBe(`<p>${text}</p>\n`)
    }
    expect(markdown('<p>snake_<span>case</span>_name</p>')).toBe('snake_case_name')
  })

  test("a terminal entity is outside an automatic link but stays inside an explicit HTML link", () => {
    const url = 'https://example.org/?q=&amp;copy;'
    const standalone = Bun.markdown.html(markdown(`<p>${url}</p>`), { autolinks: true })
    expect(standalone).toBe('<p><a href="https://example.org/?q=">https://example.org/?q=</a>&amp;copy;</p>\n')
    const linked = Bun.markdown.html(markdown(`<p><a href="https://target.example">${url}</a></p>`), { autolinks: true })
    expect(linked).toBe(`<p><a href="https://target.example">${url}</a></p>\n`)
  })

  test("regression B1: Markdown-looking text does not acquire structure", () => {
    for (const text of ['1. not list', '1) not list', '# not heading', '- not list', '+ not list', '*not em*', '--- --- ---']) {
      expect(rendered(`<p>${text}</p>`)).toBe(`<p>${text}</p>\n`)
    }
    expect(rendered('<p><span>1</span><span>. not list</span></p>')).toBe('<p>1. not list</p>\n')
  })

  test("regression B2: many sibling marks scale approximately linearly", () => {
    const input = (n: number) => `<p>${'<strong>x</strong> '.repeat(n)}</p>`
    const measure = (n: number) => { const html = input(n); const start = performance.now(); const md = htmlToMarkdown(html); return { ms: performance.now() - start, md } }
    measure(200)
    const middle = (n: number) => Array.from({ length: 3 }, () => measure(n)).sort((a, b) => a.ms - b.ms)[1]
    const small = middle(1000)
    const large = middle(8000)
    console.log(`mark performance 1000=${small.ms.toFixed(2)}ms 8000=${large.ms.toFixed(2)}ms`)
    expect(large.md.split('x').length - 1).toBe(8000)
    expect(large.ms).toBeLessThan(1000)
    expect(large.ms).toBeLessThan(small.ms * 20)
  }, 30000)

  test("regression N1: control whitespace in link or image destinations is rejected", () => {
    expect(() => htmlToMarkdown('<p><a href="https://example.org/a&#9;b">link</a></p>')).toThrow()
    expect(() => htmlToMarkdown('<p><img src="https://example.org/a&#9;b" alt="image"></p>')).toThrow()
    expect(() => htmlToMarkdown('<p><a href="https://example.org/a&#x2028;b">link</a></p>')).toThrow()
  })

  test("regression N2: break at the end of a mark does not add whitespace before following text", () => {
    expect(rendered('<p>before <strong>x<br></strong>after</p>')).toMatch(/<p>before x<br\s*\/>\s*after<\/p>/)
    expect(rendered('<p>before <em>x<br></em>after</p>')).not.toContain('\u00a0')
  })

  test("regression: tag-shaped text stays in a fenced HTML code block", () => {
    const md = markdown('<pre><code class="language-html">&lt;div&gt;x&lt;/div&gt;\n</code></pre>')
    expect(Bun.markdown.html(md)).toBe('<pre><code class="language-html">&lt;div&gt;x&lt;/div&gt;\n</code></pre>\n')
  })

  test("regression: tag-shaped text stays in an inline code span", () => {
    const md = markdown('<p><code>&lt;b&gt;</code></p>')
    expect(Bun.markdown.html(md)).toBe('<p><code>&lt;b&gt;</code></p>\n')
  })

  test("raw-tag check excludes matched code only", () => {
    expect(outsideCode('`<b>` <i>x</i>')).toContain('<i>')
    expect(outsideCode('`unclosed <b>')).toContain('<b>')
    expect(outsideCode('\\`<b>\\`')).toContain('<b>')
    expect(outsideCode('``<b>`<i>`` <em>outside</em>')).toContain('<em>outside</em>')
    expect(outsideCode('> ````html\n> ```\n> <div>x</div>\n> ````\n> <b>outside</b>')).toContain('<b>outside</b>')
    expect(outsideCode('> ````html\n> ```\n> <div>x</div>\n> ````')).not.toMatch(/<\/?[a-zA-Z]/)
    expect(outsideCode('\\[text\\](<script>)')).toContain('<script>')
    expect(outsideCode('[text](<https://example.org>) <b>outside</b>')).toContain('<b>outside</b>')
  })

  test("pure Markdown has no raw HTML tags or comments outside code", () => {
    const fixtures = ['<p>a<strong>!</strong>b foo<s>bar</s>baz<br>tail</p>', '<p><br></p>', '<p><a href="https://example.org" title="&lt;title&gt;">link</a></p>', '<p><code>&lt;tag&gt;</code></p>', '<pre><code>&lt;two&gt;</code></pre>', '<ul><li>one</li></ul><ul><li>two</li></ul>']
    for (const fixture of fixtures) {
      const md = markdown(fixture)
      expect(outsideCode(md)).not.toMatch(/<\/?[a-zA-Z]|<!--/)
    }
  })

  test("punctuation-bounded and intraword marks preserve formatting via entity boundaries", () => {
    expect(rendered('<p>a<strong>!</strong>b foo<s>bar</s>baz</p>')).toBe('<p>a<strong>!</strong>b foo<del>bar</del>baz</p>\n')
  })

  test("pure Markdown preserves consecutive and terminal hard breaks and empty paragraphs", () => {
    expect(rendered('<p>x<br><br>y</p>')).toMatch(/<p>x<br\s*\/>\s*<br\s*\/>\s*y<\/p>/)
    expect(rendered('<p>x<br></p>')).toMatch(/<p>x<br\s*\/>\s*\u00a0<\/p>/)
    expect(rendered('<p>one</p><p><br></p><p></p><p>two</p>')).toMatch(/<p>one<\/p>\s*<p>\u00a0<\/p>\s*<p>\u00a0<\/p>\s*<p>two<\/p>/)
  })

  test("nested lists survive an empty paragraph inside unordered, ordered and quoted lists", () => {
    for (const html of ['<ul><li><p><br></p><ul><li>child</li></ul></li></ul>', '<ol><li><p></p><ul><li>child</li></ul></li></ol>', '<blockquote><ul><li><p><br></p><ul><li>child</li></ul></li></ul></blockquote>']) {
      expect(rendered(html)).toMatch(/<li>[\s\S]*?<ul>\s*<li>child<\/li>\s*<\/ul>\s*<\/li>/)
    }
  })
  test("regression: strike between words preserves del formatting", () => {
    expect(rendered('<p>foo<s>bar</s>baz</p>')).toBe('<p>foo<del>bar</del>baz</p>\n')
  })

  test("regression: punctuation and adjacent word marks preserve formatting", () => {
    expect(rendered('<p>a<strong>!</strong>b</p>')).toBe('<p>a<strong>!</strong>b</p>\n')
    expect(rendered('<p>a<em>!</em>b <em>foo</em>bar</p>')).toBe('<p>a<em>!</em>b <em>foo</em>bar</p>\n')
  })

  test("regression: consecutive hard breaks stay in the same paragraph", () => {
    expect(rendered('<p>x<br><br>y</p>')).toMatch(/<p>x<br\s*\/>\s*<br\s*\/>\s*y<\/p>/)
  })

  test("regression: terminal hard break is retained", () => {
    expect(rendered('<p>x<br></p>')).toMatch(/<p>x<br\s*\/>\s*\u00a0<\/p>/)
  })

  test("regression: blank paragraph is retained", () => {
    expect(rendered('<p>one</p><p><br></p><p>two</p>')).toMatch(/<p>one<\/p>\s*<p>\u00a0<\/p>\s*<p>two<\/p>/)
  })

  test("regression: checkbox outside a list is not silently discarded", () => {
    expect(() => htmlToMarkdown('<p>before<input type="checkbox" checked>after</p>')).toThrow()
    expect(() => htmlToMarkdown('<ul><li>before<input type="checkbox">after</li></ul>')).toThrow()
  })

  test("regression: non-decorative task label is not silently discarded", () => {
    expect(() => htmlToMarkdown('<ul data-type="taskList"><li data-type="taskItem"><label><input type="checkbox">important</label><div><p>body</p></div></li></ul>')).toThrow()
    expect(() => htmlToMarkdown('<ul><li><label><input type="checkbox"><span><img src="x" alt="important"></span></label></li></ul>')).toThrow()
  })

  test("regression: nested image inside code is not silently discarded", () => {
    expect(() => htmlToMarkdown('<p><code><img src="test.png" alt="hidden"></code></p>')).toThrow()
    expect(() => htmlToMarkdown('<pre><code><img src="test.png" alt="hidden"></code></pre>')).toThrow()
  })

  test("regression: maximum ordered start retains both list items", () => {
    expect(rendered('<ol start="999999999"><li>first</li><li>second</li></ol>'))
      .toMatch(/<ol start="999999999">\s*<li>first<\/li>\s*<li>second<\/li>\s*<\/ol>/)
  })

  test("regression: common named entities work in text and attributes", () => {
    const html = '<p>&copy; &reg; &trade; &hellip; &mdash; &ndash; &lsquo; &rsquo; &ldquo; &rdquo; &apos;</p><p><a href="https://example.org/?q=&copy;">link</a></p>'
    const out = rendered(html)
    expect(out).toContain('© ® ™ … — – ‘ ’ “ ”')
    expect(out).toContain("'")
    const href = /href="([^"]+)"/.exec(out)?.[1]
    expect(href && new URL(href).searchParams.get("q")).toBe("©")
    expect(() => htmlToMarkdown('<p>&notSupported;</p>')).toThrow()
  })

  test("converts multiple roots, headings, paragraphs, breaks and literal Markdown", () => {
    const html = '<h1>First</h1><h2>Second</h2><p># title<br>1. item &amp; [link](url)</p><hr>'
    const out = rendered(html)
    expect(out).toContain('<h1>First</h1>')
    expect(out).toContain('<h2>Second</h2>')
    expect(out).toContain('# title<br')
    expect(out).toContain('1. item &amp; [link](url)')
    expect(out).toContain('<hr')
    expect(markdown('')).toBe('')
  })

  test("preserves editor task labels, precedence, nested lists and sibling structure", () => {
    const html = `<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox"><span></span></label><div><p>parent</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox" checked><span></span></label><div><p>child</p></div></li></ul></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>sibling</p></div></li></ul>`
    const md = markdown(html)
    expect(md).toMatch(/- \[x\] parent\n\s+- \[ \] child\n- \[ \] sibling/)
    const out = Bun.markdown.html(md)
    expect(out).toMatch(/checked[^>]*>\s*parent[\s\S]*<ul>[\s\S]*<input type="checkbox"[^>]*disabled>\s*child[\s\S]*<\/ul>[\s\S]*<\/li>[\s\S]*<li[^>]*><input type="checkbox"[^>]*disabled>\s*sibling/)
  })

  test("converts mixed lists, start values, checkbox fallback and multi-paragraph items", () => {
    const out = rendered('<ol start="3"><li><p>third</p><ul><li>nested</li></ul><p>after</p></li><li>fourth</li></ol><ul><li><input type="checkbox" checked> done</li></ul>')
    expect(out).toMatch(/<ol start="3">[\s\S]*<li>[\s\S]*third[\s\S]*<ul>[\s\S]*<li>nested<\/li>[\s\S]*<\/ul>[\s\S]*after[\s\S]*<\/li>[\s\S]*<li>[\s\S]*?fourth[\s\S]*?<\/li>/)
    expect(out).toMatch(/<input type="checkbox"[^>]*disabled checked>\s*done/)
  })

  test("preserves formatting, whitespace, link destinations, images and quoted angle brackets", () => {
    const out = rendered('<p>before <strong>bold <em>both</em></strong> <del>gone</del> after <a href="https://example.org/a(b)?x=1&amp;y=2" title="a > b">link</a> <img src="https://example.org/a.png" alt="a [pic]"></p><blockquote><p>quote <em>text</em></p></blockquote>')
    expect(out).toContain('before <strong>bold <em>both</em></strong> <del>gone</del> after')
    expect(out).toContain('href="https://example.org/a(b)?x=1&amp;y=2"')
    expect(out).toContain('title="a &gt; b"')
    expect(out).toContain('alt="a [pic]"')
    expect(out).toContain('<blockquote>\n<p>quote <em>text</em></p>\n</blockquote>')
  })

  test("keeps adjacent mark text and separate lists from merging", () => {
    const out = rendered('<p><strong>a</strong><strong>b</strong> <em>c</em><em>d</em> <s>e</s><s>f</s></p><ul><li>one</li></ul><ul><li>two</li></ul>')
    expect(out).toContain('<p>ab cd ef</p>')
    expect(out).toMatch(/<ul>\s*<li>one<\/li>\s*<\/ul>\s*<p>\u00a0<\/p>\s*<ul>\s*<li>two<\/li>/)
  })

  test("preserves inline and fenced code with tag-shaped text and backtick runs", () => {
    const out = rendered('<p><code> `x` &lt;tag&gt; </code></p><pre><code class="language-js">one\n```\n&lt;two&gt;\n</code></pre>')
    expect(out).toContain('<code> `x` &lt;tag&gt; </code>')
    expect(out).toContain('<pre><code class="language-js">one\n```\n&lt;two&gt;\n</code></pre>')
    expect(rendered('<pre><code class="language-js">one\n```\nx &lt; y\n</code></pre>')).toContain('<pre><code class="language-js">one\n```\nx &lt; y\n</code></pre>')
    expect(rendered('<blockquote><ul><li><pre><code class="language-html">&lt;div&gt;x&lt;/div&gt;\n</code></pre></li></ul></blockquote>')).toContain('<pre><code class="language-html">&lt;div&gt;x&lt;/div&gt;\n</code></pre>')
  })

  test("decodes supported entities in text and attributes and rejects unsupported ones", () => {
    const out = rendered('<p>&amp; &lt; &gt; &quot; &nbsp; &#65; &#x1F642;</p><p><a href="https://example.org/?a=1&amp;b=&#50;">go</a></p>')
    expect(out).toContain('&amp; &lt; &gt; &quot;')
    expect(out).toContain('A 🙂')
    expect(out).toContain('href="https://example.org/?a=1&amp;b=2"')
    for (const bad of ['<p>&bogus;</p>', '<p>&#x110000;</p>', '<p>&amp</p>']) expect(() => htmlToMarkdown(bad)).toThrow()
  })

  test("preserves literal entity-like text in destinations and titles", () => {
    const out = rendered('<p><a href="https://example.org/?q=&amp;copy;" title="&amp;copy;">link</a></p>')
    expect(out).toContain('href="https://example.org/?q=&amp;copy;"')
    expect(out).toContain('title="&amp;copy;"')
  })

  test("rejects malformed or unsupported input instead of dropping content", () => {
    for (const html of ['<p>open', '<p><b>x</p></b>', '<table><tr><td>x</td></tr></table>', '<p title="unterminated>bad</p>']) {
      expect(() => htmlToMarkdown(html)).toThrow()
    }
  })
})
