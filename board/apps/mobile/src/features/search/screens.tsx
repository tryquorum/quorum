// 레인 3 의 검색 탭 등록(웹 ⌘K 자리)
import type { ScreenDef } from '../../navigation/screen'
import { Search } from './Search'

export const searchScreens: ScreenDef[] = [{ name: 'Search', component: Search, options: { title: '검색' } }]
