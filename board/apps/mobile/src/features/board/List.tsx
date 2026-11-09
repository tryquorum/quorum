import React, { useLayoutEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { toTasks, type Task } from '@direction-board/contracts/tasks'
import { agenda, agendaDayLabel, agendaTime, roadRows, type RoadMark } from '@direction-board/contracts/road-agenda'
import { dday, isoLocal } from '@direction-board/contracts/board-text'
import { short } from '@direction-board/contracts/when'
import { color } from '@direction-board/design-tokens'
import { useBoardState, useSignals } from '../../api/board'
import type { RootParams, StackParams } from '../../navigation/routes'
import { showActions } from '../../ui/actions'
import { Chip } from '../../ui/Chip'
import { HeaderMenu } from '../../ui/HeaderMenu'
import { Row } from '../../ui/Row'
import { Screen } from '../../ui/Screen'
import { Section } from '../../ui/Section'
import { Empty, Loaded } from '../../ui/StateView'
import { colors, schemeColors, space, styles } from '../../ui/theme'
import { useMain, useSetDone, useSignalActions } from './actions'
import { openRef } from './open'
import { Dot, useCurrentBoard } from './parts'
import { countKind, doneTasks, filterTasks, GROUPS, groupTasks, KINDS, openKeysOf, type Kind } from './rules'
import { useStored } from './stored'
import { StoreProblemNotice } from './StoreProblemNotice'
import { TaskRow } from './TaskRow'
import { QuickAddBar } from './quick/QuickAddBar'

type Nav = NativeStackNavigationProp<StackParams & RootParams>
type ListPrefs = { kind: Kind; area: string; view: 'list' | 'agenda' }
const isPrefs = (v: unknown): v is ListPrefs => !!v && typeof v === 'object' && typeof (v as ListPrefs).kind === 'string' && typeof (v as ListPrefs).area === 'string' && ((v as ListPrefs).view === 'list' || (v as ListPrefs).view === 'agenda')
const INIT: ListPrefs = { kind: 'all', area: 'all', view: 'list' }
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }

/** 전체 목록(웹 list-view.tsx): 지금 판의 미리알림·목표·사건·메인을 한 층에서, 시간으로 묶고 종류·영역·찾기로 걸러요. 일정 보기는 로드맵 좁은 목록 */
export function List() {
  const navigation = useNavigation<Nav>()
  const board = useBoardState()
  const signals = useSignals()
  const setDone = useSetDone()
  const sig = useSignalActions()
  const main = useMain()
  const boards = useCurrentBoard()
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const c = schemeColors(scheme)
  const [prefs, setPrefs, , prefsIssue] = useStored<ListPrefs>('list', INIT, isPrefs)
  const [q, setQ] = useState('')
  const [showDone, setShowDone] = useState(false)
  const current = boards.current
  const noArea = color[scheme]['muted-foreground']

  useLayoutEffect(() => {
    navigation.setOptions({
      title: '전체 목록',
      headerRight: () => (
        <HeaderMenu
          actions={[
            { label: prefs.view === 'list' ? '일정 보기' : '목록 보기', onPress: () => setPrefs({ ...prefs, view: prefs.view === 'list' ? 'agenda' : 'list' }) },
            { label: '목표', onPress: () => navigation.navigate('Goals') },
            { label: '결정 칸·사건', onPress: () => navigation.navigate('Decisions') },
            { label: '보드', onPress: () => navigation.navigate('Board', current ? { boardId: current.id } : undefined) },
          ]}
        />
      ),
    })
  }, [navigation, prefs, setPrefs, current, boards.many, boards.pick])

  const items = board.data?.items ?? []
  const list = signals.data?.signals ?? []
  const all = useMemo(
    () => toTasks({ items, signals: list, boards: board.data?.boards ?? [], boardId: current?.id, mainKeys: main.keys, withDone: true, noAreaColor: noArea }),
    [items, list, board.data, current, main.keys, noArea],
  )
  const openKeys = useMemo(() => openKeysOf(items, list), [items, list])
  const open = (t: Task) => openRef(navigation, t.ref, t.title)
  const done = (t: Task, d: boolean) => (t.item ? void setDone(t.item, d) : t.signal ? void (d ? sig.resolve(t.signal) : sig.reopen(t.signal)) : undefined)
  const star = (t: Task) => main.toggle(t.key, t.title, openKeys)
  const shown = filterTasks(all, { kind: prefs.kind, area: prefs.area, q })
  const groups = groupTasks(shown)
  const finished = doneTasks(shown)
  const openCount = shown.filter((t) => !t.done).length
  const filtered = !!q || prefs.kind !== 'all' || prefs.area !== 'all'
  const areaLabel = prefs.area === 'all' ? '모든 영역' : prefs.area === 'none' ? '영역 없음' : prefs.area
  const pickArea = () =>
    showActions(
      [['all', '모든 영역'], ...(current?.areas ?? []).map((a) => [a.name, a.name]), ['none', '영역 없음']].map(([k, l]) => ({ label: l + (prefs.area === k ? ' ✓' : ''), onPress: () => setPrefs({ ...prefs, area: k }) })),
      '영역',
    )
  return (
    <Screen onRefresh={() => Promise.all([board.refresh(), signals.refresh()])}>
      <QuickAddBar />
      {/* 목록 설정을 읽지 못했거나 깨졌으면 풀릴 때까지 남아요(다시 읽기·초기화 — 리뷰 24 P2) */}
      <StoreProblemNotice label="목록 설정" issue={prefsIssue} />
      <StoreProblemNotice label="오늘 메인" issue={main.issue} />
      <Loaded query={board}>
        {(data) =>
          prefs.view === 'agenda' ? (
            <AgendaView rows={roadRows(data.items, list, current, current?.id, noArea).rows} onOpen={(m) => openRef(navigation, m.ref, m.title)} />
          ) : (
            <>
              <View style={s.filters}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} accessibilityLabel="종류">
                  {boards.many && current ? <Chip label={`${current.kind === 'personal' ? '개인' : '회사'} 판 · ${current.name} ▾`} onPress={boards.pick} /> : null}
                  {KINDS.map(([k, l]) => <Chip key={k} label={`${l} ${countKind(all, k)}`} selected={prefs.kind === k} onPress={() => setPrefs({ ...prefs, kind: k })} />)}
                  <Chip label={`${areaLabel} ▾`} selected={prefs.area !== 'all'} onPress={pickArea} />
                </ScrollView>
                <TextInput value={q} onChangeText={setQ} placeholder="제목으로 찾기" placeholderTextColor={c.muted} accessibilityLabel="제목으로 찾기" clearButtonMode="while-editing" returnKeyType="search" style={styles.input} />
              </View>
              {openCount === 0 ? (
                <Section>
                  <Empty title={filtered ? '맞는 일이 없어요' : '할 일이 없어요'} action={filtered ? { label: '필터 풀기', onPress: () => { setQ(''); setPrefs({ ...prefs, kind: 'all', area: 'all' }) } } : undefined} />
                </Section>
              ) : null}
              {GROUPS.map((k) =>
                groups[k].length ? (
                  <Section key={k} title={k} count={groups[k].length} right={k === '지남' ? <Dot tone="decide" label="지남" /> : undefined}>
                    {groups[k].map((t) => <TaskRow key={t.key} t={t} onOpen={open} onDone={done} onStar={star} />)}
                  </Section>
                ) : null,
              )}
              {finished.length ? (
                <Section title={`끝낸 것 ${finished.length}`} right={<Chip label={showDone ? '접기' : '펼치기'} onPress={() => setShowDone((v) => !v)} />}>
                  {showDone ? finished.map((t) => <TaskRow key={t.key} t={t} onOpen={open} onDone={done} onStar={star} />) : <Row title="끝낸 일 보기" meta="최근 50개" onPress={() => setShowDone(true)} />}
                </Section>
              ) : null}
            </>
          )
        }
      </Loaded>
    </Screen>
  )
}

