import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { RunThread } from '@direction-board/contracts'
import { ago, RUN_STATUS_KO } from '@direction-board/contracts/run-labels'
import { errorMessage, UnknownWriteError } from '../../api/client'
import { useQuery, useScope } from '../../api/query'
import { runsApi } from '../../api/runs'
import type { StackParams } from '../../navigation/routes'
import { useServer } from '../../server'
import { Chip } from '../../ui/Chip'
import { Row } from '../../ui/Row'
import { Screen } from '../../ui/Screen'
import { Section } from '../../ui/Section'
import { Empty, Loaded, LoginPrompt } from '../../ui/StateView'
import { useToast } from '../../ui/Toast'
import { colors, space, styles } from '../../ui/theme'
import { Composer } from './Composer'
import { ModelChip, ModelSheet } from './ModelSheet'
import { runBody } from './runLogic'
import { THREADS_KEY } from './Thread'
import { useModels } from './useModels'
import { useNow, useVisible } from './useThread'
import { useWriteScope } from '../../api/scope'
import { useIntents } from '../board/useIntents'

/** 대화 목록 한 줄의 메타: 모델 · 상태 · 몇 분 전 · n턴 */
export const threadMeta = (t: RunThread, now: number) => [t.model_name, RUN_STATUS_KO[t.last_status], ago(t.last_at, now), `${t.count}턴`].filter(Boolean).join(' · ')

/**
 * AI 탭 루트(웹 AI 명령창). 아래 입력은 늘 새 대화이고, 지난 대화는 목록에서 골라 이어 물어요(웹과 같은 기본).
 * 도는 대화가 있으면 보이는 동안 2.5초마다 목록을 다시 읽고, 끝난 대화는 토스트로 알려요.
 */
export function Chat() {
  const navigation = useNavigation<NativeStackNavigationProp<StackParams>>()
  const { origin } = useServer()
  const writeScope = useWriteScope()
  // AI 실행 시작은 먼저 기록하고 clientKey 를 붙여 보내요(규칙 B)
  const intents = useIntents()
  const toast = useToast()
  const { generation, isCurrent } = useScope()
  const threads = useQuery(THREADS_KEY, () => runsApi.threads(origin))
  const { cat, choice, setChoice, sheet: modelSheet } = useModels()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const lock = useRef(false)
  const list = threads.data?.threads ?? []
  const running = list.some((t) => t.last_status === 'running')
  const visible = useVisible()
  const now = useNow(running && visible)
  useEffect(() => {
    if (!running || !visible) return
    const timer = setInterval(() => void threads.refresh(), 2500)
    return () => clearInterval(timer)
  }, [running, visible, threads.refresh]) // eslint-disable-line react-hooks/exhaustive-deps
  // 도는 중이던 대화가 끝나면 알려요(앱이 앞으로 돌아왔을 때 포함)
  const wasRunning = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const prev = wasRunning.current
    const next = new Map(list.filter((t) => t.last_status === 'running').map((t) => [t.id, t.first]))
    for (const [id, first] of prev) {
      const now = list.find((t) => t.id === id)
      if (now && now.last_status !== 'running')
        toast(`${now.last_status === 'done' ? '답이 왔어요' : '실행이 끝났어요'}: ${first || '대화'}`, { label: '보기', onPress: () => navigation.push('Thread', { thread: id }) })
    }
    wasRunning.current = next
  }, [list]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const prompt = text.trim()
    const body = runBody({ prompt, last: null, choice, target: null })
    if (!body || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    const scope = generation
    const sent = text
    try {
      const run = await intents.startRun(writeScope, body, prompt.split('\n')[0]?.slice(0, 40) || '대화')
      if (!isCurrent(scope)) return
      setText((cur) => (cur === sent ? '' : cur))
      void threads.refresh()
      navigation.push('Thread', { thread: run.thread || run.id })
    } catch (e) {
      if (!isCurrent(scope)) return
      setError(e)
      // 결과를 모르면(응답 유실 등) 이미 시작됐을 수 있어요: 다시 보내지 말고 목록에서 확인하게 해요
      if (e instanceof UnknownWriteError) void threads.refresh()
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Screen
      onRefresh={() => threads.refresh()}
      bottomBar={
        <Composer
          value={text}
          onChange={setText}
          onSend={() => void send()}
          running={false}
          busy={busy}
          canSend={!!choice}
          placeholder="AI에게 맡길 일을 적어요"
          chips={<ModelChip cat={cat} choice={choice} onPress={() => setSheet(true)} />}
        />
      }
    >
      {error ? (
        <View style={s.notice} accessibilityRole="alert">
          <Text style={styles.meta}>{error instanceof UnknownWriteError ? '보냈는지 확인하지 못했어요. 다시 보내기 전에 아래 목록에서 새 대화가 생겼는지 확인해 주세요' : `보내지 못했어요 · ${errorMessage(error)}`}</Text>
          <LoginPrompt error={error} />
        </View>
      ) : null}
      <Loaded query={threads}>
        {(data) =>
          data.threads.length ? (
            <Section title="최근 대화" count={data.threads.length}>
              {data.threads.map((t) => (
                <Row
                  key={t.id}
                  title={t.first || '제목 없는 대화'}
                  meta={threadMeta(t, now)}
                  leading={t.last_status === 'running' ? <View accessibilityLabel="도는 중" style={[s.dot, { backgroundColor: colors.running }]} /> : undefined}
                  trailing={t.target ? <Chip label="일과 연결" /> : null}
                  onPress={() => navigation.push('Thread', { thread: t.id })}
                  chevron
                />
              ))}
            </Section>
          ) : (
            <Empty title="아직 대화가 없어요" body="아래에 적으면 새 대화가 시작돼요. AI 실행은 그 맥의 주인 계정으로 로그인했을 때만 할 수 있어요" />
          )
        }
      </Loaded>
      <ModelSheet visible={sheet} onClose={() => setSheet(false)} cat={cat} choice={choice} onChange={setChoice} {...modelSheet} />
    </Screen>
  )
}
const s = StyleSheet.create({
  notice: { backgroundColor: colors.fill, borderRadius: 12, padding: space.md, gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
})
