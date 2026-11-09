// 계층 트리 보기(웹 사이드바 문서 트리 doc-tree-nav.tsx 의 자리). 맨 위부터 펼쳐 보고, 펼친 가지는 기억해요.
// 깊이는 들여쓰기 여백만으로 보여요(이음 줄·안내선 없음, 4단부터는 더 들이지 않고 읽기 프로그램에 깊이를 말해요).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { SymbolView } from 'expo-symbols'
import type { SearchHit } from '@direction-board/contracts'
import { appendPage, createGenerations } from '@direction-board/contracts/doc-tree'
import { docsApi } from '../../api/docs'
import { useScope } from '../../api/query'
import { useServer } from '../../server'
import { showActions, type Action } from '../../ui/actions'
import { colors, schemeColors, space, styles } from '../../ui/theme'
import { onDocsChanged } from './events'
import type { MenuExtras } from './sheets'
import { useDocsUi } from './store'
import { branchKey, visibleLines, type Branch } from './tree'

const INDENT = 16
const MAX_INDENT_LEVEL = 4

/** 펼침 단추·제목·길게 누르기. reloadKey 가 바뀌면(당겨서 새로고침) 읽어 둔 가지를 모두 새로 읽어요 */
export function TreeView({ onOpen, actions, reloadKey }: { onOpen: (d: SearchHit) => void; actions: (d: SearchHit, extra?: MenuExtras) => Action[]; reloadKey: number }) {
  const { origin } = useServer()
  const { generation } = useScope()
  const { ui, setUi } = useDocsUi()
  const open = useMemo(() => new Set(ui.open), [ui.open])
  const [branches, setBranches] = useState<Record<string, Branch>>({})
  const loaded = useRef(new Set<string>())
  const gens = useRef(createGenerations())
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const load = useCallback(
    (parent: string | null, more?: string) => {
      const key = branchKey(parent)
      loaded.current.add(key)
      const g = more ? gens.current.current(key) : gens.current.fresh(key)
      setBranches((b) => ({ ...b, [key]: { items: b[key]?.items ?? [], next: b[key]?.next, state: 'loading' } }))
      docsApi.children(origin, parent, more).then(
        (r) => {
          if (!gens.current.isCurrent(key, g)) return
          setBranches((b) => ({ ...b, [key]: { items: more ? appendPage(b[key]?.items ?? [], r.results) : r.results, next: r.nextCursor, state: 'ok' } }))
        },
        () => {
          if (!gens.current.isCurrent(key, g)) return
          setBranches((b) => ({ ...b, [key]: { items: b[key]?.items ?? [], next: b[key]?.next, state: 'error' } }))
        },
      )
    },
    [origin],
  )
  // 서버·로그인이 바뀌면 옛 가지는 버리고 맨 위부터 다시
  useEffect(() => {
    gens.current.reset()
    loaded.current.clear()
    setBranches({})
    load(null)
  }, [load, generation])
  useEffect(() => {
    for (const r of open) if (!loaded.current.has(r)) load(r)
  }, [open, load])
  const reloadAll = useCallback(() => {
    for (const key of loaded.current) load(key === 'root' ? null : key)
  }, [load])
  useEffect(() => onDocsChanged(reloadAll), [reloadAll])
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    reloadAll()
  }, [reloadKey, reloadAll])
  const toggle = (ref: string) => setUi({ open: open.has(ref) ? ui.open.filter((x) => x !== ref) : [...ui.open, ref] })
  const lines = visibleLines(branches, open)
  return (
    <View style={styles.group} accessibilityLabel="문서 트리">
      {lines.map((l, i) => {
        const pad = space.sm + (Math.min(l.level, MAX_INDENT_LEVEL) - 1) * INDENT
        if (l.type !== 'doc') {
          const label = l.type === 'loading' ? '불러오는 중…' : l.type === 'error' ? '불러오지 못했어요 · 다시' : l.type === 'empty' ? '문서가 없어요' : '더 보기'
          const press = l.type === 'error' ? () => load(l.parent) : l.type === 'more' ? () => load(l.parent, l.cursor) : undefined
          return (
            <Pressable key={`${l.type}:${l.parent}:${i}`} accessibilityRole={press ? 'button' : undefined} disabled={!press} onPress={press} style={[s.line, { paddingLeft: pad + space.target }]}>
              <Text style={styles.meta}>{label}</Text>
            </Pressable>
          )
        }
        const { hit } = l
        const list = actions(hit, { siblings: l.siblings, index: l.index, stale: l.stale })
        return (
          <View key={hit.ref} style={[s.line, { paddingLeft: pad }, l.stale && s.stale]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={l.hasChildren ? `${hit.title} ${l.open ? '접기' : '펼치기'}` : undefined}
              accessibilityState={l.hasChildren ? { expanded: l.open } : undefined}
              accessibilityElementsHidden={!l.hasChildren}
              disabled={!l.hasChildren}
              onPress={() => toggle(hit.ref)}
              style={s.disclosure}
            >
              {l.hasChildren ? <SymbolView name={l.open ? 'chevron.down' : 'chevron.right'} size={13} tintColor={c.muted} /> : null}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={[hit.title || '제목 없음', l.level > 1 ? `${l.level}단` : '', l.hasChildren ? `하위 ${hit.children}개` : ''].filter(Boolean).join(', ')}
              accessibilityActions={list.map((a, j) => ({ name: `a${j}`, label: a.label }))}
              onAccessibilityAction={(e) => list[Number(e.nativeEvent.actionName.slice(1))]?.onPress()}
              onPress={() => onOpen(hit)}
              onLongPress={() => showActions(list, hit.title)}
              delayLongPress={350}
              style={({ pressed }) => [s.title, pressed && s.pressed]}
            >
              <SymbolView name="doc.text" size={15} tintColor={c.muted} />
              <Text style={[styles.text, s.flex]} numberOfLines={2}>
                {hit.title || '제목 없음'}
              </Text>
              {l.hasChildren ? <Text style={styles.small}>{hit.children}</Text> : null}
            </Pressable>
          </View>
        )
      })}
    </View>
  )
}
const s = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', minHeight: space.target, paddingRight: space.gutter },
  stale: { opacity: 0.55 },
  disclosure: { width: space.target, height: space.target, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: space.target, borderRadius: 8, paddingRight: space.xs },
  pressed: { backgroundColor: colors.fill },
  flex: { flex: 1 },
})
