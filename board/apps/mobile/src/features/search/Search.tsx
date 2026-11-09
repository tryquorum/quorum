import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View, useColorScheme, type TextInputInstance } from 'react-native'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import type { SearchResult } from '@direction-board/contracts'
import { useBoardState, useSaveItem, useSignals } from '../../api/board'
import { errorMessage, request } from '../../api/client'
import { runSweepNow, useOps } from '../../api/ops'
import { useScope } from '../../api/query'
import type { RootParams, StackParams } from '../../navigation/routes'
import { useServer } from '../../server'
import { Row } from '../../ui/Row'
import { Screen } from '../../ui/Screen'
import { Section } from '../../ui/Section'
import { useToast } from '../../ui/Toast'
import { schemeColors, space, styles } from '../../ui/theme'
import { confirmUnsavedPrompt } from '../settings/PromptEditor'
import { useDraftOwner } from '../settings/useDraftOwner'
import { searchGroups, type SearchRow } from './groups'
import { useWriteScope } from '../../api/scope'
import { useIntents } from '../board/useIntents'

type Nav = NavigationProp<StackParams & RootParams & { HomeTab: undefined; ListTab: undefined; DocsTab: undefined; AiTab: undefined }>

/** 문서 검색(웹 ⌘K 와 같은 /api/docs/search, 200ms 뒤). 검색어가 바뀌거나 범위가 바뀌면 앞 요청 결과는 버려요 */
function useDocSearch(query: string) {
  const { origin } = useServer()
  const { generation, isCurrent } = useScope()
  const [docs, setDocs] = useState<SearchResult | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'ok'>('idle')
  const seq = useRef(0)
  useEffect(() => {
    const n = ++seq.current
    setDocs(null)
    const q = query.trim()
    if (!q) {
      setState('idle')
      return
    }
    setState('loading')
    const g = generation
    const timer = setTimeout(() => {
      request<SearchResult>(origin, `/api/docs/search?q=${encodeURIComponent(q)}`).then(
        (r) => {
          if (n !== seq.current || !isCurrent(g)) return
          setDocs(r)
          setState('ok')
        },
        () => {
          if (n === seq.current && isCurrent(g)) setState('error')
        },
      )
    }, 200)
    return () => clearTimeout(timer)
  }, [query, origin, generation, isCurrent])
  return { docs, state }
}

