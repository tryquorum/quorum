// 앱 설정 파일(비밀 아님, 앱 문서 폴더). 앱을 그리기 전에 동기로 읽어서 테마와 시작 탭이 첫 화면부터 맞아요.
// 기본 모델은 AI 탭·일 대화·설정 › AI 가 같이 써요(웹 db:model 과 같은 역할).
import { useSyncExternalStore } from 'react'
import { Appearance } from 'react-native'
import { File, Paths } from 'expo-file-system'
import { colorSchemeOverride, DEFAULT_PREFS, parsePrefs, type Prefs } from './prefsModel'

const file = () => new File(Paths.document, 'app-prefs.json')
function read(): Prefs {
  try {
    const f = file()
    return f.exists ? parsePrefs(f.textSync()) : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

let current = read()
const listeners = new Set<() => void>()
Appearance.setColorScheme(colorSchemeOverride(current.theme))

export const getPrefs = () => current

/** 바꾸고 파일에 써요. 쓰기가 실패해도 이번 실행 동안은 바뀐 값을 써요 */
export function setPrefs(patch: Partial<Prefs>) {
  const next = { ...current, ...patch }
  if (patch.theme && patch.theme !== current.theme) Appearance.setColorScheme(colorSchemeOverride(patch.theme))
  current = next
  listeners.forEach((l) => l())
  try {
    const f = file()
    if (!f.exists) f.create()
    f.writeSync(JSON.stringify(next))
  } catch {
    // 다음 실행에서 기본값으로 돌아갈 수 있어요
  }
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
