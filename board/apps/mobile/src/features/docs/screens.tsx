// 레인 2 의 화면 등록
import type { ScreenDef } from '../../navigation/screen'
import { Doc } from './Doc'
import { DocFolder } from './DocFolder'
import { Docs } from './Docs'

export const docsScreens: ScreenDef[] = [
  { name: 'Docs', component: Docs },
  { name: 'Doc', component: Doc, detail: true },
  { name: 'DocFolder', component: DocFolder, detail: true },
]
