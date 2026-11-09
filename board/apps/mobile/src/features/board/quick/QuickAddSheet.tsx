import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native'
import { CHANGED_TEXT, DRAFT_KEPT_TEXT, resultText, type CasTarget } from '@direction-board/contracts/slot-store'
import { discardBothNote, draftAfterDoneNote, planDiscardBoth, runDiscardBoth } from './discardBoth'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { normTitle, type PropType } from '@direction-board/contracts'
import { captureHints, captureText } from '@direction-board/contracts/capture'
import { assertNever, findSameOpen, parseQuick, type Draft, type DraftProp } from '@direction-board/contracts/quick-add'
import { long, parse, quick } from '@direction-board/contracts/when'
import { useBoardState } from '../../../api/board'
import type { RootParams } from '../../../navigation/routes'
import { showActions } from '../../../ui/actions'
import { Button } from '../../../ui/Button'
import { Chip } from '../../../ui/Chip'
import { useToast } from '../../../ui/Toast'
import { colors, schemeColors, space, styles } from '../../../ui/theme'
import { openRef } from '../open'
import { Dot, useCurrentBoard } from '../parts'
import { personalOnly } from '../rules'
import { ParsedChips, SameWarning } from './QuickAddBar'
import { confirmDiscard, createdText, stepFailureText, takeSheet, useCreateWork } from './create'
import { usePendingSlot } from './pendingSlot'
import { EditConflictNotice, EditSaveNotice, SlotIssueNotice } from './SlotIssueNotice'
import { closeGuard, inputLocked, inputReady, LOADING_TEXT, restoreSource, retryLabel, SAVE_FAILED, slotFor, targetProblem, type QuickEdit } from './recovery'
import { useEditSlot } from './editSlot'
import { useCaptures } from './useCaptures'

const PROP_TYPES: [PropType, string][] = [['text', '글'], ['number', '숫자'], ['date', '날짜'], ['checkbox', '체크'], ['url', '링크'], ['select', '선택'], ['list', '목록']]

