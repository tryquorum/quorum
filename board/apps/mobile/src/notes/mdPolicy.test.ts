import { describe, expect, test } from 'bun:test'
import { checkMarkdown } from './mdPolicy'

describe('iOS 노트 초안 허용 문법', () => {
  test('허용 문법은 통과해요', () => {
    expect(checkMarkdown('# 제목\n\n- [ ] 할 일\n- [x] 끝낸 일\n\n문단\n\n- 글머리\n  - 하위\n\n1. 번호\n\n> 인용\n\n```\n| 펜스 안 표 < 태그\n```\n\n    들여쓴 코드\n\n![사진](/api/files/a.png) [링크](https://a.com) [[문서]] **굵게** ~~취소~~\n\n---')).toEqual({ ok: true })
  })
  test('밖의 문법은 그 줄과 이유를 알려요', () => {
    const cases: [string, number, RegExp][] = [
      ['a\n| x | y |\n|---|---|', 2, /표/],
      ['<div>x</div>', 1, /HTML/],
      ['hello <u>world</u>', 1, /HTML/],
      ['> <div>x</div>', 1, /HTML/],
      ['- [ ] parent\n  - [x] child', 2, /하위 목록/],
      ['- [ ] a\n  이어지는 글', 2, /이어지는 글/],
      ['- [ ] a\n\n- [ ] b', 3, /빈 줄/],
      ['1. [ ] 번호 할 일', 1, /번호 목록/],
      ['- [ ] a\n\n    - b', 3, /하위 목록/],
      ['> - [ ] a\n>   - child', 2, /하위 목록/],
      ['```js\nx\n```', 1, /언어/],
      ['글[^1]\n\n[^1]: 각주', 1, /각주/],
      ['[x][ref]\n\n[ref]: https://a.com', 1, /참조/],
      ['제목\n===', 2, /밑줄 제목/],
      ['[x](javascript:alert(1))', 1, /링크 주소/],
      ['![x](data:image/png;base64,AAA)', 1, /이미지 주소/],
      // 서버 mdToNoteHtml 은 섞인 목록을 <ul> 안 taskItem 으로 만들어 웹 편집기가 거절하고 다음부터 iOS 편집도 막혀요
      ['- a\n- [ ] b', 2, /섞을 수 없어요/],
      ['- [x] a\n- b', 2, /섞을 수 없어요/],
      ['* a\n\n* [ ] b', 3, /섞을 수 없어요/],
      ['> - a\n> - [ ] b', 2, /섞을 수 없어요/],
      ['- 위\n  - a\n  - [ ] b', 3, /섞을 수 없어요/],
    ]
    for (const [md, line, reason] of cases) {
      const r = checkMarkdown(md)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.line).toBe(line)
        expect(r.reason).toMatch(reason)
      }
    }
  })
  test('다른 목록이면 할 일과 글머리를 따로 쓸 수 있어요', () => {
    // 글머리 표지가 다르거나 사이에 문단이 있으면 다른 목록이에요
    expect(checkMarkdown('- a\n\n문단\n\n- [ ] b')).toEqual({ ok: true })
    expect(checkMarkdown('- a\n* [ ] b')).toEqual({ ok: true })
    expect(checkMarkdown('- [ ] 할 일\n\n## 제목\n\n- 글머리')).toEqual({ ok: true })
    expect(checkMarkdown('1. 번호\n- [ ] 할 일')).toEqual({ ok: true })
  })
})
