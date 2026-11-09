// 열 보기(웹 Finder 열 보기). 좁은 화면이라 한 번에 한 열만 보여요: 항목을 누르면 다음 열로, 위 경로 칩이나 "뒤로"로 올라가요.
// 축(종류→영역·태그 계층·링크 따라가기·폴더)과 열 계산은 웹과 같은 columns.ts. 링크 축은 지나온 문서에 "경로 안" 표시를 붙이고 더 들어가지 않아요.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import type { SearchHit } from '@direction-board/contracts'
import { appendPage, createGenerations } from '@direction-board/contracts/doc-tree'
import { docsApi } from '../../api/docs'
import { useScope } from '../../api/query'
import { useServer } from '../../server'
import { showActions, type Action } from '../../ui/actions'
import { Button } from '../../ui/Button'
import { colors, schemeColors, space, styles } from '../../ui/theme'
import { buildColumns, type DocLite, type Entry, type FolderState, type LinkState, type ListColumn } from './columns'
import { onDocsChanged } from './events'
import { kindIcon } from './labels'
import type { ColumnAxis } from './store'
import { DocFacts, DocHead } from './views'

const AXIS_LABEL: Record<ColumnAxis, string> = { kind: '종류 → 영역', tag: '태그 계층', link: '링크 따라가기', folder: '폴더(문서 계층)' }
export const AXES = Object.keys(AXIS_LABEL) as ColumnAxis[]
export const axisLabel = (a: ColumnAxis) => AXIS_LABEL[a]

