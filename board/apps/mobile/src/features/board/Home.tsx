import React, { useLayoutEffect, useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { SymbolView } from 'expo-symbols'
import { compareWorkOrder, type Signal } from '@direction-board/contracts'
import { ago, srcName } from '@direction-board/contracts/board-text'
import { useBoardState, useSignals } from '../../api/board'
import { refreshOps } from '../../api/ops'
import type { RootParams, StackParams } from '../../navigation/routes'
import { Chip } from '../../ui/Chip'
import { HeaderMenu } from '../../ui/HeaderMenu'
import { Row } from '../../ui/Row'
import { Screen } from '../../ui/Screen'
import { Section } from '../../ui/Section'
import { OpsChip } from '../settings/OpsChip'
import { Empty, Loaded, Loading } from '../../ui/StateView'
import { colors, schemeColors, space, styles } from '../../ui/theme'
import { useMain, useSetDone, useSignalActions } from './actions'
import { openRef, openSignal } from './open'
import { CheckButton, Dot, GoalStrip, SignalMarks, StarButton, useCurrentBoard } from './parts'
import { collectorState, dueText, homeGroups, mainCandidates, openKeysOf, resolveMain, upcoming, type MainRef } from './rules'
import { useStored } from './stored'
import { StoreProblemNotice } from './StoreProblemNotice'
import { QuickAddBar, useHiddenFailures } from './quick/QuickAddBar'
import { IntentsNotice } from './IntentsNotice'

type Nav = NativeStackNavigationProp<StackParams & RootParams>
const today = () => {
  const d = new Date()
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`
}
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const clean = (t: string) => t.replace(/^답이 왔어요:\s*/, '')

/** 홈(웹 home.tsx): 결정 → 오늘 메인 → 에이전트, 아래로 AI가 처리함·마감·수집기·끼어들기 */
export function Home() {
  const navigation = useNavigation<Nav>()
  const board = useBoardState()
  const signals = useSignals()
  const sig = useSignalActions()
  const setDone = useSetDone()
  const main = useMain()
  const boards = useCurrentBoard()
  const hidden = useHiddenFailures(signals.data?.signals ?? [])
  const [focus, setFocus, , focusIssue] = useStored<boolean>('focus', true, isBool)
  const [peek, setPeek] = useState(false)
  const [moreDecide, setMoreDecide] = useState(false)
  const [moreAgents, setMoreAgents] = useState(false)
  const [allAuto, setAllAuto] = useState(false)
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const items = board.data?.items ?? []
  const list = signals.data?.signals ?? []
  const hasSample = list.some((s) => s.sample) || !!signals.data?.collectors.some((x) => x.sample)

  useLayoutEffect(() => {
    navigation.setOptions({
      title: today(),
      headerRight: () => (
        <View style={s.head}>
          <HeaderMenu
            actions={[
              { label: focus ? '집중 모드 끄기' : '집중 모드 켜기', onPress: () => { setFocus(!focus); setPeek(false) } },
              ...(boards.many ? [{ label: `판 바꾸기 · ${boards.current?.name ?? ''}`, onPress: boards.pick }] : []),
              ...(hasSample ? [{ label: '샘플 지우기', destructive: true, onPress: () => void sig.clearSamples() }] : []),
            ]}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="설정" hitSlop={10} onPress={() => navigation.navigate('Settings')}>
            <SymbolView name="gearshape" size={22} tintColor={c.ink} />
          </Pressable>
        </View>
      ),
    })
  }, [navigation, c.ink, focus, setFocus, boards.many, boards.current, boards.pick, hasSample, sig])

  const openKeys = useMemo(() => openKeysOf(items, list), [items, list])
  const allMains = main.keys.map((k) => resolveMain(k, items, list)).filter((m): m is MainRef => !!m)
  const mains = allMains.filter((m) => !m.done).sort((a, b) => compareWorkOrder(a, b))
  const doneToday = allMains.length - mains.length
  const candidates = useMemo(() => mainCandidates(items, list, main.keys), [items, list, main.keys])
  const goals = items.filter((i) => i.type === 'goal' && !i.done && !i.deleted).sort((a, b) => compareWorkOrder(a, b))
  const open = (sg: Signal) => openSignal(navigation, sg, (x) => void sig.confirm([x], true))
  const finish = (m: MainRef) => (m.item ? setDone(m.item, true) : m.signal ? sig.resolve(m.signal) : undefined)

  return (
    <Screen onRefresh={() => Promise.all([board.refresh(), signals.refresh(), refreshOps()])}>
      {/* 운영 순회 칩(레인 3): 맥 주인이 아니면 칩이 그려지지 않아요 */}
      <View style={styles.group}>
        <OpsChip />
      </View>
      <QuickAddBar />
      <IntentsNotice />
      {/* 화면 설정을 읽지 못했거나 깨졌으면 풀릴 때까지 남아요(다시 읽기·초기화 — 리뷰 24 P2) */}
      <StoreProblemNotice label="집중 모드" issue={focusIssue} />
      <StoreProblemNotice label="오늘 메인" issue={main.issue} />
      {board.data ? <GoalStrip goals={goals} boards={board.data.boards} onOpen={(g) => openRef(navigation, `item:${g.boardId}:${g.id}`, g.text)} /> : null}
      <Loaded query={signals}>
        {(data) => {
          const g = homeGroups(data.signals, hidden)
          const gate = focus && mains.length > 0 && !peek
          const limit = moreDecide ? Infinity : 3
          const nowShown = g.now.slice(0, limit)
          const decideShown = gate ? [] : g.decide.slice(0, Math.max(0, limit - nowShown.length))
          const decideRest = g.now.length + (gate ? 0 : g.decide.length) - nowShown.length - decideShown.length
          const agentLimit = moreAgents ? Infinity : 8
          const reviewShown = g.review.slice(0, agentLimit)
          const runningShown = g.running.slice(0, Math.max(0, agentLimit - reviewShown.length))
          const agentRest = g.review.length + g.running.length - reviewShown.length - runningShown.length
          const urgent = g.now.length + g.decide.length > 0
          const decideRow = (x: Signal, isNow: boolean) => (
            <Row
              key={x.id}
              title={clean(x.title)}
              meta={[srcName(x.source), x.reason, ago(x.updated_at)].filter(Boolean).join(' · ')}
              leading={<Dot tone={isNow ? 'decide' : 'warn'} label={isNow ? '지금' : '결정 대기'} />}
              trailing={<Chip label="처리함" onPress={() => void sig.resolve(x)} />}
              onPress={() => open(x)}
              swipe={{ label: '처리함', tone: 'done', onPress: () => void sig.resolve(x) }}
              actions={[
                { label: 'AI가 처리함', onPress: () => void sig.aiDone(x) },
                { label: '이런 소식은 안 와도 돼', onPress: () => void sig.mute(x) },
                { label: '열기', onPress: () => open(x) },
              ]}
            >
              {x.body ? <Text style={styles.meta} numberOfLines={1}>{x.body}</Text> : null}
              <SignalMarks s={x} />
            </Row>
          )
          const decide = (
            <Section key="decide" title="결정" count={g.now.length + g.decide.length}>
              {nowShown.map((x) => decideRow(x, true))}
              {gate && g.decide.length > 0 ? (
                <Row key="gate" title={`결정 ${g.decide.length}개 · 메인 일 끝나면 펼쳐요`} meta="집중 모드" onPress={() => setPeek(true)} trailing={<Chip label="보기" onPress={() => setPeek(true)} />} />
              ) : null}
              {decideShown.map((x) => decideRow(x, false))}
              {decideRest > 0 || moreDecide ? <Row key="more" title={moreDecide ? '접기' : `결정 ${decideRest}개 더`} onPress={() => setMoreDecide((v) => !v)} /> : null}
              {!urgent ? <Empty key="empty" title="기다리는 결정 없음" /> : null}
            </Section>
          )
          return (
            <>
              {urgent ? decide : null}
              <Section title={`오늘 메인${mains.length ? ` ${mains.length}/3` : ''}`} right={focus ? <Text style={styles.small}>집중</Text> : undefined}>
                {!board.data || !main.ready ? <Loading /> : null}
                {board.data && main.ready && !mains.length ? <Empty title={doneToday ? `오늘 ${doneToday}개 끝냄` : '끝낼 일을 3개까지 골라요'} body={candidates.length ? '아래 후보의 별을 눌러 골라요' : undefined} /> : null}
                {mains.map((m) => (
                  <Row
                    key={m.key}
                    title={m.title}
                    meta={m.meta || undefined}
                    leading={<CheckButton done={false} title={m.title} onPress={() => void finish(m)} />}
                    onPress={() => openRef(navigation, m.ref, m.title)}
                    swipe={{ label: '빼기', tone: 'warn', onPress: () => main.set(main.keys.filter((k) => k !== m.key)) }}
                    actions={[{ label: '끝냄', onPress: () => void finish(m) }, { label: '열기', onPress: () => openRef(navigation, m.ref, m.title) }]}
                  />
                ))}
                {mains.length > 0 && doneToday > 0 ? <Text key="done" style={[styles.small, s.pad]}>오늘 {doneToday}개 끝냄</Text> : null}
              </Section>
              {main.ready && mains.length < 3 && candidates.length > 0 ? (
                <Section title="메인 후보" count={candidates.length}>
                  {candidates.slice(0, 5).map((m) => (
                    <Row key={m.key} title={m.title} meta={m.meta || undefined} onPress={() => openRef(navigation, m.ref, m.title)} trailing={<StarButton on={false} title={m.title} onPress={() => main.toggle(m.key, m.title, openKeys)} />} actions={[{ label: '오늘 메인으로', onPress: () => main.toggle(m.key, m.title, openKeys) }]} />
                  ))}
                </Section>
              ) : null}
              {!urgent ? decide : null}
              <Section title="에이전트" count={g.running.length + g.review.length} right={g.review.length >= 3 ? <Chip label="모두 확인함" onPress={() => void sig.confirm(g.review)} /> : undefined}>
                {reviewShown.map((x) => (
                  <Row key={x.id} title={clean(x.title)} meta={`확인 기다림 · ${ago(x.updated_at)}`} leading={<Dot tone="warn" label="확인 안 함" />} trailing={<Chip label="확인함" onPress={() => void sig.confirm([x])} />} onPress={() => open(x)} swipe={{ label: '확인함', tone: 'done', onPress: () => void sig.confirm([x]) }} actions={[{ label: '열기', onPress: () => open(x) }]} />
                ))}
                {runningShown.map((x) => (
                  <Row key={x.id} title={clean(x.title)} meta={[x.agent ?? srcName(x.source), ago(x.updated_at)].join(' · ')} leading={<Dot tone="running" label="하는 중" />} onPress={() => open(x)} chevron />
                ))}
                {agentRest > 0 ? <Row key="more" title={`${agentRest}개 더 보기`} onPress={() => setMoreAgents(true)} /> : null}
                {!g.running.length && !g.review.length ? <Empty title="하는 일 없음" /> : null}
              </Section>
              <Section title="AI가 처리함" count={g.autoDone.length}>
                {(allAuto ? g.autoDone : g.autoDone.slice(0, 5)).map((x) => (
                  <Row key={x.id} title={clean(x.title)} meta={[srcName(x.source), x.reason, ago(x.updated_at)].filter(Boolean).join(' · ')} leading={<Dot tone="done" label="끝남" />} onPress={() => open(x)} swipe={{ label: '바로 알려줘', tone: 'warn', onPress: () => void sig.urgent(x) }} actions={[{ label: '이런 소식은 바로 알려줘', onPress: () => void sig.urgent(x) }]} />
                ))}
                {g.autoDone.length > 5 ? <Row key="all" title={allAuto ? '접기' : `모두 보기 ${g.autoDone.length}`} onPress={() => setAllAuto((v) => !v)} /> : null}
                {!g.autoDone.length ? <Empty title="24시간 동안 없음" /> : null}
              </Section>
              <Section title="마감">
                {board.data ? (
                  upcoming(data.signals, items).map((u) => <Row key={u.key} title={u.title} meta={`${dueText(u.at)} · ${u.src}`} onPress={() => openRef(navigation, u.ref, u.title)} chevron />)
                ) : (
                  <Loading />
                )}
                {board.data && !upcoming(data.signals, items).length ? <Empty title="다가오는 마감 없음" /> : null}
              </Section>
              <Section title="수집기">
                {data.collectors.map((x) => {
                  const st = collectorState(x)
                  return <Row key={x.name} title={srcName(x.name) + (x.sample ? ' · 예시' : '')} meta={`${st.note} · ${ago(x.last_seen)}`} leading={<Dot tone={st.bad ? 'decide' : 'done'} label={st.bad ? '문제 있음' : '정상'} />} />
                })}
                {!data.collectors.length ? <Empty title="연결된 수집기 없음" /> : null}
              </Section>
              <Section title="끼어들기">
                <Row title={`오늘 ${data.stats.interrupts_today}번 끼어들었어요`} meta="하루 3번 이하가 목표예요" trailing={<Text style={[styles.strong, data.stats.interrupts_today > 3 && s.over]}>{data.stats.interrupts_today}/3</Text>} />
                {data.rules.map((r) => (
                  <Row
                    key={r.id}
                    title={r.note ?? '규칙'}
                    meta="규칙 · 길게 눌러 지우기"
                    actions={[{ label: '규칙 지우기', destructive: true, onPress: () => Alert.alert('규칙을 지울까요?', r.note ?? '', [{ text: '취소', style: 'cancel' }, { text: '지우기', style: 'destructive', onPress: () => void sig.deleteRule(r.id) }]) }]}
                  />
                ))}
              </Section>
            </>
          )
        }}
      </Loaded>
    </Screen>
  )
}
const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  pad: { paddingHorizontal: space.gutter, paddingVertical: space.sm },
  over: { color: colors.decide },
})
