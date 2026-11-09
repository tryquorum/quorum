import React, { useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native'
import type { Board, DocProp, Item, PropType, PropValue } from '@direction-board/contracts'
import { parseProp, propKeyIssue } from './props'
import { long, parse, quick } from '@direction-board/contracts/when'
import { ApiError, ConflictError, UnknownWriteError } from '../../../api/client'
import { useQuery } from '../../../api/query'
import { workApi, workOps } from '../../../api/work'
import { useSaveItem } from '../../../api/board'
import { useServer } from '../../../server'
import { showActions } from '../../../ui/actions'
import { Button } from '../../../ui/Button'
import { Chip } from '../../../ui/Chip'
import { Row } from '../../../ui/Row'
import { Section } from '../../../ui/Section'
import { Sheet } from '../../../ui/Sheet'
import { useToast } from '../../../ui/Toast'
import { schemeColors, space, styles } from '../../../ui/theme'
import { useWriteScope } from '../../../api/scope'

const TYPES: [PropType, string][] = [['text', '글'], ['number', '숫자'], ['date', '날짜'], ['datetime', '날짜와 시간'], ['checkbox', '체크'], ['url', '링크'], ['select', '선택'], ['list', '목록']]
const tagName = (t: unknown) => (typeof t === 'string' ? t : t && typeof t === 'object' && 'tag' in t ? String((t as { tag: unknown }).tag) : '')
const tagBy = (t: unknown) => (t && typeof t === 'object' && 'by' in t ? String((t as { by: unknown }).by) : 'person')
const valueText = (v: PropValue) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v))
/**
 * 일 속성 시트(웹 문서 속성 패널의 일 쪽): 제목·날짜·영역은 판 항목 저장, 태그·사용자 속성은 문서 층(버전 보호).
 * 문서 층은 노트가 있는 일만이라, 없으면 빈 노트를 먼저 만들어요. 회사 판 일은 태그·속성이 없어요.
 */
