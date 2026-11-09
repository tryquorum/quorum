import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native'
import type { OpsSettings } from '@direction-board/contracts'
import { checkLines, replaceBody, restoreEol, splitPrompt, toLF, type PromptPart } from '@direction-board/contracts/ops-prompt'
import { ago } from '@direction-board/contracts/run-labels'
import { ConflictError, errorMessage } from '../../api/client'
import { putOps } from '../../api/ops'
import { Button } from '../../ui/Button'
import { Row } from '../../ui/Row'
import { Section } from '../../ui/Section'
import { Sheet } from '../../ui/Sheet'
import { useToast } from '../../ui/Toast'
import { colors, schemeColors, space, styles } from '../../ui/theme'
import { Segmented } from './parts'
import { keepPromptDraft, readPromptDraft, type DraftOwner } from './promptDraft'
import { afterSave, restorable } from './promptDraftModel'
import { useWriteScope } from '../../api/scope'

let unsaved = false
const ask = (go: () => void) =>
  Alert.alert('저장하지 않은 지시문 고침이 있어요', '이번 순회는 저장된 지시문으로 돌아요. 그래도 돌릴까요?', [
    { text: '취소', style: 'cancel' },
    { text: '돌리기', onPress: go },
  ])
/**
 * 저장하지 않은 지시문 고침이 있으면 순회 전에 물어요(순회는 저장된 지시문으로 돌아요, 웹 confirmUnsavedPrompt).
 * 편집기가 열려 있지 않아도 이 서버·계정의 보관된 고침이 있으면 물어요. 보관 파일은 고침이 있을 때만 있고 저장·버리기에서 지워요
 */
export function confirmUnsavedPrompt(go: () => void, owner?: DraftOwner) {
  if (unsaved) return ask(go)
  if (!owner?.email) return go()
  void readPromptDraft(owner).then((d) => (d ? ask(go) : go()), go)
}

type Editing = { index: number | null; title: string; text: string }

/**
 * 순회 지시문 편집기(웹 PromptEditor): ##·### 영역 카드 또는 원문. 원본은 늘 글 하나라 영역에서 고쳐도 다른 부분은 그대로예요.
 * 저장은 base_rev 를 함께 보내고, 409 면 다른 곳에서 먼저 저장했다고 알려요. 고침은 서버+계정별 파일에 남아 화면을 옮겨도 이어 써요.
 */
