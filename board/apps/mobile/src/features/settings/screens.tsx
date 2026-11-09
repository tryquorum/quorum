// 레인 3 의 설정 화면 등록. 설정 쌓기(루트 쌓기의 Settings)의 루트가 SettingsHome 이에요
import type { ScreenDef } from '../../navigation/screen'
import { OpsRuns } from './OpsRuns'
import { Settings } from './Settings'
import { SettingsSection } from './SettingsSection'

export const settingsScreens: ScreenDef[] = [
  { name: 'SettingsHome', component: Settings, options: { title: '설정' } },
  { name: 'SettingsSection', component: SettingsSection, detail: true },
  { name: 'OpsRuns', component: OpsRuns, detail: true, options: { title: '지난 순회' } },
]
export { OpsChip } from './OpsChip'
