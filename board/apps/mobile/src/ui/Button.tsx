import React from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { radius } from '@direction-board/design-tokens'
import { colors, space } from './theme'

// 주 단추(채움)는 한 묶음에 하나, 나머지는 테두리 단추(SLOP-5). 누름 영역 44pt
export function Button({
  title,
  onPress,
  disabled,
  variant = 'primary',
}: {
  title: string
  onPress: () => void
  disabled?: boolean
  variant?: 'primary' | 'outline' | 'plain'
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.base, s[variant], (disabled || pressed) && { opacity: disabled ? 0.5 : 0.7 }]}
    >
      <Text style={variant === 'primary' ? s.primaryText : s.outlineText}>{title}</Text>
    </Pressable>
  )
}
const s = StyleSheet.create({
  base: { minHeight: space.target, borderRadius: radius.lg, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.primary },
  outline: { borderColor: colors.control, borderWidth: 1 },
  plain: {},
  primaryText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
  outlineText: { color: colors.ink, fontWeight: '600', fontSize: 16 },
})