export function PromptEditor({ ops, defaultText, owner }: { ops: OpsSettings; defaultText?: string; owner: DraftOwner }) {
  const toast = useToast()
  const scope = useWriteScope()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const server = toLF(ops.text)
  const [draft, setDraft] = useState<string | null>(null)
  const [baseRev, setBaseRev] = useState(ops.rev)
  const [restored, setRestored] = useState(false)
  const [conflict, setConflict] = useState<OpsSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'cards' | 'raw'>('cards')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [kept, setKept] = useState(true)
  /** 보관된 고침을 다 읽기 전에는 파일을 쓰거나 지우지 않아요(읽기보다 지우기가 먼저 끝나면 사람 글이 사라져요) */
  const [loaded, setLoaded] = useState(false)
  const value = draft ?? server
  const dirty = draft !== null && draft !== server
  const parts = useMemo(() => splitPrompt(value), [value])
  const latest = useRef(value)
  latest.current = value
  const key = `${owner.origin}|${owner.email ?? ''}`

  // 이 서버·계정의 저장 안 한 고침을 되살려요(다른 서버·계정 것은 읽지 않아요)
  useEffect(() => {
    let live = true
    setLoaded(false)
    void readPromptDraft(owner).then((d) => {
      if (!live) return
      const back = restorable(d, server)
      if (back) {
        setDraft((cur) => cur ?? back.text)
        setBaseRev(back.rev)
        setRestored(true)
      }
      setLoaded(true)
    })
    return () => {
      live = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  // 고침이 있을 때만 보관해요. 지우기는 저장 성공·버리기에서만(아래 discard·save)
  useEffect(() => {
    unsaved = dirty
    if (loaded && dirty) void keepPromptDraft(owner, { text: value, rev: baseRev }).then(setKept)
    return () => {
      unsaved = false
    }
  }, [loaded, dirty, value, baseRev, key]) // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: string) => {
    if (!loaded) return
    if (draft === null) setBaseRev(ops.rev)
    setDraft(next)
  }
  const discard = () => {
    setDraft(null)
    setRestored(false)
    setConflict(null)
    void keepPromptDraft(owner, null)
  }
  const save = async (rev = draft === null ? ops.rev : baseRev) => {
    if (saving) return
    setSaving(true)
    const sent = value
    try {
      const saved = await putOps(scope, { text: restoreEol(sent, ops.text), base_rev: rev })
      const next = afterSave(latest.current, sent, saved.rev)
      if (next) {
        setBaseRev(next.rev)
        setConflict(null)
      } else discard()
      toast('지시문을 저장했어요. 다음 순회부터 반영돼요')
    } catch (e) {
      if (e instanceof ConflictError) setConflict((e.body as { ops?: OpsSettings } | null)?.ops ?? ops)
      else toast(`저장하지 못했어요 · ${errorMessage(e)}`)
    } finally {
      setSaving(false)
    }
  }
  const open = (p: PromptPart, i: number) => loaded && setEditing({ index: i, title: p.level === 0 ? '머리글' : (p.title ?? ''), text: p.body })
  const commit = () => {
    if (!editing) return
    change(editing.index === null ? editing.text : replaceBody(value, editing.index, editing.text))
    setEditing(null)
  }

  // ## 제목만 있는 조각은 묶음 제목, 나머지는 영역 줄
  const groups: { title?: string; rows: { p: PromptPart; i: number }[] }[] = [{ rows: [] }]
  parts.forEach((p, i) => {
    if (p.level === 2 && !p.body.trim()) groups.push({ title: p.title ?? undefined, rows: [] })
    else groups[groups.length - 1]?.rows.push({ p, i })
  })
  return (
    <View style={s.wrap}>
      <View style={s.bar}>
        <Segmented label="지시문 보기" value={mode} onChange={setMode} options={[{ value: 'cards', label: '영역별' }, { value: 'raw', label: '원문' }]} />
        <Text accessibilityRole="text" style={[styles.small, s.flex, s.right]}>{dirty ? '저장 안 됨' : `저장됨 · ${ago(ops.updated_at)}`}</Text>
      </View>
      <View style={s.bar}>
        {dirty ? <Button variant="outline" title="되돌리기" onPress={discard} /> : null}
        <View style={s.flex}>
          <Button title={saving ? '저장 중' : '저장'} disabled={!dirty || saving} onPress={() => void save()} />
        </View>
      </View>
      {conflict ? (
        <View accessibilityRole="alert" style={s.notice}>
          <Text style={styles.text}>다른 곳에서 먼저 저장했어요{conflict.updated_at ? ` (${ago(conflict.updated_at)})` : ''}. 내 고침은 아직 이 화면에만 있어요.</Text>
          <Button variant="outline" title="내 고침으로 덮기" onPress={() => void save(conflict.rev)} />
          <Button variant="plain" title="서버 것 보기" onPress={discard} />
        </View>
      ) : null}
      {restored && dirty && !conflict ? (
        <View style={s.notice}>
          <Text style={styles.text}>저장하지 않은 고침을 이어서 보여줘요</Text>
          <Button variant="plain" title="버리기" onPress={discard} />
        </View>
      ) : null}
      {dirty && (!kept || !owner.email) ? <Text style={styles.meta}>고침을 기기에 보관하지 못했어요(계정을 확인하지 못했거나 쓰기 실패). 화면을 떠나거나 앱을 닫기 전에 저장해 주세요</Text> : null}
      {mode === 'raw' ? (
        <Section>
          <Row title="원문 전체" meta={`${value.split('\n').length}줄 · 눌러서 고쳐요`} onPress={() => loaded && setEditing({ index: null, title: '지시문 원문', text: value })} chevron />
        </Section>
      ) : (
        groups
          .filter((g) => g.rows.length || g.title)
          .map((g, gi) => (
            <Section key={gi} title={g.title}>
              {g.rows.map(({ p, i }) => {
                const title = p.level === 0 ? '머리글' : (p.title ?? '')
                const lines = p.level === 3 ? `확인할 곳 ${checkLines(p.body)}줄` : `${p.body.split('\n').filter((l) => l.trim()).length}줄`
                const preview = p.body.split('\n').find((l) => l.trim())?.replace(/^\s*[-*+]\s+/, '') ?? ''
                return <Row key={`${p.level}:${title}:${i}`} title={title} meta={[lines, preview].filter(Boolean).join(' · ')} onPress={() => open(p, i)} chevron />
              })}
            </Section>
          ))
      )}
      {defaultText ? <Button variant="plain" title="기본 지시문으로 바꾸기(저장 전까지 되돌릴 수 있어요)" onPress={() => change(toLF(defaultText))} /> : null}
      <Sheet visible={!!editing} title={editing?.title ?? ''} onClose={() => setEditing(null)} action={{ label: '완료', onPress: commit }}>
        <TextInput
          accessibilityLabel={`${editing?.title ?? ''} 지시문`}
          multiline
          autoCorrect={false}
          autoCapitalize="none"
          scrollEnabled={false}
          value={editing?.text ?? ''}
          onChangeText={(text) => setEditing((e) => (e ? { ...e, text } : e))}
          placeholderTextColor={c.muted}
          style={[styles.input, s.editor]}
        />
        <Text style={styles.meta}>완료를 누르면 화면의 지시문에 반영되고, 저장을 눌러야 서버에 저장돼요.</Text>
      </Sheet>
    </View>
  )
}
const s = StyleSheet.create({
  wrap: { gap: space.md },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  right: { textAlign: 'right' },
  notice: { backgroundColor: colors.fill, borderRadius: 12, padding: space.md, gap: space.sm },
  editor: { minHeight: 280, textAlignVertical: 'top', lineHeight: 22 },
})
