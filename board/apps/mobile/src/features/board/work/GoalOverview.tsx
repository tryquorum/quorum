import React, { useEffect, useMemo, useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native'
import type { QuickEdit } from '@direction-board/contracts/quick-recovery'
import { CHANGED_TEXT } from '@direction-board/contracts/slot-store'
import { discardBothNote, draftAfterDoneNote, planDiscardBoth, runDiscardBoth } from '../quick/discardBoth'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { linkedTodosForGoal, normTitle, type Board, type Item } from '@direction-board/contracts'
import { toTasks, type Task } from '@direction-board/contracts/tasks'
import { assertNever, findSameOpen, goalTodoDraft, parseQuick, type Draft } from '@direction-board/contracts/quick-add'
import { long, parse } from '@direction-board/contracts/when'
import { useSaveItem } from '../../../api/board'
import type { RootParams, StackParams } from '../../../navigation/routes'
import { showActions } from '../../../ui/actions'
import { Button } from '../../../ui/Button'
import { Chip } from '../../../ui/Chip'
import { Row } from '../../../ui/Row'
import { Section } from '../../../ui/Section'
import { useToast } from '../../../ui/Toast'
import { colors, schemeColors, space, styles } from '../../../ui/theme'
import { useMain, useSetDone } from '../actions'
import { goalSummary, Progress } from '../Goals'
import { openRef } from '../open'
import { Dot } from '../parts'
import { openKeysOf } from '../rules'
import { TaskRow } from '../TaskRow'
import { ParsedChips, SameWarning } from '../quick/QuickAddBar'
import { confirmDiscard, createdText, requestSheet, stepFailureText, useCreateWork } from '../quick/create'
import { usePendingSlot } from '../quick/pendingSlot'
import { useEditSlot } from '../quick/editSlot'
import { EditConflictNotice, EditSaveNotice, SlotIssueNotice } from '../quick/SlotIssueNotice'
import { inputLocked, inputReady, LOADING_TEXT, retryLabel, SAVE_FAILED, slotFor } from '../quick/recovery'

type Nav = NativeStackNavigationProp<StackParams & RootParams>

/** 목표 화면 위 요약(웹 goal-view.tsx GoalOverview): 상태·영역·기한·진행률·다음 행동·이어서 할 일·할 일 추가·끝낸 것 */
export function GoalOverview({ goal, items, boards, linkedRefs, onAdded }: { goal: Item; items: Item[]; boards: Board[]; linkedRefs: string[]; onAdded: () => void }) {
  const navigation = useNavigation<Nav>()
  const save = useSaveItem()
  const setDone = useSetDone()
  const main = useMain()
  const create = useCreateWork()
  const toast = useToast()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const board = boards.find((b) => b.id === goal.boardId)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  // 실패 기록(recovery.ts): 시작 범위·초안·id. 결과 불명·부분 완료면 입력을 잠그고 그 기록으로만 이어요
  // 지우는 길은 끝(done)과 사람의 버리기(확인창)뿐(리뷰 16)
  // 자리 = 목표 할 일 + 대상(그 목표의 판·목표, 리뷰 18)
  const slotName = slotFor('goal', { boardId: goal.boardId, goalId: goal.id })
  const slot = usePendingSlot(slotName)
  const { pending, ready: pendingReady, issue: slotIssue, writeAhead } = slot
  const locked = inputLocked(pending)
  // 편집 중 글(리뷰 17): 앱을 다시 열어도 쓰던 글이 남아요. 잠긴 기록이면 기록의 글로만
  const edit = useEditSlot(slotName)
  // 복원은 기록·편집 초안을 다 읽은 뒤 한 번만, 그 전에는 입력을 막아요(규칙 C, 리뷰 21 — 복원이 입력을 덮을 길이 없게)
  const [restored, setRestored] = useState(false)
  // 규칙 G(PR #43 리뷰 4): 프로그램이 칸을 바꿀 때는 이것으로만 — 그 값을 기기와 맞춘 값으로 기록해 자동 저장이 사람 편집처럼 쓰지 않아요
  const editOf = (t: string): QuickEdit => ({ text: t, boardId: goal.boardId, goalId: goal.id })
  const setByProgram = (t: string) => {
    setText(t)
    edit.adopt(editOf(t))
  }
  useEffect(() => {
    if (restored || !edit.ready || !slot.loaded) return
    const t = locked ? pending?.text : (edit.initial?.text ?? pending?.text)
    if (t && !text) setByProgram(t)
    setRestored(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 처음 다 읽었을 때만
  }, [edit.ready, slot.loaded])
  const ready = inputReady({ scope: true, target: true, record: slot.loaded, edit: edit.ready, restored })
  useEffect(() => {
    if (restored && !locked) edit.change(editOf(text))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 글이 바뀔 때만
  }, [text, locked])
  const [showDone, setShowDone] = useState(false)
  const prefix = `item:${goal.boardId}:`
  const linkedIds = useMemo(() => linkedRefs.filter((r) => r.startsWith(prefix)).map((r) => r.slice(prefix.length)), [linkedRefs, prefix])
  const subtasks = useMemo(() => {
    const ids = new Set(linkedTodosForGoal(goal, items, linkedIds).map((i) => i.id))
    return toTasks({ items: items.filter((i) => i.boardId === goal.boardId && ids.has(i.id)), signals: [], boards, boardId: goal.boardId, mainKeys: main.keys, withDone: true })
  }, [goal, items, linkedIds, boards, main.keys])
  const sm = goalSummary(goal, items, linkedIds)
  const area = board?.areas.find((a) => a.id === goal.area)
  const open = subtasks.filter((t) => !t.done)
  const done = subtasks.filter((t) => t.done)
  const next = open[0] ?? null
  const openKeys = openKeysOf(items, [])
  const onOpen = (t: Task) => openRef(navigation, t.ref, t.title)
  const onDone = (t: Task, d: boolean) => t.item && void setDone(t.item, d)
  const onStar = (t: Task) => main.toggle(t.key, t.title, openKeys)
  const setDue = (due: string | null) => void save({ ...goal, due }).catch(() => toast('기한을 저장하지 못했어요'))
  const pickDue = () =>
    showActions(
      [
        { label: '날짜를 글로 쓰기(예: 12월 3일)', onPress: () => Alert.prompt('목표 기한', '예: 12월 3일, 다음 주 금요일, 2026-12-31', (v) => { const p = v ? parse(v) : null; if (p) setDue(p.at.slice(0, 10)); else if (v) toast('날짜를 알아보지 못했어요') }) },
        ...(goal.due ? [{ label: '기한 지우기', destructive: true, onPress: () => setDue(null) }] : []),
      ],
      '목표 기한',
    )

  const parsed = text.trim() ? parseQuick(text, board?.areas ?? [], (t) => parse(t), board?.kind !== 'company') : null
  const retrying = !!pending && (locked || pending.text === text)
  const same = parsed && !retrying ? findSameOpen(items, goal.boardId, parsed.title, goal.space) : null
  // 목표의 판·영역·공간을 물려받아요(공간을 빠뜨리면 회사 판 새 항목이 첫 워크스페이스로 갔어요 — 서버도 goalId 로 물려받음)
  const draftOf = (): Draft => goalTodoDraft(goal, { title: parsed?.title ?? text, at: parsed?.at ?? null, areaId: parsed?.area?.id, tags: parsed?.tags ?? [] })
  const add = async () => {
    if (!ready || !parsed || busy || !pendingReady) return
    const key = normTitle(parsed.title)
    if (same && confirm !== key) return setConfirm(key)
    setBusy(true)
    try {
      // 제출한 초안 원문이 전제(PR #43 리뷰 3): 끝나면 그 원문일 때만 쓰던 글을 비워요
      const draftTarget = await edit.planClear()
      const r = await create(text, draftOf, pending, writeAhead)
      switch (r.kind) {
        case 'other-scope':
        case 'not-sent':
          return toast(r.message)
        case 'pending':
          if (r.note) toast(r.note)
          if (!(await slot.keep(r.pending))) toast(SAVE_FAILED)
          return
        case 'done': {
          setConfirm(null)
          const cleared = await edit.applyClear(draftTarget)
          // 그사이 바뀐 쓰던 글은 남기고 그 글을 보여요
          setByProgram(cleared.r === 'changed' ? (cleared.now?.text ?? '') : '')
          const kept = draftAfterDoneNote(cleared.r, '추가했어요 · 기기의 쓰던 글을 지우지 못했어요')
          if (kept) toast(kept)
          slot.done(r.result)
          onAdded()
          const ref = r.result.ref
          return toast(`${createdText(r.result)} · ${r.draft.title}`, { label: '열기', onPress: () => openRef(navigation, ref) })
        }
        default:
          return assertNever(r)
      }
    } finally {
      setBusy(false)
    }
  }
  // 쓰던 글을 상세 시트로 옮기기: 이 자리에 먼저 저장된 뒤에만(규칙 D)
  const detail = async () => {
    if (!(await edit.flush())) return toast(SAVE_FAILED)
    // 시트로 넘긴 원문이 전제(규칙 G)
    const handoff = await edit.planClear()
    requestSheet({ text, draft: draftOf(), onCreated: () => void edit.applyClear(handoff).then((c) => { setByProgram(c.r === 'changed' ? (c.now?.text ?? '') : ''); setConfirm(null); onAdded() }) })
    navigation.navigate('QuickAdd', { text })
  }
  // 버리기(PR #43 리뷰 3): 확인창을 띄울 때 남은 기록과 그 자리의 쓰던 글을 각자 전제와 함께 계획하고 확인창에 둘 다 밝혀요.
  // 확인 뒤 대상마다 비교-후-쓰기 — 그사이 바뀐 것은 지우지 않아요
  const askDiscard = async () => {
    const plan = await planDiscardBoth(slot, edit)
    if (!plan) return toast(CHANGED_TEXT)
    confirmDiscard(
      () =>
        void runDiscardBoth(slot, edit, plan).then((x) => {
          if (x.draft === 'done') setByProgram('')
          else if (x.draft === 'changed') setByProgram(x.now?.text ?? '')
          const note = discardBothNote(x)
          if (note) toast(note)
        }),
      plan.message,
    )
  }
  const basis = sm.basis === 'area' ? '이 목표에 붙인 할 일이 없어 같은 영역의 할 일을 세요. 여기서 할 일을 추가하면 이 목표에 붙어요' : sm.basis === 'none' ? '이 목표에 붙인 할 일도, 영역도 없어요. 여기서 할 일을 추가하면 이 목표에 붙어요' : ''
  return (
    <>
      <View style={[styles.group, s.card]} accessibilityLabel="목표 진행과 하위 할 일">
        <View style={s.chips}>
          <Chip label={sm.label} tone={sm.state === 'late' ? 'decide' : sm.state === 'done' ? 'neutral' : 'done'} />
          {area ? <View style={s.area}><Dot color={area.color} /><Text style={styles.small}>{area.name}</Text></View> : null}
          <Chip label={goal.due ? `${long(goal.due)} · ${sm.due}` : '기한 정하기'} tone={sm.late ? 'decide' : undefined} onPress={pickDue} />
        </View>
        <Progress pct={sm.pct} late={sm.state === 'late'} label="목표 진행률" />
        <Text style={styles.meta}>{sm.progress.done}/{sm.progress.total} 완료 · {sm.pct}%</Text>
        {basis ? <Text style={styles.small}>{basis}</Text> : null}
      </View>
      {next ? (
        <Section title="다음 행동">
          <TaskRow t={next} onOpen={onOpen} onDone={onDone} onStar={onStar} />
        </Section>
      ) : sm.progress.total > 0 && sm.progress.done === sm.progress.total ? (
        <View style={[styles.group, s.card]}>
          <Text style={styles.strong}>연결된 할 일을 모두 끝냈어요</Text>
          {!goal.done ? <Button title="목표 완료" onPress={() => void setDone(goal, true)} /> : null}
        </View>
      ) : null}
      {open.length > 1 ? <Section title="이어서 할 일" count={open.length - 1}>{open.slice(1).map((t) => <TaskRow key={t.key} t={t} onOpen={onOpen} onDone={onDone} onStar={onStar} />)}</Section> : null}
      <View style={s.add}>
        <View style={s.addRow}>
          <TextInput value={text} editable={ready && !busy && !locked} onChangeText={(v) => { setText(v); setConfirm(null) }} onSubmitEditing={() => void add()} submitBehavior="submit" returnKeyType="done" placeholder={ready ? '이 목표의 할 일 추가' : LOADING_TEXT} placeholderTextColor={c.muted} accessibilityLabel="이 목표의 할 일 추가" style={[styles.input, s.flex]} />
          <Chip label="자세히" onPress={busy || !ready ? undefined : () => void detail()} />
        </View>
        {/* 규칙 E(리뷰 22): 기록·쓰던 초안을 읽지 못했으면 원인과 다시 읽기·버리고 새로 */}
        <SlotIssueNotice issue={slotIssue} />
        <SlotIssueNotice issue={edit.issue} />
        <EditSaveNotice edit={edit} />
        <EditConflictNotice edit={edit} onLoad={(e) => setByProgram(e?.text ?? '')} />
        {pending ? (
          <View style={s.addRow} accessibilityRole="alert">
            <Text style={[styles.meta, s.flex, { color: colors.decide }]}>{stepFailureText(pending)}{locked ? ' · 결과를 확인할 때까지 글은 고정돼요' : ''}</Text>
            {/* 잠기면 입력칸이 Enter 를 받지 못해서 확인·다시 보내기·이어 하기는 단추로도 둬요(결과 불명이면 "확인" = 읽기만) */}
            <Chip label={busy ? '하는 중…' : retryLabel(pending)} onPress={busy ? undefined : () => void add()} />
            <Chip label="버리기" onPress={() => void askDiscard()} />
          </View>
        ) : same ? (
          <SameWarning same={same} confirmed={!!parsed && confirm === normTitle(parsed.title)} onOpen={() => openRef(navigation, `item:${same.boardId}:${same.id}`)} />
        ) : (
          <ParsedChips parsed={parsed} />
        )}
      </View>
      {done.length ? (
        <Section title={`끝낸 할 일 ${done.length}`} right={<Chip label={showDone ? '접기' : '펼치기'} onPress={() => setShowDone((v) => !v)} />}>
          {showDone ? done.map((t) => <TaskRow key={t.key} t={t} onOpen={onOpen} onDone={onDone} onStar={onStar} />) : <Row title="끝낸 할 일 보기" onPress={() => setShowDone(true)} />}
        </Section>
      ) : null}
    </>
  )
}
const s = StyleSheet.create({
  card: { padding: space.gutter, gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  area: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  add: { gap: space.sm },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
})
