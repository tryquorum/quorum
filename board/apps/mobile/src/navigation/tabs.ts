// 탭 구성은 이 파일 한 곳이에요(ADR-0010). 설정은 탭이 아니라 루트 쌓기의 Settings(홈 머리 톱니·검색 결과)예요.
// 다른 레인은 이 파일을 고치지 않아요.
import type { SFSymbol } from 'expo-symbols'
import type { StackRoute, TabParams } from './routes'

export type TabSpec = { name: keyof TabParams; root: StackRoute; label: string; icon: [SFSymbol, SFSymbol] }

// 채움 변형이 없는 심볼(list.bullet·sparkles)은 같은 모양에 색으로만 구분해요(GAP-30)
export const TABS: TabSpec[] = [
  { name: 'HomeTab', root: 'Home', label: '홈', icon: ['house', 'house.fill'] },
  { name: 'ListTab', root: 'List', label: '전체', icon: ['list.bullet', 'list.bullet'] },
  { name: 'DocsTab', root: 'Docs', label: '문서', icon: ['doc.text', 'doc.text.fill'] },
  { name: 'AiTab', root: 'Chat', label: 'AI', icon: ['sparkles', 'sparkles'] },
  { name: 'SearchTab', root: 'Search', label: '검색', icon: ['magnifyingglass', 'magnifyingglass'] },
]
