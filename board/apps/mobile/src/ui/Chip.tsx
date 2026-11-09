import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { text } from '@direction-board/design-tokens'
import { colors, space, toneDot, type Tone } from './theme'

/**
 * 칩 세 가지(design-core.md): 필터(onPress + selected), 상태(tone 점 + 글), 출처(회색). 의미 색은 점에만 칠하고
 * 글은 늘 함께 둬서 색만으로 알리지 않아요.
 */
export function Chip({ label, tone, selected, onPress }: { label: string; tone?: Tone; selected?: boolean; onPress?: () => void }) {
  const body = (
    <View style={[s.chip, selected && s.selected]}>
      {tone && tone !== 'neutral' ? <View style={[s.dot, { backgroundColor: toneDot[tone] }]} /> : null}
      <Text numberOfLines={1} style={[s.label, selected && s.selectedLabel]}>{label}</Text>
    </View>
  )
  if (!onPress) return body
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress} hitSlop={8}>
      {body}
    </Pressable>
  )
}
const s = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, backgroundColor: colors.fill, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  selected: { backgroundColor: colors.primary },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { color: colors.ink, fontSize: text.xs[0], lineHeight: text.xs[1], fontWeight: '500' },
  selectedLabel: { color: colors.onPrimary },
})
