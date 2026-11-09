// 문서 옮기기 시트(웹 doc-move.tsx 를 손가락 조작으로). 행을 누르면 그 아래로 옮기고, › 로 안에 들어가요. 검색어를 쓰면 전체에서 찾아요.
// 자기·자손·보관·독립 문서 아닌 것은 후보에서 빼요(자손은 열 때 읽어 둠, 다 못 읽어도 서버가 순환을 409 로 거절). 옮기는 중에는 닫지 않아요.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native'
import { SymbolView } from 'expo-symbols'
import type { SearchHit } from '@direction-board/contracts'
import { appendPage, collectDescendants, moveCandidates, moveError } from '@direction-board/contracts/doc-tree'
import { ApiError, errorMessage } from '../../api/client'
import { docsApi } from '../../api/docs'
import { useScope } from '../../api/query'
import { useServer } from '../../server'
import { useToast } from '../../ui/Toast'
import { colors, schemeColors, space, styles } from '../../ui/theme'
import { docsChanged } from './events'
import { useWriteScope } from '../../api/scope'

export type MoveTarget = { ref: string; title: string; parent: string | null }
type Page = { items: SearchHit[]; next?: string; state: 'loading' | 'ok' | 'error' }

export function MoveSheet({ doc, onClose }: { doc: MoveTarget | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal visible={!!doc} presentationStyle="pageSheet" animationType="slide" allowSwipeDismissal={!busy} onRequestClose={() => { if (!busy) onClose() }}>
      {doc ? <MoveBody key={doc.ref} doc={doc} busy={busy} setBusy={setBusy} onClose={onClose} /> : null}
    </Modal>
  )
}

