import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import * as WebBrowser from 'expo-web-browser'
import type { Signal } from '@direction-board/contracts'
import { srcName } from '@direction-board/contracts/board-text'
import { useBoardState, useSignals } from '../../api/board'
import { ApiError, api, errorMessage } from '../../api/client'
import { useWriteScope } from '../../api/scope'
import { useQuery, useQueryStore } from '../../api/query'
import { runsApi } from '../../api/runs'
import { workApi } from '../../api/work'
import { workLink } from '../../navigation/linking'
import type { RootParams, StackParams } from '../../navigation/routes'
import { notesApi } from '../../notes/api'
import { NoteView } from '../../notes/NoteView'
import { externalLink } from '../../notes/wiki'
import { useServer } from '../../server'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { HeaderMenu } from '../../ui/HeaderMenu'
import { Screen } from '../../ui/Screen'
import { ErrorCard, Loading } from '../../ui/StateView'
import { useToast } from '../../ui/Toast'
import { colors, space, styles } from '../../ui/theme'
import { groupThreads } from '../ai/runLogic'
import { WorkChats } from '../ai/screens'
import { useSetDone, useSignalActions } from './actions'
import { openRef } from './open'
import { requestSheet } from './quick/create'
import { PropertiesSheet } from './work/PropertiesSheet'
import { GoalOverview } from './work/GoalOverview'
import { HistoryPane } from './work/HistoryPane'
import { LinksPane } from './work/LinksPane'
import { DRAFT_PROMPT, NotePane } from './work/NotePane'
import { makeWorkFromQuote, makeWorkUnknown } from './work/makeWork'
import { makeWorkNotice } from './work/noteQuote'
import { pendingDraft } from './work/threads'
import { savedModel } from './work/toNote'
import { useIntents } from './useIntents'
import { withIntent } from './intents'

// 웹 work-view.tsx LANE_KO 와 같은 칸 이름
export const LANE_KO: Record<string, string> = { now: '지금 봐야 함', decide: '결정 대기', review: '확인 필요', running: '하는 중', auto: 'AI가 처리함', main: '메인 일 후보', info: '기록' }
const KIND: Record<string, string> = { todo: '할 일', goal: '목표', signal: '사건', sticky: '메모', doc: '문서' }
type Pane = 'note' | 'chats' | 'links' | 'history'

