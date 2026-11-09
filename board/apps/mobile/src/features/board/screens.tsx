// 레인 1 의 화면 등록. 라우트 이름은 navigation/routes.ts 에 있어요.
import type { ScreenDef } from '../../navigation/screen'
import { Board } from './Board'
import { Decisions } from './Decisions'
import { Goals } from './Goals'
import { Home } from './Home'
import { List } from './List'
import { Work } from './Work'
export { QuickAddSheet } from './quick/QuickAddSheet'

export const boardScreens: ScreenDef[] = [
  { name: 'Home', component: Home },
  { name: 'List', component: List, options: { title: '전체 목록' } },
  { name: 'Work', component: Work, detail: true },
  { name: 'Goals', component: Goals, detail: true, options: { title: '목표' } },
  { name: 'Decisions', component: Decisions, detail: true, options: { title: '결정 칸·사건' } },
  { name: 'Board', component: Board, detail: true, options: { title: '보드' } },
]
