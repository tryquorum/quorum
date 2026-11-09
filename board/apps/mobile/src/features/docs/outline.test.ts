import { expect, test } from 'bun:test'
import { splitSections } from './outline'

test('제목 자리에서 나누고 원문 줄 번호를 지켜요. 코드 블록 안 # 은 무시', () => {
  const md = ['앞 글', '# 하나', '본문', '```', '# 코드', '```', '## 둘', '#### 넷은 나누지 않음', '끝'].join('\n')
  const s = splitSections(md)
  expect(s.map((x) => [x.start, x.heading?.title ?? null])).toEqual([[0, null], [1, '하나'], [6, '둘']])
  expect(s[1].md.split('\n')).toEqual(['# 하나', '본문', '```', '# 코드', '```'])
  expect(s.map((x) => x.md).join('\n')).toBe(md)
  expect(splitSections('')).toEqual([])
})
