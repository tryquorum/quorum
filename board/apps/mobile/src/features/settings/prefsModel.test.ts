import { expect, test } from 'bun:test'
import { colorSchemeOverride, parsePrefs } from './prefsModel'

test('저장된 앱 설정을 검증해요', () => {
  expect(parsePrefs(null)).toEqual({ theme: 'system', start: 'HomeTab', model: null })
  expect(parsePrefs('{"theme":"dark","start":"AiTab","model":{"provider":"aside","model":"m","effort":"high"}}')).toEqual({ theme: 'dark', start: 'AiTab', model: { provider: 'aside', model: 'm', effort: 'high' } })
  // 옛 설정 탭·깨진 글·모르는 테마는 기본값
  expect(parsePrefs('{"theme":"blue","start":"SettingsTab","model":{"provider":1}}')).toEqual({ theme: 'system', start: 'HomeTab', model: null })
  expect(parsePrefs('{nope')).toEqual({ theme: 'system', start: 'HomeTab', model: null })
  expect(colorSchemeOverride('system')).toBe('unspecified')
  expect(colorSchemeOverride('dark')).toBe('dark')
})
