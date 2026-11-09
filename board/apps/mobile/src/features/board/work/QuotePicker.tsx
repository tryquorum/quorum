import React, { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { parseMarkdown } from '../../../notes/markdown'
import { Button } from '../../../ui/Button'
import { Sheet } from '../../../ui/Sheet'
import { colors, schemeColors, space, styles } from '../../../ui/theme'
import { noteBlocks, quoteOf } from './noteQuote'

/**
 * 노트에서 부분 고르기(웹은 글을 드래그해 고른 뒤 "AI에게 묻기·새 일로"). 폰에서는 글 선택 결과를 앱이 받을 수 없어서
 * 노트의 문단·목록·인용을 한 덩이씩 눌러 고르고, 고른 것을 노트 순서대로 이어 인용으로 써요.
 */
export function QuotePicker({ visible, md, onClose, onAsk, onMakeWork }: { visible: boolean; md: string; onClose: () => void; onAsk: (quote: string) => void; onMakeWork: (quote: string) => Promise<void> }) {
  const blocks = useMemo(() => noteBlocks(parseMarkdown(md)), [md])
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const quote = quoteOf(blocks, picked)
  const close = () => {
    setPicked(new Set())
    onClose()
  }
  const toggle = (i: number) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })
  const make = async () => {
    if (!quote || busy) return
    setBusy(true)
    try {
      await onMakeWork(quote)
      close()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet visible={visible} title="노트에서 고르기" onClose={close} action={{ label: 'AI에게 묻기', disabled: !quote, onPress: () => { const q = quote; close(); onAsk(q) } }}>
      <Text style={styles.small}>물어보거나 새 일로 만들 부분을 눌러 골라요{picked.size ? ` · ${picked.size}개 고름` : ''}</Text>
      <View style={s.list}>
        {blocks.map((b, i) => {
          const on = picked.has(i)
          return (
            <Pressable key={i} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(i)} style={[s.block, on && s.on]}>
              <SymbolView name={on ? 'checkmark.circle.fill' : 'circle'} size={20} tintColor={on ? c.primary : c.muted} />
              <Text style={[styles.text, s.text]} numberOfLines={6}>{b}</Text>
            </Pressable>
          )
        })}
      </View>
      <Button title={busy ? '만드는 중…' : '새 일로 만들기'} variant="outline" disabled={!quote || busy} onPress={() => void make()} />
    </Sheet>
  )
}
const s = StyleSheet.create({
  list: { gap: space.xs, marginVertical: space.sm },
  block: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.md, borderRadius: 12 },
  on: { backgroundColor: colors.fill },
  text: { flex: 1 },
})
