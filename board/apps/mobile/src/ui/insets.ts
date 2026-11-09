import { useContext } from 'react'
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * 화면 아래에서 비워 둘 높이: 떠 있는 필의 높이(필이 숨은 쌓인 화면에서는 필이 알려 준 안전 영역), 탭 밖이면 안전 영역.
 * 화면은 이 값 위에 24pt 를 더 비워요(Screen 이 계산해요).
 */
export function useBottomInset(): number {
  const tab = useContext(BottomTabBarHeightContext)
  const insets = useSafeAreaInsets()
  return tab ?? insets.bottom
}
