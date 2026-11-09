import React, { useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import type { CaptureEffect } from '@direction-board/contracts'
import { failureText, lastLine, OP_LABEL, SHOWN, summarize, type CaptureEntry } from '@direction-board/contracts/capture'
import { Chip } from '../../../ui/Chip'
import { colors, space, styles, type Tone } from '../../../ui/theme'
import { Dot } from '../parts'
import { canUndo, type CaptureCenter } from './captureFlow'

const elapsed = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초` }
const day = (ms: number) => new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(ms)
const TONE: Record<CaptureEffect['op'], Tone> = { created: 'ai', decision: 'decide', merged: 'neutral', updated: 'neutral' }

function EffectRow({ e, onOpen, onUndo }: { e: CaptureEffect; onOpen: (ref: string) => void; onUndo: () => void }) {
  const gone = e.undone || !e.now
  return (
    <View style={s.effect}>
      <Chip label={OP_LABEL[e.op]} tone={TONE[e.op]} />
      <Text numberOfLines={1} style={[styles.text, s.flex, gone && s.gone]}>{e.now?.title ?? e.title}</Text>
      {gone ? (
        <Text style={styles.small}>{e.undone ? '되돌림' : '없음'}</Text>
      ) : (
        <>
          {e.now?.due ? <Text style={styles.small}>{day(e.now.due)}</Text> : null}
          <Chip label="열기" onPress={() => onOpen(e.ref)} />
          {canUndo(e) ? <Chip label="되돌리기" onPress={onUndo} /> : null}
        </>
      )}
    </View>
  )
}

function Card({ entry, c, now, onOpen, onManual }: { entry: CaptureEntry; c: CaptureCenter; now: number; onOpen: (ref: string) => void; onManual: (e: CaptureEntry) => void }) {
  if (c.isUnsent(entry)) return <UnsentCard entry={entry} c={c} onManual={onManual} />
  const view = c.views[entry.id]
  const phase = c.phase(entry.id)
  const effects = view?.effects ?? []
  const run = view?.run
  const thread = run ? `run:${run.thread || run.id}` : null
  const step = run?.steps?.at(-1)
  const first = entry.text.split('\n')[0]
  const head = phase === 'running' ? 'AI가 정리 중' : phase === 'done' ? summarize(effects) : run ? failureText(run) : 'AI가 정리하지 못했어요'
  return (
    <View accessibilityLabel={`AI 정리: ${first}`} style={[styles.group, s.card]}>
      <View style={s.line}>
        <Dot tone={phase === 'failed' ? 'decide' : 'ai'} />
        <Text accessibilityRole="text" accessibilityLiveRegion="polite" numberOfLines={2} style={[styles.strong, s.flex, phase === 'failed' && { color: colors.decide }]}>
          {head}
          <Text style={styles.meta}> · {first}</Text>
        </Text>
        {phase === 'running' ? <Text style={styles.small}>{elapsed(now - entry.startedAt)}</Text> : <Chip label="닫기" onPress={() => c.dismiss(entry.id)} />}
      </View>
      {phase === 'failed' && run?.status === 'error' && (!run.error_kind || run.error_kind === 'unknown') && lastLine(run.error) ? <Text style={styles.small} numberOfLines={1}>{lastLine(run.error)}</Text> : null}
      {phase === 'running' ? (
        <View style={s.line}>
          <Text numberOfLines={1} style={[styles.small, s.flex]}>{step ? `${step.tool} ${step.arg}` : '같은 일을 찾고 사실을 확인하는 중'}</Text>
          <Chip label="멈추기" onPress={() => void c.stop(entry.id)} />
        </View>
      ) : null}
      {effects.length ? (
        <View accessibilityLabel={phase === 'failed' ? '일부는 올렸어요' : 'AI가 올린 것'} style={s.effects}>
          {effects.map((e) => <EffectRow key={e.ref} e={e} onOpen={onOpen} onUndo={() => void c.undo(entry.id, e.ref)} />)}
        </View>
      ) : null}
      {phase !== 'running' ? (
        <View style={s.actions}>
          {phase === 'failed' && effects.length ? <Text style={styles.small}>일부는 올렸어요</Text> : null}
          {phase === 'failed' ? <Chip label="다시 시도" onPress={() => void c.retry(entry.id)} /> : null}
          {phase === 'failed' || !effects.length ? <Chip label="직접 추가" onPress={() => onManual(entry)} /> : null}
          {thread ? <Chip label="대화 열기" onPress={() => onOpen(thread)} /> : null}
        </View>
      ) : null}
    </View>
  )
}

/**
 * 시작 응답을 잃은 칩: 서버에 실행이 생겼는지 몰라요. "확인"은 읽기만 해요(같은 제출 키의 실행을 찾아 있으면 그 실행으로).
 * 서버에 없다고 확인되면 "다시 보내기"를 사람이 눌러야 보내요. 닫을 수 없고 "버리기"(확인창)만 지워요. 직접 추가는 남겨 둔 초안 그대로
 */
function UnsentCard({ entry, c, onManual }: { entry: CaptureEntry; c: CaptureCenter; onManual: (e: CaptureEntry) => void }) {
  const [busy, setBusy] = useState(false)
  const first = entry.text.split('\n')[0]
  const check = c.check(entry.id)
  const act = async (f: () => Promise<void>) => {
    setBusy(true)
    try {
      await f()
    } finally {
      setBusy(false)
    }
  }
  const discard = () =>
    Alert.alert('이 AI 정리를 버릴까요?', '서버가 이미 받았을 수 있어요. 버린 뒤에는 대화 목록에서 직접 확인해 주세요.', [
      { text: '남겨 두기', style: 'cancel' },
      { text: '버리기', style: 'destructive', onPress: () => c.discard(entry.id) },
    ])
  const head = check === 'absent' ? '서버가 받지 않은 것 같아요' : check === 'unsupported' ? '이 서버는 보냈는지 확인할 수 없어요' : 'AI에게 보냈는지 확인하지 못했어요'
  return (
    <View accessibilityLabel={`AI 정리: ${first}`} style={[styles.group, s.card]}>
      <View style={s.line}>
        <Dot tone="warn" />
        <Text accessibilityRole="text" accessibilityLiveRegion="polite" numberOfLines={2} style={[styles.strong, s.flex]}>
          {head}
          <Text style={styles.meta}> · {first}</Text>
        </Text>
      </View>
      {check === 'unsupported' ? <Text style={styles.small}>들어갔는지 대화 목록에서 확인한 뒤 버려 주세요</Text> : null}
      <View style={s.actions}>
        {check === 'absent' ? (
          <Chip label={busy ? '보내는 중…' : '다시 보내기'} onPress={busy ? undefined : () => void act(() => c.resend(entry.id))} />
        ) : check !== 'unsupported' ? (
          <Chip label={busy ? '확인하는 중…' : '확인'} onPress={busy ? undefined : () => void act(() => c.confirm(entry.id))} />
        ) : null}
        <Chip label="직접 추가" onPress={() => onManual(entry)} />
        <Chip label="버리기" onPress={busy ? undefined : discard} />
      </View>
    </View>
  )
}

/** 입력줄 바로 아래 AI 정리 칩(최근 3개 + n개 더). 웹 capture-tray.tsx 와 같은 글·같은 동작 */
export function CaptureTray({ c, onOpen, onManual }: { c: CaptureCenter; onOpen: (ref: string) => void; onManual: (e: CaptureEntry) => void }) {
  const [now, setNow] = useState(() => Date.now())
  const running = c.running
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  const live = c.live()
  if (!live.length) return null
  return (
    <View style={s.tray}>
      {c.visible().map((e) => <Card key={e.id} entry={e} c={c} now={now} onOpen={onOpen} onManual={onManual} />)}
      {live.length > SHOWN ? <Chip label={c.expanded ? '접기' : `${live.length - SHOWN}개 더`} onPress={() => c.setExpanded(!c.expanded)} /> : null}
    </View>
  )
}
const s = StyleSheet.create({
  tray: { gap: space.sm },
  card: { padding: space.md, gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  effects: { gap: space.xs },
  effect: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36 },
  gone: { color: colors.muted, textDecorationLine: 'line-through' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
})
