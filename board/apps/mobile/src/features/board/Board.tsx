import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { Item } from '@direction-board/contracts'
import { useBoardState, useSaveItem } from '../../api/board'
import type { RootParams, StackParams } from '../../navigation/routes'
import { Chip } from '../../ui/Chip'
import { HeaderMenu } from '../../ui/HeaderMenu'
import { ErrorCard, Loading } from '../../ui/StateView'
import { useToast } from '../../ui/Toast'
import { colors, space, styles } from '../../ui/theme'
import { openRef } from './open'
import { useCurrentBoard } from './parts'
import { requestSheet, uid } from './quick/create'
import { AreasSheet } from './canvas/AreasSheet'
import { EditSheet } from './canvas/EditSheet'
import { canvasBounds, canvasItems, linkLine, linksOf, moved, newCanvasItem, newLink, resized } from './canvas/geometry'
import { useDeleteItems, useSaveAreas } from './canvas/hooks'
import { ItemView } from './canvas/ItemView'
import { useWriteScope } from '../../api/scope'
import { useIntents } from './useIntents'

/**
 * 보드 캔버스(웹 옛 보드): 두 손가락으로 확대·축소하고 밀어 움직여요. 항목을 누르면 고치기 시트, 길게 누르면 옮기기 모드
 * (끌어 옮기기·모서리 손잡이로 크기). 메모·글·목표·영역을 더하고, 고치기 시트에서 연결을 만들고 지워요.
 */
