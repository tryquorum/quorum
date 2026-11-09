import React, { useMemo, useRef } from 'react'
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { colors, schemeColors, space, styles, toneDot, type Tone } from './theme'
import { showActions, type Action } from './actions'

// 스와이프 규칙(mobile-ia.md): 가로 12pt 를 넘고 세로의 2배보다 클 때만 행이 잡아요. 왼쪽 가장자리 24pt 는 뒤로 제스처 몫.
// 스크롤이 가져가겠다고 하면 놓아요. 끝까지(행 폭 40%) 밀면 바로 동작, 조금 밀면 단추가 드러나요.
const EDGE = 24
const START = 12
const OPEN = 96

export type SwipeAction = Action & { tone?: Tone }

export function Row({
  title,
  meta,
  leading,
  trailing,
  onPress,
  actions,
  swipe,
  chevron,
  children,
}: {
  title: string
  meta?: string
  leading?: React.ReactNode
  trailing?: React.ReactNode
  onPress?: () => void
  /** 길게 누르기 동작 목록. 스와이프 동작도 여기에 함께 넣어요 */
  actions?: Action[]
  /** 왼쪽으로 밀면 드러나는 되돌릴 수 있는 한 동작 */
  swipe?: SwipeAction
  chevron?: boolean
  children?: React.ReactNode
}) {
  const scheme = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const x = useRef(new Animated.Value(0)).current
  const offset = useRef(0)
  const width = useRef(0)
  const swipeRef = useRef(swipe)
  swipeRef.current = swipe
  const settle = (to: number) => {
    offset.current = to
    Animated.spring(x, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 20 }).start()
  }
  const settleRef = useRef(settle)
  settleRef.current = settle
  const pan = useMemo(
    () =>
      PanResponder.create({
        // 캡처 단계에서 판정해요: 행 안의 누름(Pressable)이 이미 응답자여도 가로 끌기는 행이 먼저 가져가요.
        // 응답자를 받기 전에는 gestureState.x0 가 0 이라 시작 x 는 moveX - dx 로 셈해요
        onMoveShouldSetPanResponderCapture: (_, g) =>
          !!swipeRef.current && g.moveX - g.dx > EDGE && Math.abs(g.dx) > START && Math.abs(g.dx) > 2 * Math.abs(g.dy) && (g.dx < 0 || offset.current < 0),
        onPanResponderTerminationRequest: () => true,
        onPanResponderMove: (_, g) => x.setValue(Math.min(0, Math.max(-width.current * 0.7, offset.current + g.dx))),
        onPanResponderRelease: (_, g) => {
          const d = offset.current + g.dx
          if (-d > width.current * 0.4) {
            settleRef.current(0)
            swipeRef.current?.onPress()
          } else settleRef.current(-d > OPEN / 2 ? -OPEN : 0)
        },
        onPanResponderTerminate: () => settleRef.current(offset.current),
      }),
    [x],
  )
  const all = [...(actions ?? [])]
  if (swipe && !all.some((a) => a.label === swipe.label)) all.unshift(swipe)
  return (
    <View onLayout={(e) => (width.current = e.nativeEvent.layout.width)}>
      {swipe ? (
        <View style={[s.under, { backgroundColor: toneDot[swipe.tone ?? 'done'] }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Pressable
            style={s.underButton}
            onPress={() => {
              settle(0)
              swipe.onPress()
            }}
          >
            <Text style={s.underText}>{swipe.label}</Text>
          </Pressable>
        </View>
      ) : null}
      <Animated.View {...(swipe ? pan.panHandlers : {})} style={[s.front, { transform: [{ translateX: x }] }]}>
        <Pressable
          accessibilityRole={onPress ? 'button' : undefined}
          // 읽기 프로그램에는 제목·메타만 읽히고, 체크·스와이프 동작은 접근성 동작으로 골라요
          accessibilityLabel={[title, meta].filter(Boolean).join(', ')}
          accessibilityActions={all.map((a, i) => ({ name: `a${i}`, label: a.label }))}
          onAccessibilityAction={(e) => all[Number(e.nativeEvent.actionName.slice(1))]?.onPress()}
          onPress={() => (offset.current < 0 ? settle(0) : onPress?.())}
          onLongPress={all.length ? () => showActions(all, title) : undefined}
          delayLongPress={350}
          style={({ pressed }) => [s.row, pressed && (onPress || all.length) ? s.pressed : null]}
        >
          {leading}
          <View style={s.body}>
            <Text style={styles.text} numberOfLines={2}>
              {title}
            </Text>
            {meta ? (
              <Text style={styles.meta} numberOfLines={1}>
                {meta}
              </Text>
            ) : null}
            {children}
          </View>
          {trailing}
          {chevron && onPress ? <SymbolView name="chevron.right" size={13} tintColor={scheme.muted} /> : null}
        </Pressable>
      </Animated.View>
    </View>
  )
}
const s = StyleSheet.create({
  under: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'flex-end', justifyContent: 'center' },
  underButton: { width: OPEN, height: '100%', alignItems: 'center', justifyContent: 'center' },
  underText: { color: colors.card, fontWeight: '700', fontSize: 15 },
  front: { backgroundColor: colors.card },
  row: { minHeight: space.target + 8, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.gutter, paddingVertical: 10 },
  pressed: { backgroundColor: colors.fill },
  body: { flex: 1, gap: 2 },
})
