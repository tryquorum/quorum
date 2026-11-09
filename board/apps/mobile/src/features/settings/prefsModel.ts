// 앱 설정(테마·시작 탭·기본 모델)의 모양과 검증. 파일 읽기·적용은 prefs.ts(이 파일은 RN 없이 시험해요).
import type { ModelChoice } from '@direction-board/contracts/models'

export type ThemePref = 'light' | 'dark' | 'system'
export const START_TABS = [
  { value: 'HomeTab', label: '홈' },
  { value: 'ListTab', label: '전체' },
  { value: 'DocsTab', label: '문서' },
  { value: 'AiTab', label: 'AI' },
  { value: 'SearchTab', label: '검색' },
] as const
export type StartTab = (typeof START_TABS)[number]['value']
export type Prefs = { theme: ThemePref; start: StartTab; model: ModelChoice | null }
export const DEFAULT_PREFS: Prefs = { theme: 'system', start: 'HomeTab', model: null }

const isChoice = (v: unknown): v is ModelChoice =>
  !!v && typeof v === 'object' && ['provider', 'model', 'effort'].every((k) => typeof (v as Record<string, unknown>)[k] === 'string')

/** 저장된 글을 읽어요. 깨졌거나 모르는 값(옛 설정 탭 등)은 기본값으로 */
export function parsePrefs(raw: string | null): Prefs {
  let v: unknown = null
  try {
    v = raw ? JSON.parse(raw) : null
  } catch {
    v = null
  }
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const theme = o.theme === 'light' || o.theme === 'dark' || o.theme === 'system' ? o.theme : DEFAULT_PREFS.theme
  const start = START_TABS.find((t) => t.value === o.start)?.value ?? DEFAULT_PREFS.start
  return { theme, start, model: isChoice(o.model) ? { provider: o.model.provider, model: o.model.model, effort: o.model.effort } : null }
}

/** RN Appearance.setColorScheme 에 줄 값. 시스템은 덮어쓰기를 지우는 'unspecified' */
export const colorSchemeOverride = (theme: ThemePref) => (theme === 'system' ? 'unspecified' : theme)
