import React, { useState } from 'react'
import { StyleSheet, Switch, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { effortLabel, findModel, type ModelChoice } from '@direction-board/contracts/models'
import { whenLabel } from '@direction-board/contracts/ops-labels'
import { errorMessage } from '../../../api/client'
import { putOps, refreshOps, runSweepNow, stopSweep, useOps, type OpsPatch } from '../../../api/ops'
import type { StackParams } from '../../../navigation/routes'
import { showActions } from '../../../ui/actions'
import { Button } from '../../../ui/Button'
import { Chip } from '../../../ui/Chip'
import { Row } from '../../../ui/Row'
import { Section } from '../../../ui/Section'
import { Sheet } from '../../../ui/Sheet'
import { ErrorCard, Loading } from '../../../ui/StateView'
import { useToast } from '../../../ui/Toast'
import { space, styles } from '../../../ui/theme'
import { ModelSheet } from '../../ai/ModelSheet'
import { useModels } from '../../ai/useModels'
import { OpsRunsList } from '../OpsRunsList'
import { Anchor, SettingRow } from '../parts'
import { useDraftOwner } from '../useDraftOwner'
import { confirmUnsavedPrompt, PromptEditor } from '../PromptEditor'
import { useWriteScope } from '../../../api/scope'

const EVERY: [number, string][] = [[30, '30분'], [60, '1시간'], [120, '2시간'], [180, '3시간'], [240, '4시간'], [360, '6시간'], [720, '12시간'], [1440, '하루']]

/** 설정 › 운영 순회(웹 OpsSection): 켜기·주기·활동 시간·모델, 지금 돌리기/멈추기, 지난 순회, 지시문 */
export function OpsSection() {
  const navigation = useNavigation<NativeStackNavigationProp<StackParams>>()
  const { data, status, error, origin } = useOps(true)
  const scope = useWriteScope()
  const { cat, sheet: modelSheet } = useModels()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [hours, setHours] = useState<'from' | 'to' | null>(null)
  const owner = useDraftOwner()
  if (status === 'forbidden') return <Section><Row title="운영 순회는 이 맥의 주인만 보고 바꿀 수 있어요" /></Section>
  if (!data) return status === 'error' ? <ErrorCard error={error} retry={() => void refreshOps()} /> : <Loading />
  const o = data.ops
  const choice: ModelChoice | null = cat ? { provider: o.provider || cat.default.provider, model: o.model || cat.default.modelId, effort: o.effort || cat.default.effort } : null
  const found = findModel(cat, choice)
  const put = async (patch: OpsPatch, msg?: string) => {
    try {
      await putOps(scope, patch)
      if (msg) toast(msg)
    } catch (e) {
      toast(`저장하지 못했어요 · ${errorMessage(e)}`)
    }
  }
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
  const running = data.runs.find((r) => r.status === 'running')
  const state = !o.enabled ? '꺼져 있어요' : data.next_at ? `다음 ${whenLabel(data.next_at)}${data.in_window ? '' : ' · 지금은 쉬는 시간'}` : '활동 시간이 없어요'
  return (
    <>
      {status === 'error' ? <Text accessibilityRole="text" style={styles.meta}>새 내용을 불러오지 못했어요 · 마지막으로 불러온 내용을 보여줘요</Text> : null}
      <Section title="자동 순회">
        <SettingRow id="ops-schedule" label="자동 순회" info={state}>
          <Switch accessibilityLabel="자동 순회" value={o.enabled} onValueChange={(v) => void put({ enabled: v }, v ? '자동 순회를 켰어요' : '자동 순회를 껐어요')} />
        </SettingRow>
        <SettingRow id="ops-every" label="주기">
          <Button
            variant="plain"
            title={`${EVERY.find(([v]) => v === o.every_min)?.[1] ?? `${o.every_min}분`}마다`}
            onPress={() => showActions(EVERY.map(([v, l]) => ({ label: `${l}마다`, onPress: () => void put({ every_min: v }) })), '순회 주기')}
          />
        </SettingRow>
        <SettingRow id="ops-hours" label="활동 시간(한국)">
          <Button variant="plain" title={`${o.active_from}시`} onPress={() => setHours('from')} />
          <Text style={styles.meta}>~</Text>
          <Button variant="plain" title={`${o.active_to}시`} onPress={() => setHours('to')} />
        </SettingRow>
        <SettingRow id="ops-model" label="모델" info="순회만 쓰는 모델이에요. 설정 › AI 의 기본 모델과 따로예요">
          <Button variant="plain" title={cat ? `${found?.model.name ?? choice?.model ?? '모델'}${choice && (found?.model.efforts.length ?? 0) > 1 ? ` · ${effortLabel(choice.effort)}` : ''}` : modelSheet.loadError ? '다시 불러오기' : '불러오는 중'} disabled={!cat && !modelSheet.loadError} onPress={() => (cat ? setModelOpen(true) : modelSheet.onRetry())} />
        </SettingRow>
        <SettingRow id="ops-run" label="지금 돌리기" info="주기를 기다리지 않고 한 번 돌려요. 끝나면 결과가 아래 지난 순회와 홈에 올라와요">
          {running ? (
            <Button variant="outline" title="멈추기" disabled={busy} onPress={() => void act(() => stopSweep(scope, running.id), '순회를 멈췄어요')} />
          ) : (
            <Button variant="outline" title="지금 돌리기" disabled={busy} onPress={() => confirmUnsavedPrompt(() => void act(() => runSweepNow(scope), '순회를 시작했어요. 끝나면 홈에 올라와요'), owner)} />
          )}
        </SettingRow>
      </Section>
      <Anchor id="ops-runs">
        <OpsRunsList runs={data.runs.slice(0, 3)} />
        {data.runs.length > 3 ? (
          <Section>
            <Row title={`지난 순회 모두 ${data.runs.length}개`} onPress={() => navigation.push('OpsRuns')} chevron />
          </Section>
        ) : null}
      </Anchor>
      <Anchor id="ops-prompt">
        <View style={s.head}>
          <Text accessibilityRole="header" style={styles.heading}>지시문</Text>
          <Chip label={`rev ${o.rev}`} />
        </View>
        <Text style={styles.meta}>순회할 때마다 이 글 전체가 Aside 에게 그대로 넘어가요. 영역(###), 확인할 곳, 나를 불러야 하는 조건을 고치면 다음 순회부터 반영돼요.</Text>
        {owner.known ? <PromptEditor ops={o} defaultText={data.default_text} owner={{ origin, email: owner.email }} /> : <Loading label="계정을 확인하는 중이에요" />}
      </Anchor>
      <ModelSheet
        visible={modelOpen}
        title="순회 모델"
        {...modelSheet}
        onClose={() => setModelOpen(false)}
        cat={cat}
        choice={choice}
        onChange={(c) => void put({ provider: c.provider, model: c.model, effort: c.effort })}
      />
      <Sheet visible={!!hours} title={hours === 'from' ? '시작 시각' : '끝 시각'} onClose={() => setHours(null)}>
        <View style={s.hours}>
          {Array.from({ length: 24 }, (_, i) => (hours === 'to' ? i + 1 : i)).map((h) => (
            <Chip
              key={h}
              label={`${h}시`}
              selected={hours === 'from' ? o.active_from === h : o.active_to === h}
              onPress={() => {
                void put(hours === 'from' ? { active_from: h } : { active_to: h })
                setHours(null)
              }}
            />
          ))}
        </View>
      </Sheet>
    </>
  )
}
const s = StyleSheet.create({
  gap: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs },
  hours: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
})
