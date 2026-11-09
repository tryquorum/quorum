import { File, Paths } from 'expo-file-system'

// 서버 주소는 비밀이 아닌 설정이라 앱 문서 폴더의 파일에 둬요. 키체인(SecureStore)은 서명 없는 시뮬레이터
// 빌드에서 읽히지 않아 설정이 늘 기본값으로 돌아갔어요.
const originFile = () => new File(Paths.document, 'server-origin.txt')

export async function readOrigin(): Promise<string | null> {
  const file = originFile()
  if (!file.exists) return null
  const value = (await file.text()).trim()
  return value || null
}

export async function writeOrigin(value: string): Promise<void> {
  const file = originFile()
  if (!file.exists) file.create()
  await file.write(value)
}
