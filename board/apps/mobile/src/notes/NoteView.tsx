import React, { useMemo } from 'react'
import { Image, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { leading, text } from '@direction-board/design-tokens'
import { imageSource } from '../api/client'
import { useServer } from '../server'
import { colors, schemeColors, space } from '../ui/theme'
import { parseMarkdown, type Block, type Inline } from './markdown'

/**
 * 노트 마크다운 읽기 화면(레인 1·2 공용). 인용·코드는 옅은 바탕과 안쪽 여백으로 나누고 왼쪽 선을 쓰지 않아요.
 * onToggleTask 를 주면(편집할 수 있는 노트만) 할 일 체크를 눌러 그 줄을 바꿀 수 있어요.
 */
export function NoteView({
  md,
  onLink,
  onWiki,
  onToggleTask,
}: {
  md: string
  onLink?: (href: string) => void
  onWiki?: (term: string) => void
  onToggleTask?: (line: number) => void
}) {
  const blocks = useMemo(() => parseMarkdown(md), [md])
  const ctx = { onLink, onWiki, onToggleTask }
  if (!md.trim()) return <Text style={s.empty}>노트가 없어요</Text>
  return <View style={s.root}>{blocks.map((b, i) => <BlockView key={i} block={b} ctx={ctx} />)}</View>
}

type Ctx = { onLink?: (href: string) => void; onWiki?: (term: string) => void; onToggleTask?: (line: number) => void }

function BlockView({ block, ctx }: { block: Block; ctx: Ctx }) {
  const scheme = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  switch (block.t) {
    case 'h':
      return (
        <Text accessibilityRole="header" style={[s.prose, HEADING[Math.min(block.level, 4) - 1]]}>
          <Inlines nodes={block.c} ctx={ctx} />
        </Text>
      )
    case 'p':
      return <Paragraph nodes={block.c} ctx={ctx} />
    case 'hr':
      return <View style={s.hr} />
    case 'code':
      return (
        <View style={s.fill}>
          <Text selectable style={s.code}>
            {block.v}
          </Text>
        </View>
      )
    case 'quote':
      return <View style={[s.fill, s.root]}>{block.blocks.map((b, i) => <BlockView key={i} block={b} ctx={ctx} />)}</View>
    case 'list':
      return (
        <View style={s.list}>
          {block.items.map((item, i) => (
            <View key={i} style={s.item}>
              {item.checked === null ? (
                <Text style={[s.prose, s.marker]}>{block.ordered ? `${block.start + i}.` : '•'}</Text>
              ) : (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel="할 일"
                  accessibilityState={{ checked: item.checked, disabled: !ctx.onToggleTask }}
                  disabled={!ctx.onToggleTask}
                  hitSlop={10}
                  onPress={() => ctx.onToggleTask?.(item.line)}
                  style={s.check}
                >
                  <SymbolView name={item.checked ? 'checkmark.square.fill' : 'square'} size={18} tintColor={item.checked ? scheme.muted : scheme.ink} />
                </Pressable>
              )}
              <View style={s.itemBody}>{item.blocks.map((b, j) => <BlockView key={j} block={b} ctx={ctx} />)}</View>
            </View>
          ))}
        </View>
      )
  }
}

/** 이미지만 있는 문단은 그림으로, 나머지는 글로 */
function Paragraph({ nodes, ctx }: { nodes: Inline[]; ctx: Ctx }) {
  const { origin } = useServer()
  const images = nodes.filter((n): n is Extract<Inline, { t: 'img' }> => n.t === 'img')
  const onlyImages = images.length > 0 && nodes.every((n) => n.t === 'img' || (n.t === 'text' && !n.v.trim()) || n.t === 'br')
  if (onlyImages)
    return (
      <View style={s.root}>
        {images.map((img, i) => (
          <Image key={i} accessibilityLabel={img.alt || '이미지'} source={imageSource(origin, img.src)} style={s.image} resizeMode="contain" />
        ))}
      </View>
    )
  return (
    <Text selectable style={s.prose}>
      <Inlines nodes={nodes} ctx={ctx} />
    </Text>
  )
}

function Inlines({ nodes, ctx }: { nodes: Inline[]; ctx: Ctx }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return n.v
          case 'br':
            return '\n'
          case 'b':
            return <Text key={i} style={s.bold}><Inlines nodes={n.c} ctx={ctx} /></Text>
          case 'i':
            return <Text key={i} style={s.italic}><Inlines nodes={n.c} ctx={ctx} /></Text>
          case 'd':
            return <Text key={i} style={s.strike}><Inlines nodes={n.c} ctx={ctx} /></Text>
          case 'code':
            return <Text key={i} style={s.inlineCode}>{n.v}</Text>
          case 'link':
            return <Text key={i} accessibilityRole="link" style={s.link} onPress={ctx.onLink ? () => ctx.onLink?.(n.href) : undefined}><Inlines nodes={n.c} ctx={ctx} /></Text>
          case 'wiki':
            return <Text key={i} accessibilityRole="link" style={s.wiki} onPress={ctx.onWiki ? () => ctx.onWiki?.(n.term) : undefined}>{n.label}</Text>
          case 'img':
            return <Text key={i} style={s.muted}>[{n.alt || '이미지'}]</Text>
        }
      })}
    </>
  )
}

const base = text.base[0]
const s = StyleSheet.create({
  root: { gap: space.md },
  empty: { color: colors.muted, fontSize: base },
  prose: { color: colors.ink, fontSize: base, lineHeight: Math.round(base * leading.prose) },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  muted: { color: colors.muted },
  link: { textDecorationLine: 'underline' },
  wiki: { fontWeight: '600', textDecorationLine: 'underline' },
  inlineCode: { fontFamily: 'Menlo', fontSize: base - 2, backgroundColor: colors.fill },
  code: { fontFamily: 'Menlo', fontSize: base - 2, lineHeight: Math.round((base - 2) * 1.5), color: colors.ink },
  fill: { backgroundColor: colors.fill, borderRadius: 10, padding: space.md },
  hr: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  list: { gap: space.xs },
  item: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  marker: { minWidth: 18, color: colors.muted },
  check: { paddingTop: 4 },
  itemBody: { flex: 1, gap: space.xs },
  image: { width: '100%', height: 220, borderRadius: 10, backgroundColor: colors.fill },
})
const HEADING = [
  { fontSize: text['2xl'][0], lineHeight: text['2xl'][1], fontWeight: '700' as const },
  { fontSize: text.xl[0], lineHeight: text.xl[1], fontWeight: '700' as const },
  { fontSize: text.lg[0], lineHeight: text.lg[1], fontWeight: '600' as const },
  { fontSize: base, lineHeight: text.base[1], fontWeight: '600' as const },
]
