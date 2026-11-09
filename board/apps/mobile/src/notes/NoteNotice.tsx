import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, space, styles } from '../ui/theme'

/** 노트 위 안내 띠(편집 막힘·충돌·불명). 왼쪽 선 없이 옅은 바탕으로 나눠요 */
export function NoteNotice({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <View style={s.band} accessibilityRole="alert">
      <Text style={styles.meta}>{message}</Text>
      {children}
    </View>
  )
}
const s = StyleSheet.create({ band: { backgroundColor: colors.fill, borderRadius: 10, padding: space.md, gap: space.sm } })
