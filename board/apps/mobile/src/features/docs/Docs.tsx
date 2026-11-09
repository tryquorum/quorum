// 문서 탭 루트(웹 docs-view.tsx 의 자리): 머리 검색창, 필터 칩·시트, 보기 다섯(목록·아이콘·갤러리·열·트리), 즐겨찾기 줄, 새 문서.
// 길게 누르기가 웹 키(m·F2·Space·N)의 자리예요(sheets.tsx). 설계: devlog/_plan/261107_ios_parity/docs/010_base_list.md
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { SymbolView } from 'expo-symbols'
import type { SearchHit } from '@direction-board/contracts'
import { docsApi, type DocFilters } from '../../api/docs'
import { useQuery } from '../../api/query'
import type { StackParams } from '../../navigation/routes'
import { useServer } from '../../server'
import { showActions } from '../../ui/actions'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { Screen } from '../../ui/Screen'
import { Empty, Loaded } from '../../ui/StateView'
import { colors, schemeColors, space, styles } from '../../ui/theme'
import { AXES, axisLabel, ColumnView } from './ColumnView'
import { activeFilters, EMPTY_FILTERS, filterIssue, FilterSheet, type FilterState } from './FilterSheet'
import { GROUPS } from './groups'
import { useDocSheets } from './sheets'
import { useDocsUi, useFavorites, type DocsView } from './store'
import { TreeView } from './TreeView'
import { AUTO_LOAD, useDocList } from './useDocList'
import { DocGallery, DocGrid, DocList } from './views'

const VIEWS: { id: DocsView; label: string }[] = [
  { id: 'list', label: '목록' },
  { id: 'icon', label: '아이콘' },
  { id: 'gallery', label: '갤러리' },
  { id: 'columns', label: '열' },
  { id: 'tree', label: '트리' },
]
// 문서 페이지에 갔다 와도 검색어·필터가 남아요(웹 previousFilters 와 같음)
let remembered: { q: string; filters: FilterState } = { q: '', filters: EMPTY_FILTERS }

