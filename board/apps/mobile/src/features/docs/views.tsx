// 문서 목록 보기 세 가지(목록·아이콘·갤러리). 웹 docs-views/docs-table·icon-view·gallery-view 와 같은 정보를 손가락 크기로 그려요.
// 왼쪽 세로선 없이 바탕 대비·여백·글자 무게로 나눠요(docs/internals/mobile-ia.md).
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Image, Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { radius, text } from '@direction-board/design-tokens'
import type { SearchHit } from '@direction-board/contracts'
import { imageSource } from '../../api/client'
import { docsApi } from '../../api/docs'
import { useQuery } from '../../api/query'
import { NoteView } from '../../notes/NoteView'
import { useServer } from '../../server'
import { showActions, type Action } from '../../ui/actions'
import { Row } from '../../ui/Row'
import { Section } from '../../ui/Section'
import { colors, schemeColors, space, styles } from '../../ui/theme'
import { gridRows, groupDocs, type DocsGroup } from './groups'
import { isAiDraft, kindIcon, kindLabel, shortTime, statusLabel } from './labels'
import { displayValue } from './props'

export type DocActions = (doc: SearchHit) => Action[]

/** 행·카드 보조 줄: 상태 · 영역 · 수정 시각(웹 표의 열과 같은 순서) */
export const docMeta = (d: SearchHit) => [kindLabel(d.kind), statusLabel(d.status), d.area, d.updatedAt ? shortTime(d.updatedAt) : ''].filter(Boolean).join(' · ')

function KindIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  return <SymbolView name={kindIcon(kind)} size={size} tintColor={c.muted} accessibilityElementsHidden importantForAccessibility="no" />
}
function Draft() {
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  return <SymbolView name="sparkles" size={14} tintColor={c.muted} accessibilityLabel="AI 초안" />
}

/** 목록 보기: 한 줄 = 종류 · 제목(2줄) · 보조 줄, 표시할 속성이 있으면 "키: 값" 한 줄 */
export function DocList({ docs, columns, onOpen, actions }: { docs: SearchHit[]; columns: string[]; onOpen: (d: SearchHit) => void; actions: DocActions }) {
  return (
    <Section>
      {docs.map((d) => {
        const extra = columns.flatMap((k) => {
          const p = d.props?.find((x) => x.key === k)
          const v = p ? displayValue(p) : ''
          return v ? [`${k}: ${v}`] : []
        })
        return (
          <Row key={d.ref} title={d.title || '제목 없음'} meta={docMeta(d)} leading={<KindIcon kind={d.kind} />} trailing={isAiDraft(d) ? <Draft /> : undefined} onPress={() => onOpen(d)} actions={actions(d)}>
            {extra.length ? (
              <Text style={styles.small} numberOfLines={1}>
                {extra.join(' · ')}
              </Text>
            ) : null}
          </Row>
        )
      })}
    </Section>
  )
}

function Cover({ doc, height }: { doc: SearchHit; height: number }) {
  const { origin } = useServer()
  const excerpt = doc.excerpt ?? doc.snippet ?? ''
  if (doc.cover) return <Image source={imageSource(origin, doc.cover)} style={[s.cover, { height }]} resizeMode="cover" accessibilityIgnoresInvertColors />
  return (
    <View style={[s.cover, s.coverText, { height }]}>
      <KindIcon kind={doc.kind} size={20} />
      <Text style={styles.small} numberOfLines={5}>
        {excerpt || '본문이 비어 있어요'}
      </Text>
    </View>
  )
}

