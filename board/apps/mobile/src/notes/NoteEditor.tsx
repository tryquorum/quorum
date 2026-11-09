// 노트 편집 화면(로드맵 공용 부품 표: 주인 레인 2, 레인 1 의 일 노트도 써요). 저장 규칙은 noteSaver, 초안 보관은 drafts, 허용 문법은 mdPolicy(모두 레인 0).
// useNoteDraft: 노트 원문을 받아 저장 상태 기계를 만들고(보관한 초안 복원), 입력이 멈추면 1.2초 뒤·앱이 뒤로 갈 때 저장해요.
// NoteEditor: 여러 줄 마크다운 입력 + 키보드 위 도구 줄 + 상태 줄 + 충돌·불명·합치기 띠 + 내 초안 내보내기·보관 초안.
// useNoteLeaveGuard: 저장 안 된 초안이 있으면 뒤로 가기를 막고 고르게 해요(기기 보관을 확인하지 못했으면 "두고 나가기"는 없음).
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, InputAccessoryView, Keyboard, Pressable, Share, StyleSheet, Switch, Text, TextInput, View, useColorScheme } from 'react-native'
import { useNavigation, usePreventRemove } from '@react-navigation/native'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import type { NoteSource } from '@direction-board/contracts'
import { errorMessage } from '../api/client'
import { Button } from '../ui/Button'
import { colors, schemeColors, space, styles } from '../ui/theme'
import { keepDraft, readDraft, type DraftKey } from './drafts'
import { checkMarkdown } from './mdPolicy'
import { insertBlock, leaveChoice, noteBanner, prefixLine, statusLine, wrap, type Selection } from './noteEdit'
import { NoteNotice } from './NoteNotice'
import { NoteSaver, type NoteState, type WriteNote } from './noteSaver'
import { noteEditability } from './api'

const AUTOSAVE_MS = 1200
const policy = (md: string) => {
  const r = checkMarkdown(md)
  return r.ok ? null : `${r.line}번째 줄: ${r.reason}`
}

/**
 * 노트 원문(source)이 오면 저장 상태 기계를 하나 만들어요. key.email 이 없으면 기기 보관을 하지 않고 storageOk=false.
 * 서버 노트가 바뀌어 다시 읽혔고 이 화면이 깨끗하면 새 원문으로 다시 시작해요(고치는 중이면 그대로 두고 저장 때 409 로 알아요).
 */
export function useNoteDraft({ source, draftKey, write }: { source: NoteSource | undefined; draftKey: DraftKey; write: WriteNote }) {
  const [state, setState] = useState<NoteState | null>(null)
  // 기기 보관: 입력마다 순서대로 써요. 마지막 입력의 보관이 끝나 성공했을 때만 ok(그 전엔 pending)
  const [storage, setStorage] = useState<'ok' | 'pending' | 'failed'>('ok')
  const chain = useRef<Promise<void>>(Promise.resolve())
  const seq = useRef(0)
  const saver = useRef<NoteSaver | null>(null)
  const writeRef = useRef(write)
  writeRef.current = write
  const keyText = `${draftKey.origin}|${draftKey.email}|${draftKey.ref}`
  const keyRef = useRef(draftKey)
  keyRef.current = draftKey
  const persist = useCallback((s: NoteState) => {
    const id = ++seq.current
    const key = keyRef.current
    setStorage('pending')
    chain.current = chain.current
      .then(() => keepDraft(key, s))
      .then((ok) => {
        if (id === seq.current) setStorage(ok ? 'ok' : 'failed')
      })
  }, [])
  // 계정·서버·문서가 바뀌면 처음부터
  useEffect(() => {
    saver.current = null
    setState(null)
  }, [keyText])
  useEffect(() => {
    if (!source) return
    const current = saver.current
    if (current && !(current.state.status === 'clean' && !current.state.backups.length && source.version > current.state.version)) return
    let live = true
    const editable = noteEditability(source).editable
    void (async () => {
      const restored = current ? null : await readDraft(keyRef.current)
      if (!live) return
      const s = new NoteSaver({ md: source.md, version: source.version, editable }, (md, v) => writeRef.current(md, v), (next) => {
        setState(next)
        persist(next)
      }, policy, restored)
      saver.current = s
      setState(s.state)
      if (!keyRef.current.email) setStorage('failed')
    })()
    return () => {
      live = false
    }
  }, [source, keyText, persist])
  // 입력이 멈추면 저장
  useEffect(() => {
    if (state?.status !== 'dirty') return
    const t = setTimeout(() => void saver.current?.flush(), AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [state?.draft, state?.status])
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') void saver.current?.flush()
    })
    return () => sub.remove()
  }, [])
  /** 보관한 초안을 버리고 지금 서버 노트로 다시 시작해요(사람이 확인한 뒤에만 불러요) */
  const discard = useCallback(() => {
    if (!source) return
    const s = new NoteSaver({ md: source.md, version: source.version, editable: noteEditability(source).editable }, (md, v) => writeRef.current(md, v), (next) => {
      setState(next)
      persist(next)
    }, policy)
    saver.current = s
    setState(s.state)
    persist(s.state)
  }, [source, persist])
  return { state, saver: saver.current, storageOk: storage === 'ok', discard }
}

