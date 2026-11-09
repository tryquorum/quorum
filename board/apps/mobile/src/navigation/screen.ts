import type React from 'react'
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack'
import type { StackRoute } from './routes'

// 기능 폴더(features/<이름>/screens.tsx)가 내놓는 화면 하나. detail 이면 모든 탭 쌓기에 공용 상세로 등록돼요.
// 탭 루트는 tabs.ts 의 root 이름과 같은 화면이에요.
export type ScreenDef = {
  name: StackRoute
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: React.ComponentType<any>
  detail?: boolean
  options?: NativeStackNavigationOptions
}
