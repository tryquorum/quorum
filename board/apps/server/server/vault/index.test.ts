import { expect, spyOn, test } from 'bun:test'
import { noteHtmlToMarkdown, plainHtmlToMarkdown } from './index.ts'
import * as converters from './html-to-markdown.ts'

test('last-resort markdown preserves links and visible literal HTML without accidental autolinks', () => {
  const strict=spyOn(converters,'htmlToMarkdown').mockImplementation(()=>{throw Error('strict')})
  const lenient=spyOn(converters,'htmlToMarkdownLenient').mockImplementation(()=>{throw Error('lenient')})
  const warning=spyOn(console,'warn').mockImplementation(()=>{})
  try {
    const md=noteHtmlToMarkdown('<p>www.exa<a href="https://target">mple</a>.org &lt;private&gt;</p>')
    const html=Bun.markdown.html(md)
    expect(html).toContain('href="https://target"')
    expect(html).toContain('&lt;private&gt;')
    expect((html.match(/<a\b/g) || []).length).toBe(1)
  } finally {strict.mockRestore();lenient.mockRestore();warning.mockRestore()}
})

test('last-resort conversion remains near linear on repeated unterminated links', () => {
  const strict=spyOn(converters,'htmlToMarkdown').mockImplementation(()=>{throw Error('strict')})
  const lenient=spyOn(converters,'htmlToMarkdownLenient').mockImplementation(()=>{throw Error('lenient')})
  const warning=spyOn(console,'warn').mockImplementation(()=>{})
  try {
    const times=[50_000,100_000,200_000].map(n=>{
      const input='<p>www.exa<a href="https://target">mple</a>.org</p>'+'<a x=1>'.repeat(Math.floor(n/7))
      noteHtmlToMarkdown(input)
      return Math.min(...Array.from({length:5},()=>{
        const start=performance.now(); noteHtmlToMarkdown(input); return performance.now()-start
      }))
    })
    console.log('fallback milliseconds',times.map(x=>x.toFixed(2)).join(' / '))
    expect(times[2]).toBeLessThan(100)
    expect(times[1]).toBeLessThan(3*times[0])
    expect(times[2]).toBeLessThan(3*times[1])
  } finally {strict.mockRestore();lenient.mockRestore();warning.mockRestore()}
})

test('plain fallback quotes markup, suppresses hidden content and encodes explicit destinations', () => {
  const md=plainHtmlToMarkdown('<p>*hi* www.example.org a@b.test &lt;private&gt; <a href="https://example.com/a b&lt;c&gt;\\d?x=1&amp;y=2">go</a><img src="https://example.com/a b.png" alt="a * b"></p><!-- hidden --><script>secret</script><style>secret</style><template>secret</template>')
  const rendered=Bun.markdown.html(md)
  expect(rendered.replaceAll('<code>','').replaceAll('</code>','').replaceAll('<!-- -->','')).toContain('*hi* www.example.org a@b.test &lt;private&gt;')
  expect(rendered).toContain('href="https://example.com/a%20b%3Cc%3E%5Cd?x=1&amp;y=2"')
  expect(rendered).toContain('src="https://example.com/a%20b.png"')
  expect(rendered).toContain('alt="a * b"')
  expect((rendered.match(/<a\b/g) || []).length).toBe(1)
  expect(rendered).not.toContain('secret')
  expect(rendered).not.toContain('hidden')
  expect(plainHtmlToMarkdown('<script>secret</script>')).not.toBe('')
})
