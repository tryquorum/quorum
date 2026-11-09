import { expect, test } from 'bun:test'
import { parseProp, propKeyIssue } from './props'

test('속성 값 변환은 웹 parseValue 와 같아요', () => {
  expect(parseProp('number', '3.5')).toBe(3.5)
  expect(() => parseProp('number', 'x')).toThrow()
  expect(parseProp('checkbox', '')).toBeNull()
  expect(parseProp('list', 'a, b\nc')).toEqual(['a', 'b', 'c'])
  expect(parseProp('date', '')).toBeNull()
  expect(parseProp('text', '')).toBe('')
})
test('속성 이름: 예약어·중복·길이를 막아요', () => {
  expect(propKeyIssue('금액', [])).toBeNull()
  expect(propKeyIssue('due', [])).not.toBeNull()
  expect(propKeyIssue('금액', [{ key: '금액', type: 'number', value: 1 }])).toBe('이미 있는 속성이에요.')
  expect(propKeyIssue('', [])).not.toBeNull()
})