function MoveBody({ doc, busy, setBusy, onClose }: { doc: MoveTarget; busy: boolean; setBusy: (b: boolean) => void; onClose: () => void }) {
  const { origin } = useServer()
  const scope = useWriteScope()
  const toast = useToast()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const [q, setQ] = useState('')
  const [trail, setTrail] = useState<{ ref: string; title: string }[]>([])
  const [page, setPage] = useState<Page>({ items: [], state: 'loading' })
  const [descendants, setDescendants] = useState<Set<string>>(() => new Set())
  /** 자손 확인: 끝나기 전에는 검색 결과를 고를 수 없고, 다 못 했으면 알려요(서버가 순환을 409 로 거절하는 게 마지막 보호) */
  const [descState, setDescState] = useState<'loading' | 'ok' | 'partial' | 'error'>('loading')
  const { generation, isCurrent } = useScope()
  const [openedAt] = useState(generation)
  const [error, setError] = useState('')
  const req = useRef(0)
  const here = trail[trail.length - 1] ?? null
  const searching = !!q.trim()
  const fetchPage = useCallback(
    (cursor?: string) => (searching ? docsApi.search(origin, { q, kinds: ['doc'], includeAi: true, limit: 30, cursor }) : docsApi.children(origin, here?.ref ?? null, cursor)),
    [origin, searching, q, here],
  )
  useEffect(() => {
    const id = ++req.current
    setError('')
    setPage({ items: [], state: 'loading' })
    const t = setTimeout(() => {
      fetchPage().then(
        (r) => req.current === id && setPage({ items: r.results, next: r.nextCursor, state: 'ok' }),
        () => {
          if (req.current !== id) return
          setPage({ items: [], state: 'error' })
          setError('옮길 곳을 불러오지 못했어요')
        },
      )
    }, searching ? 200 : 0)
    return () => clearTimeout(t)
  }, [fetchPage, searching])
  useEffect(() => {
    let live = true
    collectDescendants(doc.ref, (p, cur) => docsApi.children(origin, p, cur)).then(
      (d) => {
        if (!live) return
        setDescendants(d.refs)
        setDescState(d.complete ? 'ok' : 'partial')
      },
      () => live && setDescState('error'),
    )
    return () => {
      live = false
    }
  }, [doc.ref, origin])
  const more = () => {
    const id = req.current
    if (!page.next || page.state === 'loading') return
    setPage((p) => ({ ...p, state: 'loading' }))
    fetchPage(page.next).then(
      (r) => req.current === id && setPage((p) => ({ items: appendPage(p.items, r.results), next: r.nextCursor, state: 'ok' })),
      () => {
        if (req.current !== id) return
        setPage((p) => ({ ...p, state: 'ok' }))
        setError('더 불러오지 못했어요')
      },
    )
  }
  const candidates = useMemo(() => moveCandidates(page.items, doc.ref, descendants), [page.items, doc.ref, descendants])
  const enter = (h: { ref: string; title: string }) => {
    setTrail((t) => [...t, { ref: h.ref, title: h.title || '제목 없음' }])
    setQ('')
  }
  const go = async (parent: string | null, title: string) => {
    if (busy) return
    if (!isCurrent(openedAt)) return setError('서버나 계정이 바뀌어 옮기지 않았어요. 시트를 닫아 주세요')
    setBusy(true)
    setError('')
    try {
      await docsApi.move(scope, { ref: doc.ref, parent })
      docsChanged()
      toast(`옮겼어요: ${doc.title} → ${title}`)
      setBusy(false)
      onClose()
    } catch (e) {
      setBusy(false)
      setError(e instanceof ApiError ? moveError(e.status, e.message) : `옮긴 결과를 확인하지 못했어요. 목록을 새로 읽어 확인해 주세요 (${errorMessage(e)})`)
      if (!(e instanceof ApiError)) docsChanged()
    }
  }
  const row = (key: string, label: string, onPress: () => void, opts: { icon: 'doc' | 'folder' | 'up' | 'here'; note?: string; disabled?: boolean; enter?: () => void } = { icon: 'doc' }) => (
    <View key={key} style={s.row}>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!opts.disabled || busy }} disabled={opts.disabled || busy} onPress={onPress} style={({ pressed }) => [s.main, pressed && s.pressed]}>
        <SymbolView name={opts.icon === 'folder' ? 'folder' : opts.icon === 'up' ? 'arrow.up.to.line' : opts.icon === 'here' ? 'arrow.down.right' : 'doc.text'} size={18} tintColor={c.muted} />
        <Text style={[styles.text, s.flex, opts.disabled && s.dim]} numberOfLines={2}>
          {label}
        </Text>
        {opts.note ? <Text style={styles.small}>{opts.note}</Text> : null}
      </Pressable>
      {opts.enter ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} 안으로`} onPress={opts.enter} style={s.enter} hitSlop={4}>
          <SymbolView name="chevron.right" size={14} tintColor={c.muted} />
        </Pressable>
      ) : null}
    </View>
  )
  return (
    <View style={styles.page}>
      <View style={s.head}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onClose} hitSlop={10} style={s.side}>
          <Text style={[s.close, busy && s.dim]}>닫기</Text>
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={[styles.strong, s.flex, s.center]}>
          {`'${doc.title || '제목 없음'}' 옮기기`}
        </Text>
        <View style={s.side} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, s.content]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={styles.meta}>고른 문서 아래로 옮겨요. › 로 안에 들어가요. 자기 아래나 하위 문서 아래로는 옮길 수 없어요</Text>
        <TextInput accessibilityLabel="옮길 곳 찾기" placeholder={here ? `'${here.title}' 안에서 (쓰면 전체 검색)` : '옮길 곳 찾기'} value={q} onChangeText={setQ} style={styles.input} clearButtonMode="while-editing" />
        {!searching && trail.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.trail} accessibilityLabel="옮길 곳 경로">
            <Pressable accessibilityRole="button" onPress={() => setTrail([])} hitSlop={8}>
              <Text style={styles.meta}>맨 위</Text>
            </Pressable>
            {trail.map((t, i) => (
              <Pressable key={t.ref} accessibilityRole="button" onPress={() => setTrail(trail.slice(0, i + 1))} hitSlop={8}>
                <Text style={i === trail.length - 1 ? styles.strong : styles.meta} numberOfLines={1}>
                  › {t.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.text}>
            {error}
          </Text>
        ) : null}
        <View style={styles.group}>
          {!searching && !here && doc.parent !== null ? row('root', '맨 위로', () => void go(null, '맨 위'), { icon: 'up' }) : null}
          {!searching && here ? row('here', `'${here.title}' 아래로 옮기기`, () => void go(here.ref, here.title), { icon: 'here', disabled: here.ref === doc.parent, note: here.ref === doc.parent ? '지금 위치' : undefined }) : null}
          {searching && descState === 'loading' ? <Text style={[styles.meta, s.pad]}>하위 문서를 확인하는 중이에요. 끝나면 검색 결과를 고를 수 있어요</Text> : null}
          {descState === 'partial' || descState === 'error' ? <Text style={[styles.meta, s.pad]}>하위 문서를 다 확인하지 못했어요. 하위 문서 아래로 옮기면 서버가 거절해요</Text> : null}
          {candidates.map((h) => {
            const folder = (h.children ?? 0) > 0
            const current = h.ref === doc.parent
            return row(h.ref, h.title || '제목 없음', () => (current ? folder && !searching && enter(h) : void go(h.ref, h.title)), {
              icon: folder ? 'folder' : 'doc',
              disabled: searching && descState === 'loading',
              note: current ? '지금 위치' : undefined,
              enter: folder && !searching ? () => enter(h) : undefined,
            })
          })}
          {page.state === 'loading' && !page.items.length ? <Text style={[styles.meta, s.pad]}>찾는 중…</Text> : null}
          {page.state === 'ok' && !candidates.length ? <Text style={[styles.meta, s.pad]}>{searching ? '맞는 문서가 없어요' : '하위 문서가 없어요'}</Text> : null}
          {page.next ? row('more', page.state === 'loading' ? '불러오는 중…' : '더 보기', more, { icon: 'doc', disabled: page.state === 'loading' }) : null}
        </View>
      </ScrollView>
    </View>
  )
}
const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.gutter, paddingTop: space.lg, paddingBottom: space.sm, gap: space.sm },
  side: { minWidth: 64, minHeight: space.target, justifyContent: 'center' },
  close: { color: colors.ink, fontSize: 17 },
  center: { textAlign: 'center' },
  content: { paddingBottom: 48 },
  trail: { gap: space.sm, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: space.target + 8 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.gutter, paddingVertical: 10, minHeight: space.target + 8 },
  enter: { width: space.target, height: space.target, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.fill },
  flex: { flex: 1 },
  dim: { opacity: 0.45 },
  pad: { padding: space.gutter },
})
