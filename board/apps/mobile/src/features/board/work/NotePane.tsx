import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import type { Run } from '@direction-board/contracts'
import { ApiError, ConflictError, ScopeChangedError, UnknownWriteError } from '../../../api/client'
import { useQuery } from '../../../api/query'
import { workOps, type WorkFull } from '../../../api/work'
import { notesApi } from '../../../notes/api'
import { NoteNotice } from '../../../notes/NoteNotice'
import { NoteView } from '../../../notes/NoteView'
import { externalLink, wikiTarget } from '../../../notes/wiki'
import { useServer } from '../../../server'
import { Button } from '../../../ui/Button'
import { Chip } from '../../../ui/Chip'
import { useToast } from '../../../ui/Toast'
import { colors, space, styles } from '../../../ui/theme'
import { notePaneMode, type NotePaneMode } from './notePaneMode'
import { useWriteScope } from '../../../api/scope'
import { DRAFT_PROMPT } from './draftPrompt'
import { insertDraftNote } from './insertDraft'
import { QuotePicker } from './QuotePicker'
import { savedModel } from './toNote'
import { useIntents } from '../useIntents'
import { withIntent, WriteAheadError } from '../intents'

export { DRAFT_PROMPT }

type Props = {
  w: WorkFull
  draft: Run | null
  reloadRuns: () => void
  refresh: () => void
  openDoc: () => void
  openRoute: (route: 'Doc' | 'Work', ref: string) => void
  /** 고른 부분을 인용으로 새 대화 */
  askAbout: (quote: string) => void
  /** 고른 부분으로 새 일(노트 전체 글은 새 일 초안의 바탕) */
  makeWork: (quote: string, noteText: string) => Promise<void>
}

/** 노트 갈래. 편집 화면은 문서 페이지(레인 2 노트 편집기)이고, 여기서는 읽기·시작·AI 초안을 다뤄요 */
export function NotePane(props: Props) {
  const { w } = props
  // 노트가 있고 버전 보호가 있는 서버일 때만 편집 원문·편집 허락(markdownEditable)을 물어요
  if (w.note && w.noteVersioning === true) return <WithSource {...props} />
  return <Body {...props} mode={notePaneMode({ noteVersioning: w.noteVersioning, hasNote: !!w.note })} md={w.note?.md ?? w.note?.text ?? ''} version={null} retry={null} />
}

function WithSource(props: Props) {
  const { origin } = useServer()
  const { w } = props
  const source = useQuery(`note/${w.ref}`, () => notesApi.source(origin, w.ref))
  const sourceError = source.data === undefined && source.status === 'error' ? (source.error instanceof ApiError && source.error.status === 404 ? 'missing' : 'error') : null
  const mode = source.data === undefined && !sourceError ? null : notePaneMode({ noteVersioning: w.noteVersioning, hasNote: true, source: source.data, sourceError })
  return <Body {...props} mode={mode} md={source.data?.md ?? w.note?.md ?? w.note?.text ?? ''} version={source.data?.version ?? null} retry={() => void source.refresh()} />
}