/** 검색 탭(웹 ⌘K): 화면·명령·설정·할 일·목표·사건·문서를 한 입구에서 찾고, 할 일로 추가·AI에게 묻기 */
export function Search({ route }: NativeStackScreenProps<StackParams, 'Search'>) {
  const navigation = useNavigation<Nav>()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const toast = useToast()
  const [query, setQuery] = useState(route.params?.q ?? '')
  const input = useRef<TextInputInstance>(null)
  const board = useBoardState()
  const signals = useSignals()
  const ops = useOps(false)
  const { docs, state: docsState } = useDocSearch(query)
  const owner = useDraftOwner()
  const saveItem = useSaveItem()
  const scope = useWriteScope()
  const intents = useIntents()
  // 탭을 다시 누르면(이미 검색 탭일 때) 검색 칸에 바로 써요. 처음 들어올 때는 키보드가 결과를 가리지 않게 올리지 않아요
  useEffect(() => {
    const parent = navigation.getParent()
    const off = parent?.addListener('tabPress' as never, () => {
      if (navigation.isFocused()) input.current?.focus()
    })
    return off
  }, [navigation])
  const routes = navigation.getState()?.routeNames ?? []
  const root = navigation.getParent()?.getParent()?.getState()?.routeNames ?? []
  const personal = board.data?.boards.find((b) => b.kind === 'personal' && b.mine && !b.deleted)
  const hasQuickAdd = root.includes('QuickAdd')
  const signalsStatus = signals.data ? 'ok' : signals.status === 'error' ? 'error' : 'loading'
  const { groups, nothing } = searchGroups({
    query,
    items: board.data?.items ?? [],
    boards: board.data?.boards ?? [],
    signals: signals.data?.signals ?? [],
    signalsStatus,
    docs,
    routes,
    quickAdd: hasQuickAdd || !!personal,
    canSweep: ops.status === 'ok',
  })
  const go = (row: SearchRow) => {
    const t = row.target
    if (t.type === 'tab') navigation.navigate(t.tab)
    else if (t.type === 'route') navigation.navigate(t.route)
    else if (t.type === 'settings') navigation.navigate('Settings', t.section ? { screen: 'SettingsSection', params: { section: t.section, item: t.item }, initial: false } : undefined)
    else if (t.type === 'work') navigation.navigate('Work', { ref: t.ref, title: row.label })
    else if (t.type === 'doc') navigation.navigate('Doc', { ref: t.ref, title: row.label })
    else if (t.type === 'sweep')
      confirmUnsavedPrompt(() => void runSweepNow(scope).then(() => toast('순회를 시작했어요. 끝나면 홈에 올라와요'), (e: unknown) => toast(errorMessage(e))), owner)
    else if (t.type === 'newTask') {
      if (hasQuickAdd) navigation.navigate('QuickAdd', t.text ? { text: t.text } : undefined)
      else if (personal && t.text) addTask(personal.id, t.text)
      else if (personal) toast('검색 칸에 할 일 제목을 적고 다시 눌러 주세요')
    }
    else navigation.navigate('Thread', { draft: t.text })
  }
  /** 빠른 추가 시트(레인 1)가 아직 없을 때: 개인 판에 제목만으로 할 일을 만들어요(웹 빠른 추가의 한 줄 Enter 와 같은 저장) */
  const addTask = (boardId: string, title: string) => {
    const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    setQuery('')
    // 새 항목은 먼저 기록하고 저장해요(규칙 B)
    void intents.createItem(scope, saveItem, { id, boardId, type: 'todo', text: title, x: 0, y: 0, w: 240, h: 90, z: Date.now(), done: false }, `할 일 추가: ${title.slice(0, 40)}`).then(
      () => toast(`할 일로 추가했어요: ${title}`, { label: '열기', onPress: () => navigation.navigate('Work', { ref: `item:${boardId}:${id}`, title }) }),
      (e: unknown) => toast(`추가하지 못했어요 · ${errorMessage(e)}`),
    )
  }
  const q = query.trim()
  return (
    <Screen keyboard onRefresh={() => Promise.all([board.refresh(), signals.refresh()])}>
      <TextInput
        ref={input}
        accessibilityLabel="화면과 일 검색"
        placeholder="화면, 설정, 할 일, 사건, 문서를 찾거나 AI에게 물어요"
        placeholderTextColor={c.muted}
        clearButtonMode="while-editing"
        autoCorrect={false}
        returnKeyType="search"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => {
          const first = groups[0]?.rows[0]
          if (first) go(first)
        }}
        style={styles.input}
      />
      {q ? (
        <Text style={styles.small} accessibilityLiveRegion="polite">
          문서 검색 · AI 초안 제외{docsState === 'loading' ? ' · 검색 중…' : docsState === 'error' ? ' · 문서 검색에 실패했어요' : ''}
        </Text>
      ) : null}
      {nothing && docsState === 'ok' ? <Text style={styles.meta}>검색 결과가 없어요. 사건은 열린 항목과 최근 7일만 찾아요.</Text> : null}
      {!q && signalsStatus !== 'ok' ? <Text style={styles.meta}>{signalsStatus === 'loading' ? '사건을 불러오는 중이에요' : '사건을 불러오지 못했어요'}</Text> : null}
      {groups.map((g) => (
        <Section key={g.title} title={g.title}>
          {g.rows.map((r) => (
            <Row key={r.id} title={r.label} meta={r.hint} leading={<SymbolView name={r.icon as SFSymbol} size={18} tintColor={c.muted} />} onPress={() => go(r)} />
          ))}
        </Section>
      ))}
      {!q && signalsStatus === 'ok' && !groups.some((g) => g.title === '안 끝난 할 일 · 목표' || g.title === '열린 사건') ? (
        <View style={s.empty}>
          <Text style={styles.meta}>안 끝난 할 일과 열린 사건이 없어요</Text>
        </View>
      ) : null}
    </Screen>
  )
}
const s = StyleSheet.create({ empty: { paddingHorizontal: space.xs } })
