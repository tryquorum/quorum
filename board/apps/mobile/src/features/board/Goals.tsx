import React, { useLayoutEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { compareWorkOrder, computeGoalProgress, computeGoalState, goalProgressBasis, goalStateLabel, type Board, type Item } from '@direction-board/contracts'
import { dday } from '@direction-board/contracts/board-text'
import { useBoardState } from '../../api/board'
import type { RootParams, StackParams } from '../../navigation/routes'
import { HeaderMenu } from '../../ui/HeaderMenu'
import { Row } from '../../ui/Row'
import { Screen } from '../../ui/Screen'
import { Section } from '../../ui/Section'
import { Empty, Loaded } from '../../ui/StateView'
import { colors, toneDot } from '../../ui/theme'
import { openRef } from './open'
import { Dot, useCurrentBoard } from './parts'
import { requestSheet } from './quick/create'

/** 목표 줄 요약(웹 goal-sidebar.tsx): 상태·진행·기준·남은 날 */
export function goalSummary(g: Item, items: Item[], linked?: string[]) {
  const progress = computeGoalProgress(g, items, linked)
  const basis = goalProgressBasis(g, items, linked)
  const state = computeGoalState(g)
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : g.done ? 100 : 0
  const d = dday(g.due)
  return { progress, basis, state, pct, label: goalStateLabel(state), due: g.due ? d.t : '기한 없음', late: d.late && !g.done }
}

/** 진행 막대(가로). 늦으면 빨강, 아니면 초록 */
export function Progress({ pct, late, label }: { pct: number; late: boolean; label: string }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: pct }} style={s.track}>
      <View style={[s.fill, { width: `${pct}%`, backgroundColor: late ? toneDot.decide : toneDot.done }]} />
    </View>
  )
}

export function GoalRow({ g, items, board, onOpen }: { g: Item; items: Item[]; board: Board | undefined; onOpen: () => void }) {
  const sm = goalSummary(g, items)
  const area = board?.areas.find((a) => a.id === g.area)
  const basis = sm.basis === 'area' ? ' · 영역 기준' : sm.basis === 'none' ? ' · 붙인 할 일 없음' : ''
  return (
    <Row title={(g.text || '(제목 없음)').split('\n')[0]} meta={`${sm.label} · ${sm.progress.done}/${sm.progress.total}${basis} · ${sm.due}`} leading={<Dot color={area?.color} label={area?.name ?? '영역 없음'} />} onPress={onOpen} chevron>
      <Progress pct={sm.pct} late={sm.state === 'late'} label="목표 진행률" />
    </Row>
  )
}

/** 목표 목록(웹 사이드바 목표): 지금 판의 목표, + 목표 세우기 */
export function Goals({ navigation }: NativeStackScreenProps<StackParams & RootParams, 'Goals'>) {
  const board = useBoardState()
  const { current } = useCurrentBoard()
  const newGoal = () => {
    requestSheet({ draft: { boardId: current?.id ?? '', kind: 'goal', title: '', at: null, areaId: null, tags: [], note: '', props: [] } })
    navigation.navigate('QuickAdd', {})
  }
  useLayoutEffect(() => {
    navigation.setOptions({ title: '목표', headerRight: () => <HeaderMenu label="목표 메뉴" actions={[{ label: '새 목표', onPress: newGoal }]} /> })
  })
  return (
    <Screen onRefresh={board.refresh}>
      <Loaded query={board}>
        {(data) => {
          const goals = data.items.filter((i) => i.boardId === current?.id && !i.deleted && i.type === 'goal').sort((a, b) => compareWorkOrder(a, b))
          const open = goals.filter((g) => !g.done)
          const done = goals.filter((g) => g.done)
          return (
            <>
              <Section title={current?.name} count={open.length}>
                {open.map((g) => <GoalRow key={g.id} g={g} items={data.items} board={current} onOpen={() => openRef(navigation, `item:${g.boardId}:${g.id}`, g.text)} />)}
                {!open.length ? <Empty title="열린 목표가 없어요" body="기한이 있는 목표를 세우면 진행률과 다음 행동이 여기에 보여요" action={{ label: '+ 목표 세우기', onPress: newGoal }} /> : <Row title="+ 목표 세우기" onPress={newGoal} />}
              </Section>
              {done.length ? <Section title="끝낸 목표" count={done.length}>{done.map((g) => <GoalRow key={g.id} g={g} items={data.items} board={current} onOpen={() => openRef(navigation, `item:${g.boardId}:${g.id}`, g.text)} />)}</Section> : null}
            </>
          )
        }}
      </Loaded>
    </Screen>
  )
}
const s = StyleSheet.create({
  track: { height: 6, borderRadius: 3, backgroundColor: colors.fill, overflow: 'hidden', marginTop: 6 },
  fill: { height: 6, borderRadius: 3 },
})