/** 내 초안을 공유 시트로 내보내요. 보낸 것을 확인하면 true */
export async function exportDraft(text: string): Promise<boolean> {
  try {
    const r = await Share.share({ message: text })
    return r.action === Share.sharedAction
  } catch {
    return false
  }
}

type Tool = { icon: SFSymbol; label: string; run: (md: string, sel: Selection) => { md: string; sel: Selection } }
const TOOLS: Tool[] = [
  { icon: 'textformat.size', label: '제목', run: (md, sel) => prefixLine(md, sel, '## ') },
  { icon: 'list.bullet', label: '글머리', run: (md, sel) => prefixLine(md, sel, '- ') },
  { icon: 'checklist', label: '할 일', run: (md, sel) => prefixLine(md, sel, '- [ ] ') },
  { icon: 'bold', label: '굵게', run: (md, sel) => wrap(md, sel, '**') },
  { icon: 'link', label: '[[링크]]', run: (md, sel) => wrap(md, sel, '[[', ']]') },
]

/**
 * 편집 화면 본체. reload 는 서버 노트를 다시 읽어 돌려줘요(충돌·불명 뒤 사람이 누를 때만).
 * pickImage 를 주면 도구 줄에 사진 단추가 생기고, 받은 주소를 그림 문단으로 넣어요.
 */
