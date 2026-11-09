import React, { useMemo, useRef } from 'react'
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'
import type { Board, Item } from '@direction-board/contracts'
import { dday, STICKY_COLORS, STICKY_INK, type StickyColor } from '@direction-board/contracts/board-text'
import { long } from '@direction-board/contracts/when'
import { colors, space, styles } from '../../../ui/theme'
import { Dot } from '../parts'
import { heightOf } from './geometry'

type Props = {
  it: Item
  board: Board | undefined
  ox: number
  oy: number
  zoom: () => number
  moving: boolean
  onPress: () => void
  onLongPress: () => void
  onMoved: (dx: number, dy: number) => void
  onResized: (dx: number, dy: number) => void
}

/** 캔버스 항목 하나. 누르면 고치기, 길게 누르면 옮기기(끌기)와 모서리 손잡이로 크기 바꾸기 */
export function ItemView({ it, board, ox, oy, zoom, moving, onPress, onLongPress, onMoved, onResized }: Props) {
  const drag = useRef(new Animated.ValueXY()).current
  const size = useRef(new Animated.ValueXY()).current
  const movingRef = useRef(moving)
  movingRef.current = moving
  const cbs = useRef({ onMoved, onResized, zoom })
  cbs.current = { onMoved, onResized, zoom }
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => movingRef.current,
        onMoveShouldSetPanResponderCapture: () => movingRef.current,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => drag.setValue({ x: g.dx, y: g.dy }),
        onPanResponderRelease: (_, g) => {
          drag.setValue({ x: 0, y: 0 })
          if (Math.abs(g.dx) + Math.abs(g.dy) > 2) cbs.current.onMoved(g.dx, g.dy)
        },
        onPanResponderTerminate: () => drag.setValue({ x: 0, y: 0 }),
      }),
    [drag],
  )
  const handle = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => size.setValue({ x: g.dx, y: g.dy }),
        onPanResponderRelease: (_, g) => {
          size.setValue({ x: 0, y: 0 })
          cbs.current.onResized(g.dx, g.dy)
        },
        onPanResponderTerminate: () => size.setValue({ x: 0, y: 0 }),
      }),
    [size],
  )
  const area = board?.areas.find((a) => a.id === it.area)
  const h = heightOf(it)
  const sticky = it.type === 'sticky' ? STICKY_COLORS[(it.color as StickyColor) in STICKY_COLORS ? (it.color as StickyColor) : 'yellow'] : null
  const d = dday(it.due as string | null)
  const label = it.type === 'frame' ? `영역 ${it.text}` : it.type === 'goal' ? `목표 ${it.text}` : it.type === 'sticky' ? `메모 ${it.text}` : `글 ${it.text}`
  return (
    <Animated.View
      {...pan.panHandlers}
      style={[
        s.box,
        { left: it.x + ox, top: it.y + oy, width: Animated.add(it.w, size.x), height: it.type === 'text' || it.type === 'goal' ? undefined : Animated.add(h, size.y), minHeight: h, transform: drag.getTranslateTransform(), zIndex: it.type === 'frame' ? 0 : moving ? 3 : 1 },
        it.type === 'frame' ? s.frame : it.type === 'goal' ? s.goal : null,
        sticky ? { backgroundColor: sticky } : null,
        moving ? s.moving : null,
      ]}
    >
      <Pressable accessibilityRole="button" accessibilityLabel={label || '빈 항목'} accessibilityHint="눌러서 고치고, 길게 눌러 옮겨요" onPress={onPress} onLongPress={onLongPress} delayLongPress={350} style={s.fill}>
        {it.type === 'frame' ? <Text numberOfLines={1} style={[styles.strong, s.frameTitle]}>{it.text || '영역'}</Text> : null}
        {it.type === 'goal' ? (
          <View style={s.goalRow}>
            <Dot tone={it.done ? 'done' : d.late ? 'decide' : 'neutral'} label={it.done ? '완료' : '진행 중'} />
            <View style={s.flex}>
              <Text style={[styles.strong, it.done && s.done]}>{it.text || '무엇을 달성할지'}</Text>
              <Text style={styles.small}>{it.due ? `${long(it.due as string)} · ${it.done ? '완료' : d.t}` : '언제까지?'}</Text>
            </View>
          </View>
        ) : null}
        {it.type === 'sticky' ? <Text style={[s.stickyText, { color: STICKY_INK }]}>{it.text || '메모'}</Text> : null}
        {it.type === 'text' ? <Text style={[it.big ? styles.heading : styles.text, !it.text && s.ph]}>{it.text || '글'}</Text> : null}
        {area && it.type !== 'frame' ? <View style={s.area}><Dot color={area.color} /><Text style={[styles.small, sticky ? { color: STICKY_INK } : null]}>{area.name}</Text></View> : null}
      </Pressable>
      {moving ? <View {...handle.panHandlers} accessibilityLabel="크기 바꾸기 손잡이" style={s.handle} /> : null}
    </Animated.View>
  )
}
const s = StyleSheet.create({
  box: { position: 'absolute', borderRadius: 8, padding: space.md },
  fill: { flex: 1, gap: space.xs },
  frame: { borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.control, backgroundColor: colors.fill, opacity: 0.85 },
  frameTitle: { position: 'absolute', top: -34, left: 0 },
  goal: { backgroundColor: colors.card, borderRadius: 12 },
  goalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1 },
  done: { textDecorationLine: 'line-through', color: colors.muted },
  stickyText: { fontSize: 18, lineHeight: 23 },
  ph: { color: colors.muted },
  area: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 'auto' },
  moving: { shadowColor: colors.ink, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  handle: { position: 'absolute', right: -14, bottom: -14, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary },
})
