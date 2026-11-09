import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { ago } from '@direction-board/contracts/run-labels'
import { useQuery } from '../../api/query'
import { runsApi } from '../../api/runs'
import type { StackParams } from '../../navigation/routes'
import { useServer } from '../../server'
import { Row } from '../../ui/Row'
import { Section } from '../../ui/Section'
import { colors } from '../../ui/theme'
import { groupThreads } from './runLogic'

/**
 * 일에 붙은 대화(웹 일 화면 대화 탭). 일 상세(레인 1)가 절로 품어요: 그 일의 대화 목록과 "새 대화".
 * 누르면 공용 상세 Thread 로(target 고정, quote 를 주면 첫 질문에 인용으로 붙어요).
 */
export function WorkChats({ target, quote }: { target: string; quote?: string | null }) {
  const navigation = useNavigation<NativeStackNavigationProp<StackParams>>()
  const { origin } = useServer()
  const runs = useQuery(`ai/target/${target}`, () => runsApi.forTarget(origin, target))
  const threads = groupThreads(runs.data?.runs ?? [])
  return (
    <Section title="대화" count={threads.length || undefined}>
      <Row title="새 대화" meta="이 일을 아는 에이전트에게 물어요" onPress={() => navigation.push('Thread', { target, ...(quote ? { quote } : {}) })} chevron />
      {threads.map((t) => (
        <Row
          key={t.id}
          title={t.title || '제목 없는 대화'}
          meta={[t.model, t.running ? '도는 중' : null, ago(t.updated), `${t.count}턴`].filter(Boolean).join(' · ')}
          trailing={t.running ? <View style={s.dot} /> : null}
          onPress={() => navigation.push('Thread', { thread: t.id, target })}
          chevron
        />
      ))}
    </Section>
  )
}
const s = StyleSheet.create({ dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.running } })
