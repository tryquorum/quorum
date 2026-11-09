import React from 'react'
import { Pressable, StyleSheet, TextInput, View, useColorScheme } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { schemeColors, space, styles } from '../../ui/theme'

/** 아래 입력 줄(엄지 영역): 위에 칩 줄(모델·문맥), 아래 여러 줄 입력 + 보내기/멈추기 원 단추 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  busy,
  canSend,
  placeholder,
  chips,
  allowEmpty = false,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop?: () => void
  running: boolean
  busy: boolean
  canSend: boolean
  placeholder: string
  chips?: React.ReactNode
  /** 비어도 보낼 수 있음(인용만 붙였을 때 "이 부분을 설명해줘") */
  allowEmpty?: boolean
}) {
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const ready = canSend && !busy && (allowEmpty || !!value.trim())
  return (
    <View style={s.wrap}>
      {chips ? <View style={s.chips}>{chips}</View> : null}
      <View style={s.row}>
        <TextInput
          accessibilityLabel="AI에게 보낼 내용"
          multiline
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={c.muted}
          style={[styles.input, s.field]}
        />
        {running && onStop ? (
          <Pressable accessibilityRole="button" accessibilityLabel="멈추기" onPress={onStop} hitSlop={6} style={s.send}>
            <SymbolView name="stop.circle.fill" size={34} tintColor={c.ink} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? '보내는 중' : '보내기'}
            accessibilityState={{ disabled: !ready }}
            disabled={!ready}
            onPress={onSend}
            hitSlop={6}
            style={s.send}
          >
            <SymbolView name="arrow.up.circle.fill" size={34} tintColor={ready ? c.ink : c.muted} />
          </Pressable>
        )}
      </View>
    </View>
  )
}
const s = StyleSheet.create({
  wrap: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  field: { flex: 1, maxHeight: 140, paddingTop: 11 },
  send: { paddingBottom: 5 },
})
