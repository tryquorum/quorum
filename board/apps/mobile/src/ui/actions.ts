import { ActionSheetIOS } from 'react-native'

/** 행·머리 메뉴의 동작 하나. destructive 는 빨간 글(지우기·보관처럼 거두기 어려운 것) */
export type Action = { label: string; onPress: () => void; destructive?: boolean }

/** iOS 동작 시트로 동작 목록을 보여요(길게 누르기·⋯ 메뉴 공용) */
export function showActions(actions: Action[], title?: string) {
  const destructive = actions.flatMap((a, i) => (a.destructive ? [i] : []))
  ActionSheetIOS.showActionSheetWithOptions(
    { title, options: [...actions.map((a) => a.label), '취소'], cancelButtonIndex: actions.length, destructiveButtonIndex: destructive },
    (index) => actions[index]?.onPress(),
  )
}
