import React, { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native'
import type { QuickEdit } from '@direction-board/contracts/quick-recovery'
import { CHANGED_TEXT } from '@direction-board/contracts/slot-store'
import { discardBothNote, draftAfterDoneNote, planDiscardBoth, runDiscardBoth } from './discardBoth'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { SymbolView } from 'expo-symbols'
import { normTitle, type Item, type Signal } from '@direction-board/contracts'
import { activeSame, captureHints, hiddenFailures, lastFinishedRun, type CaptureEntry } from '@direction-board/contracts/capture'
import { assertNever, findSameOpen, parseQuick, type Draft, type Parsed } from '@direction-board/contracts/quick-add'
import { long, parse } from '@direction-board/contracts/when'
import { useBoardState } from '../../../api/board'
import { workApi } from '../../../api/work'
import { useServer } from '../../../server'
import type { RootParams, StackParams } from '../../../navigation/routes'
import { Chip } from '../../../ui/Chip'
import { useToast } from '../../../ui/Toast'
import { colors, schemeColors, space, styles } from '../../../ui/theme'
import { openRef } from '../open'
import { useCurrentBoard } from '../parts'
import { personalOnly } from '../rules'
import { CaptureTray } from './CaptureTray'
import { confirmDiscard, createdText, requestSheet, stepFailureText, useCreateWork } from './create'
import { usePendingSlot } from './pendingSlot'
import { useEditSlot } from './editSlot'
import { EditConflictNotice, EditSaveNotice, SlotIssueNotice } from './SlotIssueNotice'
import { aiAllowed, inputLocked, inputReady, LOADING_TEXT, retryLabel, SAVE_FAILED, slotFor } from './recovery'
import { useCaptures } from './useCaptures'

type Nav = NativeStackNavigationProp<StackParams & RootParams>

/** 알아본 날짜·영역·태그 칩(웹 ParsedChips) */
export function ParsedChips({ parsed }: { parsed: Parsed | null }) {
  if (!parsed || (!parsed.at && !parsed.area && !parsed.tags.length)) return null
  return (
    <View style={s.chips} accessibilityLabel="알아본 것">
      {parsed.at ? <Chip label={long(parsed.at)} /> : null}
      {parsed.area ? <Chip label={parsed.area.name} /> : null}
      {parsed.tags.map((t) => <Chip key={t} label={`#${t}`} />)}
    </View>
  )
}

/** 같은 제목의 열린 일 경고(웹 SameWarning). 한 번 더 누르면 추가해요 */
export function SameWarning({ same, confirmed, onOpen }: { same: Item; confirmed: boolean; onOpen: () => void }) {
  const title = (same.text || '').split('\n')[0]
  return (
    <View style={s.chips} accessibilityRole="text">
      <Text style={styles.meta}>같은 일이 열려 있어요{title ? ` · ${title}` : ''}{confirmed ? ' · 한 번 더 누르면 추가해요' : ''}</Text>
      <Chip label="열기" onPress={onOpen} />
    </View>
  )
}

/** 결정 칸에서 숨길 사건: 트레이에 보이는 AI 정리 실패와 같은 것(웹 home.tsx:47-60) */
export function useHiddenFailures(signals: Signal[]): Set<string> {
  const { origin } = useServer()
  const { center } = useCaptures()
  const shown = (center?.visible() ?? []).map((e) => ({ run: center?.views[e.id]?.run })).filter((x) => x.run?.status === 'error')
  const key = shown.map((x) => x.run?.id).join(',')
  const [last, setLast] = useState<Record<string, string | null>>({})
  useEffect(() => {
    for (const { run } of shown) {
      if (!run || run.id in last) continue
      // 목록을 못 받으면 기록하지 않아요: 그러면 숨기지 않고 결정 칸에 그대로 보여요
      workApi.runsInThread(origin, run.thread || run.id).then((r) => setLast((m) => ({ ...m, [run.id]: lastFinishedRun(r.runs) })), () => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 보이는 실패 실행이 바뀔 때만 물어요
  }, [key, origin])
  return useMemo(() => {
    const lastFinished = Object.fromEntries(shown.flatMap(({ run }) => (run ? [[run.thread || run.id, last[run.id]]] : [])))
    return hiddenFailures(signals, shown, lastFinished)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, key, last])
}

/** 한 줄 + ✦ + ＋ (웹 QuickAddBar). Enter 는 바로 할 일, ✦ 는 AI에게 맡기기, ＋ 는 쓰던 글을 상세 시트로 */
/** 입력 상태는 대상 키로만(리뷰 18): 판이 바뀌면 다시 그려 쓰던 글이 다른 판으로 넘어가지 않아요. 범위(계정)가 바뀌면 화면 나무 전체를 다시 그려요(api/query.ts) */
export function QuickAddBar() {
  const { current, ready } = useCurrentBoard()
  const slotName = slotFor('bar', { boardId: current?.id ?? null })
  // 보고 있는 판(기기에 고른 판·판 목록)을 다 읽기 전에는 대상이 바뀔 수 있어 입력을 막아요(규칙 C, 리뷰 21)
  return <QuickAddBarIn key={slotName} slotName={slotName} targetReady={ready} />
}

function QuickAddBarIn({ slotName, targetReady }: { slotName: string; targetReady: boolean }) {
  const navigation = useNavigation<Nav>()
  const board = useBoardState()
  const { current, issue: boardIssue } = useCurrentBoard()
  const { center, available, issue: captureIssue } = useCaptures()
  const create = useCreateWork()
  const toast = useToast()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  // 실패 기록(recovery.ts): 시작 범위·초안·id 를 범위별 기기 저장의 한 줄 자리에 둬요(앱을 다시 열어도 이어가요).
  // 결과 불명·부분 완료면 입력을 잠그고 그 기록으로만 이어요(시작 범위에서만). 기록이 있는 동안 ✦ 는 막아요.
  // 기록을 지우는 길은 끝(done)과 사람의 버리기(확인창)뿐이에요(리뷰 16)
  const slot = usePendingSlot(slotName)
  const { pending, ready: pendingReady, issue: slotIssue, writeAhead } = slot
  const locked = inputLocked(pending)
  // 편집 중 글(리뷰 17): 앱을 다시 열어도 쓰던 글이 남아요. 잠긴 기록이면 기록의 글로만
  const edit = useEditSlot(slotName)
  // 복원은 대상·기록·편집 초안을 다 읽은 뒤 한 번만, 그 전에는 입력을 막아요(규칙 C — 복원이 입력을 덮을 길이 없게)
  const [restored, setRestored] = useState(false)
  // 규칙 G(PR #43 리뷰 4): 프로그램이 칸을 바꿀 때는 이것으로만 — 그 값을 기기와 맞춘 값으로 기록해 자동 저장이 사람 편집처럼 쓰지 않아요
  const editOf = (t: string): QuickEdit => ({ text: t, ...(current?.id ? { boardId: current.id } : {}) })
  const setByProgram = (t: string) => {
    setText(t)
    edit.adopt(editOf(t))
  }
  useEffect(() => {
    if (restored || !targetReady || !edit.ready || !slot.loaded) return
    const t = locked ? pending?.text : (edit.initial?.text ?? pending?.text)
    if (t && !text) setByProgram(t)
    setRestored(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 처음 다 읽었을 때만
  }, [targetReady, edit.ready, slot.loaded])
  const ready = inputReady({ scope: true, target: targetReady && !!current, record: slot.loaded, edit: edit.ready, restored })
  useEffect(() => {
    if (restored && !locked) edit.change(editOf(text))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 글이 바뀔 때만
  }, [text, locked])
  const boardId = current?.id
  const personal = personalOnly(current)
  const items = board.data?.items ?? []
  const parsed = text.trim() ? parseQuick(text, current?.areas ?? [], (t) => parse(t), personal) : null
  const retrying = !!pending && (locked || pending.text === text)
  const same = parsed && boardId && !retrying ? findSameOpen(items, boardId, parsed.title) : null
  const aiSame = text.trim() && center ? activeSame(center.entries, center.phases, text) : null
  const aiReady = ready && available && personal && !!boardId && !!text.trim() && !busy && !aiBusy && !aiSame && !!center && pendingReady && aiAllowed(pending)
  const open = (ref: string) => openRef(navigation, ref)

  const submit = async () => {
    if (!ready || !boardId || !parsed || busy || !pendingReady) return
    const key = normTitle(parsed.title)
    if (same && confirm !== key) return setConfirm(key)
    setBusy(true)
    try {
      // 제출한 초안 원문이 전제(PR #43 리뷰 3): 끝나면 그 원문일 때만 쓰던 글을 비워요
      const draftTarget = await edit.planClear()
      const r = await create(text, (): Draft => ({ boardId, kind: 'todo', title: parsed.title, at: parsed.at, areaId: parsed.area?.id ?? null, tags: parsed.tags, note: '', props: [] }), pending, writeAhead)
      switch (r.kind) {
        case 'other-scope':
        case 'not-sent':
          return toast(r.message)
        case 'pending':
          if (r.note) toast(r.note)
          if (!(await slot.keep(r.pending))) toast(SAVE_FAILED)
          return
        case 'done': {
          // 끝(done)일 때만 칸·기록을 비워요(리뷰 15)
          setConfirm(null)
          const cleared = await edit.applyClear(draftTarget)
          // 그사이 바뀐 쓰던 글은 남기고 그 글을 보여요
          setByProgram(cleared.r === 'changed' ? (cleared.now?.text ?? '') : '')
          const kept = draftAfterDoneNote(cleared.r, '추가했어요 · 기기의 쓰던 글을 지우지 못했어요')
          if (kept) toast(kept)
          slot.done(r.result)
          const ref = r.result.ref
          return toast(`${createdText(r.result)} · ${r.draft.title}`, { label: '열기', onPress: () => open(ref) })
        }
        default:
          return assertNever(r)
      }
    } finally {
      setBusy(false)
    }
  }
  const askAi = async () => {
    if (!aiReady || !boardId || !parsed || !center || !aiAllowed(pending)) return
    const draft: Draft = { boardId, kind: 'todo', title: text.trim(), at: parsed.at, areaId: parsed.area?.id ?? null, tags: parsed.tags, note: '', props: [] }
    setAiBusy(true)
    try {
      // 넘기기 전 원문이 전제(PR #43 리뷰 4 규칙 G): 넘긴 뒤 그 원문일 때만 쓰던 글을 비우고, 그사이 바뀌었으면 남겨 칸에 그 글
      const handoff = await edit.planClear()
      const r = await center.start(text.trim(), draft, captureHints(draft, current?.areas ?? []))
      if (!r.ok) return toast(`AI에게 맡기지 못했어요 · ${r.error}`)
      if (r.unsent) toast('AI에게 보냈는지 확인하지 못했어요 · 아래 칩에서 확인해요')
      const cleared = await edit.applyClear(handoff)
      setByProgram(cleared.r === 'changed' ? (cleared.now?.text ?? '') : '')
      const kept = draftAfterDoneNote(cleared.r, 'AI에게 맡겼어요 · 기기의 쓰던 글을 지우지 못했어요')
      if (kept) toast(kept)
      setConfirm(null)
    } finally {
      setAiBusy(false)
    }
  }
  // 쓰던 글을 상세 시트로 옮기기: 이 자리에 먼저 저장된 뒤에만(규칙 D)
  const sheet = async () => {
    if (!(await edit.flush())) return toast(SAVE_FAILED)
    // 시트로 넘긴 원문이 전제: 시트에서 추가가 끝나면 그 원문일 때만 이 자리 쓰던 글을 비워요(규칙 G)
    const handoff = await edit.planClear()
    requestSheet({ text, onCreated: () => void edit.applyClear(handoff).then((c) => { setByProgram(c.r === 'changed' ? (c.now?.text ?? '') : ''); setConfirm(null) }) })
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
  const manual = (e: CaptureEntry) => {
    requestSheet({ text: e.draft ? e.draft.title : e.text, draft: e.draft ?? { boardId: boardId ?? '', kind: 'todo', title: e.text, at: null, areaId: null, tags: [], note: '', props: [] }, onCreated: () => center?.dismiss(e.id) })
    navigation.navigate('QuickAdd', { text: e.text })
  }
  // 기록이 있으면 늘 보여요(글을 고쳐도 기록·✦ 막힘의 이유가 보이게)
  const failed = pending
  const placeholder = !ready || !current ? LOADING_TEXT : current.kind === 'personal' ? '할 일 추가' : `${current.name}에 할 일 추가`
  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <TextInput
          value={text}
          editable={ready && !busy && !aiBusy && !!boardId && !locked}
          onChangeText={(v) => { setText(v); setConfirm(null) }}
          onSubmitEditing={() => void submit()}
          submitBehavior="submit"
          returnKeyType="done"
          placeholder={placeholder}
          placeholderTextColor={c.muted}
          accessibilityLabel="할 일 추가"
          accessibilityHint="Enter 로 바로 추가해요. 내일 3시, 금요일 같은 날짜와 #영역, #태그를 알아봐요"
          style={[styles.input, s.input]}
        />
        {available && personal ? (
          <Pressable accessibilityRole="button" accessibilityLabel="AI로 정리해서 올리기" accessibilityState={{ disabled: !aiReady }} disabled={!aiReady} onPress={() => void askAi()} hitSlop={6} style={[s.icon, !aiReady && s.off]}>
            <SymbolView name="sparkles" size={20} tintColor={c.ink} />
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="자세히 추가" disabled={!ready || !boardId || busy || !!failed} onPress={() => void sheet()} hitSlop={6} style={[s.icon, s.plus, (!ready || !boardId || busy || !!failed) && s.off]}>
          <SymbolView name="plus" size={20} tintColor={c.card} />
        </Pressable>
      </View>
      {/* 규칙 E(리뷰 22): 지금 판·기록·쓰던 초안·AI 정리 칩을 읽지 못했거나 판 목록이 늦으면 원인과 다시 읽기(·버리고 새로) */}
      <SlotIssueNotice issue={boardIssue} />
      <SlotIssueNotice issue={slotIssue} />
      <SlotIssueNotice issue={edit.issue} />
      <SlotIssueNotice issue={captureIssue} />
      <EditSaveNotice edit={edit} />
      <EditConflictNotice edit={edit} onLoad={(e) => setByProgram(e?.text ?? '')} />
      {failed ? (
        <View style={s.chips} accessibilityRole="alert">
          <Text style={[styles.meta, { color: colors.decide }]}>{stepFailureText(failed)}{locked ? ' · 결과를 확인할 때까지 글은 고정돼요' : ''}</Text>
          {/* 잠기면 입력칸이 Enter 를 받지 못해서 확인·다시 보내기·이어 하기는 단추로도 둬요(결과 불명이면 "확인" = 읽기만) */}
          <Chip label={busy ? '하는 중…' : retryLabel(failed)} onPress={busy ? undefined : () => void submit()} />
          {failed.ref ? <Chip label="열기" onPress={() => open(failed.ref ?? '')} /> : null}
          <Chip label="버리기" onPress={() => void askDiscard()} />
        </View>
      ) : same ? (
        <SameWarning same={same} confirmed={!!parsed && confirm === normTitle(parsed.title)} onOpen={() => open(`item:${same.boardId}:${same.id}`)} />
      ) : aiSame ? (
        <Text style={styles.small}>같은 글을 AI가 정리하고 있어요</Text>
      ) : (
        <ParsedChips parsed={parsed} />
      )}
      {center ? <CaptureTray c={center} onOpen={open} onManual={manual} /> : null}
    </View>
  )
}
const s = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: { flex: 1 },
  icon: { width: space.target, height: space.target, borderRadius: space.target / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  plus: { backgroundColor: colors.primary },
  off: { opacity: 0.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
})
