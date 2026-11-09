import React, { useLayoutEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { Signal } from '@direction-board/contracts'
import { ago, srcName } from '@direction-board/contracts/board-text'
import { useSignals } from '../../api/board'
import type { RootParams, StackParams } from '../../navigation/routes'
import { Chip } from '../../ui/Chip'
import { Row } from '../../ui/Row'
import { Screen } from '../../ui/Screen'
import { Section } from '../../ui/Section'
import { Empty, Loaded } from '../../ui/StateView'
import { space, styles, type Tone } from '../../ui/theme'
import { useSignalActions } from './actions'
import { openSignal } from './open'
import { Dot, SignalMarks } from './parts'

// 웹 work-view LANE_KO 와 같은 칸 이름. 사람 손이 필요한 칸부터
const LANES: [string, string, Tone][] = [['now', '지금 봐야 함', 'decide'], ['decide', '결정 대기', 'warn'], ['review', '확인 필요', 'warn'], ['main', '메인 일 후보', 'neutral'], ['running', '하는 중', 'running'], ['info', '기록', 'neutral'], ['auto', 'AI가 처리함', 'done']]
type Status = 'open' | 'snoozed' | 'resolved'
const STATUS: [Status, string][] = [['open', '열림'], ['snoozed', '미룸'], ['resolved', '처리함']]

/** 결정 칸·사건(웹 첫 화면 결정 칸과 일 상세의 처리 동작을 한 화면에): 칸별로 묶고 처리·미루기·AI가 처리함·규칙 */
export function Decisions({ navigation }: NativeStackScreenProps<StackParams & RootParams, 'Decisions'>) {
  const signals = useSignals()
  const act = useSignalActions()
  const [status, setStatus] = useState<Status>('open')
  useLayoutEffect(() => navigation.setOptions({ title: '결정 칸·사건' }), [navigation])
  const open = (s: Signal) => openSignal(navigation, s, (x) => void act.confirm([x], true))
  const row = (s: Signal, tone: Tone) => {
    const isOpen = s.status === 'open'
    return (
      <Row
        key={s.id}
        title={s.title.replace(/^답이 왔어요:\s*/, '')}
        meta={[srcName(s.source), s.reason, ago(s.updated_at)].filter(Boolean).join(' · ')}
        leading={<Dot tone={tone} />}
        onPress={() => open(s)}
        swipe={isOpen ? { label: '처리함', tone: 'done', onPress: () => void act.resolve(s) } : { label: '다시 열기', tone: 'warn', onPress: () => void act.reopen(s) }}
        actions={[
          ...(isOpen
            ? [
                { label: 'AI가 처리함', onPress: () => void act.aiDone(s) },
                { label: '미루기', onPress: () => void act.patch(s, { status: 'snoozed' }) },
                ...(s.lane === 'review' ? [{ label: '확인함', onPress: () => void act.confirm([s]) }] : []),
              ]
            : []),
          { label: '이런 소식은 안 와도 돼', onPress: () => void act.mute(s) },
          { label: '이런 소식은 바로 알려줘', onPress: () => void act.urgent(s) },
          { label: '열기', onPress: () => open(s) },
        ]}
      >
        {s.body ? <Text style={styles.meta} numberOfLines={1}>{s.body}</Text> : null}
        <SignalMarks s={s} />
      </Row>
    )
  }
  return (
    <Screen onRefresh={signals.refresh}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips} accessibilityLabel="상태">
        {STATUS.map(([k, l]) => <Chip key={k} label={`${l} ${signals.data?.signals.filter((s) => s.status === k).length ?? ''}`} selected={status === k} onPress={() => setStatus(k)} />)}
      </ScrollView>
      <Loaded query={signals}>
        {(data) => {
          const list = data.signals.filter((s) => s.status === status && s.kind !== 'start' && s.kind !== 'progress')
          const groups = LANES.map(([lane, label, tone]) => ({ lane, label, tone, list: list.filter((s) => s.lane === lane).sort((a, b) => b.updated_at - a.updated_at) })).filter((g) => g.list.length)
          if (!groups.length) return <Section><Empty title={status === 'open' ? '열린 사건이 없어요' : status === 'snoozed' ? '미룬 사건이 없어요' : '처리한 사건이 없어요'} /></Section>
          return groups.map((g) => <Section key={g.lane} title={g.label} count={g.list.length}>{g.list.slice(0, 60).map((s) => row(s, g.tone))}</Section>)
        }}
      </Loaded>
    </Screen>
  )
}
const st = StyleSheet.create({ chips: { gap: space.sm, paddingRight: space.gutter } })
