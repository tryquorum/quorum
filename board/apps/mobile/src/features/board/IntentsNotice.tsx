// 홈의 "끝나지 않은 요청"(먼저 기록, 규칙 B): 결과를 모르는 채 남았거나 앱이 도중에 꺼진 생성·AI 실행.
// 리뷰 9 원칙: 결과가 불명인 쓰기는 앱이 스스로 다시 쓰지 않아요. "확인"은 읽기만, 서버에 없다고 확인된 뒤 "다시 보내기"·남은 단계가 있으면
// "이어 하기"를 사람이 눌러야 보내요. 기록은 들어가 있다고 확인됐거나 사람이 "버리기"(확인창) 했을 때만 지워요.
// 기록 파일을 못 읽었거나 깨졌으면 다시 읽기·버리고 새로(그동안 새 요청은 보내지 않아요).
import React, { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { RootParams, StackParams } from '../../navigation/routes'
import { Chip } from '../../ui/Chip'
import { useToast } from '../../ui/Toast'
import { colors, space, styles } from '../../ui/theme'
import { openRef } from './open'
import { SlotIssueNotice } from './quick/SlotIssueNotice'
import type { ReplayResult } from './replays'
import { useIntents } from './useIntents'

type Nav = NativeStackNavigationProp<StackParams & RootParams>
type Checked = ReplayResult | { kind: 'other-scope' }
const STEP = { link: '잇기', draft: '노트 초안' } as const

/** 확인 결과 한 줄 */
export function checkedText(r: Checked): string {
  switch (r.kind) {
    case 'done': return '이미 들어가 있어요'
    case 'absent': return '서버가 받지 않은 것 같아요 · 다시 보내기를 누르면 같은 요청으로 보내요'
    case 'partial': return '이미 있어요 · 남은 단계: ' + r.remaining.map((s) => STEP[s]).join('·')
    case 'unsupported': return '이 서버는 확인할 수 없어요 · 들어갔는지 직접 확인한 뒤 버려 주세요'
    case 'other-scope': return '다른 계정에서 시작한 요청이에요 · 그 계정으로 돌아가면 확인해요'
    case 'unknown': return '아직 확인하지 못했어요 · 잠시 뒤 다시 확인해 주세요'
    case 'failed': return '보내지 못했어요(' + r.message + ') · 기록은 남겨 뒀어요'
  }
}

export function IntentsNotice() {
  const intents = useIntents()
  const toast = useToast()
  const navigation = useNavigation<Nav>()
  const [busy, setBusy] = useState<string | null>(null)
  const [checked, setChecked] = useState<Record<string, Checked>>({})
  if (!intents.issue && !intents.pending.length) return null
  const act = async (key: string, how: 'confirm' | 'resend') => {
    const i = intents.pending.find((x) => x.key === key)
    if (!i || busy) return
    setBusy(key)
    try {
      const r = await intents[how](i)
      setChecked((m) => ({ ...m, [key]: r }))
      if (r.kind === 'done') {
        const open = r.open
        toast(how === 'resend' ? '보냈어요 · ' + i.label : '이미 들어가 있어요 · ' + i.label, open ? { label: '열기', onPress: () => openRef(navigation, open) } : undefined)
      }
    } finally {
      setBusy(null)
    }
  }
  const discard = (key: string, label: string) =>
    Alert.alert('이 요청 기록을 버릴까요?', label + '\n이미 들어갔을 수 있어요. 버린 뒤에는 직접 확인해 주세요.', [
      { text: '남겨 두기', style: 'cancel' },
      { text: '버리기', style: 'destructive', onPress: () => intents.drop(key) },
    ])
  return (
    <View style={s.wrap} accessibilityLabel="끝나지 않은 요청">
      <SlotIssueNotice issue={intents.issue} />
      {intents.pending.length ? <Text style={[styles.meta, { color: colors.decide }]}>보냈는지 확인하지 못한 요청이 있어요 · 확인은 읽어 보기만 하고 다시 보내지 않아요</Text> : null}
      {intents.pending.map((i) => {
        const c = checked[i.key]
        const open = c && (c.kind === 'partial' || c.kind === 'done') ? c.open : undefined
        return (
          <View key={i.key} style={s.item}>
            <View style={s.row}>
              <Text style={[styles.meta, s.label]} numberOfLines={1}>{i.label}</Text>
              {c?.kind === 'absent' || c?.kind === 'partial' ? (
                <Chip label={busy === i.key ? '보내는 중…' : c.kind === 'absent' ? '다시 보내기' : '이어 하기'} onPress={busy ? undefined : () => void act(i.key, 'resend')} />
              ) : c?.kind !== 'unsupported' ? (
                <Chip label={busy === i.key ? '확인하는 중…' : '확인'} onPress={busy ? undefined : () => void act(i.key, 'confirm')} />
              ) : null}
              {open ? <Chip label="열기" onPress={() => openRef(navigation, open)} /> : null}
              <Chip label="버리기" onPress={busy ? undefined : () => discard(i.key, i.label)} />
            </View>
            {c ? <Text style={styles.small}>{checkedText(c)}</Text> : null}
          </View>
        )
      })}
    </View>
  )
}
const s = StyleSheet.create({
  wrap: { gap: space.sm },
  item: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { flex: 1 },
})