export function NoteEditor({
  state,
  saver,
  storageOk,
  reload,
  pickImage,
  onDone,
  onAdopted,
}: {
  state: NoteState
  saver: NoteSaver
  storageOk: boolean
  reload: () => Promise<NoteSource>
  pickImage?: () => Promise<string | null>
  onDone: () => void
  /** 사람이 서버 노트를 채택했을 때(문서 쓰기 줄의 막힘을 풀어요) */
  onAdopted?: () => void
}) {
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const [sel, setSel] = useState<Selection>({ start: state.draft.length, end: state.draft.length })
  const selRef = useRef(sel)
  selRef.current = sel
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null)
  // 도구 줄로 글을 바꾼 직후에만 커서를 정해요. 평소에는 입력칸이 커서를 맡아요(제어하면 iOS 에서 커서가 튀어요)
  const [forced, setForced] = useState<Selection | undefined>()
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const banner = noteBanner(state)
  // 자동 저장이 멈추면(충돌·불명·합치기·오류) 키보드를 내려 안내 띠와 단추가 보이게 해요
  const stoppedStatus = ['conflict', 'unknown', 'merging', 'error'].includes(state.status)
  useEffect(() => {
    if (stoppedStatus) Keyboard.dismiss()
  }, [stoppedStatus])
  const accessory = 'note-editor-tools'
  const apply = (r: { md: string; sel: Selection }) => {
    saver.edit(r.md)
    setSel(r.sel)
    setForced(r.sel)
  }
  const doExport = async (text: string) => {
    if (await exportDraft(text)) setCopied(true)
  }
  const doReload = async () => {
    setBusy('reload')
    setNote('')
    try {
      const src = await reload()
      saver.reload({ version: src.version, md: src.md, truncated: false }, noteEditability(src).editable)
    } catch (e) {
      setNote(`현재 노트를 불러오지 못했어요: ${errorMessage(e)}`)
    } finally {
      setBusy('')
    }
  }
  const doPick = async () => {
    if (!pickImage) return
    setBusy('image')
    setNote('')
    try {
      const url = await pickImage()
      // 올리는 동안 더 쓴 글을 덮지 않게 지금 초안·커서에 넣어요
      if (url) apply(insertBlock(saver.state.draft, selRef.current, `![](${url})`))
    } catch (e) {
      setNote(e instanceof Error ? e.message : '사진을 넣지 못했어요')
    } finally {
      setBusy('')
    }
  }
  const done = async () => {
    if (state.status === 'dirty') await saver.flush()
    onDone()
  }
  const locked = !state.editable
  // autoFocus 는 아래 InputAccessoryView 가 붙기 전에 키보드를 올려 첫 포커스에 도구 줄이 없어요. 붙은 뒤 포커스해요
  const lockedAtMount = useRef(locked)
  useEffect(() => {
    if (lockedAtMount.current) return
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [])
  return (
    <View style={s.wrap}>
      <View style={s.statusRow}>
        <Text style={styles.small} accessibilityLiveRegion="polite">
          {statusLine(state)}
          {!storageOk && state.status !== 'clean' ? ' · 초안을 기기에 보관하지 못했어요. 나가기 전에 내보내 주세요' : ''}
        </Text>
        <Button variant="plain" title="완료" onPress={() => void done()} />
      </View>
      {banner ? (
        <NoteNotice message={banner.message}>
          {state.current ? <Text style={styles.small} numberOfLines={6}>서버 버전 {state.current.version}{state.current.truncated ? ' · 앞부분만' : ''}: {state.current.md}</Text> : null}
          {state.reloaded ? <Text style={styles.small} numberOfLines={8}>불러온 서버 노트(버전 {state.reloaded.version}): {state.reloaded.md}</Text> : null}
          {banner.actions.includes('export') ? <Button variant="outline" title="내 초안 내보내기" onPress={() => void doExport(state.draft)} /> : null}
          {banner.actions.includes('reload') ? <Button variant="outline" title={busy === 'reload' ? '불러오는 중' : '현재 노트 새로 불러오기'} disabled={!!busy} onPress={() => void doReload()} /> : null}
          {banner.actions.includes('adopt') ? (
            <>
              <View style={s.switchRow}>
                <Text style={[styles.text, s.flex]}>내 초안을 다른 곳에 복사했어요</Text>
                <Switch accessibilityLabel="내 초안을 다른 곳에 복사했어요" value={copied} onValueChange={setCopied} />
              </View>
              <Button title="서버 노트 채택 후 직접 합치기" disabled={!copied} onPress={() => {
                  if (saver.adopt(copied)) {
                    setCopied(false)
                    onAdopted?.()
                  }
                }} />
            </>
          ) : null}
          {banner.actions.includes('saveMerged') ? (
            <Button
              title="합친 노트 저장"
              onPress={() => Alert.alert('합친 노트 저장', `서버 버전 ${state.version} 위에 저장해요. 그사이 서버가 바뀌었으면 충돌로 멈춰요.`, [{ text: '취소', style: 'cancel' }, { text: '저장', onPress: () => void saver.saveMerged() }])}
            />
          ) : null}
        </NoteNotice>
      ) : null}
      {note ? <Text accessibilityRole="alert" style={styles.meta}>{note}</Text> : null}
      <TextInput
        accessibilityLabel="노트 마크다운"
        multiline
        ref={inputRef}
        editable={!locked}
        scrollEnabled={false}
        value={state.draft}
        onChangeText={(md) => saver.edit(md)}
        selection={forced}
        onSelectionChange={(e) => {
          setSel(e.nativeEvent.selection)
          setForced(undefined)
        }}
        inputAccessoryViewID={accessory}
        placeholder="요약, 결정한 것, 다음 할 일을 적어요. # 제목, - 목록, - [ ] 할 일, [[링크]]"
        placeholderTextColor={c.muted}
        autoCorrect={false}
        style={s.input}
      />
      {state.backups.length ? (
        <View style={s.backups}>
          <Text style={styles.strong}>보관한 내 초안 {state.backups.length}개</Text>
          {state.backups.map((b, i) => (
            <View key={i} style={s.backup}>
              <Text style={[styles.small, s.flex]} numberOfLines={2}>
                {b}
              </Text>
              <Button variant="plain" title="내보내기" onPress={() => void doExport(b)} />
              <Button variant="plain" title="지우기" onPress={() => Alert.alert('보관 초안 지우기', '먼저 필요한 내용을 내보냈나요?', [{ text: '취소', style: 'cancel' }, { text: '지우기', style: 'destructive', onPress: () => saver.removeBackup(i) }])} />
            </View>
          ))}
        </View>
      ) : null}
      <InputAccessoryView nativeID={accessory}>
        <View style={s.toolbar}>
          {TOOLS.map((t) => (
            <Pressable key={t.label} accessibilityRole="button" accessibilityLabel={t.label} disabled={locked} onPress={() => apply(t.run(state.draft, sel))} style={s.tool}>
              <SymbolView name={t.icon} size={20} tintColor={c.ink} />
            </Pressable>
          ))}
          {pickImage ? (
            <Pressable accessibilityRole="button" accessibilityLabel="사진 넣기" disabled={locked || !!busy} onPress={() => void doPick()} style={s.tool}>
              <SymbolView name={busy === 'image' ? 'hourglass' : 'photo'} size={20} tintColor={c.ink} />
            </Pressable>
          ) : null}
          <View style={s.flex} />
          <Pressable accessibilityRole="button" accessibilityLabel="편집 마치기" onPress={() => void done()} style={s.tool}>
            <Text style={styles.strong}>완료</Text>
          </Pressable>
        </View>
      </InputAccessoryView>
    </View>
  )
}