export function ColumnView({ docs, axis, onOpen, actions }: { docs: SearchHit[]; axis: ColumnAxis; onOpen: (d: DocLite) => void; actions: (d: SearchHit) => Action[] }) {
  const { origin } = useServer()
  const { generation } = useScope()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const [path, setPath] = useState<string[]>([])
  /** 지나온 열 번호(맨 위 0 은 늘 있음) */
  const [stack, setStack] = useState<number[]>([])
  const [links, setLinks] = useState<LinkState>({})
  const [folders, setFolders] = useState<FolderState>({})
  const [moreBusy, setMoreBusy] = useState<string | null>(null)
  const gens = useRef(createGenerations())
  useEffect(() => {
    setPath([])
    setStack([])
  }, [axis])
  useEffect(() => {
    gens.current.reset()
    setLinks({})
    setFolders({})
    setPath([])
    setStack([])
  }, [generation])
  useEffect(
    () =>
      onDocsChanged(() => {
        gens.current.reset()
        setFolders({})
        setLinks({})
      }),
    [],
  )
  const built = useMemo(() => buildColumns(axis, docs as DocLite[], path, links, folders), [axis, docs, path, links, folders])
  const { columns, trail } = built
  useEffect(() => {
    if (axis !== 'link') return
    for (const e of trail) {
      const ref = e.doc?.ref
      if (!ref || links[ref]) continue
      // 폴더처럼 링크 요청에도 세대를 둬요(전환·새로 읽기 전에 보낸 늦은 응답은 버림)
      const key = `link:${ref}`
      const g = gens.current.fresh(key)
      setLinks((old) => ({ ...old, [ref]: 'loading' }))
      docsApi.related(origin, ref, 'both', 50).then(
        (r) => gens.current.isCurrent(key, g) && setLinks((old) => ({ ...old, [ref]: r })),
        () => gens.current.isCurrent(key, g) && setLinks((old) => ({ ...old, [ref]: 'error' })),
      )
    }
  }, [axis, trail, links, origin])
  useEffect(() => {
    if (axis !== 'folder') return
    const need = ['root', ...trail.flatMap((e) => (e.doc && e.hasChildren ? [e.doc.ref] : []))]
    for (const key of need) {
      if (folders[key]) continue
      const g = gens.current.fresh(key)
      setFolders((old) => ({ ...old, [key]: 'loading' }))
      docsApi.children(origin, key === 'root' ? null : key).then(
        (r) => gens.current.isCurrent(key, g) && setFolders((old) => ({ ...old, [key]: r })),
        () => gens.current.isCurrent(key, g) && setFolders((old) => ({ ...old, [key]: 'error' })),
      )
    }
  }, [axis, trail, folders, origin])
  const loadMore = (key: string) => {
    const s = folders[key]
    if (typeof s !== 'object' || !s.nextCursor || moreBusy) return
    const cursor = s.nextCursor
    const g = gens.current.current(key)
    setMoreBusy(key)
    docsApi
      .children(origin, key === 'root' ? null : key, cursor)
      .then(
        (r) =>
          gens.current.isCurrent(key, g) &&
          setFolders((old) => {
            const o = old[key]
            return typeof o === 'object' && o.nextCursor === cursor ? { ...old, [key]: { ...o, results: appendPage(o.results, r.results), nextCursor: r.nextCursor } } : old
          }),
        () => undefined,
      )
      .finally(() => setMoreBusy((k) => (k === key ? null : k)))
  }
  const current = Math.min(stack[stack.length - 1] ?? 0, columns.length - 1)
  const choose = (i: number, entry: Entry) => {
    if (entry.cycle) return
    setPath([...built.path.slice(0, i), entry.key])
    const target = entry.doc ? (axis === 'link' ? i + 2 : i + 1) : i + 1
    setStack((s) => [...s.filter((x) => x <= i), target])
  }
  const backTo = (depth: number) => {
    const next = stack.slice(0, depth)
    setStack(next)
    setPath(built.path.slice(0, next[next.length - 1] ?? 0))
  }
  const col = columns[current]
  const icon = (e: Entry): SFSymbol => (e.doc ? kindIcon(e.doc.kind) : e.icon === 'kind' ? kindIcon(e.key.slice(5)) : e.icon === 'tag' ? 'number' : e.icon === 'none' ? 'circle.dashed' : 'folder')
  const renderList = (list: ListColumn, i: number) => {
    if (list.state === 'loading') return <Text style={[styles.meta, s.pad]}>불러오는 중…</Text>
    if (list.state === 'error') return <Text accessibilityRole="alert" style={[styles.meta, s.pad]}>불러오지 못했어요</Text>
    if (!list.entries.length) return <Text style={[styles.meta, s.pad]}>{list.docRef ? '연결된 문서가 없어요' : '비어 있어요'}</Text>
    let section: string | undefined
    return list.entries.map((e) => {
      const head = e.section && e.section !== section ? e.section : null
      section = e.section
      const hit = e.doc && 'snippet' in e.doc ? (e.doc as SearchHit) : null
      const acts = hit ? actions(hit) : []
      return (
        <React.Fragment key={e.key}>
          {head ? <Text accessibilityRole="header" style={s.section}>{head}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={[e.label, e.count !== undefined ? `${e.count}개` : '', e.cycle ? '이미 경로에 있는 문서' : ''].filter(Boolean).join(', ')}
            accessibilityState={{ disabled: !!e.cycle }}
            onPress={() => choose(i, e)}
            onLongPress={acts.length ? () => showActions(acts, e.label) : undefined}
            delayLongPress={350}
            style={({ pressed }) => [s.row, pressed && s.pressed]}
          >
            <SymbolView name={icon(e)} size={16} tintColor={c.muted} />
            <Text style={[styles.text, s.flex, e.cycle && s.dim]} numberOfLines={2}>
              {e.label}
            </Text>
            {e.cycle ? <Text style={styles.small}>↻ 경로 안</Text> : null}
            {e.count !== undefined ? <Text style={styles.small}>{e.count}</Text> : null}
            {e.hasChildren && !e.cycle ? <SymbolView name="chevron.right" size={13} tintColor={c.muted} /> : null}
          </Pressable>
        </React.Fragment>
      )
    })
  }
  return (
    <View style={s.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.trail} accessibilityLabel="경로">
        <Pressable accessibilityRole="button" onPress={() => backTo(0)} hitSlop={8}>
          <Text style={trail.length ? styles.meta : styles.strong}>{axis === 'kind' ? '종류' : axis === 'tag' ? '태그' : axis === 'folder' ? '맨 위' : '문서'}</Text>
        </Pressable>
        {trail.map((e, n) => (
          <Pressable key={e.key + n} accessibilityRole="button" onPress={() => backTo(n + 1)} hitSlop={8}>
            <Text style={n === trail.length - 1 ? styles.strong : styles.meta} numberOfLines={1}>
              › {e.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {stack.length ? <Button variant="outline" title={`‹ 뒤로`} onPress={() => backTo(stack.length - 1)} /> : null}
      {col?.type === 'preview' ? (
        <View style={[styles.group, s.preview]}>
          <Text style={styles.heading}>{col.doc.title || '제목 없음'}</Text>
          {'snippet' in col.doc ? <DocFacts doc={col.doc as SearchHit} /> : null}
          {'snippet' in col.doc ? <DocHead doc={col.doc as SearchHit} /> : null}
          <Button title="열기" onPress={() => onOpen(col.doc)} />
        </View>
      ) : col ? (
        <View style={styles.group}>
          <Text accessibilityRole="header" style={[styles.strong, s.pad]}>
            {col.label}
          </Text>
          {col.docRef ? <Button variant="plain" title="이 문서 열기" onPress={() => { const d = trail[current - 1]?.doc; if (d) onOpen(d) }} /> : null}
          {renderList(col, current)}
          {col.truncated ? <Text style={[styles.small, s.pad]}>연결이 많아 앞의 50개만 보여요</Text> : null}
          {col.more ? <Button variant="plain" title={moreBusy === col.more ? '불러오는 중…' : '더 보기'} disabled={moreBusy === col.more} onPress={() => col.more && loadMore(col.more)} /> : null}
        </View>
      ) : null}
    </View>
  )
}
const s = StyleSheet.create({
  wrap: { gap: space.md },
  trail: { gap: space.sm, alignItems: 'center' },
  pad: { paddingHorizontal: space.gutter, paddingVertical: space.sm },
  section: { color: colors.muted, fontSize: 13, fontWeight: '600', paddingHorizontal: space.gutter, paddingTop: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: space.target + 4, paddingHorizontal: space.gutter, paddingVertical: 8 },
  pressed: { backgroundColor: colors.fill },
  flex: { flex: 1 },
  dim: { opacity: 0.5 },
  preview: { padding: space.lg, gap: space.md },
})
