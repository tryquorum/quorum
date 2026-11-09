import React, { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { SymbolView } from 'expo-symbols'
import type { Run } from '@direction-board/contracts'
import { ago, elapsedLabel, errorGuide, runStalled, toolLabel } from '@direction-board/contracts/run-labels'
import { NoteView } from '../../notes/NoteView'
import { Button } from '../../ui/Button'
import { colors, schemeColors, space, styles } from '../../ui/theme'
import { tablesAsList } from './runLogic'

/** 작업 단계: 도는 중이면 마지막 도구 한 줄, 끝나면 "작업 n단계"를 눌러 펼쳐요. 단계 사이는 들여쓰기·점(왼쪽 선 없음) */
function Steps({ steps, running }: { steps: { tool: string; arg: string }[]; running: boolean }) {
  const [open, setOpen] = useState(false)
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  if (!steps.length) return null
  const last = steps[steps.length - 1]
  return (
    <View style={s.steps}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} hitSlop={8} style={s.stepHead}>
        {running ? <ActivityIndicator size="small" /> : <SymbolView name={open ? 'chevron.down' : 'chevron.right'} size={11} tintColor={c.muted} />}
        <Text style={styles.meta} numberOfLines={1}>
          {running && last ? `${toolLabel(last.tool)}${last.arg ? ` · ${last.arg}` : ''}` : `작업 ${steps.length}단계`}
        </Text>
      </Pressable>
      {open
        ? steps.map((st, i) => (
            <View key={i} style={s.step}>
              <View style={s.dot} />
              <Text style={styles.small} numberOfLines={2}>
                <Text style={s.tool}>{toolLabel(st.tool)}</Text>
                {st.arg ? ` · ${st.arg}` : ''}
              </Text>
            </View>
          ))
        : null}
    </View>
  )
}

/** 실패·멈춤 안내(웹 RunError 와 같은 문구). 바탕 색으로 나눠요 */
function RunError({ run, onRetry, retrying }: { run: Run; onRetry?: (run: Run) => void; retrying: boolean }) {
  const [detail, setDetail] = useState(false)
  const stopped = run.status === 'stopped'
  const guide = errorGuide(run.error_kind)
  return (
    <View accessibilityRole={stopped ? undefined : 'alert'} style={s.error}>
      {stopped ? <Text style={styles.meta}>실행을 멈췄어요</Text> : (
        <>
          <Text style={[styles.strong, s.errorTitle]}>{guide.title}</Text>
          <Text style={styles.text}>{guide.guidance}</Text>
        </>
      )}
      {run.error ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: detail }} onPress={() => setDetail((v) => !v)} hitSlop={8}>
          <Text style={styles.meta}>{detail ? '자세히 접기' : '자세히'}</Text>
          {detail ? <Text selectable style={[styles.small, s.mono]}>{run.error}</Text> : null}
        </Pressable>
      ) : null}
      {onRetry ? (
        <View style={s.retry}>
          <Button variant="outline" title={retrying ? '다시 시작하는 중…' : '다시 시도'} disabled={retrying} onPress={() => onRetry(run)} />
          {run.parent ? <Text style={styles.small}>새 대화로 다시 시작해요(앞 대화 맥락은 빠져요)</Text> : null}
        </View>
      ) : null}
    </View>
  )
}

/** 모델 · 수준 · 이어서 · 상태 · 경과 · 몇 분 전, 그리고 90초 무응답 안내 */
function RunStatus({ run, now }: { run: Run; now: number }) {
  const running = run.status === 'running'
  const parts = [
    run.model_name || run.model,
    run.effort,
    run.parent ? '이어서' : null,
    run.retry_of ? '다시 시도한 실행' : null,
    running ? '진행 중' : run.status === 'done' ? '끝남' : run.status === 'stopped' ? '멈춤' : '오류',
    elapsedLabel(run, now),
    !running && run.finished_at ? ago(run.finished_at, now) : null,
  ].filter(Boolean)
  return (
    <View style={s.status}>
      <View style={s.statusLine}>
        {running ? <View style={s.liveDot} /> : null}
        <Text style={styles.small}>{parts.join(' · ')}</Text>
      </View>
      {runStalled(run, now) ? (
        <Text accessibilityRole="text" style={[styles.meta, s.note]}>
          응답이 없어요(90초). 계속 기다리거나 멈출 수 있어요
        </Text>
      ) : null}
    </View>
  )
}

/** 대화 한 턴: 오른쪽 질문 말풍선, 아래 작업 단계·답·안내·상태. 답을 길게 누르면 복사·공유 */
export function RunBlock({ run, now, onRetry, retrying, onAnswerLongPress, onLink }: {
  run: Run
  now: number
  onRetry?: (run: Run) => void
  retrying: boolean
  onAnswerLongPress?: (run: Run) => void
  onLink?: (href: string) => void
}) {
  const running = run.status === 'running'
  const steps = run.steps ?? []
  return (
    <View style={s.turn}>
      <View style={s.ask}>
        <Text selectable style={styles.text}>{run.prompt}</Text>
      </View>
      <Steps steps={steps} running={running} />
      {run.output ? (
        <Pressable accessibilityHint="길게 누르면 복사·공유" onLongPress={onAnswerLongPress ? () => onAnswerLongPress(run) : undefined} delayLongPress={350}>
          <NoteView md={tablesAsList(run.output)} onLink={onLink} />
        </Pressable>
      ) : running && !steps.length ? (
        <View style={s.thinking}>
          <ActivityIndicator size="small" />
          <Text style={styles.meta}>생각하는 중…</Text>
        </View>
      ) : null}
      {run.status === 'error' || run.status === 'stopped' ? <RunError run={run} onRetry={run.kind === 'sweep' ? undefined : onRetry} retrying={retrying} /> : null}
      <RunStatus run={run} now={now} />
    </View>
  )
}
const s = StyleSheet.create({
  turn: { gap: space.sm },
  ask: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: colors.fill, borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: space.md, paddingVertical: space.sm },
  steps: { gap: space.xs },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingLeft: space.lg },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted, marginTop: 7 },
  tool: { color: colors.ink, fontWeight: '600' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.running },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  error: { backgroundColor: colors.fill, borderRadius: 12, padding: space.md, gap: space.sm },
  errorTitle: { color: colors.decide },
  mono: { fontFamily: 'Menlo', marginTop: space.xs },
  retry: { gap: space.xs, alignItems: 'flex-start' },
  status: { gap: space.xs },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  note: { backgroundColor: colors.fill, borderRadius: 8, paddingHorizontal: space.sm, paddingVertical: space.xs },
})