/** 노트 밖의 저장 안 된 입력(문서 속성 등). kept 는 그 입력을 기기에 보관했는지 */
export type ExtraDraft = { dirty: boolean; kept: boolean; label: string }
/**
 * 저장 안 된 노트 초안이나 다른 입력(extra)이 있으면 뒤로 가기를 막아요(usePreventRemove: 머리 뒤로·밀어서 뒤로도 막아요). 둘을 함께 봐요:
 * 노트가 저장 전이면 "노트 저장하고 나가기"(저장이 끝나고 다른 입력도 없을 때만 떠남), 멈춘 초안·다른 입력은 기기 보관을 확인했을 때만 "두고 나가기",
 * 아니면 내보내기·버리기·머물기만.
 */
export function useNoteLeaveGuard(saver: NoteSaver | null, state: NoteState | null, storageOk: boolean, extra: ExtraDraft = { dirty: false, kept: true, label: '' }) {
  const navigation = useNavigation()
  const ref = useRef({ saver, state, storageOk, extra })
  ref.current = { saver, state, storageOk, extra }
  const blocking = leaveChoice(state, storageOk).kind !== 'free' || extra.dirty
  usePreventRemove(blocking, ({ data }) => {
    const { saver: sv, state: st, storageOk: ok, extra: ex } = ref.current
    const note = leaveChoice(st, ok)
    const leave = () => navigation.dispatch(data.action)
    const stay = { text: '머물기', style: 'cancel' as const }
    const kept = (note.kind === 'free' || note.kept) && (!ex.dirty || ex.kept)
    const what = [note.kind !== 'free' ? '노트 초안' : '', ex.dirty ? ex.label : ''].filter(Boolean).join('과 ')
    const discard = { text: '버리고 나가기', style: 'destructive' as const, onPress: () => Alert.alert('버릴까요?', `${what}을 되살릴 수 없을 수 있어요.`, [stay, { text: '버리기', style: 'destructive', onPress: leave }]) }
    const exportThenLeave = { text: '노트 내보내고 나가기', onPress: () => void exportDraft(st?.draft ?? '').then((sent) => sent && !ex.dirty && leave()) }
    const keepAndLeave = { text: '기기에 두고 나가기', onPress: leave }
    if (note.kind === 'save') {
      Alert.alert('저장하지 않은 노트가 있어요', ex.dirty ? `${ex.label}도 저장되지 않았어요.` : undefined, [
        stay,
        {
          text: '노트 저장하고 나가기',
          onPress: () =>
            void sv?.flush().then(() => {
              if (sv.state.status !== 'clean') return Alert.alert('저장하지 못했어요', sv.state.message ?? '초안은 그대로 있어요')
              const now = ref.current.extra
              if (!now.dirty) return leave()
              Alert.alert(`${now.label}이 남아 있어요`, now.kept ? '기기에 보관했어요' : '기기에 보관하지 못했어요', now.kept ? [stay, keepAndLeave] : [stay, discard])
            }),
        },
      ])
      return
    }
    const buttons = [stay, ...(note.kind !== 'free' ? [exportThenLeave] : []), kept ? keepAndLeave : discard]
    Alert.alert(`저장하지 않은 ${what}이 있어요`, kept ? '이 기기에 보관했어요. 다시 열면 이어서 볼 수 있어요.' : '기기에 보관하지 못했어요. 나가기 전에 내보내 주세요.', buttons)
  })
}
const s = StyleSheet.create({
  wrap: { gap: space.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: { minHeight: 280, color: colors.ink, fontSize: 16, lineHeight: 24, backgroundColor: colors.card, borderRadius: 14, padding: space.lg, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  backups: { gap: space.sm },
  backup: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  toolbar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, paddingHorizontal: space.sm, height: space.target + 4 },
  tool: { minWidth: space.target, height: space.target, alignItems: 'center', justifyContent: 'center' },
})
