import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { chipState, countsLabel, STATUS_KO } from '@direction-board/contracts/ops-labels'
import { ago } from '@direction-board/contracts/run-labels'
import { errorMessage } from '../../api/client'
import { runSweepNow, stopSweep, useOps } from '../../api/ops'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { Row } from '../../ui/Row'
import { Sheet } from '../../ui/Sheet'
import { useToast } from '../../ui/Toast'
import { colors, space, styles, toneDot, type Tone } from '../../ui/theme'
import { runTone } from './OpsRunsList'
import { confirmUnsavedPrompt } from './PromptEditor'
import { useDraftOwner } from './useDraftOwner'
import { useWriteScope } from '../../api/scope'

const TONE: Record<'running' | 'error' | 'off' | 'idle', Tone> = { running: 'running', error: 'decide', off: 'neutral', idle: 'done' }
type Nav = { navigate: (name: 'Settings', params?: { screen: 'SettingsSection'; params: { section: 'ops' }; initial: false }) => void; push: (name: 'Thread', params: { thread: string }) => void }

/**
 * 운영 순회 칩(웹 사이드바 OpsStatus): 점 + 한 줄. 누르면 마지막 순회 요약·지금 돌리기/멈추기·결과·설정 시트.
 * 맥 주인이 아니면(403) 그리지 않아요. 설정 루트 첫 줄에 있고, 홈 머리(레인 1)도 이 칩을 품을 수 있어요.
 */
export function OpsChip() {
  const { data, status } = useOps(false)
  const navigation = useNavigation<Nav>()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const owner = useDraftOwner()
  const scope = useWriteScope()
  if (status === 'forbidden' || !data) return null
  const chip = chipState(data)
  const last = data.runs[0]
  const running = last?.status === 'running' ? last : undefined
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast(ok)
    } catch (e) {
      toast(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const go = (fn: () => void) => {
    setOpen(false)
    fn()
  }
  return (
    <>
      <Row
        title={chip.label}
        meta={last ? `마지막 순회 ${ago(last.created_at)}` : '아직 돈 순회가 없어요'}
        leading={<View accessibilityElementsHidden style={[s.dot, { backgroundColor: toneDot[TONE[chip.tone]] }]} />}
        onPress={() => setOpen(true)}
        chevron
      />
      <Sheet visible={open} title="운영 순회" onClose={() => setOpen(false)}>
        <Text style={styles.meta}>{chip.label}</Text>
        {!last ? (
          <Text style={styles.text}>아직 돈 순회가 없어요</Text>
        ) : (
          <View style={s.box}>
            <View style={s.line}>
              <Chip label={STATUS_KO[last.status] || last.status} tone={runTone(last.status)} />
              <Text style={styles.meta}>마지막 순회 {ago(last.created_at)}</Text>
            </View>
            {last.report ? (
              <>
                <Text style={styles.text} numberOfLines={2}>{last.report.summary.split('\n')[0] || '요약 없음'}</Text>
                <Text style={styles.meta}>{countsLabel(last.report.counts)}</Text>
              </>
            ) : last.status === 'running' ? (
              <Text style={styles.text}>돌아보는 중이에요. 끝나면 홈에 올라와요</Text>
            ) : last.status === 'error' ? (
              <Text style={[styles.text, s.error]} numberOfLines={2}>{(last.error || '실패했어요').split('\n')[0]}</Text>
            ) : (
              <Text style={styles.text}>보고 없이 끝났어요</Text>
            )}
          </View>
        )}
        {running ? (
          <Button variant="outline" title="멈추기" disabled={busy} onPress={() => void act(() => stopSweep(scope, running.id), '순회를 멈췄어요')} />
        ) : (
          <Button title="지금 돌리기" disabled={busy} onPress={() => confirmUnsavedPrompt(() => void act(() => runSweepNow(scope), '순회를 시작했어요. 끝나면 홈에 올라와요'), owner)} />
        )}
        {last ? <Button variant="outline" title="결과 대화 열기" onPress={() => go(() => navigation.push('Thread', { thread: last.id }))} /> : null}
        <Button
          variant="plain"
          title="운영 순회 설정"
          onPress={() => go(() => navigation.navigate('Settings', { screen: 'SettingsSection', params: { section: 'ops' }, initial: false }))}
        />
      </Sheet>
    </>
  )
}
const s = StyleSheet.create({
  dot: { width: 10, height: 10, borderRadius: 5 },
  box: { backgroundColor: colors.card, borderRadius: 14, padding: space.lg, gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  error: { color: colors.decide },
})
