import React, { useEffect, useState } from 'react'
import { Alert, StyleSheet, TextInput, View, useColorScheme } from 'react-native'
import { srcName } from '@direction-board/contracts/board-text'
import { short } from '@direction-board/contracts/when'
import { isoLocal } from '@direction-board/contracts/board-text'
import { ConflictError, UnknownWriteError } from '../../../api/client'
import { workApi, workOps, type Brief, type WorkFull } from '../../../api/work'
import { useServer } from '../../../server'
import { Chip } from '../../../ui/Chip'
import { Row } from '../../../ui/Row'
import { Section } from '../../../ui/Section'
import { Sheet } from '../../../ui/Sheet'
import { Empty } from '../../../ui/StateView'
import { useToast } from '../../../ui/Toast'
import { schemeColors, space, styles, type Tone } from '../../../ui/theme'
import { Dot } from '../parts'
import { useWriteScope } from '../../../api/scope'

export const LINK_LABELS = ['막힘', '위해서', '관련', '다음에', '같은 건']
const toneOf = (b: Brief): Tone => (b.status === 'resolved' ? 'neutral' : b.lane === 'now' ? 'decide' : b.lane === 'running' ? 'running' : b.lane === 'decide' ? 'warn' : 'neutral')
const whenOf = (b: Brief) => (b.when || b.due ? short(b.when || isoLocal(b.due ?? 0)) : '')

/** 연결할 일 찾기 시트(웹 AddLink): 라벨 칩 + 찾기 → 고르면 잇기 */
function AddLink({ self, visible, onClose, onDone }: { self: string; visible: boolean; onClose: () => void; onDone: () => void }) {
  const { origin } = useServer()
  const scope = useWriteScope()
  const toast = useToast()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const [q, setQ] = useState('')
  const [label, setLabel] = useState('관련')
  const [res, setRes] = useState<Brief[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!visible) return
    let alive = true
    const t = setTimeout(() => workApi.search(origin, q, self).then((r) => alive && setRes(r.results), () => undefined), 120)
    return () => { alive = false; clearTimeout(t) }
  }, [q, visible, self, origin])
  const add = async (b: Brief) => {
    if (busy) return
    setBusy(true)
    try {
      await workOps(scope).link(self, b.ref, label)
      toast(`연결했어요 · ${label} · ${b.title}`)
      setQ('')
      onDone()
      onClose()
    } catch (e) {
      toast(e instanceof ConflictError ? '이미 연결돼 있어요' : e instanceof UnknownWriteError ? e.message : '연결하지 못했어요')
      if (e instanceof UnknownWriteError) onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet visible={visible} title="일 연결하기" onClose={onClose}>
      <View style={s.chips}>{LINK_LABELS.map((l) => <Chip key={l} label={l} selected={label === l} onPress={() => setLabel(l)} />)}</View>
      <TextInput value={q} onChangeText={setQ} autoFocus placeholder="연결할 일 찾기" placeholderTextColor={c.muted} accessibilityLabel="연결할 일 찾기" returnKeyType="search" style={styles.input} />
      <Section>
        {res.map((b) => <Row key={b.ref} title={b.title} meta={[srcName(b.source), b.area].filter(Boolean).join(' · ')} leading={<Dot tone={toneOf(b)} />} onPress={() => void add(b)} />)}
        {!res.length ? <Empty title="맞는 일이 없어요" /> : null}
      </Section>
    </Sheet>
  )
}

/** 연결·같은 흐름(웹 work-view Side) */
export function LinksPane({ w, onOpen, refresh }: { w: WorkFull; onOpen: (ref: string, title?: string) => void; refresh: () => void }) {
  const scope = useWriteScope()
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const unlink = (id: string, title: string) =>
    Alert.alert('연결을 끊을까요?', title, [
      { text: '취소', style: 'cancel' },
      { text: '끊기', style: 'destructive', onPress: () => void workOps(scope).unlink(id).then(refresh, (e: unknown) => { toast(e instanceof UnknownWriteError ? e.message : '연결을 끊지 못했어요'); refresh() }) },
    ])
  const grouped: [string, Brief[]][] = (() => {
    const g: Record<string, Brief[]> = {}
    for (const f of w.flow) (g[f.why] ||= []).push(f.item)
    return Object.entries(g)
  })()
  return (
    <>
      <Section title="연결" count={w.links.length} right={<Chip label="+ 연결" onPress={() => setAdding(true)} />}>
        {w.links.map((l) => (
          <Row
            key={l.id}
            title={l.other.title}
            meta={[`${l.dir === 'out' ? '→' : '←'} ${l.label || '관련'}`, whenOf(l.other)].filter(Boolean).join(' · ')}
            leading={<Dot tone={toneOf(l.other)} />}
            onPress={() => onOpen(l.other.ref, l.other.title)}
            swipe={{ label: '끊기', tone: 'decide', onPress: () => unlink(l.id, l.other.title) }}
            actions={[{ label: '열기', onPress: () => onOpen(l.other.ref, l.other.title) }]}
          />
        ))}
        {!w.links.length ? <Empty title="연결된 일이 없어요" action={{ label: '+ 연결', onPress: () => setAdding(true) }} /> : null}
      </Section>
      {grouped.map(([why, list]) => (
        <Section key={why} title={why}>
          {list.map((b) => <Row key={b.ref} title={b.title} meta={whenOf(b) || undefined} leading={<Dot tone={toneOf(b)} />} onPress={() => onOpen(b.ref, b.title)} chevron />)}
        </Section>
      ))}
      <AddLink self={w.ref} visible={adding} onClose={() => setAdding(false)} onDone={refresh} />
    </>
  )
}
const s = StyleSheet.create({ chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm } })
