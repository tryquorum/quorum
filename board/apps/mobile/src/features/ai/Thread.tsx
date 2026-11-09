import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, Share, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { Run } from '@direction-board/contracts'
import { errorMessage, ScopeChangedError, UnknownWriteError } from '../../api/client'
import { useQueryStore, useScope } from '../../api/query'
import { runsApi, type RunPage } from '../../api/runs'
import type { StackParams } from '../../navigation/routes'
import { externalLink } from '../../notes/wiki'
import { showWorkNote, useAnswerToNote } from '../board/work/toNote'
import { useServer } from '../../server'
import { showActions } from '../../ui/actions'
import { BottomBar } from '../../ui/BottomBar'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { HeaderMenu } from '../../ui/HeaderMenu'
import { Empty, LoginPrompt } from '../../ui/StateView'
import { useToast } from '../../ui/Toast'
import { useBottomInset } from '../../ui/insets'
import { colors, space, styles } from '../../ui/theme'
import { Composer } from './Composer'
import { ModelChip, ModelSheet } from './ModelSheet'
import { RunBlock } from './RunBlock'
import { afterSend, continuable, quotedPrompt, runBody } from './runLogic'
import { useModels } from './useModels'
import { useNow, useThread } from './useThread'
import { useWriteScope } from '../../api/scope'
import { useIntents } from '../board/useIntents'

const VIEW: Record<string, RunPage['view']> = { HomeTab: 'home', ListTab: 'list', DocsTab: 'docs' }
const VIEW_KO: Record<RunPage['view'], string> = { home: '홈', list: '전체 목록', docs: '문서' }
export const THREADS_KEY = 'ai/threads'

/**
 * AI 대화(웹 명령창의 결과 창 + 일 화면 대화). thread 가 없으면 새 대화, target 은 함께 보낼 일, quote 는 노트에서 고른 부분.
 * 이어 묻기는 마지막 턴이 세션을 만들었을 때만이고, 아니면 새 대화로 안내해요.
 */
export function Thread({ route, navigation }: NativeStackScreenProps<StackParams, 'Thread'>) {
  const { origin } = useServer()
  const writeScope = useWriteScope()
  // AI 실행 시작은 먼저 기록하고 clientKey 를 붙여 보내요(결과를 몰라도 홈의 끝나지 않은 요청에서 같은 키로 다시 확인, 규칙 B)
  const intents = useIntents()
  const store = useQueryStore()
  const toast = useToast()
  const { generation, isCurrent } = useScope()
  const params = route.params ?? {}
  const [threadId, setThreadId] = useState<string | null>(params.thread ?? null)
  useEffect(() => setThreadId(params.thread ?? null), [params.thread])
  const t = useThread(threadId)
  const { cat, choice, setChoice, sheet: modelSheet } = useModels()
  const [text, setText] = useState(params.draft ?? '')
  const [quote, setQuote] = useState<string | null>(params.quote ?? null)
  const [withWork, setWithWork] = useState(!!params.target)
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [sendError, setSendError] = useState<unknown>(null)
  const lock = useRef(false)
  const gen = useRef(0)
  const scroller = useRef<ScrollViewInstance>(null)
  const stick = useRef(true)
  const bottom = useBottomInset()
  const [bar, setBar] = useState(0)
  const now = useNow(t.running && t.visible)

  // 화면 문맥: 이 대화를 연 탭과 함께 보낼 일(웹 "AI가 보는 화면")
  const tab = navigation.getParent()?.getState()
  const tabName = tab ? tab.routes[tab.index ?? 0]?.name : undefined
  const view = tabName ? VIEW[tabName] : undefined
  const page: RunPage | undefined = view ? { view, ...(params.target ? { work: params.target } : {}) } : undefined
  const last = t.ready ? continuable(t.runs) : null
  const blocked = !!threadId && (!t.ready || !last)
  const title = t.runs[0]?.prompt.split('\n')[0] || (threadId ? '대화' : '새 대화')

  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerRight: () => (
        <HeaderMenu
          actions={[
            { label: '새 대화', onPress: () => fresh() },
            ...(t.running ? [{ label: '멈추기', onPress: () => void stop(), destructive: true }] : []),
          ]}
        />
      ),
    })
  })

  // 끝난 답을 화면에서 봤으면 그 대화의 "확인 기다림"을 확인함으로(한 번)
  const seenFor = useRef<string | null>(null)
  const lastRun = t.runs[t.runs.length - 1]
  useEffect(() => {
    if (!t.visible || !lastRun || lastRun.status !== 'done' || seenFor.current === lastRun.id) return
    seenFor.current = lastRun.id
    runsApi.seen(writeScope, lastRun.thread || lastRun.id).catch(() => null)
  }, [t.visible, lastRun, origin])

  const outLen = useMemo(() => t.runs.reduce((n, r) => n + r.output.length + (r.steps?.length ?? 0), t.runs.length), [t.runs])
  useEffect(() => {
    if (stick.current) requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: false }))
  }, [outLen, threadId])

  function fresh() {
    gen.current++
    setThreadId(null)
    navigation.setParams({ thread: undefined })
    setText('')
    setSendError(null)
  }
  const select = (id: string) => {
    gen.current++
    setThreadId(id)
    navigation.setParams({ thread: id })
  }

  const send = async () => {
    const prompt = quotedPrompt(text, quote)
    if (!prompt || lock.current || t.running || blocked) return
    const body = runBody({ prompt, page, last, choice, target: withWork && params.target ? params.target : null })
    if (!body) return
    lock.current = true
    setBusy(true)
    setSendError(null)
    const g = gen.current
    const scope = generation
    const sent = text
    try {
      const run = await intents.startRun(writeScope, body, prompt.split('\n')[0]?.slice(0, 40) || '대화')
      if (!isCurrent(scope)) return
      void store.fetch(THREADS_KEY, () => runsApi.threads(origin))
      if (g !== gen.current) {
        toast('보냈어요 · 대화 목록에서 확인할 수 있어요')
        return
      }
      setText((cur) => afterSend(cur, sent))
      setQuote(null)
      const tid = run.thread || run.id
      stick.current = true
      if (tid === threadId) await t.load(true)
      else select(tid)
    } catch (e) {
      if (!isCurrent(scope)) return
      setSendError(e)
      if (e instanceof UnknownWriteError) {
        void store.fetch(THREADS_KEY, () => runsApi.threads(origin))
        if (threadId) void t.load(true)
      }
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const retry = async (run: Run) => {
    if (lock.current || t.running) return
    lock.current = true
    setBusy(true)
    const g = gen.current
    try {
      const next = await runsApi.retry(writeScope, run.id)
      if (g === gen.current) select(next.thread || next.id)
    } catch (e) {
      toast(`다시 시도하지 못했어요 · ${errorMessage(e)}`)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const stop = async () => {
    const r = [...t.runs].reverse().find((x) => x.status === 'running')
    if (r) await runsApi.stop(writeScope, r.id).catch((e: unknown) => toast(`멈추지 못했어요 · ${errorMessage(e)}`))
    await t.load(true)
  }
  // 레인 1: 일에 붙은 대화의 답을 그 일 노트 끝에(웹 chat-pane "노트에 넣기"). 결과를 모르면 실패라 하지 않고 확인할 곳을 알려요
  const answerToNote = useAnswerToNote()
  const toNote = async (run: Run, target: string) => {
    const look = { label: '노트 보기', onPress: () => showWorkNote(navigation, target) }
    try {
      const r = await answerToNote(target, run)
      toast(r === 'added' ? '노트에 넣었어요' : '이미 노트에 넣은 답이에요', look)
    } catch (e) {
      if (e instanceof UnknownWriteError) toast('노트에 들어갔는지 확인하지 못했어요. 홈의 끝나지 않은 요청에서 확인할 수 있어요(읽어 보기만 해요)', look)
      else if (e instanceof ScopeChangedError) toast(e.message)
      else toast(`노트에 넣지 못했어요 · ${errorMessage(e)}`)
    }
  }
  const answerActions = (run: Run) =>
    showActions(
      [
        ...(params.target && run.status === 'done' && run.output.trim() ? [{ label: '노트에 넣기', onPress: () => void toNote(run, params.target ?? '') }] : []),
        { label: '복사', onPress: () => void Clipboard.setStringAsync(run.output).then(() => toast('복사했어요'), () => toast('복사하지 못했어요')) },
        { label: '공유', onPress: () => void Share.share({ message: run.output }) },
      ],
      '답',
    )
  const openLink = (href: string) => {
    if (externalLink(href)) void WebBrowser.openBrowserAsync(href)
  }

  const chips = threadId ? (
    <Chip label={last ? `같은 세션 이어서 · ${last.model_name || last.model}` : t.running ? '답을 기다리는 중이에요' : '대화를 불러오는 중이에요'} />
  ) : (
    <>
      <ModelChip cat={cat} choice={choice} onPress={() => setSheet(true)} />
      {params.target ? <Chip label="이 일 함께 보내기" selected={withWork} onPress={() => setWithWork((v) => !v)} /> : null}
      {view ? <Text style={styles.small}>AI가 보는 화면: {VIEW_KO[view]}{params.target ? ' · 열어 둔 일' : ''}</Text> : null}
    </>
  )
  const cannotContinue = !!threadId && t.status === 'ready' && !t.running && !last
  return (
    <View style={styles.page}>
      <ScrollView
        ref={scroller}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: bar + bottom + 12 }]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        onContentSizeChange={() => {
          if (stick.current) scroller.current?.scrollToEnd({ animated: false })
        }}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
          stick.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80
        }}
        scrollEventThrottle={100}
      >
        {!threadId ? (
          <Empty
            title={params.target ? '이 일을 아는 에이전트와 새 대화' : '새 대화'}
            body={params.target ? '이 일의 노트·연결을 함께 보고 답해요' : 'AI 실행은 그 맥의 주인 계정으로 로그인했을 때만 할 수 있어요'}
          />
        ) : t.status === 'loading' && !t.runs.length ? (
          <Text style={styles.meta}>대화를 불러오는 중이에요</Text>
        ) : t.status === 'missing' ? (
          <Empty title="대화를 찾을 수 없어요" action={{ label: '새 대화', onPress: fresh }} />
        ) : (
          <>
            {t.status === 'error' ? (
              <View style={s.notice} accessibilityRole="alert">
                <Text style={styles.meta}>{t.runs.length ? '연결이 끊겼어요. 다시 시도해 주세요' : '대화를 열지 못했어요'} · {errorMessage(t.error)}</Text>
                <LoginPrompt error={t.error} />
                <Button variant="outline" title="다시 시도" onPress={() => void t.load()} />
              </View>
            ) : null}
            {t.truncated ? <Text style={[styles.small, s.center]}>앞의 오래된 대화는 생략했어요</Text> : null}
            {t.runs.map((r) => (
              <RunBlock key={r.id} run={r} now={now} onRetry={retry} retrying={busy || t.running} onAnswerLongPress={answerActions} onLink={openLink} />
            ))}
          </>
        )}
        {sendError ? (
          <View style={s.notice} accessibilityRole="alert">
            <Text style={styles.meta}>{sendError instanceof UnknownWriteError ? '보냈는지 확인하지 못했어요. 홈의 끝나지 않은 요청에서 확인할 수 있어요(읽어 보기만 하고, 다시 보내기는 직접 눌러요)' : `보내지 못했어요 · ${errorMessage(sendError)}`}</Text>
            <LoginPrompt error={sendError} />
          </View>
        ) : null}
      </ScrollView>
      <BottomBar onHeight={setBar}>
        {quote ? (
          <View style={s.quote}>
            <Text style={[styles.small, s.quoteText]} numberOfLines={3}>{quote}</Text>
            <Button variant="plain" title="인용 빼기" onPress={() => setQuote(null)} />
          </View>
        ) : null}
        {cannotContinue ? (
          <View style={s.blocked}>
            <Text style={styles.meta}>이 대화는 이어갈 수 없어요. 새 대화를 시작해 주세요</Text>
            <Button variant="outline" title="새 대화" onPress={fresh} />
          </View>
        ) : (
          <Composer
            value={text}
            onChange={setText}
            onSend={() => void send()}
            onStop={() => void stop()}
            running={t.running}
            busy={busy}
            canSend={!blocked && (!!threadId || !!choice)}
            allowEmpty={!!quote}
            placeholder={threadId ? '이어서 물어보기' : quote ? '이 부분에 대해 물어봐요 (비워두면 설명해 줘요)' : 'AI에게 맡길 일을 적어요'}
            chips={chips}
          />
        )}
      </BottomBar>
      <ModelSheet visible={sheet} onClose={() => setSheet(false)} cat={cat} choice={choice} onChange={setChoice} {...modelSheet} />
    </View>
  )
}
const s = StyleSheet.create({
  notice: { backgroundColor: colors.fill, borderRadius: 12, padding: space.md, gap: space.sm },
  center: { textAlign: 'center' },
  blocked: { gap: space.sm },
  quote: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.fill, borderRadius: 10, paddingLeft: space.md, marginBottom: space.sm },
  quoteText: { flex: 1, paddingVertical: space.sm },
})
