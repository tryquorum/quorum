import { expect, test } from 'bun:test'
import type { DocProp } from '@direction-board/contracts'
import { dayOffset, dueIssue, newKeyIssue, parseValue, propertyFilterIssue, valueText } from './props'

test('타입별 값 변환은 웹 parseValue 와 같아요', () => {
  expect(parseValue('number', '3.5')).toBe(3.5)
  expect(parseValue('number', '')).toBeNull()
  expect(() => parseValue('number', 'x')).toThrow('올바른 숫자')
  expect(parseValue('checkbox', '')).toBeNull()
  expect(parseValue('checkbox', 'true')).toBe(true)
  expect(parseValue('list', 'a\n\n b \n')).toEqual(['a', 'b'])
  expect(parseValue('text', '')).toBe('')
  expect(parseValue('date', '')).toBeNull()
  expect(valueText(['a', 'b'])).toBe('a\nb')
})

test('새 속성 이름: 규칙·예약어(대소문자)·30개·같은 이름·타입 충돌', () => {
  const props: DocProp[] = [{ key: '우선순위', type: 'number', value: 1 }]
  expect(newKeyIssue('Due', props, undefined, 'text')).toContain('기본 속성 이름')
  expect(newKeyIssue(' -x', props, undefined, 'text')).toContain('1~40자')
  expect(newKeyIssue('우선순위', props, undefined, 'number')).toBe('이미 있는 속성이에요.')
  expect(newKeyIssue('담당', props, 'select', 'text')).toBe('이 속성의 기존 타입은 선택이에요.')
  const many = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, type: 'text' as const, value: '' }))
  expect(newKeyIssue('새것', many, undefined, 'text')).toContain('30개')
  expect(newKeyIssue('담당자', props, undefined, 'text')).toBeNull()
})

test('속성 필터 검사 문구는 웹과 같아요', () => {
  expect(propertyFilterIssue('number', 'exists', '')).toBeNull()
  expect(propertyFilterIssue('number', 'eq', ' ')).toBe('속성 조건 값을 입력해 주세요.')
  expect(propertyFilterIssue('text', 'gt', 'a')).toContain('숫자·날짜')
  expect(propertyFilterIssue('number', 'contains', '1')).toContain('포함 조건')
  expect(propertyFilterIssue('number', 'eq', 'x')).toBe('올바른 숫자를 입력해 주세요.')
  expect(propertyFilterIssue('checkbox', 'eq', 'yes')).toContain('true 또는 false')
})

test('날짜: 할 일은 시각까지, 없는 날짜는 거절', () => {
  expect(dueIssue('2026-11-07', false)).toBeNull()
  expect(dueIssue('2026-02-30', false)).not.toBeNull()
  expect(dueIssue('2026-11-07T09:30', false)).not.toBeNull()
  expect(dueIssue('2026-11-07T09:30', true)).toBeNull()
  expect(dueIssue('2026-11-07T24:00', true)).not.toBeNull()
  expect(dayOffset(1, new Date(2026, 11, 31))).toBe('2027-01-01')
})
