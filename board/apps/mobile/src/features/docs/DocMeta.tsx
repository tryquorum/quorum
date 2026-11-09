// 문서 페이지의 제목·속성(웹 document-metadata.tsx). 제목은 Return·포커스 이동에 바로 저장, 요약 줄을 눌러 속성 절을 펼쳐요.
// 영역·상태는 고르면 바로, 날짜·사용자 속성은 저장을 눌러 저장해요. 모든 쓰기는 문서 쓰기 줄(WriteQueue)로 노트 저장과 같은 version 을 이어 가요.
// 409·결과 불명이면 입력을 지키고 막아요(사람이 최신 값으로 전환해야 풀려요). 저장 중·막힘인 입력은 기기에 보관했다가 다시 열 때 막힌 채 돌려줘요.
import React, { useEffect, useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View, useColorScheme } from 'react-native'
import { SymbolView } from 'expo-symbols'
import type { DocProp, FetchResult, PropType, PropValue, SchemaResult } from '@direction-board/contracts'
import { ApiError, ConflictError } from '../../api/client'
import { ScopeChangedError } from '../../api/queryStore'
import { docsApi } from '../../api/docs'
import { useServer } from '../../server'
import type { DraftKey } from '../../notes/drafts'
import { NoteNotice } from '../../notes/NoteNotice'
import { showActions } from '../../ui/actions'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { colors, schemeColors, space, styles } from '../../ui/theme'
import { docsChanged } from './events'
import { kindLabel, statusLabel } from './labels'
import { fieldRules, metaAtRisk, metaSummary, restoreMeta, riskText, type MetaGuard, type MetaInputs } from './metaDraft'
import { keepMeta, readMeta } from './metaStore'
import { dayOffset, displayValue, dueIssue, initialValue, newKeyIssue, parseValue, PROP_TYPES, TYPE_LABEL, valueText } from './props'
import type { WriteQueue } from './writeQueue'
import { useWriteScope } from '../../api/scope'

const MSG = {
  conflict: '다른 곳에서 변경됐어요. 입력한 값은 보존되며 자동으로 덮어쓰지 않아요.',
  rejected: (m: string) => `서버가 입력값을 거부했어요: ${m}`,
  unknown: '저장 결과를 확인하지 못했어요. 입력한 값을 복사하고 서버 상태를 확인해 주세요.',
}
const baseOf = (doc: FetchResult) => ({ title: doc.title, area: String(doc.frontmatter.area ?? ''), status: String(doc.frontmatter.status ?? 'open'), due: String(doc.frontmatter.due ?? '') })
const propsOf = (doc: FetchResult) => (Array.isArray(doc.frontmatter.props) ? (doc.frontmatter.props as DocProp[]) : [])
const fmtTime = (v: unknown) => (typeof v === 'number' ? new Date(v).toLocaleString('ko-KR') : '알 수 없음')

