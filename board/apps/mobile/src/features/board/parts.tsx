// 판 화면 작은 부품: 상태 점, 끝냄 동그라미, 메인 별, 목표 띠, 판 고르기. 왼쪽 세로선 없이 점·글자·바탕으로만 구분해요.
import React, { useCallback } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { text } from '@direction-board/design-tokens'
import type { Board, Item, Signal } from '@direction-board/contracts'
import { dday } from '@direction-board/contracts/board-text'
import { useBoardState } from '../../api/board'
import { showActions } from '../../ui/actions'
import { colors, schemeColors, space, styles, toneDot, type Tone } from '../../ui/theme'
import { currentBoard } from './rules'
import { useStored } from './stored'
import { useStoreGate, type StoreIssue } from './storeGate'
import { useStall } from './stall'
import { stallText } from '@direction-board/contracts/quick-recovery'

export function Dot({ tone, color, label }: { tone?: Tone; color?: string; label?: string }) {
  return <View accessibilityLabel={label} accessible={!!label} style={[s.dot, { backgroundColor: color ?? toneDot[tone ?? 'neutral'] }]} />
}

/** 끝냄/다시 열기 동그라미(44pt 누름 영역) */
export function CheckButton({ done, title, onPress }: { done: boolean; title: string; onPress: () => void }) {
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={`${title} ${done ? '다시 열기' : '끝냄'}`} hitSlop={12} onPress={onPress}>
      <SymbolView name={done ? 'checkmark.circle.fill' : 'circle'} size={22} tintColor={done ? c.muted : c.ink} />
    </Pressable>
  )
}

/** 오늘 메인 별(웹 task-row.tsx 의 별) */
export function StarButton({ on, title, onPress }: { on: boolean; title: string; onPress: () => void }) {
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={on ? `${title} 메인에서 빼기` : `${title} 오늘 메인으로`} hitSlop={12} onPress={onPress} style={s.star}>
      <SymbolView name={on ? 'star.fill' : 'star'} size={18} tintColor={on ? (toneDot.warn as unknown as string) : c.muted} />
    </Pressable>
  )
}

/** 사건 줄 아래 작은 표시(웹 SignalRow 의 순회·개인·AI 판단 대기) */
export function SignalMarks({ s }: { s: Signal }) {
  const marks = [s.ref?.startsWith('ops:') ? '순회' : '', s.private ? '개인' : '', s.needs_ai ? 'AI 판단 대기' : '', s.sample ? '샘플' : ''].filter(Boolean)
  if (!marks.length) return null
  return <Text style={styles.small}>{marks.join(' · ')}</Text>
}

/** 열린 목표 가로 띠(웹 home.tsx:238-251). 누르면 목표 화면 */
export function GoalStrip({ goals, boards, onOpen }: { goals: Item[]; boards: Board[]; onOpen: (g: Item) => void }) {
  if (!goals.length) return null
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip} accessibilityLabel="열린 목표">
      {goals.map((g) => {
        const a = boards.find((b) => b.id === g.boardId)?.areas.find((x) => x.id === g.area)
        const d = dday(g.due)
        const title = (g.text || '목표').split('\n')[0]
        return (
          <Pressable key={`${g.boardId}:${g.id}`} accessibilityRole="button" accessibilityLabel={[title, a?.name ?? '영역 없음', g.due ? d.t : '기한 없음'].join(', ')} onPress={() => onOpen(g)} style={({ pressed }) => [styles.group, s.goal, pressed && { opacity: 0.7 }]}>
            <Dot color={a?.color} />
            <Text numberOfLines={1} style={[styles.strong, s.goalTitle]}>{title}</Text>
            <Text style={[styles.small, d.late && { color: colors.decide }]}>{g.due ? d.t : '—'}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const isPick = (v: unknown): v is string | null => v === null || typeof v === 'string'
/**
 * 지금 판(웹 사이드바 판 고르기). 기기에 고른 판을 두고, 없으면 내 개인 판.
 * ready: 기기에 고른 판을 잘 읽었고(읽기 실패·깨짐이면 아니에요, 규칙 E) 판 목록도 받았을 때만 — 그 전의 current 는 기본 판이라 바뀔 수 있어요.
 * issue: 고른 판을 읽지 못함(다시 읽기·버리고 새로) 또는 판 목록이 늦음·실패(다시 시도, 리뷰 22 P2)
 */
export function useCurrentBoard() {
  const board = useBoardState()
  const [picked, setPicked, pickReady] = useStored<string | null>('board', null, isPick)
  const pickGate = useStoreGate('board', isPick, null, '지금 판')
  const boards = board.data?.boards ?? []
  const current = currentBoard(boards, picked)
  const pick = useCallback(() => {
    const live = boards.filter((b) => !b.deleted)
    if (live.length < 2) return
    showActions(live.map((b) => ({ label: `${b.name} · ${b.kind === 'personal' ? '개인' : '회사'}${b.id === current?.id ? ' ✓' : ''}`, onPress: () => setPicked(b.id) })), '판 고르기')
  }, [boards, current, setPicked])
  const late = useStall(!board.data)
  const retry = board.refresh
  const issue: StoreIssue | null = pickGate.issue ?? (!board.data && (late || board.status === 'error') ? { kind: 'read', text: stallText('판 목록'), retry: () => void retry() } : null)
  return { current, boards, pick, many: boards.filter((b) => !b.deleted).length > 1, ready: pickReady && !!board.data, issue }
}

const s = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
  star: { minWidth: space.target, minHeight: space.target, alignItems: 'center', justifyContent: 'center', marginRight: -space.md },
  strip: { gap: space.sm, paddingRight: space.gutter },
  goal: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: space.target, minWidth: 180, maxWidth: 260 },
  goalTitle: { flex: 1, fontSize: text.sm[0], lineHeight: text.sm[1] },
})
