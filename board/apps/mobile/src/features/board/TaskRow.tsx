import React from 'react'
import { Text, View, useColorScheme } from 'react-native'
import { SymbolView } from 'expo-symbols'
import type { Task } from '@direction-board/contracts/tasks'
import { Row } from '../../ui/Row'
import { colors, schemeColors, styles } from '../../ui/theme'
import { CheckButton, Dot, StarButton } from './parts'
import { taskWhen } from './rules'

/** 할 일 한 줄(웹 task-row.tsx): 미리알림·목표·사건 모두 같은 모양. 밀면 끝냄/다시 열기, 길게 누르면 동작 시트 */
export function TaskRow({ t, onOpen, onDone, onStar }: { t: Task; onOpen: (t: Task) => void; onDone: (t: Task, done: boolean) => void; onStar: (t: Task) => void }) {
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const when = taskWhen(t)
  const toggle = { label: t.done ? '다시 열기' : '끝냄', tone: t.done ? ('warn' as const) : ('done' as const), onPress: () => onDone(t, !t.done) }
  const meta = [t.kind === 'signal' ? t.source : t.kind === 'goal' ? '목표' : '', when, t.area?.name].filter(Boolean).join(' · ')
  return (
    <Row
      title={t.title}
      meta={meta || undefined}
      onPress={() => onOpen(t)}
      leading={t.kind === 'goal' ? <SymbolView name="flag" size={18} tintColor={c.muted} accessibilityLabel="목표" /> : <CheckButton done={t.done} title={t.title} onPress={toggle.onPress} />}
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {t.area ? <Dot color={t.area.color.startsWith('var(') ? undefined : t.area.color} /> : null}
          {t.late ? <Text style={[styles.small, { color: colors.decide }]}>늦음</Text> : null}
          {!t.done ? <StarButton on={t.main} title={t.title} onPress={() => onStar(t)} /> : null}
        </View>
      }
      swipe={t.kind === 'goal' ? undefined : toggle}
      actions={[...(t.kind === 'goal' ? [toggle] : []), { label: t.main ? '메인에서 빼기' : '오늘 메인으로', onPress: () => onStar(t) }, { label: '열기', onPress: () => onOpen(t) }]}
    />
  )
}
