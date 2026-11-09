// 빠른 추가 복구 기록 자리의 문제 안내(리뷰 6): 읽지 못함·깨짐이면 새 제출을 막고 다시 읽기·버리고 새로, 기록을 못 남겼으면 확인 요청.
import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Chip } from '../../../ui/Chip'
import { colors, space, styles } from '../../../ui/theme'
import type { SlotIssue } from './pendingSlot'
import type { EditSlot } from './editSlot'
import { SAVE_FAILED, type QuickEdit } from './recovery'
import { CHANGED_TEXT } from '@direction-board/contracts/slot-store'
import { EDIT_READ_FAILED_TEXT } from '@direction-board/contracts/quick-recovery'
import { confirmDiscard } from './create'

export function SlotIssueNotice({ issue }: { issue: SlotIssue | null }) {
  // 버리기 결과 안내(그사이 바뀜·쓰지 못함) — 문제가 풀리면 안내도 사라져요
  const [note, setNote] = useState<string | null>(null)
  if (!issue) return null
  // 규칙 F(PR #43 리뷰 2): 누르면 지금 저장을 읽어 계획(지울 곳 하나 + 확인창 글)을 만들고, 확인창은 그 글을 그대로, 실행은 그 계획만
  const discard = async () => {
    const p = await issue.plan?.()
    // 지금 읽어 보니 버릴 것이 없으면(그사이 풀림) 다시 읽어 지금 상태를 보여요
    if (!p) {
      setNote(null)
      return issue.retry?.()
    }
    confirmDiscard(() => void issue.apply?.(p).then((r) => setNote(r === 'changed' ? CHANGED_TEXT : r === 'failed' ? SAVE_FAILED : null)), p.message)
  }
  return (
    <View style={s.row} accessibilityRole="alert">
      <Text style={[styles.meta, s.text, { color: colors.decide }]}>{issue.text}</Text>
      {/* 다시 읽는 중·버리는 중에는 단추가 없어요(storeGate busy — 그동안 다시 읽기·새 제출이 닫혀요, PR #43 리뷰) */}
      {issue.retry && !issue.busy ? <Chip label="다시 읽기" onPress={issue.retry} /> : null}
      {/* 버리고 새로는 사람이 확인창에서 고를 때만(규칙 E — 읽지 못한 기록을 덮는 유일한 길). 확인창은 무엇이 버려지는지 밝혀요(issue.confirm) */}
      {issue.plan && !issue.busy ? <Chip label="버리고 새로" onPress={() => void discard()} /> : null}
      {note ? <Text style={[styles.meta, s.text, { color: colors.decide }]}>{note}</Text> : null}
    </View>
  )
}

/** 규칙 D(리뷰 21): 편집 초안을 기기에 저장하지 못했으면 칸은 그대로 두고 알려요 — 다시 저장(밀린 값 그대로). 저장될 때까지 닫기·옮기기를 하지 않아요 */
export function EditSaveNotice({ edit }: { edit: EditSlot }) {
  if (!edit.failed && !edit.readFailed) return null
  return (
    <View style={s.row} accessibilityRole="alert">
      <Text style={[styles.meta, s.text, { color: colors.decide }]}>{edit.readFailed ? EDIT_READ_FAILED_TEXT : SAVE_FAILED}</Text>
      <Chip label={edit.readFailed ? '다시 읽어 저장' : '다시 저장'} onPress={() => void edit.flush()} />
    </View>
  )
}
/**
 * 규칙 G(PR #43 리뷰 4): 자동 저장이 "다른 곳에서 바뀐 초안"을 만나 쓰지 않았을 때 — 불러오기(그 초안을 칸에, 화면은 setByProgram 으로) ·
 * 내 것으로 덮기(확인창 뒤 지금 칸의 글을 저장). 고를 때까지 자동 저장은 쓰지 않아요
 */
export function EditConflictNotice({ edit, onLoad }: { edit: EditSlot; onLoad: (e: QuickEdit | null) => void }) {
  if (!edit.conflict) return null
  return (
    <View style={s.row} accessibilityRole="alert">
      <Text style={[styles.meta, s.text, { color: colors.decide }]}>다른 곳에서 바뀐 초안이 있어요 · 지금 칸의 글은 아직 저장하지 않았어요</Text>
      <Chip label="불러오기" onPress={() => void edit.takeTheirs().then((e) => e !== undefined && onLoad(e))} />
      <Chip label="내 것으로 덮기" onPress={() => confirmDiscard(() => void edit.keepMine(), '다른 곳에서 바뀐 초안을 지금 칸의 글로 덮어요 · 덮으면 그 초안은 사라져요.')} />
    </View>
  )
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  text: { flexBasis: '100%' },
})