function Body({ w, draft, reloadRuns, refresh, openDoc, openRoute, askAbout, makeWork, mode, md, retry }: Props & { mode: NotePaneMode | null; md: string; version: number | null; retry: (() => void) | null }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const scope = useWriteScope()
  const intents = useIntents()
  const s = w.signal
  const fail = (e: unknown, text: string) => toast(e instanceof UnknownWriteError ? e.message : e instanceof ConflictError ? '노트가 그사이 바뀌었어요. 다시 불러와 주세요' : text)
  const startThen = async (after: (version: number) => Promise<void>) => {
    const r = await workOps(scope).startNote(w.ref)
    await after(typeof r.version === 'number' ? r.version : 0)
  }
  const edit = async () => {
    if (mode?.kind === 'edit') return openDoc()
    if (mode?.kind !== 'start' || busy) return
    setBusy(true)
    try {
      await startThen(async () => undefined)
      refresh()
      retry?.()
      openDoc()
    } catch (e) {
      fail(e, '노트를 시작하지 못했어요')
    } finally {
      setBusy(false)
    }
  }
  const askDraft = async () => {
    if (draft || busy) return
    setBusy(true)
    try {
      // 먼저 기록하고 clientKey 를 붙여 보내요(결과를 몰라도 홈의 끝나지 않은 요청에서 같은 키로 다시 확인, 규칙 B)
      await intents.startRun(scope, { target: w.ref, kind: 'draft', prompt: DRAFT_PROMPT, ...savedModel() }, '노트 초안 쓰기')
      reloadRuns()
    } catch (e) {
      fail(e, '초안을 시작하지 못했어요')
    } finally {
      setBusy(false)
    }
  }
  // 초안 넣기: 단추는 화면이 편집 허락을 본 노트에만 둬요. 보내기 직전에 매 시도 노트를 다시 읽어, 그사이 웹 서식으로 바뀌어
  // 고칠 수 없게 됐으면 replace 대신 원본 HTML 을 지키는 append 로 넣어요. 규칙은 insertDraft.ts:
  // 누를 때 범위 고정 클라이언트를 만들어 그 범위에서만 보내고, 서버 onceKey(run:<초안 id>)로 같은 초안은 한 번만 들어가요.
  // 노트 저장과 적용 표시는 따로 알려요. 결과를 모르면 실패라 하지 않고 노트를 확인하라고 해요
  const insertDraft = async () => {
    if (!draft?.output.trim() || busy || !mode || (mode.kind !== 'edit' && mode.kind !== 'start')) return
    setBusy(true)
    try {
      // 먼저 기록(규칙 B): 앱이 도중에 꺼져도 홈에서 같은 초안(onceKey run:<초안 id>)으로 다시 확인해요
      const d = { id: draft.id, output: draft.output }
      const r = await withIntent(intents.journal, { key: `note:${draft.id}:${w.ref}`, kind: 'note', scope: scope.scope, at: Date.now(), label: '초안을 노트에 넣기', payload: { ref: w.ref, draft: d } }, () => insertDraftNote(scope, w.ref, d))
      toast(r.applied ? (r.saved === 'added' ? '노트에 넣었어요' : '이미 노트에 넣은 초안이에요') : '노트에 넣었어요 · 초안 정리 표시는 못 했어요. 다시 누르면 표시만 해요')
      reloadRuns()
    } catch (e) {
      if (e instanceof ScopeChangedError || e instanceof WriteAheadError) toast(e.message)
      else if (e instanceof UnknownWriteError) toast('초안이 노트에 들어갔는지 확인하지 못했어요. 홈의 끝나지 않은 요청에서 확인할 수 있어요(읽어 보기만 해요)')
      else fail(e, '노트에 넣지 못했어요')
    } finally {
      refresh()
      retry?.() // 노트 원문(note/<ref>) 캐시도 새로: 다음 저장이 옛 버전으로 충돌하지 않게
      setBusy(false)
    }
  }
  const closeDraft = async () => {
    if (!draft) return
    try {
      await workOps(scope).markApplied(draft.id)
      reloadRuns()
    } catch {
      toast('초안 상태를 닫지 못했어요')
    }
  }
  const openWiki = (term: string) => {
    const t = wikiTarget(term)
    if (t) openRoute(t.route, t.ref)
  }
  const draftFailed = draft && (draft.status === 'error' || draft.status === 'stopped' || (draft.status === 'done' && !draft.output.trim()))
  const writable = mode?.kind === 'edit' || mode?.kind === 'start'
  return (
    <View style={st.wrap}>
      {s?.body ? <Text selectable style={[styles.meta, st.body]}>{s.body}</Text> : null}
      <View style={st.chips}>
        {s?.url ? <Chip label="원본 열기" onPress={() => externalLink(s.url ?? '') && void WebBrowser.openBrowserAsync(s.url ?? '')} /> : null}
        <Chip label={draft?.status === 'running' ? 'AI가 초안을 쓰는 중' : '✦ AI로 초안 쓰기'} tone={draft?.status === 'running' ? 'ai' : undefined} onPress={draft ? undefined : () => void askDraft()} />
        {md.trim() ? <Chip label="부분 골라 묻기" onPress={() => setPicking(true)} /> : null}
      </View>
      <QuotePicker visible={picking} md={md} onClose={() => setPicking(false)} onAsk={askAbout} onMakeWork={(q) => makeWork(q, md)} />
      {draft?.status === 'running' ? <Text style={styles.small}>{draft.steps?.at(-1) ? `${draft.steps.at(-1)?.tool} ${draft.steps.at(-1)?.arg}` : '노트 초안을 쓰는 중이에요'}</Text> : null}
      {draftFailed ? (
        <NoteNotice message={`AI 초안을 만들지 못했어요${draft.status === 'done' ? ' · 결과가 비어 있어요' : draft.error ? ` · ${draft.error.split('\n').at(-1)}` : ''}`}>
          <Button title="확인 후 다시 시도" variant="outline" onPress={() => void closeDraft()} />
        </NoteNotice>
      ) : null}
      {draft?.status === 'done' && draft.output.trim() ? (
        <View style={[styles.group, st.draft]}>
          <Text style={styles.strong}>AI 초안</Text>
          <NoteView md={draft.output} />
          {writable ? <Button title={busy ? '넣는 중…' : '노트에 넣기'} variant="outline" disabled={busy} onPress={() => void insertDraft()} /> : <Text style={styles.small}>이 노트는 앱에서 고칠 수 없어 웹에서 넣어 주세요</Text>}
          <Chip label="넣지 않고 닫기" onPress={() => void closeDraft()} />
        </View>
      ) : null}
      {mode?.kind === 'readonly' ? (
        <NoteNotice message={mode.reason}>{mode.retry && retry ? <Button title="다시 시도" variant="outline" onPress={retry} /> : null}</NoteNotice>
      ) : null}
      <NoteView md={md} onWiki={openWiki} onLink={(href) => externalLink(href) && void WebBrowser.openBrowserAsync(href)} />
      {mode?.kind === 'edit' || mode?.kind === 'start' ? <Button title={mode.kind === 'start' ? (busy ? '시작하는 중…' : '노트 쓰기') : '노트 고치기'} variant="outline" disabled={busy} onPress={() => void edit()} /> : null}
    </View>
  )
}
const st = StyleSheet.create({
  wrap: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  body: { backgroundColor: colors.fill, borderRadius: 10, padding: space.md },
  draft: { padding: space.gutter, gap: space.sm },
})
