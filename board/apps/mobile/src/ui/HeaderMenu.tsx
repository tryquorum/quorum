import React from 'react'
import { Pressable, useColorScheme } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { showActions, type Action } from './actions'
import { schemeColors } from './theme'

/** 상세 머리 오른쪽 ⋯. 필이 숨은 쌓인 화면에서 빠른 추가 같은 전역 동작도 여기에 둬요(mobile-ia.md) */
export function HeaderMenu({ actions, label = '더 보기' }: { actions: Action[]; label?: string }) {
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  if (!actions.length) return null
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={10} onPress={() => showActions(actions)}>
      <SymbolView name="ellipsis.circle" size={24} tintColor={c.ink} />
    </Pressable>
  )
}
