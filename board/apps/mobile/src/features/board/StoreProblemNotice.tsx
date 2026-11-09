// 화면 설정(집중 모드·오늘 메인·목록 설정) 문제 표시(리뷰 24 P2): 토스트(하나·5초) 대신 문제가 풀릴 때까지 그 화면에 남아요.
// 읽기 실패면 다시 읽기, 깨짐이면 다시 읽기·초기화. 초기화는 규칙 F(PR #43 리뷰 2): 누르면 지금 값을 읽어 계획을 만들고, 확인창은 그 계획의 글, 실행은 그 계획만
// (그사이 값이 바뀌었으면 아무것도 지우지 않고 "그사이 바뀌었어요").
import React, { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { CHANGED_TEXT } from '@direction-board/contracts/slot-store'
import { Chip } from '../../ui/Chip'
import { colors, space, styles } from '../../ui/theme'
import { storeProblemCopy, type StoreIssueNow } from './storedHook'

export function StoreProblemNotice({ label, issue }: { label: string; issue: StoreIssueNow | null }) {
  const [note, setNote] = useState<string | null>(null)
  if (!issue) return null
  const copy = storeProblemCopy(label, issue.problem, issue)
  const reset = copy.reset
  const ask = async () => {
    if (!reset) return
    const p = await issue.plan()
    // 지금 읽어 보니 깨지지 않았으면(그사이 풀림) 다시 읽어 지금 상태를 보여요
    if (!p) {
      setNote(null)
      return issue.retry()
    }
    Alert.alert(reset.title, p.message, [{ text: '취소', style: 'cancel' }, { text: '초기화', style: 'destructive', onPress: () => void issue.apply(p).then((r) => setNote(r === 'changed' ? CHANGED_TEXT : null)) }])
  }
  return (
    <View style={s.row} accessibilityRole="alert" accessibilityLabel={copy.text}>
      <Text style={[styles.meta, s.text, { color: colors.decide }]}>{copy.text}</Text>
      {/* 다시 읽는 동안·초기화하는 동안은 단추 없이 글만(끝나면 결과대로 바뀌어요) */}
      {issue.retrying || issue.resetting ? null : <Chip label="다시 읽기" onPress={issue.retry} />}
      {reset ? <Chip label={issue.resetFailed ? '다시 시도' : '초기화'} onPress={() => void ask()} /> : null}
      {note ? <Text style={[styles.meta, s.text, { color: colors.decide }]}>{note}</Text> : null}
    </View>
  )
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  text: { flexBasis: '100%' },
})