export function PropertiesSheet({ visible, onClose, workRef, item, board, onChanged }: { visible: boolean; onClose: () => void; workRef: string; item: Item | undefined; board: Board | undefined; onChanged: () => void }) {
  const { origin } = useServer()
  const scope = useWriteScope()
  const toast = useToast()
  const save = useSaveItem()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const docs = board?.kind !== 'company'
  const meta = useQuery(`docmeta/${workRef}`, () => (docs ? workApi.docMeta(origin, workRef) : Promise.resolve(null)))
  const [tagText, setTagText] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newType, setNewType] = useState<PropType>('text')
  const [busy, setBusy] = useState(false)
  const missing = meta.status === 'error' && meta.error instanceof ApiError && meta.error.status === 404
  const fm = meta.data?.frontmatter ?? {}
  const tags = (Array.isArray(fm.tags) ? fm.tags : []).filter((t) => tagBy(t) === 'person').map(tagName).filter(Boolean)
  const props = (Array.isArray(fm.props) ? fm.props : []) as DocProp[]
  const fail = (e: unknown) => {
    toast(e instanceof ConflictError ? '다른 곳에서 바뀌어 최신으로 다시 불러왔어요. 다시 해 주세요' : e instanceof UnknownWriteError ? e.message : e instanceof ApiError ? `서버가 거절했어요 · ${e.message}` : '저장하지 못했어요')
    void meta.refresh()
  }
  const run = async (f: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await f()
      void meta.refresh()
      onChanged()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  const putItem = (patch: Partial<Item>) => item && void save({ ...item, ...patch }).then(onChanged, () => toast('저장하지 못해 되돌렸어요'))
  const rename = () => item && Alert.prompt('제목', '한 줄, 200자까지', (v) => { const t = (v ?? '').replace(/\n/g, ' ').trim(); if (t) putItem({ text: [t, ...String(item.text || '').split('\n').slice(1)].join('\n') }) }, 'plain-text', String(item.text || '').split('\n')[0])
  const when = item ? (item.type === 'goal' ? (item.due as string | null | undefined) : item.remindAt) : null
  const setWhen = (at: string | null) => item && putItem(item.type === 'goal' ? { due: at ? at.slice(0, 10) : null } : { remindAt: at ?? undefined })
  const askWhen = () => Alert.prompt(item?.type === 'goal' ? '마감' : '알림', '예: 내일 3시, 12월 3일, 다음 주 금요일', (v) => { const p = v ? parse(v) : null; if (p) setWhen(p.at); else if (v) toast('날짜를 알아보지 못했어요') })
  const addTag = () => { const t = tagText.replace(/^#/, '').trim(); if (!t) return; setTagText(''); void run(() => workOps(scope).changeTags(workRef, { add: [t] })) }
  const setProp = (p: DocProp, value: string) => {
    let v: PropValue
    try { v = parseProp(p.type, value) } catch (e) { return toast((e as Error).message) }
    void run(() => workOps(scope).patchProps(workRef, { set: { [p.key]: v }, types: { [p.key]: p.type }, expectedVersion: meta.data?.version ?? 0 }))
  }
  const editProp = (p: DocProp) =>
    p.type === 'checkbox'
      ? showActions([{ label: '예', onPress: () => setProp(p, 'true') }, { label: '아니요', onPress: () => setProp(p, 'false') }, { label: '값 비우기', onPress: () => setProp(p, '') }], p.key)
      : Alert.prompt(p.key, p.type === 'list' ? '쉼표로 나눠요' : p.type === 'date' ? 'YYYY-MM-DD' : p.type === 'datetime' ? 'YYYY-MM-DDTHH:MM' : '값', (v) => setProp(p, v ?? ''), 'plain-text', valueText(p.value))
  const removeProp = (p: DocProp) => Alert.alert(`${p.key} 속성을 지울까요?`, '', [{ text: '취소', style: 'cancel' }, { text: '지우기', style: 'destructive', onPress: () => void run(() => workOps(scope).patchProps(workRef, { remove: [p.key], expectedVersion: meta.data?.version ?? 0 })) }])
  const addProp = () => {
    const issue = propKeyIssue(newKey, props)
    if (issue) return toast(issue)
    const k = newKey.normalize('NFC').trim()
    const initial: PropValue = newType === 'checkbox' ? false : newType === 'list' ? [] : newType === 'text' ? '' : null
    setNewKey('')
    void run(() => workOps(scope).patchProps(workRef, { set: { [k]: initial }, types: { [k]: newType }, expectedVersion: meta.data?.version ?? 0 }))
  }
  return (
    <Sheet visible={visible} title="속성" onClose={onClose}>
      {item ? (
        <Section title="기본">
          <Row title={String(item.text || '(제목 없음)').split('\n')[0]} meta="제목 · 눌러서 고치기" onPress={rename} />
          <Row title={when ? long(when) : '없음'} meta={item.type === 'goal' ? '마감 · 눌러서 글로 바꾸기' : '알림 · 눌러서 글로 바꾸기'} onPress={askWhen} actions={when ? [{ label: '지우기', destructive: true, onPress: () => setWhen(null) }] : undefined} />
        </Section>
      ) : null}
      {item && item.type === 'todo' ? <View style={s.chips}>{quick().map((q) => <Chip key={q.k} label={q.label} selected={when === q.at} onPress={() => setWhen(q.at)} />)}</View> : null}
      {item && board?.areas.length ? (
        <View style={s.chips} accessibilityLabel="영역">
          {board.areas.map((a) => <Chip key={a.id} label={a.name} selected={item.area === a.id} onPress={() => putItem({ area: item.area === a.id ? undefined : a.id })} />)}
        </View>
      ) : null}
      {!docs ? <Text style={styles.small}>회사 판 일은 태그·속성을 붙이지 않아요</Text> : missing ? (
        <View style={s.gap}>
          <Text style={styles.meta}>태그·속성은 노트가 있는 일에 붙어요</Text>
          <Button title="빈 노트 만들고 태그·속성 쓰기" variant="outline" disabled={busy} onPress={() => void run(() => workOps(scope).startNote(workRef))} />
        </View>
      ) : (
        <>
          <Section title="태그" count={tags.length}>
            {tags.map((t) => <Row key={t} title={`#${t}`} swipe={{ label: '빼기', tone: 'decide', onPress: () => void run(() => workOps(scope).changeTags(workRef, { remove: [t] })) }} actions={[{ label: '태그 빼기', destructive: true, onPress: () => void run(() => workOps(scope).changeTags(workRef, { remove: [t] })) }]} />)}
          </Section>
          <TextInput value={tagText} onChangeText={setTagText} onSubmitEditing={addTag} submitBehavior="blurAndSubmit" returnKeyType="done" placeholder="태그 더하기" placeholderTextColor={c.muted} accessibilityLabel="태그 더하기" style={styles.input} />
          <Section title="사용자 속성" count={props.length}>
            {props.map((p) => <Row key={p.key} title={valueText(p.value) || '비어 있음'} meta={`${p.key} · ${TYPES.find(([t]) => t === p.type)?.[1] ?? p.type}`} onPress={() => editProp(p)} actions={[{ label: '값 고치기', onPress: () => editProp(p) }, { label: '속성 지우기', destructive: true, onPress: () => removeProp(p) }]} />)}
          </Section>
          <View style={s.row}>
            <TextInput value={newKey} onChangeText={setNewKey} onSubmitEditing={addProp} submitBehavior="blurAndSubmit" returnKeyType="done" placeholder="새 속성 이름" placeholderTextColor={c.muted} accessibilityLabel="새 속성 이름" style={[styles.input, s.flex]} />
            <Chip label={TYPES.find(([t]) => t === newType)?.[1] ?? newType} onPress={() => showActions(TYPES.map(([t, l]) => ({ label: l, onPress: () => setNewType(t) })), '속성 종류')} />
            <Chip label="+ 추가" onPress={busy ? undefined : addProp} />
          </View>
        </>
      )}
    </Sheet>
  )
}
const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  gap: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
})