/** 일 상세(웹 work-view.tsx): 머리(제목·상태·주 행동) + 노트·대화·연결·기록 갈래. 목표면 노트 위에 목표 요약 */
export function Work({ route, navigation }: NativeStackScreenProps<StackParams & RootParams, 'Work'>) {
  const { ref } = route.params
  const { origin } = useServer()
  const scope = useWriteScope()
  const intents = useIntents()
  const work = useQuery(`work/${ref}`, () => workApi.work(origin, ref))
  // 대화 목록(레인 3 WorkChats)과 같은 열쇠라 여기서 다시 읽으면 대화 갈래도 같이 바뀌어요
  const runs = useQuery(`ai/target/${ref}`, () => runsApi.forTarget(origin, ref))
  const board = useBoardState()
  const signals = useSignals()
  const setDone = useSetDone()
  const act = useSignalActions()
  const toast = useToast()
  const store = useQueryStore()
  const [pane, setPane] = useState<Pane>('note')
  const [propsOpen, setPropsOpen] = useState(false)
  // 같은 화면에 다른 일이 들어오면(딥 링크 등) 갈래·시트를 처음으로
  useEffect(() => {
    setPane('note')
    setPropsOpen(false)
  }, [ref])
  const w = work.data
  const s = w?.signal ?? null
  const [, bid, iid] = ref.startsWith('item:') ? ref.split(':') : []
  const item = board.data?.items.find((i) => i.boardId === bid && i.id === iid)
  // 사건은 판 캐시(낙관적)에 있으면 그 값으로 상태를 보여요(처리 직후 바로 바뀌게)
  const live: Signal | undefined = s ? signals.data?.signals.find((x) => x.id === s.id) : undefined
  const status = item ? (item.done ? 'resolved' : 'open') : (live?.status ?? s?.status ?? w?.self.status ?? 'open')
  const lane = live?.lane ?? s?.lane
  const threads = useMemo(() => groupThreads(runs.data?.runs ?? []), [runs.data])
  const draft = pendingDraft(runs.data?.runs ?? [])
  const refresh = () => {
    void work.refresh()
    void signals.refresh()
  }
  // 도는 대화·초안이 있으면 화면이 보이는 동안 다시 읽어요(웹 1초 → 앱 2초)
  const running = (runs.data?.runs ?? []).some((r) => r.status === 'running')
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void runs.refresh(), 2000)
    return () => clearInterval(t)
  }, [running, runs])
  // 끝난 초안이 생기면 노트도 다시 읽어요(서버가 노트를 바꿨을 수 있어요)
  const draftDone = draft?.status === 'done'
  useEffect(() => { if (draftDone) void work.refresh() }, [draftDone]) // eslint-disable-line react-hooks/exhaustive-deps
  // 확인 기다림인 사건을 열어 봤으면 확인한 걸로(웹 work-view.tsx:226-229)
  const confirmed = useRef('')
  useEffect(() => {
    if (live && live.lane === 'review' && live.status === 'open' && confirmed.current !== live.id) {
      confirmed.current = live.id
      void act.confirm([live], true)
    }
  }, [live, act])

  const sig = live ?? (s as unknown as Signal | null)
  const primary = sig
    ? { label: status === 'resolved' ? '다시 열기' : '처리함', onPress: () => void (status === 'resolved' ? act.reopen(sig) : act.resolve(sig)) }
    : item
      ? { label: item.done ? '다시 열기' : '끝냄', onPress: () => void setDone(item, !item.done) }
      : null
  const newThread = (quote?: string) => navigation.push('Thread', { target: ref, ...(quote ? { quote } : {}) })
  // 먼저 기록하고 clientKey 를 붙여 보내요(규칙 B). 결과를 모르면 홈의 끝나지 않은 요청에서 같은 키로 다시 확인해요
  const askDraft = () => void intents.startRun(scope, { target: ref, kind: 'draft', prompt: DRAFT_PROMPT, ...savedModel() }, '노트 초안 쓰기').then(() => runs.refresh(), (e: unknown) => toast(errorMessage(e)))
  // 노트에서 고른 부분 → 새 일(웹 makeWork): 만들고, 이 일과 잇고, 새 일의 노트 초안을 AI에게 맡겨요.
  // 만들기만 성공하고 연결·초안이 실패하거나 결과를 모르면 그 사실과 확인·다시 할 곳을 알려요(성공으로 숨기지 않고, 결과 불명을 실패라 하지 않음)
  const makeWork = async (sel: string, noteText: string) => {
    // 규칙은 work/makeWork.ts: 누를 때의 범위 고정 클라이언트로만 보내고, 결과 불명·범위 바뀜을 실패와 나눠 알려요
    // 먼저 기록(규칙 B): 단계마다 서버에서 멱등인 키로 보내서, 결과를 모르거나 앱이 꺼져도 홈에서 같은 키로 다시 확인해요
    const a = { ref, sel, noteText, parentTitle: s?.title || w?.self.title || '', model: savedModel() }
    const key = `work:${intents.newKey()}`
    let r: Awaited<ReturnType<typeof makeWorkFromQuote>>
    try {
      r = await withIntent(intents.journal, { key, kind: 'work', scope: scope.scope, at: Date.now(), label: `새 일 만들기: ${sel.split('\n')[0]?.slice(0, 40) ?? ''}`, payload: { a } }, () => makeWorkFromQuote(scope, a, key), makeWorkUnknown)
    } catch (e) {
      return toast(errorMessage(e))
    }
    if (r.kind === 'unknown') return toast('새 일이 만들어졌는지 확인하지 못했어요. 홈의 끝나지 않은 요청에서 확인할 수 있어요(읽어 보기만 해요)')
    if (r.kind === 'scope') return toast(r.error)
    if (r.kind === 'failed') return toast(`새 일을 만들지 못했어요 · ${errorMessage(r.error)}`)
    refresh()
    toast(makeWorkNotice({ linked: r.linked, drafted: r.drafted }), { label: '열기', onPress: () => navigation.push('Work', { ref: r.next, title: r.title }) })
  }
  useLayoutEffect(() => {
    navigation.setOptions({
      title: w ? (KIND[w.self.type] ?? '일') : '일',
      headerRight: () => (
        <HeaderMenu
          actions={[
            ...(primary ? [primary] : []),
            ...(sig && status !== 'resolved' ? [{ label: 'AI가 처리함', onPress: () => void act.aiDone(sig) }, { label: '이런 소식은 안 와도 돼', onPress: () => void act.mute(sig) }] : []),
            ...(s?.url && externalLink(s.url) ? [{ label: '원본 열기', onPress: () => void WebBrowser.openBrowserAsync(s.url ?? '') }] : []),
            { label: '새 대화', onPress: () => newThread() },
            ...(!draft ? [{ label: 'AI로 초안 쓰기', onPress: askDraft }] : []),
            ...(item ? [{ label: '속성(날짜·영역·태그)', onPress: () => setPropsOpen(true) }] : []),
            { label: '문서로 열기', onPress: () => navigation.push('Doc', { ref }) },
            { label: '링크 공유', onPress: () => void Share.share({ message: workLink(ref) }) },
            { label: '빠른 추가', onPress: () => { requestSheet({}); navigation.navigate('QuickAdd', {}) } },
          ]}
        />
      ),
    })
  })

  if (!w) {
    if (work.status === 'error' && work.error instanceof ApiError && work.error.status === 404) return <Archived workRef={ref} />
    return <Screen>{work.status === 'error' ? <ErrorCard error={work.error} retry={() => void work.refresh()} /> : <Loading label="일을 불러오는 중이에요" />}</Screen>
  }
  const goal = w.self.type === 'goal' ? board.data?.items.find((i) => `item:${i.boardId}:${i.id}` === ref) : undefined
  const tabs: [Pane, string][] = [['note', '노트'], ['chats', `대화${threads.length ? ` ${threads.length}` : ''}`], ['links', `연결${w.links.length ? ` ${w.links.length}` : ''}`], ['history', '기록']]
  return (
    <Screen onRefresh={() => Promise.all([work.refresh(), runs.refresh(), board.refresh(), signals.refresh(), ...(w.note && w.noteVersioning === true ? [store.fetch(`note/${ref}`, () => notesApi.source(origin, ref))] : [])])}>
      {work.status === 'error' ? <Text style={styles.meta} onPress={() => void work.refresh()}>최신 내용을 불러오지 못했어요 · 마지막으로 불러온 내용을 보여줘요 · 다시</Text> : null}
      <View style={st.head}>
        <Text accessibilityRole="header" selectable style={st.title}>{s?.title || w.self.title || '제목 없음'}</Text>
        {s?.reason ? <Text style={styles.meta}>{s.reason}</Text> : null}
        <View style={st.chips}>
          <Chip label={s ? srcName(s.source) : (KIND[w.self.type] ?? w.self.type)} />
          <Chip label={status === 'resolved' ? '끝남' : lane ? (LANE_KO[lane] ?? lane) : '열림'} tone={status === 'resolved' ? 'done' : lane === 'now' ? 'decide' : lane === 'running' ? 'running' : lane === 'decide' ? 'warn' : undefined} />
          {s?.private ? <Chip label="개인" /> : null}
          {s?.needs_ai ? <Chip label="AI 판단 대기" tone="ai" /> : null}
          {s?.sample ? <Chip label="샘플" /> : null}
          {w.self.area ? <Chip label={w.self.area} onPress={item ? () => setPropsOpen(true) : undefined} /> : null}
          {w.self.when ? <Chip label={w.self.when.replace('T', ' ')} onPress={item ? () => setPropsOpen(true) : undefined} /> : null}
          {item ? <Chip label="속성" onPress={() => setPropsOpen(true)} /> : null}
        </View>
        {primary ? (
          <View style={st.actions}>
            <View style={st.flex}><Button title={primary.label} variant={status === 'resolved' ? 'outline' : 'primary'} onPress={primary.onPress} /></View>
            {sig && status !== 'resolved' ? <View style={st.flex}><Button title="AI가 처리함" variant="outline" onPress={() => void act.aiDone(sig)} /></View> : null}
          </View>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips} accessibilityRole="tablist">
        {tabs.map(([k, l]) => <Chip key={k} label={l} selected={pane === k} onPress={() => setPane(k)} />)}
      </ScrollView>
      {pane === 'note' ? (
        <>
          {goal && board.data ? <GoalOverview goal={goal} items={board.data.items} boards={board.data.boards} linkedRefs={w.links.map((l) => l.other.ref)} onAdded={() => void work.refresh()} /> : null}
          {goal ? <Text style={st.why}>왜 · 노트</Text> : null}
          <NotePane w={w} draft={draft} reloadRuns={() => void runs.refresh()} refresh={refresh} openDoc={() => navigation.push('Doc', { ref })} openRoute={(r: 'Doc' | 'Work', x: string) => navigation.push(r, { ref: x })} askAbout={(q) => newThread(q)} makeWork={makeWork} />
        </>
      ) : pane === 'chats' ? (
        <WorkChats target={ref} />
      ) : pane === 'links' ? (
        <LinksPane w={w} onOpen={(r, t) => openRef(navigation, r, t)} refresh={refresh} />
      ) : (
        <HistoryPane w={w} />
      )}
      {item ? <PropertiesSheet visible={propsOpen} onClose={() => setPropsOpen(false)} workRef={ref} item={item} board={board.data?.boards.find((b) => b.id === item.boardId)} onChanged={refresh} /> : null}
    </Screen>
  )
}