export function Board({ navigation, route }: NativeStackScreenProps<StackParams & RootParams, 'Board'>) {
  const state = useBoardState()
  const { current } = useCurrentBoard()
  const save = useSaveItem()
  const scope = useWriteScope()
  const intents = useIntents()
  const del = useDeleteItems()
  const saveAreas = useSaveAreas()
  const toast = useToast()
  const window = useWindowDimensions()
  const board = state.data?.boards.find((b) => b.id === (route.params?.boardId ?? current?.id)) ?? current
  const all = state.data?.items ?? []
  const items = useMemo(() => canvasItems(all, board?.id), [all, board?.id])
  const links = useMemo(() => linksOf(all, board?.id), [all, board?.id])
  const bounds = useMemo(() => canvasBounds(items), [items])
  const [editing, setEditing] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [areasOpen, setAreasOpen] = useState(false)
  const view = useRef({ zoom: 1, x: 0, y: 0 })
  // 전체 보기: 화면 폭에 맞춘 배율로 스크롤 뷰를 새로 그려요(왼쪽 위부터). 처음엔 배율 1, 왼쪽 위(항목 바로 앞)
  const [fit, setFit] = useState({ key: 0, zoom: 1 })
  const put = (it: Item) => void save(it).catch(() => toast('저장하지 못해 되돌렸어요'))
  // 보이는 화면 가운데의 캔버스 좌표(새 항목 자리)
  const center = () => ({ x: (view.current.x + window.width / 2) / view.current.zoom - bounds.ox, y: (view.current.y + window.height / 3) / view.current.zoom - bounds.oy })
  // 전체 보기: iOS 스크롤 뷰의 확대 맞춤(scrollResponderZoomTo)으로 캔버스 전체를 화면에
  const zoomAll = () => {
    const zoom = Math.max(0.2, Math.min(1, window.width / bounds.width, (window.height - 120) / bounds.height))
    view.current = { zoom, x: 0, y: 0 }
    setFit((f) => ({ key: f.key + 1, zoom }))
  }
  const add = (type: 'sticky' | 'text' | 'goal' | 'frame') => {
    if (!board) return
    const it = newCanvasItem(type, uid(), board.id, center(), Date.now())
    // 새 항목은 먼저 기록하고 저장해요(규칙 B): 결과를 모르면 홈의 끝나지 않은 요청에서 같은 id 로 확인해요
    void intents.createItem(scope, save, it, '보드에 항목 추가').catch(() => toast('저장하지 못해 되돌렸어요'))
    setEditing(it.id)
  }
  useLayoutEffect(() => {
    navigation.setOptions({
      title: board?.name ?? '보드',
      headerRight: () => (
        <HeaderMenu
          label="보드 메뉴"
          actions={[
            { label: '메모 추가', onPress: () => add('sticky') },
            { label: '글 추가', onPress: () => add('text') },
            { label: '목표 추가', onPress: () => add('goal') },
            { label: '영역(묶음 상자) 추가', onPress: () => add('frame') },
            { label: '할 일 추가', onPress: () => { requestSheet({ draft: { boardId: board?.id ?? '', kind: 'todo', title: '', at: null, areaId: null, tags: [], note: '', props: [] } }); navigation.navigate('QuickAdd', {}) } },
            { label: '판 영역 고치기', onPress: () => setAreasOpen(true) },
            { label: '전체 보기', onPress: () => zoomAll() },
          ]}
        />
      ),
    })
  })
  if (!state.data) return <View style={styles.page}>{state.status === 'error' ? <ErrorCard error={state.error} retry={() => void state.refresh()} /> : <Loading />}</View>
  const editItem = items.find((i) => i.id === editing) ?? null
  return (
    <View style={styles.page}>
      {moving ? (
        <View style={st.bar}>
          <Text style={[styles.meta, st.flex]}>끌어서 옮기고, 오른쪽 아래 손잡이로 크기를 바꿔요</Text>
          <Chip label="다 됐어요" selected onPress={() => setMoving(null)} />
        </View>
      ) : null}
      <ScrollView
        style={st.flex}
        contentContainerStyle={{ width: bounds.width, height: bounds.height }}
        maximumZoomScale={3}
        minimumZoomScale={0.2}
        bouncesZoom
        scrollEnabled={!moving}
        pinchGestureEnabled={!moving}
        scrollEventThrottle={32}
        key={fit.key}
        zoomScale={fit.zoom}
        onScroll={(e) => { const n = e.nativeEvent; view.current = { zoom: n.zoomScale || 1, x: n.contentOffset.x, y: n.contentOffset.y } }}
        accessibilityLabel={`${board?.name ?? ''} 보드`}
      >
        <Pressable0 onPress={() => setMoving(null)} />
        {/* 영역 상자가 맨 아래, 그 위에 연결선, 맨 위에 카드(옛 보드 render 와 같은 순서) */}
        {items.filter((it) => it.type === 'frame').map((it) => (
          <ItemView
            key={it.id}
            it={it}
            board={board}
            ox={bounds.ox}
            oy={bounds.oy}
            zoom={() => view.current.zoom}
            moving={moving === it.id}
            onPress={() => (moving ? setMoving(null) : setEditing(it.id))}
            onLongPress={() => setMoving(it.id)}
            onMoved={(dx, dy) => put(moved(it, dx, dy, view.current.zoom))}
            onResized={(dx, dy) => put(resized(it, dx, dy, view.current.zoom))}
          />
        ))}
        {links.map((l) => {
          const line = linkLine(items, l)
          if (!line) return null
          return (
            <View key={l.id} pointerEvents="none">
              <View style={[st.link, { left: line.x + bounds.ox - line.length / 2, top: line.y + bounds.oy - 1, width: line.length, transform: [{ rotate: `${line.angle}rad` }] }]} />
              {l.text ? <Text style={[styles.small, st.linkLabel, { left: line.x + bounds.ox - 60, top: line.y + bounds.oy - 22 }]}>{l.text}</Text> : null}
            </View>
          )
        })}
        {items.filter((it) => it.type !== 'frame').map((it) => (
          <ItemView
            key={it.id}
            it={it}
            board={board}
            ox={bounds.ox}
            oy={bounds.oy}
            zoom={() => view.current.zoom}
            moving={moving === it.id}
            onPress={() => (moving ? setMoving(null) : setEditing(it.id))}
            onLongPress={() => setMoving(it.id)}
            onMoved={(dx, dy) => put(moved(it, dx, dy, view.current.zoom))}
            onResized={(dx, dy) => put(resized(it, dx, dy, view.current.zoom))}
          />
        ))}
        {!items.length ? <Text style={[styles.meta, st.empty, { left: bounds.ox, top: bounds.oy }]}>아직 보드가 비어 있어요. 오른쪽 위 메뉴에서 메모·글·목표·영역을 더해요</Text> : null}
      </ScrollView>
      <EditSheet
        item={editItem}
        items={items}
        links={links}
        board={board}
        onClose={() => setEditing(null)}
        onSave={put}
        onDelete={(it) => void del(it.boardId, [it.id])}
        onLink={(a, b) => {
          const l = newLink(all, uid(), a.boardId, a.id, b.id, Date.now())
          if (!l) return toast('이미 연결돼 있어요')
          put(l)
          toast('연결했어요 · 연결을 길게 눌러 라벨을 달 수 있어요')
        }}
        onUnlink={(l) => void del(l.boardId, [l.id])}
        onLabel={(l, label) => put({ ...l, text: label })}
        onOpenGoal={(it) => { setEditing(null); openRef(navigation, `item:${it.boardId}:${it.id}`, it.text) }}
      />
      <AreasSheet board={board} visible={areasOpen} onClose={() => setAreasOpen(false)} onSave={(areas) => board && void saveAreas(board, areas)} />
    </View>
  )
}
/** 빈 곳 누르면 옮기기 모드를 끝내요(캔버스 전체를 덮는 바닥) */
function Pressable0({ onPress }: { onPress: () => void }) {
  return <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} onResponderRelease={onPress} />
}
const st = StyleSheet.create({
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.gutter, paddingVertical: space.sm, backgroundColor: colors.card },
  link: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: colors.muted },
  linkLabel: { position: 'absolute', width: 120, textAlign: 'center' },
  empty: { position: 'absolute', width: 280 },
})