/** 빠른 추가 상세 시트(웹 quick-add-sheet.tsx). 제목이 먼저, 노트·날짜·영역·태그·속성은 아래. 추가는 쓴 그대로, ✦ 는 AI에게 */
export function QuickAddSheet({ navigation, route }: NativeStackScreenProps<RootParams, 'QuickAdd'>) {
  const req = useRef(takeSheet()).current
  const initial = req?.draft ?? null
  const board = useBoardState()
  const { current, ready: currentReady, issue: boardIssue } = useCurrentBoard()
  const { center, available, issue: captureIssue } = useCaptures()
  const create = useCreateWork()
  const toast = useToast()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  // 대상(판·목표·공간, 리뷰 18): 연 쪽이 넘긴 것으로 시작하고, 복원한 기록·편집 초안의 대상을 그대로 적용해요(보고 있는 판으로 바뀌지 않게)
  const [tgt, setTgt] = useState<{ boardId: string | null; goalId: string | null; space: string | null }>(() => ({ boardId: initial?.boardId ?? null, goalId: initial?.goalId ?? null, space: initial?.space ?? null }))
  const target = tgt.boardId ? board.data?.boards.find((b) => b.id === tgt.boardId) : current
  const boardId = target?.id
  // 자리 = 시트 + 지금 대상(판·목표·공간, 리뷰 20 — 웹과 같은 구조). 개인 목표에서 쓴 초안은 회사 판 시트에 나타나지 않아요.
  // 대상은 연 쪽·복원한 기록의 판, 없으면 보고 있는 판 — 그 판(기기에 고른 판)을 다 읽기 전에는 복원하지 않아요(targetReady)
  const slotName = slotFor('sheet', { boardId: boardId ?? null, goalId: tgt.goalId, space: tgt.space })
  const targetReady = tgt.boardId ? !!board.data : currentReady
  const docs = personalOnly(target) // 회사 판 항목은 문서 색인 밖이라 태그·속성을 못 붙여요
  const [title, setTitle] = useState(initial?.title ?? req?.text ?? route.params?.text ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [kind, setKind] = useState<'todo' | 'goal'>(initial?.kind ?? 'todo')
  const [atPick, setAtPick] = useState<string | null | undefined>(initial?.at ?? undefined) // undefined: 제목에서 알아본 것
  const [atText, setAtText] = useState('')
  const [areaPick, setAreaPick] = useState<string | null | undefined>(initial?.areaId ?? undefined)
  const [tags, setTags] = useState<string[]>(initial?.tags ?? [])
  const [tagText, setTagText] = useState('')
  const [props, setProps] = useState<DraftProp[]>(initial?.props ?? [])
  const [busy, setBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  // 실패 기록(recovery.ts): 시작 범위·초안·id·단계를 범위별 기기 저장의 시트 자리에 둬요 — 시트를 닫거나 앱을 다시 열어도 같은 기록으로 이어가요.
  // 결과 불명·부분 완료면 내용을 고정해 같은 초안으로만 이어요
  // 지우는 길은 끝(done)과 사람의 버리기(확인창)뿐 — 닫기·뒤로·끌어내림은 기록을 그대로 둬요(리뷰 16)
  const slot = usePendingSlot(slotName)
  const { pending: failure, ready: failureReady, issue: slotIssue, writeAhead } = slot
  // 편집 중 초안(리뷰 17): 제출 기록과 따로 두고 짧은 지연·닫기·앱이 뒤로 갈 때 저장해요. 다시 열면 편집 초안이 먼저(잠긴 기록이면 기록의 초안)
  const edit = useEditSlot(slotName)
  const frozen = inputLocked(failure) ? (failure?.draft ?? null) : null
  // 규칙 C(리뷰 21): 대상(고른 판·판 목록)·그 자리의 기록·편집 초안을 다 읽어 복원한 뒤에만 입력·제출 — 그 전에는 칸 전체를 막아요(복원이 입력을 덮을 길이 없게)
  const [restoredDone, setRestoredDone] = useState(false)
  const prepared = inputReady({ scope: true, target: targetReady && !!boardId, record: slot.loaded, edit: edit.ready, restored: restoredDone })
  const locked = busy || !!frozen || !prepared

  const parsed = title.trim() ? parseQuick(title, target?.areas ?? [], (t) => parse(t), docs) : null
  const at = atPick !== undefined ? atPick : (parsed?.at ?? null)
  const areaId = areaPick !== undefined ? areaPick : (parsed?.area?.id ?? null)
  const allTags = docs ? [...new Set([...(parsed?.tags ?? []), ...tags])] : []
  const same = parsed && boardId && !failure ? findSameOpen(board.data?.items ?? [], boardId, parsed.title) : null
  // 대상(판·목표)을 지금 범위에서 찾을 수 없으면 제출을 막고 안내(버리기는 열어 둬요)
  const targetIssue = targetProblem({ boardId: tgt.boardId ?? boardId ?? null, goalId: tgt.goalId }, board.data?.boards ?? null, board.data?.items ?? null)
  const ready = prepared && !!boardId && targetReady && !!parsed?.title && !busy && failureReady && !targetIssue
  const addTag = () => {
    const t = tagText.replace(/^#/, '').trim()
    if (t && !allTags.some((x) => normTitle(x) === normTitle(t))) setTags((v) => [...v, t])
    setTagText('')
  }
  const current_ = (): Draft | null => {
    if (!boardId || !parsed) return null
    const typed = tagText.replace(/^#/, '').trim()
    const tagsNow = docs && typed && !allTags.some((x) => normTitle(x) === normTitle(typed)) ? [...allTags, typed] : allTags
    // 목표에 붙일 할 일이면 목표의 공간도 같이(goalTodoDraft 가 담아 둔 것)
    return { boardId, kind, title: parsed.title, at, areaId, ...(tgt.goalId && kind === 'todo' ? { goalId: tgt.goalId } : {}), ...(tgt.space ? { space: tgt.space as Draft['space'] } : {}), tags: tagsNow, note, props: docs ? props : [] }
  }
  // 저장에서(남은 기록·편집 초안) 복원한 시트면, 끝나도 이번에 연 쪽(AI 정리 칩 등)의 onCreated 는 부르지 않아요(다른 추가를 지우지 않게)
  const fromStore = useRef(false)
  // 끝나면(추가·AI에게 맡김) 쓰던 초안은 제출할 때의 원문일 때만 비워요(PR #43 리뷰 3) — 그사이 바뀌었으면 남겨요
  const done = async (ai: boolean, draftTarget: CasTarget<string> | null) => {
    const cleared = await edit.applyClear(draftTarget)
    const kept = draftAfterDoneNote(cleared.r, '기기의 쓰던 초안을 지우지 못했어요 · 다음에 열면 다시 보일 수 있어요')
    if (kept) toast(kept)
    if (ai || !fromStore.current) req?.onCreated?.()
    navigation.goBack()
  }
  const submit = async () => {
    if (!ready || !boardId || !parsed) return
    const key = normTitle(parsed.title)
    if (same && confirm !== key) return setConfirm(key)
    const draft = frozen ?? current_()
    if (!draft) return
    setBusy(true)
    try {
      const draftTarget = await edit.planClear()
      // 잠긴 기록(결과 불명·부분 완료)이면 그 기록의 시작 범위·초안·id 로만 이어요. 항목이 확실히 거절된 실패면 고친 초안으로 새로
      const r = await create('', () => draft, inputLocked(failure) ? failure : null, writeAhead)
      switch (r.kind) {
        case 'other-scope':
        case 'not-sent':
          return toast(r.message)
        case 'pending':
          // differs·conflict·결과 불명·실패는 끝이 아니에요: 시트·기록·아직 안 보낸 노트를 그대로 두고 사람이 고르게(리뷰 15)
          if (r.note) toast(r.note)
          if (!(await slot.keep(r.pending))) toast(SAVE_FAILED)
          return
        case 'done': {
          slot.done(r.result)
          failureRef.current = null // 곧 닫아요: 지운 기록으로 닫기 확인이 뜨지 않게
          const ref = r.result.ref
          toast(`${createdText(r.result)} · ${r.draft.title}`, { label: '열기', onPress: () => openRef(navigation, ref) })
          return done(false, draftTarget)
        }
        default:
          return assertNever(r)
      }
    } finally {
      setBusy(false)
    }
  }
  const aiReady = available && docs && ready && !failure && !!center
  const askAi = async () => {
    const d = current_()
    if (!aiReady || !d || !center) return
    setBusy(true)
    setAiError(null)
    try {
      const draftTarget = await edit.planClear()
      // 원문은 사람이 쓴 제목 그대로(날짜·#말 포함)와 노트. 실패하면 이 초안 전체로 시트를 다시 열어요
      const r = await center.start(captureText(title, note), { ...d, title: title.trim() }, captureHints(d, target?.areas ?? []))
      if (!r.ok) return setAiError(r.error)
      if (r.unsent) toast('AI에게 보냈는지 확인하지 못했어요 · 홈의 칩에서 확인해요(초안은 칩에 남아 있어요)')
      void done(true, draftTarget)
    } finally {
      setBusy(false)
    }
  }
  useLayoutEffect(() => {
    navigation.setOptions({
      title: '빠른 추가',
      headerLeft: () => (
        <Pressable accessibilityRole="button" hitSlop={10} onPress={() => navigation.goBack()}>
          <Text style={s.headText}>{inputLocked(failure) ? '닫기' : '취소'}</Text>
        </Pressable>
      ),
    })
  }, [navigation, failure])
  // 남아 있던 기록·편집 초안(앞서 닫았거나 앱을 다시 연 경우)을 칸에 다시 보여요 — 편집 초안이 먼저, 잠긴 기록이면 고정된 초안(계약 restoreSource)
  const restored = useRef(false)
  const [restoredEdit, setRestoredEdit] = useState(false)
  useEffect(() => {
    if (!targetReady || !boardId || !slot.loaded || !edit.ready || restored.current) return
    restored.current = true
    setRestoredDone(true)
    const src = restoreSource(failure, edit.initial)
    if (!src) return
    fromStore.current = true
    if (src.from === 'record') {
      const d = src.draft
      const t = { boardId: d.boardId, goalId: d.goalId ?? null, space: d.space ?? null }
      setTgt(t)
      // 복원은 프로그램 변경(리뷰 5 P2): 기록의 대상 그대로의 값을 기기와 맞춘 값으로 — 자동 저장이 다시 쓰지 않아요
      setFieldsByProgram({ title: d.title, note: d.note, kind: d.kind, atPick: d.at, areaPick: d.areaId, tags: d.tags, props: d.props }, t)
      return
    }
    const e = src.edit
    setTgt((t) => ({ boardId: e.boardId ?? t.boardId, goalId: e.goalId ?? null, space: e.space ?? null }))
    setRestoredEdit(true)
    // 복원은 기기 값 그대로(규칙 G — 자동 저장이 다시 쓰지 않아요): 기기에 있던 그 초안을 맞춘 값으로
    setFieldsByProgram({ title: e.text, note: e.note ?? '', kind: e.kind ?? 'todo', atPick: e.at, areaPick: e.areaId, tags: e.tags ?? [], props: (e.props ?? []) as DraftProp[] }, undefined, e)
  }, [targetReady, boardId, slot.loaded, edit.ready, failure, edit.initial])
  // 칸 묶음 → 편집 초안(자동 저장과 프로그램 변경이 같은 모양을 써요)
  type Fields = { title: string; note: string; kind: 'todo' | 'goal'; atPick: string | null | undefined; areaPick: string | null | undefined; tags: string[]; props: DraftProp[] }
  type Target = { boardId: string | null; goalId: string | null; space: string | null }
  const editOfFields = (f: Fields, t: Target = { boardId: boardId ?? null, goalId: tgt.goalId, space: tgt.space }): QuickEdit => ({ text: f.title, note: f.note, kind: f.kind, ...(f.atPick !== undefined ? { at: f.atPick } : {}), ...(f.areaPick !== undefined ? { areaId: f.areaPick } : {}), tags: f.tags, props: f.props, ...(t.boardId ? { boardId: t.boardId } : {}), ...(t.goalId ? { goalId: t.goalId } : {}), ...(t.space ? { space: t.space } : {}) })
  /**
   * 규칙 G(PR #43 리뷰 4·5): 프로그램이 칸을 바꿀 때는 이것으로만(복원·되돌리기·바뀜 채우기) — 그 값을 기기와 맞춘 값으로 기록해 자동 저장이 사람 편집처럼 쓰지 않아요.
   * t: 복원한 기록의 대상(아직 그려지기 전), adoptAs: 기기에 있던 그 초안 그대로(편집 초안 복원)
   */
  const setFieldsByProgram = (f: Fields, t?: Target, adoptAs?: QuickEdit) => {
    setTitle(f.title)
    setNote(f.note)
    setKind(f.kind)
    setAtPick(f.atPick)
    setAreaPick(f.areaPick)
    setTags(f.tags)
    setProps(f.props)
    edit.adopt(adoptAs ?? editOfFields(f, t))
  }
  // 쓰는 대로 편집 초안에 남겨요(복원 전·잠긴 동안은 남기지 않아요 — 잠긴 동안은 편집할 수 없어요).
  // 복원이 끝난 순간에도 한 번(리뷰 5 P1-3): 넘겨받은 글(route.params.text·연 쪽의 글)은 기기에 없는 사람 글이라 더 입력하지 않아도 바로 저장 예약 —
  // 저장에서 복원한 칸은 맞춘 값이라 다시 쓰지 않아요
  useEffect(() => {
    if (!restored.current || frozen) return
    edit.change(editOfFields({ title, note, kind, atPick, areaPick, tags, props }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 칸이 바뀔 때만
  }, [title, note, kind, atPick, areaPick, tags, props, !!frozen, restoredEdit, restoredDone])
  // 버린 뒤에는 칸을 이번에 넘긴 글·초안으로 되돌려요(버린 내용이 편집 초안으로 다시 남지 않게)
  const resetFields = () => {
    setRestoredEdit(false)
    setFieldsByProgram({ title: initial?.title ?? req?.text ?? '', note: initial?.note ?? '', kind: initial?.kind ?? 'todo', atPick: initial?.at ?? undefined, areaPick: initial?.areaId ?? undefined, tags: initial?.tags ?? [], props: initial?.props ?? [] })
  }
  // 그사이 바뀐 쓰던 초안을 칸에 보여요(대상은 그대로 — 남겨 둔 초안의 글만)
  const fillFromEdit = (e: QuickEdit) => setFieldsByProgram({ title: e.text, note: e.note ?? '', kind: e.kind ?? 'todo', atPick: e.at, areaPick: e.areaId, tags: e.tags ?? [], props: (e.props ?? []) as DraftProp[] })
  // 쓰던 초안 버리기(PR #43 리뷰 3): 확인창을 띄울 때 지금 원문을 전제로, 확인 뒤 비교-후-쓰기
  const clearDraft = async () => {
    const target = await edit.planClear()
    if (!target) return resetFields()
    confirmDiscard(
      () =>
        void edit.applyClear(target).then((c) => {
          if (c.r === 'done') return resetFields()
          if (c.r === 'changed' && c.now) fillFromEdit(c.now)
          toast(c.r === 'changed' ? DRAFT_KEPT_TEXT : (resultText(c.r, SAVE_FAILED) ?? SAVE_FAILED))
        }),
      '이 자리의 쓰던 초안을 버려요 · 되살릴 수 없어요.',
    )
  }
  // 남은 기록 버리기(PR #43 리뷰 3): 기록·쓰던 초안 두 대상을 각자 전제와 함께, 확인창에 둘 다. after(kept): 기록이 지워졌을 때 할 일 —
  // kept = 쓰던 초안이 그사이 바뀌어 남겨 둠(칸에 그 글을 채웠으니 되돌리지 않아요 — 리뷰 4 P1-1)
  const askDiscard = async (ed: typeof edit, after: (kept: boolean) => void) => {
    const plan = await planDiscardBoth(slot, ed)
    if (!plan) return toast(CHANGED_TEXT)
    confirmDiscard(
      () =>
        void runDiscardBoth(slot, ed, plan).then((x) => {
          if (x.draft === 'changed' && x.now) fillFromEdit(x.now)
          const note = discardBothNote(x)
          if (note) toast(note)
          if (x.record === 'done') after(x.draft === 'changed')
        }),
      plan.message,
    )
  }
  // 닫기·끌어내림·뒤로: 기록이 있으면 결과 종류와 무관하게 확인(리뷰 16) — 계속 쓰기 / 닫기(기록 남김) / 버리기(확인창). 닫기는 아무것도 지우지 않아요.
  // 규칙 D(리뷰 21): 쓰던 초안이 기기에 닿지 않았으면 먼저 저장하고, 저장하지 못하면 닫지 않아요(저장하지 않고 닫기는 사람이 확인창으로)
  const failureRef = useRef(failure)
  failureRef.current = failure
  const editRef = useRef(edit)
  editRef.current = edit
  const askRef = useRef(askDiscard)
  askRef.current = askDiscard
  const leaving = useRef(false)
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (leaving.current) return
        const p = failureRef.current
        const message = p ? closeGuard(p) : null
        const ed = editRef.current
        if (!message && !ed.unsaved()) return
        e.preventDefault()
        const leave = () => {
          leaving.current = true
          navigation.dispatch(e.data.action)
        }
        const ask = () => {
          if (!message) return leave()
          Alert.alert('빠른 추가', message, [
            { text: '계속 쓰기', style: 'cancel' },
            { text: '닫기(기록 남김)', onPress: leave },
            { text: '버리기', style: 'destructive', onPress: () => void askRef.current(editRef.current, () => { failureRef.current = null; leave() }) },
          ])
        }
        void ed.flush().then((ok) => {
          if (ok) return ask()
          Alert.alert('빠른 추가', `${SAVE_FAILED} · 닫지 않았어요`, [
            { text: '계속 쓰기', style: 'cancel' },
            { text: '저장하지 않고 닫기', style: 'destructive', onPress: () => Alert.alert('저장하지 않고 닫을까요?', '쓰던 초안이 기기에 남지 않아요.', [{ text: '취소', style: 'cancel' }, { text: '닫기', style: 'destructive', onPress: ask }]) },
          ])
        })
      }),
    [navigation, slot, toast],
  )
  const input = (extra?: object) => [styles.input, extra]
  const field = (label: string, child: React.ReactNode) => (
    <View style={s.field} accessibilityLabel={label}>
      <Text style={s.label}>{label}</Text>
      {child}
    </View>
  )
  return (
    <ScrollView style={styles.page} contentContainerStyle={[styles.content, s.content]} automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
      <View style={s.field}>
        <TextInput autoFocus editable={!locked} value={title} onChangeText={(v) => { setTitle(v); setConfirm(null) }} onSubmitEditing={() => void submit()} submitBehavior="submit" returnKeyType="done" placeholder={!prepared ? LOADING_TEXT : kind === 'goal' ? '목표' : '할 일'} placeholderTextColor={c.muted} accessibilityLabel="제목" style={input(s.title)} />
        <ParsedChips parsed={parsed} />
      </View>
      <TextInput editable={!locked} value={note} onChangeText={setNote} multiline placeholder="노트" placeholderTextColor={c.muted} accessibilityLabel="노트" style={input(s.note)} />
      {field('종류', (
        <View style={s.chips}>
          <Chip label="할 일" selected={kind === 'todo'} onPress={locked ? undefined : () => setKind('todo')} />
          <Chip label="목표" selected={kind === 'goal'} onPress={locked ? undefined : () => setKind('goal')} />
        </View>
      ))}
      {field(kind === 'goal' ? '마감' : '알림', (
        <View style={s.gap}>
          <View style={s.chips}>
            {kind === 'todo' ? quick().map((q) => <Chip key={q.k} label={q.label} selected={at === q.at} onPress={locked ? undefined : () => setAtPick(q.at)} />) : null}
            {at ? <Chip label={`${long(kind === 'goal' ? at.slice(0, 10) : at)} ✕`} selected onPress={locked ? undefined : () => setAtPick(null)} /> : null}
          </View>
          <TextInput
            editable={!locked}
            value={atText}
            onChangeText={(v) => { setAtText(v); const p = parse(v); if (p) setAtPick(kind === 'goal' ? p.at.slice(0, 10) : p.at) }}
            placeholder={kind === 'goal' ? '예: 12월 3일, 다음 주 금요일' : '예: 내일 3시, 금요일 저녁'}
            placeholderTextColor={c.muted}
            accessibilityLabel={kind === 'goal' ? '마감일을 글로' : '알림 시각을 글로'}
            style={input()}
          />
        </View>
      ))}
      {target?.areas.length ? field('영역', (
        <View style={s.chips}>
          {target.areas.map((a) => (
            <Pressable key={a.id} accessibilityRole="button" accessibilityState={{ selected: areaId === a.id }} disabled={locked} onPress={() => setAreaPick(areaId === a.id ? null : a.id)} style={s.areaChip}>
              <Chip label={a.name} selected={areaId === a.id} />
              <View style={s.areaDot}><Dot color={a.color} /></View>
            </Pressable>
          ))}
        </View>
      )) : null}
      {docs ? field('태그', (
        <View style={s.gap}>
          <View style={s.chips}>
            {allTags.map((t) => <Chip key={t} label={tags.includes(t) ? `#${t} ✕` : `#${t}`} onPress={!locked && tags.includes(t) ? () => setTags((v) => v.filter((x) => x !== t)) : undefined} />)}
          </View>
          <TextInput editable={!locked} value={tagText} onChangeText={setTagText} onSubmitEditing={addTag} onBlur={addTag} submitBehavior="submit" returnKeyType="done" placeholder="태그" placeholderTextColor={c.muted} accessibilityLabel="태그 추가" style={input()} />
        </View>
      )) : null}
      {docs ? field('속성', (
        <View style={s.gap}>
          {props.map((p, i) => {
            const set = (patch: Partial<DraftProp>) => setProps((v) => v.map((x, j) => (j === i ? { ...x, ...patch } : x)))
            return (
              <View key={i} style={s.prop}>
                <TextInput editable={!locked} value={p.key} onChangeText={(key) => set({ key })} placeholder="이름" placeholderTextColor={c.muted} accessibilityLabel="속성 이름" style={input(s.propKey)} />
                <Chip label={PROP_TYPES.find(([t]) => t === p.type)?.[1] ?? p.type} onPress={locked ? undefined : () => showActions(PROP_TYPES.map(([t, l]) => ({ label: l, onPress: () => set({ type: t, value: '' }) })), '속성 종류')} />
                {p.type === 'checkbox' ? (
                  <Chip label={p.value === 'true' ? '예' : '아니요'} selected={p.value === 'true'} onPress={locked ? undefined : () => set({ value: p.value === 'true' ? 'false' : 'true' })} />
                ) : (
                  <TextInput editable={!locked} value={p.value} onChangeText={(value) => set({ value })} keyboardType={p.type === 'number' ? 'decimal-pad' : p.type === 'url' ? 'url' : 'default'} autoCapitalize="none" placeholder={p.type === 'list' ? '쉼표로 나눠요' : p.type === 'date' ? 'YYYY-MM-DD' : '값'} placeholderTextColor={c.muted} accessibilityLabel="속성 값" style={input(s.propValue)} />
                )}
                <Chip label="빼기" onPress={locked ? undefined : () => setProps((v) => v.filter((_, j) => j !== i))} />
              </View>
            )
          })}
          <Chip label="속성 추가" onPress={locked ? undefined : () => setProps((v) => [...v, { key: '', type: 'text', value: '' }])} />
        </View>
      )) : <Text style={styles.small}>회사 판 일은 태그·속성을 붙이지 않아요</Text>}
      <View style={s.gap}>
        {/* 규칙 E(리뷰 22): 지금 판·기록·쓰던 초안을 읽지 못했거나 판 목록이 늦으면 원인과 다시 읽기(·버리고 새로) */}
        <SlotIssueNotice issue={boardIssue} />
        <SlotIssueNotice issue={slotIssue} />
        <SlotIssueNotice issue={edit.issue} />
        <EditSaveNotice edit={edit} />
        <EditConflictNotice edit={edit} onLoad={(e) => (e ? fillFromEdit(e) : resetFields())} />
        <SlotIssueNotice issue={captureIssue} />
        {targetIssue ? <Text accessibilityRole="alert" style={[styles.meta, s.error]}>{targetIssue}</Text> : null}
        {failure ? (
          <>
            <Text accessibilityRole="alert" style={[styles.meta, s.error]}>{stepFailureText(failure)}{inputLocked(failure) ? ' · 결과를 확인할 때까지 내용은 고정돼요' : ''}</Text>
            {/* 사람이 고르게(리뷰 10): 이미 저장된 할 일 열기, 위 단추로 확인·보내기, 기록 버리기(확인창) */}
            <View style={s.chips}>
              {failure.ref ? <Chip label="열기" onPress={() => openRef(navigation, failure.ref ?? '')} /> : null}
              <Chip label="버리기" onPress={busy ? undefined : () => void askDiscard(edit, (kept) => { failureRef.current = null; if (!kept) resetFields() })} />
            </View>
          </>
        ) : restoredEdit ? (
          <View style={s.chips}>
            <Text style={styles.small}>쓰던 초안을 이어서 보여 줘요</Text>
            <Chip label="쓰던 초안 버리기" onPress={busy ? undefined : () => void clearDraft()} />
          </View>
        ) : aiError ? (
          <Text accessibilityRole="alert" style={[styles.meta, s.error]}>AI에게 맡기지 못했어요 · {aiError}</Text>
        ) : same ? (
          <SameWarning same={same} confirmed={confirm === normTitle(parsed?.title ?? '')} onOpen={() => openRef(navigation, `item:${same.boardId}:${same.id}`)} />
        ) : null}
        <Button title={busy ? '하는 중…' : failure ? retryLabel(failure) : same && confirm ? '그래도 추가' : '추가'} disabled={!ready} onPress={() => void submit()} />
        {available && docs ? <Button title="✦ AI로 정리해서 올리기" variant="outline" disabled={!aiReady} onPress={() => void askAi()} /> : null}
        {!docs ? <Text style={styles.small}>AI 추가는 개인 판에 올려요. 개인 판에서 써 주세요</Text> : null}
      </View>
    </ScrollView>
  )
}
const s = StyleSheet.create({
  content: { paddingTop: space.lg, paddingBottom: 48, gap: space.lg },
  headText: { color: colors.ink, fontSize: 17 },
  field: { gap: space.sm },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '600' },
  note: { minHeight: 96, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  gap: { gap: space.sm },
  areaChip: { flexDirection: 'row', alignItems: 'center' },
  areaDot: { marginLeft: -space.xs },
  prop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  propKey: { width: 110 },
  propValue: { flex: 1, minWidth: 120 },
  error: { color: colors.decide },
})