/** 원본 일을 찾을 수 없을 때(웹 ArchivedWorkView): 보관된 마크다운을 읽기만 */
function Archived({ workRef }: { workRef: string }) {
  const { origin } = useServer()
  const doc = useQuery(`doc/${workRef}`, () => api.doc(origin, workRef))
  return (
    <Screen onRefresh={doc.refresh}>
      <Text style={[styles.meta, st.band]}>원본 일을 찾을 수 없어 보관된 Markdown 만 볼 수 있어요. 표와 서식이 손실될 수 있어 편집은 지원하지 않아요.</Text>
      {doc.data ? (
        <>
          <Text accessibilityRole="header" style={styles.heading}>{doc.data.title || '보관 문서'}</Text>
          <Text style={styles.small}>버전 {doc.data.version} · 전체 Markdown</Text>
          <NoteView md={doc.data.markdown} />
        </>
      ) : doc.status === 'error' ? (
        <ErrorCard error={doc.error} retry={() => void doc.refresh()} />
      ) : (
        <Loading />
      )}
    </Screen>
  )
}
const st = StyleSheet.create({
  head: { gap: space.sm },
  title: { color: colors.ink, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  flex: { flex: 1 },
  why: { color: colors.muted, fontSize: 13, fontWeight: '600', paddingHorizontal: space.xs },
  band: { backgroundColor: colors.fill, borderRadius: 10, padding: space.md },
})
