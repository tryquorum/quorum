// 새 문서 시트(웹 doc-create.tsx 의 한 줄 + 상세 시트를 하나로). 제목만 쓰고 만들기(Return)를 누르면 바로 만들고 그 문서로 가요.
// "자세히"에서 본문·영역·태그·연결·부모·속성. 같은 제목이면 경고하고 한 번 더 누르면 만들어요. 결과를 모르면 같은 초안(같은 id)으로만 다시 보내요.
import React, { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import type { DocProp, PropType, SchemaResult } from '@direction-board/contracts'
import { SAME_TITLE_MIN } from '@direction-board/contracts'
import { docsApi } from '../../api/docs'
import { useScope } from '../../api/query'
import { useServer } from '../../server'
import { showActions } from '../../ui/actions'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { Sheet } from '../../ui/Sheet'
import { space, styles } from '../../ui/theme'
import { confirmKey, createDocSteps, emptyDraft, findSameDoc, gate, resumeOf, titleKey, type DocCreateDeps, type DocCreateResult, type DocDraft, type SameCheck } from './create'
import { docsChanged } from './events'
import { PROP_TYPES, TYPE_LABEL } from './props'
import { useWriteScope } from '../../api/scope'
import { useIntents } from '../board/useIntents'
import { withIntent } from '../board/intents'

export type CreateContext = { area?: string | null; links?: { ref: string; title: string }[]; linksOn?: boolean; parent?: { ref: string; title: string } }
type Pending = { draft: DocDraft; result: Exclude<DocCreateResult, { status: 'done' }>; generation: number }
// 실패한 제출은 시트를 닫았다 열어도 남아요(같은 초안·같은 id 로만 다시 보내요). 웹 barPending 과 같은 역할.
// 만든 서버·계정(캐시 세대)에 묶어서, 서버·계정이 바뀌면 다른 곳에서 같은 id 로 다시 보내지 않고 버려요
let pending: Pending | null = null
const pendingFor = (generation: number) => (pending && pending.generation === generation ? pending : null)

function useSameTitle(origin: string, title: string) {
  const [check, setCheck] = useState<SameCheck | null>(null)
  const ask = useCallback(
    (t: string): Promise<SameCheck> =>
      docsApi.search(origin, { sameTitle: t, kinds: ['doc'], includeAi: true, limit: 5 }).then(
        (r): SameCheck => ({ key: titleKey(t), state: 'ok', hits: r.results.map((h) => ({ ref: h.ref, title: h.title, status: h.status })) }),
        (): SameCheck => ({ key: titleKey(t), state: 'error' }),
      ),
    [origin],
  )
  useEffect(() => {
    const key = titleKey(title)
    if (key.length < SAME_TITLE_MIN) return setCheck(null)
    let live = true
    setCheck((c) => (c?.key === key ? c : { key, state: 'loading' }))
    const t = setTimeout(() => void ask(title).then((c) => live && setCheck(c)), 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [title, ask])
  // 만들기 직전에는 캐시 없이 다시 물어요(다른 기기에서 그 사이 만든 문서도 보게)
  const ensure = useCallback(async (t: string) => {
    const c = await ask(t)
    setCheck(c)
    return c
  }, [ask])
  return { check, ensure }
}

export function CreateSheet({ visible, context, schema, onClose, onCreated }: { visible: boolean; context: CreateContext; schema?: SchemaResult; onClose: () => void; onCreated: (ref: string, title: string) => void }) {
  const { origin } = useServer()
  const scope = useWriteScope()
  const intents = useIntents()
  const { generation, isCurrent } = useScope()
  const fresh = () => {
    const d = emptyDraft(() => Crypto.randomUUID(), { area: context.area ?? null, links: context.linksOn === false ? [] : (context.links ?? []).map((l) => l.ref), parent: context.parent?.ref ?? null })
    return d
  }
  const [draft, setDraft] = useState<DocDraft>(() => pendingFor(generation)?.draft ?? fresh())
  const [result, setResult] = useState<Pending['result'] | null>(pendingFor(generation)?.result ?? null)
  // 시트를 연 세대. 보내기 직전에 그대로인지 봐요
  const [openedAt, setOpenedAt] = useState(generation)
  const [detail, setDetail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState<string | null>(null)
  const [tag, setTag] = useState('')
  const { check, ensure } = useSameTitle(origin, draft.title)
  // 시트를 다시 열 때: 붙든 실패가 있으면 그 초안, 없으면 지금 맥락의 새 초안
  useEffect(() => {
    if (!visible) return
    const held = pendingFor(generation)
    if (!held) pending = null
    setOpenedAt(generation)
    setDraft(held?.draft ?? fresh())
    setResult(held?.result ?? null)
    setArmed(null)
    setDetail(!!held && (held.draft.md !== '' || held.draft.props.length > 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])
  const retry = result ? resumeOf(result) : null
  const locked = !!retry
  const set = (patch: Partial<DocDraft>) => {
    if (locked) return
    setDraft((d) => ({ ...d, ...patch }))
    if (result && !retry) {
      setResult(null)
      pending = null
    }
  }
  const deps: DocCreateDeps = {
    // 먼저 기록(규칙 B): 같은 id·같은 요청이면 서버가 처음 결과를 돌려줘서, 결과를 모르거나 앱이 꺼져도 홈에서 같은 id 로 다시 확인해요
    create: (input) => withIntent(intents.journal, { key: `doc:${input.id}`, kind: 'doc', scope: scope.scope, at: Date.now(), label: `문서 만들기: ${input.title.slice(0, 40)}`, payload: { input } }, () => docsApi.create(scope, input)),
    setProps: (ref, body) => docsApi.patchProps(scope, ref, body),
    readMeta: async (ref) => {
      const m = await docsApi.meta(origin, ref)
      return { version: m.version, props: Array.isArray(m.frontmatter.props) ? (m.frontmatter.props as DocProp[]) : [] }
    },
  }
  const submit = async () => {
    const title = draft.title.trim()
    if (!title || busy) return
    if (!isCurrent(openedAt)) {
      setResult({ status: 'failed', step: 'doc', retry: false, message: '서버나 계정이 바뀌어 보내지 않았어요. 시트를 닫고 다시 열어 주세요' })
      return
    }
    setBusy(true)
    try {
      if (!retry) {
        const verdict = gate(title, await ensure(title), armed)
        if (verdict !== 'go') {
          if (verdict !== 'wait') setArmed(confirmKey(verdict, title))
          return
        }
      }
      const r = await createDocSteps(draft, deps, retry ?? undefined)
      if (r.status === 'done') {
        pending = null
        setResult(null)
        docsChanged()
        onCreated(r.ref, title)
        return
      }
      pending = { draft, result: r, generation: openedAt }
      setResult(r)
      if (r.status === 'conflict' || r.step === 'props') docsChanged()
    } finally {
      setBusy(false)
    }
  }
  const same = check && check.key === titleKey(draft.title) && check.state !== 'loading' ? (check.state === 'ok' ? findSameDoc(check.hits, draft.title) : 'unknown') : null
  const failure = result
    ? result.status === 'conflict'
      ? '문서는 만들었고, 다른 곳에서 바뀌어 속성을 덮지 않았어요'
      : result.step === 'props'
        ? `문서는 만들었어요. 속성을 넣지 못했어요${result.retry ? '' : `: ${result.message}`}`
        : result.retry
          ? '만든 결과를 확인하지 못했어요. 다시 시도해도 같은 문서가 두 번 생기지 않아요'
          : `만들지 못했어요: ${result.message}`
    : ''
  const createdRef = result && (result.status === 'conflict' || result.step === 'props') ? result.ref : null
  const links = context.links ?? []
  const areas = schema?.areas ?? []
  return (
    <Sheet visible={visible} title={context.parent ? '하위 문서 만들기' : '새 문서'} onClose={onClose} action={{ label: retry ? '다시 시도' : busy ? '만드는 중' : '만들기', onPress: () => void submit(), disabled: busy || !draft.title.trim() }}>
      <TextInput
        accessibilityLabel="새 문서 제목"
        placeholder="제목"
        autoFocus
        value={draft.title}
        editable={!locked}
        onChangeText={(title) => set({ title })}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        style={[styles.input, s.title]}
      />
      {same ? (
        <View accessibilityRole="alert" style={s.notice}>
          <Text style={styles.meta}>{same === 'unknown' ? '같은 제목인지 확인하지 못했어요' : '같은 제목의 문서가 있어요'}{armed === confirmKey(same === 'unknown' ? 'unknown' : 'same', draft.title) ? ' · 한 번 더 누르면 만들어요' : ''}</Text>
          {same !== 'unknown' ? <Button variant="plain" title="그 문서 열기" onPress={() => onCreated(same.ref, same.title)} /> : null}
        </View>
      ) : null}
      {failure ? (
        <View accessibilityRole="alert" style={s.notice}>
          <Text style={styles.meta}>{failure}</Text>
          {createdRef ? <Button variant="outline" title="만든 문서 열기" onPress={() => { pending = null; onCreated(createdRef, draft.title.trim()) }} /> : null}
        </View>
      ) : null}
      <View style={s.chips}>
        {context.parent ? <Chip label={`${context.parent.title} 아래${draft.parent ? '' : ' (맨 위에 만듦)'}`} selected={!!draft.parent} onPress={() => set({ parent: draft.parent ? null : context.parent?.ref })} /> : null}
        {links.map((l) => (
          <Chip key={l.ref} label={`연결: ${l.title}`} selected={draft.links.includes(l.ref)} onPress={() => set({ links: draft.links.includes(l.ref) ? draft.links.filter((x) => x !== l.ref) : [...draft.links, l.ref] })} />
        ))}
        <Chip label={draft.area ? `영역: ${draft.area}` : '영역 없음'} selected={!!draft.area} onPress={() => showActions([{ label: '없음', onPress: () => set({ area: null }) }, ...areas.map((a) => ({ label: a, onPress: () => set({ area: a }) }))], '영역')} />
      </View>
      {!detail ? <Button variant="plain" title="자세히" onPress={() => setDetail(true)} /> : null}
      {detail ? (
        <View style={s.group}>
          <TextInput accessibilityLabel="본문" placeholder="본문(마크다운)" multiline value={draft.md} editable={!locked} onChangeText={(md) => set({ md })} style={[styles.input, s.body]} />
          <View style={s.chips}>
            {draft.tags.map((t) => (
              <Chip key={t} label={`#${t} ×`} onPress={() => set({ tags: draft.tags.filter((x) => x !== t) })} />
            ))}
          </View>
          <TextInput
            accessibilityLabel="태그 추가"
            placeholder="태그 쓰고 Return"
            value={tag}
            editable={!locked}
            autoCapitalize="none"
            onChangeText={setTag}
            returnKeyType="done"
            blurOnSubmit={false}
            onSubmitEditing={() => {
              const t = tag.trim().replace(/^#/, '')
              if (t && !draft.tags.includes(t)) set({ tags: [...draft.tags, t] })
              setTag('')
            }}
            style={styles.input}
          />
          <Text accessibilityRole="header" style={styles.strong}>
            속성
          </Text>
          {draft.props.map((p, i) => (
            <View key={i} style={s.propRow}>
              <TextInput accessibilityLabel={`속성 ${i + 1} 이름`} placeholder="이름" value={p.key} editable={!locked} onChangeText={(key) => set({ props: draft.props.map((x, j) => (j === i ? { ...x, key } : x)) })} style={[styles.input, s.flex]} />
              <Button
                variant="outline"
                title={TYPE_LABEL[p.type]}
                onPress={() => showActions(PROP_TYPES.map((t: PropType) => ({ label: TYPE_LABEL[t], onPress: () => set({ props: draft.props.map((x, j) => (j === i ? { ...x, type: t } : x)) }) })), '속성 타입')}
              />
              <TextInput accessibilityLabel={`속성 ${i + 1} 값`} placeholder={p.type === 'list' ? '쉼표로 나눠요' : '값'} value={p.value} editable={!locked} onChangeText={(value) => set({ props: draft.props.map((x, j) => (j === i ? { ...x, value } : x)) })} style={[styles.input, s.flex]} />
            </View>
          ))}
          <Button variant="outline" title="+ 속성" onPress={() => set({ props: [...draft.props, { key: '', type: 'text', value: '' }] })} />
        </View>
      ) : null}
    </Sheet>
  )
}
const s = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '600' },
  notice: { gap: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  group: { gap: space.md },
  body: { minHeight: 140, textAlignVertical: 'top' },
  propRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  flex: { flex: 1 },
})