/** 아이콘 보기: 2열(넓은 화면 3열) 카드, 묶음을 고르면 절 머리 */
export function DocGrid({ docs, group, onOpen, actions }: { docs: SearchHit[]; group: DocsGroup; onOpen: (d: SearchHit) => void; actions: DocActions }) {
  const { width } = useWindowDimensions()
  const columns = width >= 600 ? 3 : 2
  const rows = useMemo(() => gridRows(groupDocs(docs, group), columns, group !== 'none'), [docs, group, columns])
  const cardW = (width - space.gutter * 2 - space.md * (columns - 1)) / columns
  return (
    <View style={s.grid}>
      {rows.map((r) =>
        r.type === 'head' ? (
          <Text key={r.key} accessibilityRole="header" style={s.groupHead}>
            {r.label} <Text style={s.count}>{r.count}</Text>
          </Text>
        ) : (
          <View key={r.key} style={s.cardRow}>
            {r.items.map((d) => {
              const list = actions(d)
              return (
                <Pressable
                  key={d.ref}
                  accessibilityRole="button"
                  accessibilityLabel={[d.title, docMeta(d), isAiDraft(d) ? 'AI 초안' : ''].filter(Boolean).join(', ')}
                  accessibilityActions={list.map((a, i) => ({ name: `a${i}`, label: a.label }))}
                  onAccessibilityAction={(e) => list[Number(e.nativeEvent.actionName.slice(1))]?.onPress()}
                  onPress={() => onOpen(d)}
                  onLongPress={list.length ? () => showActions(list, d.title) : undefined}
                  delayLongPress={350}
                  style={({ pressed }) => [s.card, { width: cardW }, pressed && s.pressed]}
                >
                  <Cover doc={d} height={Math.round(cardW * 0.75)} />
                  <View style={s.cardBody}>
                    <Text style={styles.strong} numberOfLines={2}>
                      {d.title || '제목 없음'}
                    </Text>
                    <Text style={styles.small} numberOfLines={1}>
                      {[statusLabel(d.status), d.area, d.updatedAt ? shortTime(d.updatedAt) : ''].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
        ),
      )}
    </View>
  )
}

/** 미리보기 본문(앞 4,000자). 갤러리·미리보기 시트가 같이 써요 */
export function DocHead({ doc }: { doc: SearchHit }) {
  const { origin } = useServer()
  const head = useQuery(`docs/head/${doc.ref}/${doc.updatedAt}`, () => docsApi.head(origin, doc.ref))
  if (head.data === undefined) return <Text style={styles.meta}>{head.status === 'error' ? '미리보기를 불러오지 못했어요' : '불러오는 중이에요'}</Text>
  return (
    <View style={s.headBody}>
      <NoteView md={head.data.markdown} />
      {head.data.truncated ? <Text style={styles.small}>앞부분만 보여요. 열어서 전체를 읽어요</Text> : null}
    </View>
  )
}
/** 정보 줄(웹 DocFacts 와 같은 항목) */
export function DocFacts({ doc }: { doc: SearchHit }) {
  const tags = doc.tags?.filter((t) => t.by !== 'auto').map((t) => `#${t.tag}`) ?? []
  return (
    <Text style={styles.meta}>
      {[docMeta(doc), ...tags].filter(Boolean).join(' · ')}
    </Text>
  )
}

/** 갤러리: 위 큰 미리보기(가로로 밀어 이전·다음), 아래 썸네일 줄, 미리보기 아래 정보 줄 */
export function DocGallery({ docs, onOpen, actions, onEnd }: { docs: SearchHit[]; onOpen: (d: SearchHit) => void; actions: DocActions; onEnd?: () => void }) {
  const { width, height } = useWindowDimensions()
  const pageW = width - space.gutter * 2
  // 첫 화면에서 썸네일 줄이 탭 막대 위에 보이도록 미리보기 높이를 화면 높이에 맞춰요
  const pageH = Math.max(200, Math.min(340, height - 620))
  const [index, setIndex] = useState(0)
  const pages = useRef<FlatList<SearchHit>>(null)
  const strip = useRef<FlatList<SearchHit>>(null)
  const current = docs[Math.min(index, docs.length - 1)]
  useEffect(() => {
    if (index >= docs.length && docs.length) setIndex(docs.length - 1)
  }, [docs.length, index])
  useEffect(() => {
    // 고른 썸네일을 가운데로(맨 앞에서는 0 아래로 넘기지 않아요. scrollToIndex 의 가운데 맞추기는 앞쪽 썸네일을 잘라요)
    if (current) strip.current?.scrollToOffset({ offset: Math.max(0, Math.min(index, docs.length - 1) * (THUMB + space.sm) - (width - THUMB) / 2), animated: true })
  }, [index, current, docs.length, width])
  if (!current) return null
  const go = (i: number) => {
    setIndex(i)
    pages.current?.scrollToIndex({ index: i, animated: true })
  }
  return (
    <View style={s.gallery}>
      <FlatList
        ref={pages}
        data={docs}
        keyExtractor={(d) => d.ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: pageW, offset: pageW * i, index: i })}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / pageW))}
        onEndReached={onEnd}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, 열기`}
            accessibilityHint="옆으로 밀어 이전·다음 문서"
            onPress={() => onOpen(item)}
            onLongPress={() => showActions(actions(item), item.title)}
            style={[s.page, { width: pageW, height: pageH }]}
          >
            <Text style={styles.heading} numberOfLines={2}>
              {item.title || '제목 없음'}
            </Text>
            <View style={s.pageBody}>{item.ref === current.ref ? <DocHead doc={item} /> : <Text style={styles.meta}>{item.excerpt ?? ''}</Text>}</View>
          </Pressable>
        )}
      />
      <DocFacts doc={current} />
      <FlatList
        ref={strip}
        data={docs}
        keyExtractor={(d) => d.ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: THUMB + space.sm, offset: (THUMB + space.sm) * i, index: i })}
        contentContainerStyle={s.strip}
        onEndReached={onEnd}
        renderItem={({ item, index: i }) => (
          <Pressable accessibilityRole="button" accessibilityState={{ selected: i === index }} accessibilityLabel={item.title} onPress={() => go(i)} style={[s.thumb, i === index && s.thumbOn]}>
            <Cover doc={item} height={THUMB * 0.75} />
            <Text style={styles.small} numberOfLines={2}>
              {item.title}
            </Text>
          </Pressable>
        )}
      />
    </View>
  )
}
const THUMB = 96
const s = StyleSheet.create({
  grid: { gap: space.md },
  groupHead: { color: colors.muted, fontSize: text.sm[0], fontWeight: '600', paddingHorizontal: space.xs, marginTop: space.sm },
  count: { fontWeight: '400', fontVariant: ['tabular-nums'] },
  cardRow: { flexDirection: 'row', gap: space.md },
  card: { backgroundColor: colors.card, borderRadius: radius.xl, overflow: 'hidden' },
  pressed: { opacity: 0.7 },
  cover: { width: '100%', backgroundColor: colors.fill },
  coverText: { padding: space.md, gap: space.xs, overflow: 'hidden' },
  cardBody: { padding: space.md, gap: 2 },
  headBody: { gap: space.sm },
  gallery: { gap: space.md },
  page: { backgroundColor: colors.card, borderRadius: radius.xl, padding: space.lg, gap: space.md, overflow: 'hidden' },
  pageBody: { flex: 1, overflow: 'hidden' },
  strip: { gap: space.sm },
  thumb: { width: THUMB, gap: space.xs, borderRadius: radius.lg, padding: space.xs },
  thumbOn: { backgroundColor: colors.fill },
})