export function DocMeta({ doc, queue, knownVersion, schema, draftKey, onDraft, alive }: { doc: FetchResult; queue: WriteQueue; knownVersion: { from: number; to: number } | null; schema?: SchemaResult; draftKey: DraftKey; onDraft: (d: { dirty: boolean; kept: boolean }) => void; alive: () => boolean }) {
  const { origin } = useServer()
  const scope = useWriteScope()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const base = baseOf(doc)
  const props = propsOf(doc)
  const rules = fieldRules(doc.kind, base.status)
  const [inputs, setInputs] = useState<MetaInputs>({ ...base, propDrafts: {}, newKey: '' })
  const [version, setVersion] = useState(doc.version)
  const [guard, setGuard] = useState<MetaGuard>({ busy: false, blocked: false, conflict: false, error: '', storageError: false })
  const [conflictInfo, setConflictInfo] = useState<{ version?: number; md?: string; truncated?: boolean } | null>(null)
  const [folded, setFolded] = useState(true)
  const [titleFocused, setTitleFocused] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const restored = useRef(false)
  // 기기 보관은 순서대로, 마지막 입력의 보관이 끝나 성공했을 때만 kept
  const keepChain = useRef<Promise<void>>(Promise.resolve())
  const keepSeq = useRef(0)
  const [kept, setKept] = useState(true)
  const set = (patch: Partial<MetaInputs>) => setInputs((old) => ({ ...old, ...patch }))
  const setG = (patch: Partial<MetaGuard>) => setGuard((old) => ({ ...old, ...patch }))
  // 보관한 입력이 있으면 그 version 기준으로 돌려줘요(그 사이 바뀌었으면 저장이 409 로 막혀요)
  useEffect(() => {
    let live = true
    void readMeta(draftKey).then((saved) => {
      const r = restoreMeta(saved)
      restored.current = true
      if (!live || !r) return
      setInputs(r.inputs)
      setVersion(r.version)
      setG(r.guard)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey.origin, draftKey.email, draftKey.ref])
  const clean = !guard.busy && !guard.blocked && inputs.title === base.title && inputs.area === base.area && inputs.status === base.status && inputs.due === base.due && !Object.keys(inputs.propDrafts).length && !inputs.newKey
  // 남은 입력이 없을 때만 새 서버 값을 그대로 받아요
  useEffect(() => {
    if (clean) {
      setVersion(doc.version)
      setInputs({ ...baseOf(doc), propDrafts: {}, newKey: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.version, doc.title])
  useEffect(() => {
    if (knownVersion) setVersion((v) => (v === knownVersion.from ? knownVersion.to : v))
  }, [knownVersion])
  const risk = metaAtRisk(inputs, base, guard, titleFocused)
  useEffect(() => {
    onDraft({ dirty: risk, kept })
    if (risk) setFolded(false)
  }, [risk, kept, onDraft])
  useEffect(() => {
    if (!restored.current) return
    const keep = !clean ? { version, inputs, blocked: guard.blocked || guard.busy, conflict: guard.conflict } : null
    const id = ++keepSeq.current
    setKept(!keep)
    keepChain.current = keepChain.current
      .then(() => keepMeta(draftKey, keep))
      .then((ok) => {
        if (id !== keepSeq.current) return
        setKept(!keep || ok)
        setG({ storageError: !!keep && !ok })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clean, version, inputs, guard.blocked, guard.busy, guard.conflict])
  const send = async (fn: (v: number) => Promise<{ version: number }>, done: () => void) => {
    if (guard.busy || guard.blocked) return
    if (!alive()) return setG({ error: '서버나 계정이 바뀌어 저장하지 않았어요' })
    setG({ busy: true, error: '' })
    try {
      const r = await queue.run(version, fn)
      setVersion(r.version)
      done()
      docsChanged()
    } catch (e) {
      if (e instanceof ConflictError) {
        setConflictInfo(((e.body as { current?: typeof conflictInfo } | null)?.current ?? {}) as never)
        setG({ conflict: true, blocked: true, error: MSG.conflict })
      } else if (e instanceof ApiError && e.rejected && !e.loginRequired) setG({ error: MSG.rejected(e.message) })
      else if (e instanceof ScopeChangedError) setG({ error: e.message })
      else setG({ blocked: true, error: MSG.unknown })
    } finally {
      setG({ busy: false })
    }
  }
  const saveTitle = () => {
    const next = inputs.title.replace(/\r?\n/g, ' ').trim()
    if (!next || Array.from(next).length > 200) return set({ title: base.title })
    if (next === base.title) return
    void send((v) => docsApi.patchMeta(scope, doc.ref, { title: next, expectedVersion: v }), () => set({ title: next }))
  }
  const saveBasic = (patch: { area?: string | null; status?: 'open' | 'done'; due?: string | null }) => void send((v) => docsApi.patchMeta(scope, doc.ref, { ...patch, expectedVersion: v }), () => undefined)
  const saveProp = (p: DocProp) => {
    const sent = inputs.propDrafts[p.key]
    let value: PropValue
    try {
      value = parseValue(p.type, sent ?? valueText(p.value))
    } catch (e) {
      return setG({ error: (e as Error).message })
    }
    void send((v) => docsApi.patchProps(scope, doc.ref, { set: { [p.key]: value }, types: { [p.key]: p.type }, expectedVersion: v }), () => {
      setInputs((old) => {
        if (old.propDrafts[p.key] !== sent) return old
        const d = { ...old.propDrafts }
        delete d[p.key]
        return { ...old, propDrafts: d }
      })
      setEditing(null)
    })
  }
  const removeProp = (p: DocProp) =>
    Alert.alert('속성 삭제', `${p.key} (${TYPE_LABEL[p.type]}) 속성을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => void send((v) => docsApi.patchProps(scope, doc.ref, { remove: [p.key], expectedVersion: v }), () => undefined) },
    ])
  const addProp = () =>
    Alert.prompt('새 속성 이름', undefined, (name?: string) => {
      const key = (name ?? '').normalize('NFC').trim()
      if (!key) return
      showActions(
        PROP_TYPES.map((type: PropType) => ({
          label: TYPE_LABEL[type],
          onPress: () => {
            const issue = newKeyIssue(key, props, schema?.props?.find((x) => x.key === key)?.type, type)
            if (issue) return setG({ error: issue })
            void send((v) => docsApi.patchProps(scope, doc.ref, { set: { [key]: initialValue(type) }, types: { [key]: type }, expectedVersion: v }), () => setEditing(key))
          },
        })),
        `${key} 타입`,
      )
    })
  const adoptLatest = () =>
    Alert.alert('최신 속성으로 전환', '입력값을 복사했나요? 지금 속성 입력을 버리고 서버의 최신 값을 불러와요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '전환',
        style: 'destructive',
        onPress: () =>
          void docsApi.meta(origin, doc.ref).then(
            (latest) => {
              queue.reset()
              setVersion(latest.version)
              setInputs({ ...baseOf(latest), propDrafts: {}, newKey: '' })
              setConflictInfo(null)
              setGuard({ busy: false, blocked: false, conflict: false, error: '', storageError: false })
              docsChanged()
            },
            () => setG({ error: '최신 속성을 불러오지 못했어요. 기존 입력값을 보존했어요.' }),
          ),
      },
    ])
  const locked = guard.busy || guard.blocked
  const open = !folded || risk
  return (
    <View style={s.wrap}>
      <TextInput
        accessibilityLabel="문서 제목"
        multiline
        blurOnSubmit
        returnKeyType="done"
        editable={rules.title && !locked}
        value={inputs.title}
        onChangeText={(t) => set({ title: t.replace(/\r?\n/g, ' ') })}
        onFocus={() => setTitleFocused(true)}
        onBlur={() => {
          setTitleFocused(false)
          if (rules.title) saveTitle()
        }}
        style={s.title}
      />
      {!rules.title && rules.titleHint ? <Text style={styles.small}>{rules.titleHint}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: risk }}
        accessibilityHint={risk ? riskText(guard) : '속성 절을 펼치거나 접어요'}
        onPress={() => !risk && setFolded((f) => !f)}
        style={s.summary}
      >
        <Text style={[styles.meta, s.flex]} numberOfLines={1}>
          {metaSummary({ area: base.area, status: base.status, due: base.due, props })}
          {risk ? <Text style={styles.text}> · {riskText(guard)}</Text> : null}
        </Text>
        <SymbolView name={open ? 'chevron.down' : 'chevron.right'} size={13} tintColor={c.muted} />
      </Pressable>
      {guard.error ? (
        <NoteNotice message={guard.error}>
          {conflictInfo ? <Text style={styles.small} numberOfLines={4}>서버 버전 {conflictInfo.version ?? '확인 불가'}{conflictInfo.truncated ? ' · 일부만 표시' : ''}</Text> : null}
          {guard.blocked ? <Text style={styles.small} selectable>{JSON.stringify({ title: inputs.title, area: inputs.area, status: inputs.status, due: inputs.due, props: inputs.propDrafts })}</Text> : null}
          {guard.blocked ? <Button variant="outline" title="복사 후 최신 속성으로 전환" onPress={adoptLatest} /> : <Button variant="plain" title="닫기" onPress={() => setG({ error: '' })} />}
        </NoteNotice>
      ) : null}
      {guard.storageError ? <Text accessibilityRole="alert" style={styles.small}>속성 입력을 기기에 보관하지 못했어요. 나가기 전에 복사해 주세요</Text> : null}
      {open ? (
        <View style={styles.group}>
          <Field label="영역">
            {rules.area ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`영역 ${base.area || '없음'}, 바꾸기`} disabled={locked} onPress={() => showActions([{ label: '없음', onPress: () => saveBasic({ area: null }) }, ...(schema?.areas ?? []).map((a) => ({ label: a, onPress: () => saveBasic({ area: a }) }))], '영역')}>
                <Text style={styles.text}>{base.area || '없음'}</Text>
              </Pressable>
            ) : (
              <Text style={styles.meta}>{base.area || '—'}</Text>
            )}
          </Field>
          <Field label="상태">
            {rules.status ? (
              <View style={s.chips}>
                {(['open', 'done'] as const).map((st) => (
                  <Chip key={st} label={statusLabel(st)} selected={base.status === st} onPress={locked || base.status === st ? undefined : () => saveBasic({ status: st })} />
                ))}
              </View>
            ) : (
              <Text style={styles.meta}>{statusLabel(base.status)}</Text>
            )}
          </Field>
          <Field label="날짜">
            {rules.due ? (
              <View style={s.flex}>
                <TextInput
                  accessibilityLabel="문서 날짜"
                  placeholder={rules.dueWithTime ? '2026-11-07T09:30' : '2026-11-07'}
                  autoCapitalize="none"
                  editable={!locked}
                  value={inputs.due}
                  onChangeText={(due) => set({ due })}
                  onSubmitEditing={() => !dueIssue(inputs.due, rules.dueWithTime) && inputs.due !== base.due && saveBasic({ due: inputs.due || null })}
                  style={[styles.input, s.input]}
                />
                <View style={s.chips}>
                  <Chip label="오늘" onPress={() => set({ due: dayOffset(0) })} />
                  <Chip label="내일" onPress={() => set({ due: dayOffset(1) })} />
                  <Chip label="지우기" onPress={() => set({ due: '' })} />
                  {inputs.due !== base.due ? <Chip label="저장" selected onPress={dueIssue(inputs.due, rules.dueWithTime) || locked ? undefined : () => saveBasic({ due: inputs.due || null })} /> : null}
                </View>
                {dueIssue(inputs.due, rules.dueWithTime) ? <Text style={styles.small}>{dueIssue(inputs.due, rules.dueWithTime)}</Text> : null}
              </View>
            ) : (
              <Text style={styles.meta}>{base.due ? base.due.replace('T', ' ') : '—'}</Text>
            )}
          </Field>
          <Field label="종류"><Text style={styles.meta}>{kindLabel(doc.kind)}</Text></Field>
          <Field label="만든 시각"><Text style={styles.meta}>{fmtTime(doc.frontmatter.created)}</Text></Field>
          <Field label="고친 시각"><Text style={styles.meta}>{fmtTime(doc.frontmatter.updated)}</Text></Field>
          {props.map((p) => (
            <PropRow
              key={p.key}
              prop={p}
              value={inputs.propDrafts[p.key] ?? valueText(p.value)}
              options={schema?.props?.find((x) => x.key === p.key)?.options ?? []}
              editing={editing === p.key}
              disabled={locked}
              onEdit={() => setEditing(p.key)}
              onCancel={() => {
                setEditing(null)
                setInputs((old) => {
                  const d = { ...old.propDrafts }
                  delete d[p.key]
                  return { ...old, propDrafts: d }
                })
              }}
              onChange={(v) => setInputs((old) => ({ ...old, propDrafts: { ...old.propDrafts, [p.key]: v } }))}
              onSave={() => saveProp(p)}
              onRemove={() => removeProp(p)}
            />
          ))}
          <Button variant="plain" title="+ 속성 추가" disabled={locked} onPress={addProp} />
        </View>
      ) : null}
    </View>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={[styles.meta, s.label]}>{label}</Text>
      <View style={s.flex}>{children}</View>
    </View>
  )
}

function PropRow({ prop, value, options, editing, disabled, onEdit, onCancel, onChange, onSave, onRemove }: { prop: DocProp; value: string; options: string[]; editing: boolean; disabled: boolean; onEdit: () => void; onCancel: () => void; onChange: (v: string) => void; onSave: () => void; onRemove: () => void }) {
  if (!editing)
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${prop.key}: ${displayValue(prop) || '비어 있음'}`} accessibilityHint="눌러 고치고, 길게 눌러 삭제" accessibilityActions={[{ name: 'remove', label: '속성 삭제' }]} onAccessibilityAction={onRemove} disabled={disabled} onPress={onEdit} onLongPress={onRemove} style={s.field}>
        <Text style={[styles.meta, s.label]} numberOfLines={1}>{prop.key}</Text>
        <Text style={[displayValue(prop) ? styles.text : styles.meta, s.flex]}>{displayValue(prop) || '비어 있음'}</Text>
      </Pressable>
    )
  const input =
    prop.type === 'checkbox' ? (
      <View style={s.chips}>
        <Switch accessibilityLabel={`${prop.key} 값`} value={value === 'true'} onValueChange={(v) => onChange(String(v))} />
        <Chip label="값 비우기" onPress={() => onChange('')} />
      </View>
    ) : prop.type === 'select' ? (
      <View style={s.chips}>
        <Chip label={value || '비어 있음'} selected onPress={() => showActions([{ label: '비어 있음', onPress: () => onChange('') }, ...options.map((o) => ({ label: o, onPress: () => onChange(o) })), { label: '새 선택값 입력', onPress: () => Alert.prompt('새 선택값', undefined, (v?: string) => onChange((v ?? '').trim())) }], prop.key)} />
      </View>
    ) : (
      <TextInput
        accessibilityLabel={`${prop.key} 값`}
        autoFocus
        multiline={prop.type === 'list'}
        placeholder={prop.type === 'list' ? '한 줄에 하나씩' : prop.type === 'date' ? '2026-11-07' : prop.type === 'datetime' ? '2026-11-07T09:30' : '값'}
        keyboardType={prop.type === 'number' ? 'numbers-and-punctuation' : prop.type === 'url' ? 'url' : 'default'}
        autoCapitalize="none"
        value={value}
        onChangeText={onChange}
        style={[styles.input, s.input]}
      />
    )
  return (
    <View style={s.editing}>
      <Text style={styles.strong}>{prop.key} <Text style={styles.small}>{TYPE_LABEL[prop.type]}</Text></Text>
      {input}
      {prop.type === 'list' && options.length ? <Text style={styles.small}>기존 값: {options.join(', ')}</Text> : null}
      <View style={s.chips}>
        <Button title="저장" disabled={disabled} onPress={onSave} />
        <Button variant="outline" title="취소" onPress={onCancel} />
        <Button variant="plain" title="삭제" disabled={disabled} onPress={onRemove} />
      </View>
    </View>
  )
}
const s = StyleSheet.create({
  wrap: { gap: space.sm },
  title: { color: colors.ink, fontSize: 26, lineHeight: 32, fontWeight: '700', paddingVertical: space.xs },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: space.target },
  flex: { flex: 1 },
  field: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: space.target, paddingHorizontal: space.gutter, paddingVertical: space.xs },
  label: { width: 84 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  input: { marginVertical: space.xs },
  editing: { gap: space.sm, padding: space.gutter },
})
