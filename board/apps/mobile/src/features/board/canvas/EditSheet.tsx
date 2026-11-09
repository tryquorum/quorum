import React, { useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native'
import type { Board, Item } from '@direction-board/contracts'
import { STICKY_COLORS, type StickyColor } from '@direction-board/contracts/board-text'
import { long, parse } from '@direction-board/contracts/when'
import { Button } from '../../../ui/Button'
import { Chip } from '../../../ui/Chip'
import { Row } from '../../../ui/Row'
import { Section } from '../../../ui/Section'
import { Sheet } from '../../../ui/Sheet'
import { Empty } from '../../../ui/StateView'
import { schemeColors, space, styles } from '../../../ui/theme'
import { Dot } from '../parts'

const STICKY_KO: Record<StickyColor, string> = { yellow: '노랑', pink: '분홍', blue: '파랑', green: '초록', white: '흰색' }
const KIND_KO: Record<string, string> = { sticky: '메모', text: '글', goal: '목표', frame: '영역' }
const titleOf = (i: Item) => (i.text || KIND_KO[i.type] || '항목').split('\n')[0]

type Props = {
  item: Item | null
  items: Item[]
  links: Item[]
  board: Board | undefined
  onClose: () => void
  onSave: (next: Item) => void
  onDelete: (it: Item) => void
  onLink: (from: Item, to: Item) => void
  onUnlink: (link: Item) => void
  onLabel: (link: Item, label: string) => void
  onOpenGoal: (it: Item) => void
}

/** 캔버스 항목 고치기 시트(옛 보드 선택 도구 막대와 같은 일): 글·색·크기·영역·기한·연결·삭제 */
export function EditSheet({ item, items, links, board, onClose, onSave, onDelete, onLink, onUnlink, onLabel, onOpenGoal }: Props) {
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const [text, setText] = useState('')
  const [picking, setPicking] = useState(false)
  useEffect(() => {
    setText(item?.text ?? '')
    setPicking(false)
  }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return <Sheet visible={false} title="" onClose={onClose}>{null}</Sheet>
  const mine = links.filter((l) => l.from === item.id || l.to === item.id)
  const others = items.filter((i) => i.id !== item.id && i.type !== 'frame' && !mine.some((l) => l.from === i.id || l.to === i.id))
  const save = (patch: Partial<Item>) => onSave({ ...item, text, ...patch })
  const askDue = () =>
    Alert.prompt('목표 기한', '예: 12월 3일, 다음 주 금요일, 2026-12-31', (v) => {
      const p = v ? parse(v) : null
      if (p) save({ due: p.at.slice(0, 10) })
    })
  return (
    <Sheet visible title={KIND_KO[item.type] ?? '항목'} onClose={() => { if (text !== item.text) save({}); onClose() }} action={{ label: '저장', onPress: () => { save({}); onClose() } }}>
      <TextInput value={text} onChangeText={setText} multiline={item.type !== 'frame'} autoFocus={!item.text} placeholder={item.type === 'frame' ? '영역 이름' : item.type === 'goal' ? '무엇을 달성할지' : '내용'} placeholderTextColor={c.muted} accessibilityLabel="내용" style={[styles.input, item.type !== 'frame' && s.multi]} />
      {item.type === 'sticky' ? (
        <View style={s.chips} accessibilityLabel="메모 색">
          {(Object.keys(STICKY_COLORS) as StickyColor[]).map((k) => <Chip key={k} label={STICKY_KO[k]} selected={(item.color ?? 'yellow') === k} onPress={() => save({ color: k })} />)}
        </View>
      ) : null}
      {item.type === 'text' ? <Chip label={item.big ? '큰 글 끄기' : '큰 글'} selected={!!item.big} onPress={() => save({ big: !item.big })} /> : null}
      {item.type === 'goal' ? (
        <View style={s.chips}>
          <Chip label={item.done ? '완료 취소' : '완료'} selected={!!item.done} onPress={() => save({ done: !item.done })} />
          <Chip label={item.due ? `기한 ${long(item.due as string)}` : '기한 정하기'} onPress={askDue} />
          {item.due ? <Chip label="기한 지우기" onPress={() => save({ due: null })} /> : null}
          <Chip label="목표 화면" onPress={() => onOpenGoal(item)} />
        </View>
      ) : null}
      {board?.areas.length && item.type !== 'frame' ? (
        <View style={s.chips} accessibilityLabel="영역">
          {board.areas.map((a) => <Chip key={a.id} label={a.name} selected={item.area === a.id} onPress={() => save({ area: item.area === a.id ? undefined : a.id })} />)}
        </View>
      ) : null}
      <View style={s.chips} accessibilityLabel="크기">
        <Text style={styles.meta}>크기 {item.w}×{item.h}</Text>
        <Chip label="넓게" onPress={() => save({ w: item.w + 40 })} />
        <Chip label="좁게" onPress={() => save({ w: Math.max(40, item.w - 40) })} />
        <Chip label="높게" onPress={() => save({ h: item.h + 40 })} />
        <Chip label="낮게" onPress={() => save({ h: Math.max(30, item.h - 40) })} />
      </View>
      {item.type !== 'frame' ? (
        <Section title="연결" count={mine.length} right={<Chip label={picking ? '닫기' : '+ 연결'} onPress={() => setPicking((v) => !v)} />}>
          {mine.map((l) => {
            const other = items.find((i) => i.id === (l.from === item.id ? l.to : l.from))
            return (
              <Row key={l.id} title={other ? titleOf(other) : '(없는 항목)'} meta={`${l.from === item.id ? '→' : '←'} ${l.text || '라벨 없음'}`} actions={[
                { label: '라벨 고치기', onPress: () => Alert.prompt('연결 라벨', '예: 위해서, 막힘', (v) => onLabel(l, (v ?? '').trim()), 'plain-text', l.text) },
                { label: '연결 지우기', destructive: true, onPress: () => onUnlink(l) },
              ]} swipe={{ label: '지우기', tone: 'decide', onPress: () => onUnlink(l) }} />
            )
          })}
          {picking ? others.map((o) => <Row key={o.id} title={titleOf(o)} meta={`${KIND_KO[o.type] ?? o.type}에 연결`} leading={<Dot tone="running" />} onPress={() => { onLink(item, o); setPicking(false) }} />) : null}
          {!mine.length && !picking ? <Empty title="연결이 없어요" body="+ 연결로 다른 카드와 이어요" /> : null}
        </Section>
      ) : null}
      <Button title="지우기" variant="outline" onPress={() => Alert.alert(`${KIND_KO[item.type] ?? '항목'}을 지울까요?`, '연결도 함께 지워요', [{ text: '취소', style: 'cancel' }, { text: '지우기', style: 'destructive', onPress: () => { onDelete(item); onClose() } }])} />
    </Sheet>
  )
}
const s = StyleSheet.create({
  multi: { minHeight: 96, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
})
