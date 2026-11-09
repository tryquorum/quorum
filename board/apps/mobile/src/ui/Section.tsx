import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { text } from '@direction-board/design-tokens'
import { colors, space, styles } from './theme'

/** 묶음: 위에 제목(과 개수), 아래 테두리 없는 둥근 바탕. 안의 행은 들여쓴 가는 가로 구분선으로 나눠요 */
export function Section({ title, count, right, children }: { title?: string; count?: number; right?: React.ReactNode; children: React.ReactNode }) {
  const rows = React.Children.toArray(children).filter(Boolean)
  return (
    <View style={s.wrap}>
      {title ? (
        <View style={s.head}>
          <Text accessibilityRole="header" style={s.title}>
            {title}
            {count ? <Text style={s.count}>  {count}</Text> : null}
          </Text>
          {right}
        </View>
      ) : null}
      <View style={styles.group}>
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <View style={styles.separator} /> : null}
            {row}
          </React.Fragment>
        ))}
      </View>
    </View>
  )
}
const s = StyleSheet.create({
  wrap: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs },
  title: { color: colors.muted, fontSize: text.sm[0], lineHeight: text.sm[1], fontWeight: '600' },
  count: { color: colors.muted, fontWeight: '400', fontVariant: ['tabular-nums'] },
})
