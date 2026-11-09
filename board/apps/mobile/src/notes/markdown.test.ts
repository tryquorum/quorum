import { describe, expect, test } from 'bun:test'
import { parseInline, parseMarkdown, toggleTask } from './markdown'

describe('노트 마크다운 읽기', () => {
  test('제목·문단·인용·코드·가로줄', () => {
    expect(parseMarkdown('# 제목\n\n첫 줄\n이어짐\n\n> 인용\n\n```\ncode\n```\n\n---')).toEqual([
      { t: 'h', level: 1, c: [{ t: 'text', v: '제목' }] },
      { t: 'p', c: [{ t: 'text', v: '첫 줄 이어짐' }] },
      { t: 'quote', blocks: [{ t: 'p', c: [{ t: 'text', v: '인용' }] }] },
      { t: 'code', lang: '', v: 'code' },
      { t: 'hr' },
    ])
  })
  test('할 일과 중첩 목록, 원문 줄 번호', () => {
    const blocks = parseMarkdown('- [x] 끝\n- [ ] 남음\n  - 하위\n3. 셋')
    expect(blocks[0]).toMatchObject({ t: 'list', ordered: false, items: [{ checked: true, line: 0 }, { checked: false, line: 1, blocks: [{ t: 'p' }, { t: 'list', items: [{ checked: null }] }] }] })
    expect(blocks[1]).toMatchObject({ t: 'list', ordered: true, start: 3 })
  })
  test('글자 서식·링크·[[링크]]·이미지·이스케이프', () => {
    expect(parseInline('a **b** *c* ~~d~~ `e` [f](https://x.y) [[문서|별칭]] ![g](/api/files/1.png) \\# h')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'b', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'i', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'd', c: [{ t: 'text', v: 'd' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'e' },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://x.y', c: [{ t: 'text', v: 'f' }] },
      { t: 'text', v: ' ' },
      { t: 'wiki', term: '문서', label: '별칭' },
      { t: 'text', v: ' ' },
      { t: 'img', alt: 'g', src: '/api/files/1.png' },
      { t: 'text', v: ' # h' },
    ])
  })
  test('할 일 체크는 그 줄만 바꿔요', () => {
    expect(toggleTask('- [ ] a\n- [x] b', 0)).toBe('- [x] a\n- [x] b')
    expect(toggleTask('- [ ] a\n- [x] b', 1)).toBe('- [ ] a\n- [ ] b')
    expect(toggleTask('글', 0)).toBe('글')
  })
})
