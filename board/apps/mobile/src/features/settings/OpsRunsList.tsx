import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { SymbolView } from 'expo-symbols'
import type { OpsReportItem, OpsRun } from '@direction-board/contracts'
import { countsLabel, STATUS_KO } from '@direction-board/contracts/ops-labels'
import type { StackParams } from '../../navigation/routes'
import { NoteView } from '../../notes/NoteView'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { Row } from '../../ui/Row'
import { Section } from '../../ui/Section'
import { colors, schemeColors, space, styles, type Tone } from '../../ui/theme'

const KIND: Record<OpsReportItem['kind'], string> = { signal: '사건', card: '할 일', merged: '합침', closed: '닫음' }
const firstLine = (s: string | null | undefined) => (s || '').split('\n').find((l) => l.trim()) || ''
const clock = (ts: number) => new Date(ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
export const runTone = (status: string): Tone => (status === 'error' ? 'decide' : status === 'running' ? 'running' : status === 'done' ? 'done' : 'neutral')

/** 지난 순회(웹 OpsRuns): 줄마다 상태·시각·결과 수·요약 첫 줄, 누르면 보고 전문·올린 것(누르면 그 일)·대화 열기 */
export function OpsRunsList({ runs, title = '지난 순회' }: { runs: OpsRun[]; title?: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<StackParams>>()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const [open, setOpen] = useState<string | null>(null)
  if (!runs.length)
    return (
      <Section title={title}>
        <Row title="아직 돈 순회가 없어요" meta="지금 돌리기로 한 번 돌려 볼 수 있어요" />
      </Section>
    )
  return (
    <Section title={title}>
      {runs.map((r) => {
        const expanded = open === r.id
        const line = r.report ? countsLabel(r.report.counts) : r.status === 'running' ? '돌아보는 중' : r.status === 'error' ? firstLine(r.error) || '실패했어요' : '보고 없음'
        return (
          <View key={r.id}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpen(expanded ? null : r.id)} style={({ pressed }) => [s.head, pressed && s.pressed]}>
              <SymbolView name={expanded ? 'chevron.down' : 'chevron.right'} size={12} tintColor={c.muted} />
              <View style={s.body}>
                <View style={s.line}>
                  <Chip label={STATUS_KO[r.status] || r.status} tone={runTone(r.status)} />
                  <Text style={[styles.meta, s.num]}>{clock(r.created_at)}</Text>
                </View>
                <Text style={[styles.text, r.status === 'error' && s.error]} numberOfLines={2}>{line}</Text>
                {r.report?.summary && !expanded ? <Text style={styles.meta} numberOfLines={1}>{firstLine(r.report.summary)}</Text> : null}
              </View>
            </Pressable>
            {expanded ? (
              <View style={s.detail}>
                {r.report?.summary ? <Text selectable style={styles.text}>{r.report.summary}</Text> : null}
                {r.report && r.report.items.length ? (
                  <View style={s.items}>
                    <Text style={styles.small}>올린 것</Text>
                    {r.report.items.map((it) => (
                      <Pressable key={it.kind + it.ref} accessibilityRole="link" onPress={() => navigation.push('Work', { ref: it.ref, title: it.title })} style={s.item} hitSlop={4}>
                        <Text style={[styles.small, s.kind]}>{KIND[it.kind]}</Text>
                        <Text style={[styles.text, s.flex]} numberOfLines={1}>{it.title || it.ref}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {r.report && r.report.counts.errors > 0 ? <Text style={styles.meta}>보고에서 받지 못한 항목 {r.report.counts.errors}개</Text> : null}
                {r.error ? <Text selectable style={[styles.meta, s.error]}>{r.error}</Text> : null}
                {r.output ? (
                  <View style={s.answer}>
                    <Text style={styles.small}>마지막 답</Text>
                    <NoteView md={r.output} />
                  </View>
                ) : null}
                <View style={s.foot}>
                  <Text style={[styles.small, s.flex]}>{[r.model_name, r.effort].filter(Boolean).join(' · ')}</Text>
                  <Button variant="outline" title="대화 열기" onPress={() => navigation.push('Thread', { thread: r.id })} />
                </View>
              </View>
            ) : null}
          </View>
        )
      })}
    </Section>
  )
}
const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingHorizontal: space.gutter, paddingVertical: space.md, backgroundColor: colors.card },
  pressed: { backgroundColor: colors.fill },
  body: { flex: 1, gap: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  num: { fontVariant: ['tabular-nums'] },
  error: { color: colors.decide },
  detail: { gap: space.md, paddingHorizontal: space.gutter, paddingBottom: space.lg, paddingTop: space.xs, backgroundColor: colors.card },
  items: { gap: space.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 },
  kind: { width: 36 },
  flex: { flex: 1 },
  answer: { backgroundColor: colors.fill, borderRadius: 10, padding: space.md, gap: space.xs },
  foot: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
})
