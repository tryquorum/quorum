import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { ago } from '@direction-board/contracts/board-text'
import { Row } from '../../../ui/Row'
import { Section } from '../../../ui/Section'
import { Empty } from '../../../ui/StateView'
import { space, styles, type Tone } from '../../../ui/theme'
import type { WorkFull } from '../../../api/work'
import { Dot } from '../parts'

const TONE: Record<string, Tone> = { resolved: 'done', run: 'ai', answer: 'ai', link: 'running', note: 'warn' }
/** 기록(웹 Side 의 타임라인). 세로 줄 없이 시각 글자와 작은 점만 */
export function HistoryPane({ w }: { w: WorkFull }) {
  const [all, setAll] = useState(false)
  const s = w.signal
  return (
    <>
      <Section title="기록" count={w.timeline.length}>
        {(all ? w.timeline : w.timeline.slice(0, 6)).map((t, i) => (
          <Row key={i} title={t.text.split(' · ')[0]} meta={[t.text.split(' · ')[1], ago(t.at)].filter(Boolean).join(' · ')} leading={<Dot tone={TONE[t.kind] ?? 'neutral'} />} />
        ))}
        {w.timeline.length > 6 ? <Row title={all ? '접기' : `${w.timeline.length - 6}개 더`} onPress={() => setAll((v) => !v)} /> : null}
        {!w.timeline.length ? <Empty title="아직 기록이 없어요" /> : null}
      </Section>
      {s ? (
        <Section title="정보">
          <View style={st.info}>
            {([['에이전트', s.agent], ['영역', s.area], ['일 묶음', s.task], ['마감', s.due ? new Date(s.due).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null], ['처음', new Date(s.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })]] as [string, string | null][])
              .filter(([, v]) => !!v)
              .map(([k, v]) => (
                <View key={k} style={st.pair}>
                  <Text style={[styles.meta, st.key]}>{k}</Text>
                  <Text style={[styles.text, st.value]} selectable>{v}</Text>
                </View>
              ))}
          </View>
        </Section>
      ) : null}
    </>
  )
}
const st = StyleSheet.create({
  info: { padding: space.gutter, gap: space.sm },
  pair: { flexDirection: 'row', gap: space.md },
  key: { width: 72 },
  value: { flex: 1 },
})
