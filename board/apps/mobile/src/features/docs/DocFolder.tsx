// 문서 계층의 한 층(라우트 DocFolder). 문서 페이지의 "하위 문서 모두 보기"나 길게 누르기 "하위 문서 보기"로 와요.
// 위에 브레드크럼(맨 위 … 가까운 둘), 아래 그 부모의 자식(형제 순서, 50개씩). 길게 누르기로 이동·위로/아래로·맨 위로·하위 문서 만들기.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { SymbolView } from 'expo-symbols'
import type { SearchHit } from '@direction-board/contracts'
import { appendPage, crumbs } from '@direction-board/contracts/doc-tree'
import { errorMessage } from '../../api/client'
import { docsApi } from '../../api/docs'
import { useQuery, useScope } from '../../api/query'
import type { StackParams } from '../../navigation/routes'
import { useServer } from '../../server'
import { Button } from '../../ui/Button'
import { Screen } from '../../ui/Screen'
import { Empty, Loaded } from '../../ui/StateView'
import { schemeColors, space, styles } from '../../ui/theme'
import { onDocsChanged } from './events'
import { useDocSheets } from './sheets'
import { DocList } from './views'

export function DocFolder({ route, navigation }: NativeStackScreenProps<StackParams, 'DocFolder'>) {
  const { parent, title } = route.params
  const { origin } = useServer()
  const { generation, isCurrent } = useScope()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const sheets = useDocSheets()
  const first = useQuery(`docs/children/${parent ?? 'root'}`, () => docsApi.children(origin, parent))
  const meta = useQuery(`docs/meta/${parent ?? 'root'}`, () => (parent ? docsApi.meta(origin, parent) : Promise.resolve(null)))
  const [more, setMore] = useState<SearchHit[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const page = useRef(0)
  useEffect(() => {
    page.current++
    setMore([])
    setCursor(undefined)
    setError('')
  }, [first.data, generation])
  const refresh = first.refresh
  const refreshMeta = meta.refresh
  useEffect(() => onDocsChanged(() => { void refresh(); void refreshMeta() }), [refresh, refreshMeta])
  const name = parent ? (meta.data?.title ?? title ?? '문서') : '맨 위 문서'
  const openCreateRef = useRef(sheets.openCreate)
  openCreateRef.current = sheets.openCreate
  const areaOf = typeof meta.data?.frontmatter.area === 'string' ? meta.data.frontmatter.area : null
  useLayoutEffect(() => {
    navigation.setOptions({
      title: name,
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel={parent ? '하위 문서 만들기' : '새 문서'} hitSlop={10} onPress={() => openCreateRef.current(parent ? { parent: { ref: parent, title: name }, area: areaOf, links: [{ ref: parent, title: name }], linksOn: false } : {})}>
          <SymbolView name="square.and.pencil" size={22} tintColor={c.ink} />
        </Pressable>
      ),
    })
  }, [navigation, name, parent, areaOf, c.ink])
  const next = cursor === null ? undefined : (cursor ?? first.data?.nextCursor)
  const loadMore = useCallback(async () => {
    if (!next || busy) return
    const started = generation
    const p0 = page.current
    setBusy(true)
    try {
      const r = await docsApi.children(origin, parent, next)
      if (!isCurrent(started) || p0 !== page.current) return
      setMore((rows) => appendPage(rows, r.results))
      setCursor(r.nextCursor ?? null)
    } catch (e) {
      if (isCurrent(started) && p0 === page.current) setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }, [next, busy, generation, origin, parent, isCurrent])
  const ancestors = [...(meta.data?.ancestors ?? []), ...(parent ? [{ ref: parent, title: name }] : [])]
  return (
    <Screen onRefresh={async () => { await Promise.all([first.refresh(), meta.refresh()]) }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.crumbs} accessibilityLabel="문서 위치">
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Docs')} hitSlop={8}>
          <Text style={styles.meta}>문서</Text>
        </Pressable>
        {crumbs(ancestors, 3).map((cr, i) =>
          'gap' in cr ? (
            <Text key={`gap${i}`} style={styles.meta}>› …</Text>
          ) : (
            <Pressable key={cr.ref} accessibilityRole="button" disabled={cr.ref === parent} onPress={() => navigation.push('DocFolder', { parent: cr.ref, title: cr.title })} hitSlop={8}>
              <Text style={cr.ref === parent ? styles.strong : styles.meta} numberOfLines={1}>
                › {cr.title || '제목 없음'}
              </Text>
            </Pressable>
          ),
        )}
      </ScrollView>
      {parent ? <Button variant="plain" title="이 문서 열기" onPress={() => navigation.push('Doc', { ref: parent, title: name })} /> : null}
      <Loaded query={first}>
        {(data) => {
          const rows = appendPage(data.results, more)
          if (!rows.length) return <Empty title="하위 문서가 없어요" action={{ label: parent ? '하위 문서 만들기' : '새 문서', onPress: () => sheets.openCreate(parent ? { parent: { ref: parent, title: name }, links: [{ ref: parent, title: name }], linksOn: false } : {}) }} />
          return (
            <>
              <DocList docs={rows} columns={[]} onOpen={(d) => sheets.open(d)} actions={(d) => sheets.actions(d, { siblings: rows, index: rows.findIndex((x) => x.ref === d.ref), stale: first.fetching })} />
              {error ? <Button variant="outline" title={`다시 시도 · ${error}`} onPress={() => void loadMore()} /> : null}
              {next ? <Button variant="outline" title={busy ? '불러오는 중' : '더 보기'} disabled={busy} onPress={() => void loadMore()} /> : null}
            </>
          )
        }}
      </Loaded>
      {sheets.elements}
    </Screen>
  )
}
const s = StyleSheet.create({ crumbs: { gap: space.sm, alignItems: 'center' } })