/** 일정(웹 로드맵 좁은 목록): 오늘부터 14일을 날짜별로, 지난 일은 맨 위, 그 뒤·날짜 없는 일은 개수만 */
function AgendaView({ rows, onOpen }: { rows: ReturnType<typeof roadRows>['rows']; onOpen: (m: RoadMark) => void }) {
  const t0 = today0()
  const a = agenda(rows.flatMap((r) => r.marks), rows.reduce((n, r) => n + r.undated, 0), t0, 14)
  const KIND: Record<RoadMark['kind'], string> = { goal: '목표', todo: '미리알림', deadline: '마감', event: '일정' }
  const row = (m: RoadMark, overdue: boolean) => (
    <Row
      key={m.key}
      title={m.title}
      meta={[KIND[m.kind], m.area].join(' · ')}
      leading={<Dot color={m.color} />}
      trailing={<Text style={[styles.small, m.late && { color: colors.decide }]}>{m.kind === 'goal' ? dday(isoLocal(m.at).slice(0, 10)).t : overdue ? short(isoLocal(m.at)) : agendaTime(m.at)}</Text>}
      onPress={() => onOpen(m)}
    />
  )
  return (
    <>
      {a.overdue.length ? <Section title="지난 일" count={a.overdue.length}>{a.overdue.map((m) => row(m, true))}</Section> : null}
      {a.days.map((d) => <Section key={d.day} title={agendaDayLabel(d.day, t0)}>{d.marks.map((m) => row(m, false))}</Section>)}
      {!a.overdue.length && !a.days.length ? <Section><Empty title="14일 안에 날짜가 있는 일이 없어요" /></Section> : null}
      {a.later > 0 || a.undated > 0 ? <Text style={[styles.small, s.foot]}>{[a.later > 0 && `14일 뒤 ${a.later}개`, a.undated > 0 && `날짜 없는 일 ${a.undated}개`].filter(Boolean).join(' · ')}</Text> : null}
    </>
  )
}
const s = StyleSheet.create({
  filters: { gap: space.sm },
  chips: { gap: space.sm, paddingRight: space.gutter },
  foot: { paddingHorizontal: space.xs },
})
