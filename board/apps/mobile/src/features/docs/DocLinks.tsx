// 문서 페이지 아래 절들(웹 오른쪽 패널·doc-links.tsx): 태그, 나가는 링크, 본문 [[링크]], 여기를 가리키는 글(역링크), 하위 문서.
// 절은 위 여백과 글자 무게로 나눠요(테두리·왼쪽 선 없음).
import React, { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import type { FetchResult, SearchHit, TagBy } from '@direction-board/contracts'
import { ApiError, errorMessage } from '../../api/client'
import { docsApi } from '../../api/docs'
import { useQuery } from '../../api/query'
import { useServer } from '../../server'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { Row } from '../../ui/Row'
import { Section } from '../../ui/Section'
import { space, styles } from '../../ui/theme'
import { docsChanged } from './events'
import { kindLabel, statusLabel } from './labels'
import { useWriteScope } from '../../api/scope'

type Open = (d: { ref: string; title: string; kind?: string }) => void

/** 태그: 직접 붙인 것(by person)만 뺄 수 있어요. 누르면 그 태그로 목록. 결과를 모르면 잠그고 다시 보내지 않아요 */
export function DocTags({ doc, onTag, alive }: { doc: FetchResult; onTag: (tag: string) => void; alive: () => boolean }) {
  const scope = useWriteScope()
  const initial = Array.isArray(doc.frontmatter.tags) ? (doc.frontmatter.tags as { tag: string; by: TagBy }[]).filter((t) => t && typeof t.tag === 'string') : []
  const [tag, setTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const change = async (c: { add?: string[]; remove?: string[] }) => {
    if (busy || uncertain) return
    if (!alive()) return setError('서버나 계정이 바뀌어 보내지 않았어요')
    setBusy(true)
    setError('')
    try {
      await docsApi.changeTags(scope, doc.ref, c)
      setTag('')
      docsChanged()
    } catch (e) {
      if (e instanceof ApiError && e.rejected) setError(`태그를 바꾸지 못했어요: ${e.message}`)
      else {
        setUncertain(true)
        setError('태그 변경 결과를 확인하지 못했어요. 중복 요청을 막기 위해 다시 보내지 않아요.')
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={s.section}>
      <Text accessibilityRole="header" style={styles.strong}>
        태그
      </Text>
      <View style={s.chips}>
        {initial.length ? (
          initial.map((t) => (
            <View key={t.tag} style={s.tag}>
              <Chip label={`#${t.tag}`} selected={t.by === 'person'} onPress={() => onTag(t.tag)} />
              {t.by === 'person' ? <Button variant="plain" title="×" disabled={busy || uncertain} onPress={() => void change({ remove: [t.tag] })} /> : null}
            </View>
          ))
        ) : (
          <Text style={styles.meta}>없음</Text>
        )}
      </View>
      <View style={s.addRow}>
        <TextInput accessibilityLabel="추가할 태그" placeholder="태그 추가" value={tag} onChangeText={setTag} autoCapitalize="none" returnKeyType="done" onSubmitEditing={() => tag.trim() && void change({ add: [tag.trim().replace(/^#/, '')] })} style={[styles.input, s.flex]} />
        <Button variant="outline" title="추가" disabled={!tag.trim() || busy || uncertain} onPress={() => void change({ add: [tag.trim().replace(/^#/, '')] })} />
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.meta}>{error}</Text> : null}
    </View>
  )
}

export function DocRelations({ doc, wikiTerms, onWiki, onOpen }: { doc: FetchResult; wikiTerms: string[]; onWiki: (term: string) => void; onOpen: Open }) {
  const { origin } = useServer()
  const out = useQuery(`docs/related/out/${doc.ref}/${doc.version}`, () => docsApi.related(origin, doc.ref, 'out'))
  const back = useQuery(`docs/related/in/${doc.ref}/${doc.version}`, () => docsApi.related(origin, doc.ref, 'in'))
  const edgeRows = (q: typeof out, empty: string) =>
    q.data === undefined ? (
      <Text style={styles.meta}>{q.status === 'error' ? `불러오지 못했어요 · ${errorMessage(q.error)}` : '불러오는 중이에요'}</Text>
    ) : q.data.edges.length ? (
      <Section>
        {q.data.edges.map((e, i) => (
          <Row key={`${e.node.ref}-${i}`} title={e.node.title || '제목 없음'} meta={[kindLabel(e.node.kind), statusLabel(e.node.status), e.label].filter(Boolean).join(' · ')} onPress={() => onOpen(e.node)} chevron />
        ))}
      </Section>
    ) : (
      <Text style={styles.meta}>{empty}</Text>
    )
  return (
    <>
      <View style={s.section}>
        <Text accessibilityRole="header" style={styles.strong}>나가는 링크</Text>
        {edgeRows(out, '없음')}
        {out.data?.truncated ? <Text style={styles.small}>일부만 표시</Text> : null}
      </View>
      <View style={s.section}>
        <Text accessibilityRole="header" style={styles.strong}>[[링크]]</Text>
        {wikiTerms.length ? (
          <View style={s.chips}>
            {wikiTerms.map((t) => (
              <Chip key={t} label={t} onPress={() => onWiki(t)} />
            ))}
          </View>
        ) : (
          <Text style={styles.meta}>없음</Text>
        )}
      </View>
      <View style={s.section}>
        <Text accessibilityRole="header" style={styles.strong}>여기를 가리키는 글</Text>
        {back.data?.truncated ? <Text style={styles.small}>최근 30개만 표시</Text> : null}
        {edgeRows(back, '없음')}
        {back.status === 'error' ? <Button variant="plain" title="다시 시도" onPress={() => void back.refresh()} /> : null}
      </View>
    </>
  )
}

/** 하위 문서(독립 문서만): 첫 50개와 "모두 보기"(DocFolder), + 하위 문서 */
export function DocChildren({ doc, onOpen, onCreate, onFolder }: { doc: FetchResult; onOpen: (d: SearchHit) => void; onCreate: () => void; onFolder: () => void }) {
  const { origin } = useServer()
  const kids = useQuery(`docs/children/${doc.ref}`, () => docsApi.children(origin, doc.ref))
  return (
    <View style={s.section}>
      <View style={s.headRow}>
        <Text accessibilityRole="header" style={[styles.strong, s.flex]}>하위 문서</Text>
        <Button variant="plain" title="+ 하위 문서" disabled={doc.frontmatter.status === 'archived'} onPress={onCreate} />
      </View>
      {kids.data === undefined ? (
        <Text style={styles.meta}>{kids.status === 'error' ? '불러오지 못했어요' : '불러오는 중이에요'}</Text>
      ) : kids.data.results.length ? (
        <>
          <Section>
            {kids.data.results.map((k) => (
              <Row key={k.ref} title={k.title || '제목 없음'} meta={(k.children ?? 0) > 0 ? `하위 ${k.children}개` : undefined} onPress={() => onOpen(k)} chevron />
            ))}
          </Section>
          {kids.data.nextCursor ? <Button variant="plain" title={`모두 보기 (${kids.data.total}개)`} onPress={onFolder} /> : null}
        </>
      ) : (
        <Text style={styles.meta}>없음</Text>
      )}
    </View>
  )
}
const s = StyleSheet.create({
  section: { gap: space.sm, marginTop: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center' },
  addRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
})
