import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle, type HostInstance, type ScrollViewInstance } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useToast } from '../../ui/Toast'
import { colors, space, styles } from '../../ui/theme'

/** 검색에서 고른 설정 항목: 그 줄로 스크롤하고 2초 바탕 강조 + 읽기 초점(웹 data-highlight 와 같음) */
type Highlight = { item: string | null; scroller: React.RefObject<ScrollViewInstance | null> }
export const HighlightContext = createContext<Highlight>({ item: null, scroller: { current: null } })

/** 검색에서 고른 항목이면 그 자리로 스크롤하고 2초 강조 + 읽기 초점 */
function useHighlight(id: string) {
  const { item, scroller } = useContext(HighlightContext)
  const ref = useRef<HostInstance>(null)
  const [lit, setLit] = useState(false)
  useEffect(() => {
    if (item !== id) return
    const t1 = setTimeout(() => {
      const node = ref.current
      const scroll = scroller.current
      if (!node || !scroll) return
      const content = scroll.getInnerViewRef()
      if (content) node.measureLayout(content, (_x: number, y: number) => scroll.scrollTo({ y: Math.max(0, y - 96), animated: true }), () => {})
      const handle = findNodeHandle(node)
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle)
      setLit(true)
    }, 250)
    const t2 = setTimeout(() => setLit(false), 2250)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [item, id, scroller])
  return { ref, lit }
}

/** 설정 한 줄: 이름(과 설명), 오른쪽(또는 아래) 조작. 묶음 안에서 행 사이는 가로 구분선만 */
export function SettingRow({ id, label, info, children, stack }: { id: string; label: string; info?: string; children?: React.ReactNode; stack?: boolean }) {
  const { ref, lit } = useHighlight(id)
  return (
    <View ref={ref} accessible={!children} style={[s.row, stack ? s.stack : s.inline, lit && s.lit]}>
      <View style={stack ? undefined : s.labelBox}>
        <Text style={styles.text}>{label}</Text>
        {info ? <Text style={styles.small}>{info}</Text> : null}
      </View>
      {children ? <View style={stack ? s.stackBody : s.control}>{children}</View> : null}
    </View>
  )
}

/** 묶음 여러 개를 감싼 검색 대상(지난 순회·지시문). 강조는 둥근 바탕으로 */
export function Anchor({ id, children }: { id: string; children: React.ReactNode }) {
  const { ref, lit } = useHighlight(id)
  return (
    <View ref={ref} style={[s.anchor, lit && s.anchorLit]}>
      {children}
    </View>
  )
}

/** 여러 개 중 하나(테마·연결 위치·보기). 선택은 바탕과 굵기로 */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={s.seg}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.value)} style={[s.segItem, on && s.segOn]}>
            <Text style={[styles.meta, on && s.segOnText]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** 복사 → "복사됨" 1.5초 */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const toast = useToast()
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1500)
    return () => clearTimeout(t)
  }, [done])
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() =>
        void Clipboard.setStringAsync(text).then(
          () => setDone(true),
          () => toast('복사하지 못했어요. 길게 눌러 직접 골라 복사해 주세요'),
        )
      }
      style={s.copy}
    >
      <Text style={s.copyText}>{done ? '복사됨' : '복사'}</Text>
    </Pressable>
  )
}

/** 코드 조각 + 복사. 가로로 길면 옆으로 밀어 봐요 */
export function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <View style={s.code}>
      <View style={s.codeHead}>
        <Text style={[styles.small, s.mono]} numberOfLines={1}>{label}</Text>
        <CopyButton text={code} label={`${label} 복사`} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text selectable style={[styles.small, s.mono, s.codeText]}>{code}</Text>
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  row: { paddingHorizontal: space.gutter, paddingVertical: space.md, minHeight: space.target + 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stack: { gap: space.md },
  lit: { backgroundColor: colors.fill },
  anchor: { gap: space.sm, borderRadius: 16 },
  anchorLit: { backgroundColor: colors.fill },
  labelBox: { flex: 1, gap: 2 },
  control: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  stackBody: { gap: space.sm },
  seg: { flexDirection: 'row', backgroundColor: colors.fill, borderRadius: 10, padding: 2, alignSelf: 'flex-start' },
  segItem: { minHeight: 36, paddingHorizontal: space.md, borderRadius: 8, justifyContent: 'center' },
  segOn: { backgroundColor: colors.card },
  segOnText: { color: colors.ink, fontWeight: '600' },
  copy: { minHeight: 32, paddingHorizontal: space.md, borderRadius: 8, borderWidth: 1, borderColor: colors.control, justifyContent: 'center' },
  copyText: { color: colors.ink, fontWeight: '600', fontSize: 14 },
  code: { backgroundColor: colors.fill, borderRadius: 10, overflow: 'hidden' },
  codeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm },
  mono: { fontFamily: 'Menlo' },
  codeText: { color: colors.ink, padding: space.md },
})