export function Docs() {
  const navigation = useNavigation<NativeStackNavigationProp<StackParams>>()
  const route = useRoute<RouteProp<StackParams, 'Docs'>>()
  const { origin } = useServer()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const { ui, setUi, saveFailed } = useDocsUi()
  const fav = useFavorites()
  const sheets = useDocSheets()
  const [q, setQ] = useState(remembered.q)
  const [query, setQuery] = useState(remembered.q)
  const [f, setF] = useState<FilterState>(remembered.filters)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const set = (patch: Partial<FilterState>) => setF((old) => ({ ...old, ...patch }))
  useEffect(() => {
    remembered = { q, filters: f }
  }, [q, f])
  // 입력이 멈추고 180ms 뒤 검색(웹과 같음). 늦은 응답은 캐시 키가 달라 화면에 섞이지 않아요
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 180)
    return () => clearTimeout(t)
  }, [q])
  // 문서 페이지의 태그를 누르면 그 태그로 걸러요
  const tagParam = (route.params as { tag?: string } | undefined)?.tag
  useEffect(() => {
    if (tagParam) setF((old) => (old.tags.includes(tagParam) ? old : { ...old, tags: [tagParam] }))
  }, [tagParam])
  const schema = sheets.schema
  const issue = filterIssue(f, schema.data)
  const filters: DocFilters = useMemo(
    () => ({ q: query, area: f.area, status: f.status, kinds: f.kind ? [f.kind] : [], tags: f.tags, includeAi: f.includeAi, sort: f.sort, props: f.propKey ? [{ key: f.propKey, op: f.propOp, value: f.propValue }] : [] }),
    [query, f],
  )
  const view = ui.view
  const list = useDocList(filters, !issue, view === 'icon' || view === 'gallery' || view === 'columns')
  // 머리 옵션은 바뀐 값이 있을 때만 다시 넣어요(그릴 때마다 넣으면 내비게이션이 다시 그려져요). 누를 때는 최신 함수를 ref 로
  const openCreateRef = useRef(sheets.openCreate)
  openCreateRef.current = sheets.openCreate
  useLayoutEffect(() => {
    navigation.setOptions({
      // stacked: 큰 제목 아래에 둬요(iOS 26 기본은 아래 도구 막대라 떠 있는 필 뒤에 가려요)
      headerSearchBarOptions: { placeholder: '문서 검색', hideWhenScrolling: false, placement: 'stacked', onChangeText: (e) => setQ(e.nativeEvent.text), onCancelButtonPress: () => setQ('') },
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="새 문서" hitSlop={10} onPress={() => openCreateRef.current({ area: f.area || null })}>
          <SymbolView name="square.and.pencil" size={22} tintColor={c.ink} />
        </Pressable>
      ),
    })
  }, [navigation, f.area, c.ink])
  const active = activeFilters(f, set)
  // 모두 풀기는 한 번에(칩마다 따로 풀면 같은 옛 값을 보고 서로 덮어요)
  const clearAll = () => setF(EMPTY_FILTERS)
  const favDocs = fav.favorites
  const favTitles = useQuery(`docs/favorites/${favDocs.join(',')}`, async () => Promise.all(favDocs.map((ref) => docsApi.meta(origin, ref).then((m) => ({ ref, title: m.title }), () => ({ ref, title: ref })))))
  const open = (d: { ref: string; title: string }) => sheets.open(d)
  const refresh = async () => {
    setReloadKey((n) => n + 1)
    await Promise.all([list.first.refresh(), schema.refresh()])
  }
  const body = (docs: SearchHit[]) => {
    if (view === 'tree') return <TreeView onOpen={open} actions={sheets.actions} reloadKey={reloadKey} />
    if (!docs.length)
      return <Empty title="맞는 문서가 없어요" body={active.length || query ? '검색어나 필터를 바꿔 보세요' : '웹·에이전트·여기서 만든 문서가 모여요'} action={active.length ? { label: '필터 풀기', onPress: clearAll } : { label: '새 문서', onPress: () => sheets.openCreate({}) }} />
    if (view === 'icon') return <DocGrid docs={docs} group={ui.group} onOpen={open} actions={sheets.actions} />
    if (view === 'gallery') return <DocGallery docs={docs} onOpen={open} actions={sheets.actions} onEnd={() => void list.loadMore()} />
    if (view === 'columns') return <ColumnView docs={docs} axis={ui.axis} onOpen={open} actions={sheets.actions} />
    return <DocList docs={docs} columns={ui.columns} onOpen={open} actions={sheets.actions} />
  }
  const treeHidesFilters = view === 'tree' && (active.length > 0 || !!query)
  return (
    <Screen onRefresh={refresh}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} accessibilityLabel="걸린 필터">
        <Chip label={active.length ? `필터 ${active.length}` : '필터'} selected={active.length > 0} onPress={() => setFiltersOpen(true)} />
        {active.map((a) => (
          <Pressable key={a.key} accessibilityRole="button" accessibilityLabel={`${a.label} 필터 빼기`} onPress={a.clear} hitSlop={6} style={s.activeChip}>
            <Text style={s.activeText}>{a.label}</Text>
            <SymbolView name="xmark" size={10} tintColor={c.card} />
          </Pressable>
        ))}
        {active.length > 1 ? <Chip label="모두 풀기" onPress={clearAll} /> : null}
      </ScrollView>
      <View style={s.views} accessibilityRole="tablist">
        {VIEWS.map((v) => (
          <Pressable key={v.id} accessibilityRole="tab" accessibilityState={{ selected: view === v.id }} onPress={() => setUi({ view: v.id })} style={[s.viewBtn, view === v.id && s.viewOn]}>
            <Text style={[s.viewText, view === v.id && s.viewTextOn]}>{v.label}</Text>
          </Pressable>
        ))}
      </View>
      {view === 'icon' ? <Button variant="plain" title={`묶음: ${GROUPS.find((g) => g.id === ui.group)?.label}`} onPress={() => showActions(GROUPS.map((g) => ({ label: g.label, onPress: () => setUi({ group: g.id }) })), '묶음')} /> : null}
      {view === 'columns' ? <Button variant="plain" title={`열 기준: ${axisLabel(ui.axis)}`} onPress={() => showActions(AXES.map((a) => ({ label: axisLabel(a), onPress: () => setUi({ axis: a }) })), '열 기준')} /> : null}
      {favDocs.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} accessibilityLabel="즐겨찾기">
          {(favTitles.data ?? favDocs.map((ref) => ({ ref, title: ref }))).map((d) => (
            <Chip key={d.ref} label={`★ ${d.title}`} onPress={() => open(d)} />
          ))}
        </ScrollView>
      ) : null}
      {saveFailed || fav.saveFailed ? <Text style={styles.small}>화면 설정을 기기에 저장하지 못했어요. 지금은 그대로 써요</Text> : null}
      {issue ? <Text style={styles.meta}>{issue}</Text> : null}
      {treeHidesFilters ? <Empty title="트리는 검색·필터 없이 보여요" action={{ label: '필터 풀기', onPress: () => { setQ(''); clearAll() } }} /> : view === 'tree' ? body([]) : issue ? null : (
        <Loaded query={list.first}>
          {() => (
            <View style={s.body}>
              <Text style={styles.small} accessibilityLabel={`전체 ${list.total}개 중 ${list.results.length}개 표시`}>
                {list.results.length < list.total ? `${list.results.length} / ${list.total}` : list.total}개{list.busy ? ' · 불러오는 중' : ''}
              </Text>
              {body(list.results)}
              {list.error ? <Button variant="outline" title={`다시 시도 · ${list.error}`} onPress={() => void list.loadMore()} /> : null}
              {list.next && !list.busy && !list.error && (view === 'list' || list.results.length >= AUTO_LOAD) ? <Button variant="outline" title="더 보기" onPress={() => void list.loadMore()} /> : null}
            </View>
          )}
        </Loaded>
      )}
      <FilterSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={f}
        set={set}
        schema={schema.data}
        schemaError={schema.status === 'error'}
        retrySchema={() => void schema.refresh()}
        showColumns={view === 'list'}
        columns={ui.columns}
        setColumns={(columns) => setUi({ columns })}
      />
      {sheets.elements}
    </Screen>
  )
}
const s = StyleSheet.create({
  chips: { gap: space.sm, alignItems: 'center', paddingVertical: 2 },
  activeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  activeText: { color: colors.onPrimary, fontSize: 12, fontWeight: '500' },
  views: { flexDirection: 'row', backgroundColor: colors.fill, borderRadius: 10, padding: 2 },
  viewBtn: { flex: 1, minHeight: space.target - 8, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  viewOn: { backgroundColor: colors.card },
  viewText: { color: colors.muted, fontSize: 14, fontWeight: '500' },
  viewTextOn: { color: colors.ink, fontWeight: '600' },
  body: { gap: space.md },
})
