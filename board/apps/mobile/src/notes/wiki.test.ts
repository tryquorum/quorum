import { expect, test } from 'bun:test'
import { externalLink, wikiTarget } from './wiki'

test('ref 모양 [[링크]] 는 문서나 일 상세로 바로 열어요', () => {
  expect(wikiTarget('doc:7f3a')).toEqual({ route: 'Doc', ref: 'doc:7f3a' })
  expect(wikiTarget('item:b1:x9')).toEqual({ route: 'Work', ref: 'item:b1:x9' })
  expect(wikiTarget('signal:42')).toEqual({ route: 'Work', ref: 'signal:42' })
  expect(wikiTarget('회의록')).toBeNull()
  expect(externalLink('https://a.com')).toBe(true)
  expect(externalLink('javascript:x')).toBe(false)
})
