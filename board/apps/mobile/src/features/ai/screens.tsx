// 레인 3 의 AI 화면 등록. 대화(Thread)는 공용 상세라 어느 탭에서 열든 그 탭에 쌓여요
import type { ScreenDef } from '../../navigation/screen'
import { Chat } from './Chat'
import { Thread } from './Thread'

export const aiScreens: ScreenDef[] = [
  { name: 'Chat', component: Chat, options: { title: 'AI' } },
  { name: 'Thread', component: Thread, detail: true, options: { title: '대화' } },
]
export { WorkChats } from './WorkChats'
