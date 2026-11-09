// 문서 페이지(공용 상세 Doc, 웹 document-page.tsx). 위에서 아래로: 브레드크럼 → 제목·속성(DocMeta) → 본문(읽기 NoteView / 편집 NoteEditor) → 태그·링크·역링크·하위 문서.
// 본문은 노트 원문(GET /note 의 md)이고, 서버가 iOS 편집을 허락한 노트(markdownEditable)만 고칠 수 있어요. 모든 버전 쓰기는 한 쓰기 줄(WriteQueue)로.
// 설계: devlog/_plan/261107_ios_parity/docs/030_doc_page.md
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View, useColorScheme } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { SymbolView } from 'expo-symbols'
import * as WebBrowser from 'expo-web-browser'
import type { SearchHit } from '@direction-board/contracts'
import { crumbs } from '@direction-board/contracts/doc-tree'
import { wikiLinks } from '@direction-board/contracts/wiki-links'
import { api, ApiError } from '../../api/client'
import { docsApi } from '../../api/docs'
import { useQuery, useScope } from '../../api/query'
import { docLink } from '../../navigation/linking'
import type { StackParams } from '../../navigation/routes'
import { notesApi, noteEditability, noteOps } from '../../notes/api'
import { toggleTask } from '../../notes/markdown'
import { exportDraft, NoteEditor, useNoteDraft, useNoteLeaveGuard } from '../../notes/NoteEditor'
import { NoteNotice } from '../../notes/NoteNotice'
import { NoteView } from '../../notes/NoteView'
import { externalLink, wikiTarget } from '../../notes/wiki'
import { useServer } from '../../server'
import { showActions, type Action } from '../../ui/actions'
import { Button } from '../../ui/Button'
import { Screen } from '../../ui/Screen'
import { Sheet } from '../../ui/Sheet'
import { Empty, Loaded } from '../../ui/StateView'
import { useToast } from '../../ui/Toast'
import { schemeColors, space, styles } from '../../ui/theme'
import { DocChildren, DocRelations, DocTags } from './DocLinks'
import { DocMeta } from './DocMeta'
import { onDocsChanged } from './events'
import { kindLabel, statusLabel } from './labels'
import { splitSections } from './outline'
import { pickAndUpload } from './pickImage'
import { useDocSheets } from './sheets'
import { useFavorites } from './store'
import { resolveWiki, wikiMessage } from './wikiNav'
import { WriteQueue } from './writeQueue'
import { useWriteScope } from '../../api/scope'

type Props = NativeStackScreenProps<StackParams, 'Doc'>
/** 다른 탭에서 연 문서에서도 문서 탭 목록으로(태그 필터 등) 가요 */
export function goDocsRoot(navigation: { getParent: () => unknown }, params?: { tag?: string }) {
  const parent = navigation.getParent() as { navigate: (name: string, p: unknown) => void } | undefined
  parent?.navigate('DocsTab', { screen: 'Docs', params })
}

export function Doc({ route, navigation }: Props) {
  const { ref } = route.params
  const { origin } = useServer()
  const scope = useWriteScope()
  const { generation, isCurrent } = useScope()
  const toast = useToast()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const fav = useFavorites()
  const sheets = useDocSheets()
  const doc = useQuery(`docs/doc/${ref}`, () => api.doc(origin, ref))
  const source = useQuery(`docs/note/${ref}`, () => notesApi.source(origin, ref))
  const settings = useQuery('settings', () => api.settings(origin))
  // 처음 연 서버·계정을 붙들어요. 그 뒤 바뀌면 저장을 멈추고 사람이 고르게 해요(초안은 그 서버·계정 열쇠로 남아요)
  const [mount] = useState(() => ({ origin, generation }))
  const stopped = generation !== mount.generation || origin !== mount.origin
  const stoppedRef = useRef(stopped)
  stoppedRef.current = stopped
  const email = settings.data?.me.email ?? null
  const [known, setKnown] = useState<{ from: number; to: number } | null>(null)
  const saverRef = useRef<{ acceptExternalVersion: (a: number, b: number) => void } | null>(null)
  // 화면을 연 서버·계정이 그대로일 때만 보내요(줄에 서 있던 쓰기도 보내기 직전에 다시 봐요)
  const alive = useCallback(() => isCurrent(mount.generation), [isCurrent, mount.generation])
  const [queue] = useState(
    () =>
      new WriteQueue(
        (from, to) => {
          setKnown({ from, to })
          saverRef.current?.acceptExternalVersion(from, to)
        },
        () => alive(),
      ),
  )
  const write = useCallback(
    (md: string, version: number) => {
      if (stoppedRef.current) return Promise.reject(new Error('서버나 계정이 바뀌어 저장하지 않았어요'))
      return queue.run(version, (v) => noteOps(scope).replace(ref, md, v))
    },
    [mount.origin, ref, queue],
  )
  // 초안 열쇠는 처음 확인한 계정으로 화면이 닫힐 때까지 그대로 둬요(전환 뒤에도 초안·저장 상태를 잃지 않게)
  const [fixedEmail, setFixedEmail] = useState<string | null>(null)
  useEffect(() => {
    if (email && !fixedEmail && !stopped) setFixedEmail(email)
  }, [email, fixedEmail, stopped])
  const draftKey = useMemo(() => ({ origin: mount.origin, email: fixedEmail, ref }), [mount.origin, fixedEmail, ref])
  // 계정을 확인한 뒤에(또는 확인에 실패한 뒤에) 저장 상태를 만들어요. 계정을 모르면 기기 보관 없이 편집해요.
  // 서버·계정이 바뀐 뒤 읽은 노트는 넘기지 않아요(새 계정의 응답이 옛 열쇠의 초안·저장 상태를 덮지 않게)
  const note = useNoteDraft({ source: !stopped && (fixedEmail || settings.status === 'error') ? source.data : undefined, draftKey, write })
  saverRef.current = note.saver
  const [editing, setEditing] = useState(false)
  const [metaDraft, setMetaDraft] = useState({ dirty: false, kept: true })
  const [choices, setChoices] = useState<{ hits: SearchHit[]; message: string } | null>(null)
  const [wikiNote, setWikiNote] = useState('')
  const wikiSeq = useRef(0)
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null)
  const offsets = useRef<Record<number, number>>({})
  const bodyY = useRef(0)
  useNoteLeaveGuard(note.saver, note.state, note.storageOk, { ...metaDraft, label: '속성 입력' })
  // 전환되면 편집기를 닫고 멈춤 안내(초안 내보내기)를 보여요. 저장 상태와 초안은 그대로 남아요
  useEffect(() => {
    if (stopped) setEditing(false)
  }, [stopped])
  useEffect(() => () => void wikiSeq.current++, [])
  const refreshDoc = doc.refresh
  useEffect(() => onDocsChanged(() => void refreshDoc()), [refreshDoc])
  const missing = doc.status === 'error' && doc.error instanceof ApiError && doc.error.status === 404
  const data = doc.data
  const standalone = ref.startsWith('doc:')
  const title = data?.title ?? route.params.title ?? '문서'
  const area = typeof data?.frontmatter.area === 'string' ? data.frontmatter.area : null
  const parent = typeof data?.frontmatter.parent === 'string' ? data.frontmatter.parent : null
  const editable = !!note.state?.editable && !stopped
  // 고칠 수 없는 노트는 서버 원문을 보여요(보관한 내 초안은 따로 내보내기·지우기)
  const draft = editable ? (note.state?.draft ?? source.data?.md ?? '') : (source.data?.md ?? '')
  const heldDraft = !editable && note.state && source.data && note.state.draft !== source.data.md ? note.state.draft : null
  const sections = useMemo(() => splitSections(draft), [draft])
  const headings = sections.filter((x) => x.heading)
  const openDoc = useCallback(
    (d: { ref: string; title: string }) => {
      if (wikiTarget(d.ref)?.route === 'Work') navigation.push('Work', { ref: d.ref, title: d.title })
      else navigation.push('Doc', { ref: d.ref, title: d.title })
    },
    [navigation],
  )
  const onWiki = async (term: string) => {
    const id = ++wikiSeq.current
    setWikiNote('')
    try {
      const r = await resolveWiki(term, (f) => docsApi.search(origin, f))
      if (id !== wikiSeq.current) return
      if (r.type === 'open') openDoc(r)
      else if (r.type === 'choose') setChoices({ hits: r.hits, message: wikiMessage(r) })
      else setWikiNote(wikiMessage(r))
    } catch {
      if (id === wikiSeq.current) setWikiNote('링크 검색에 실패했어요.')
    }
  }
  const childCtx = { parent: { ref, title }, area, links: [{ ref, title }], linksOn: false }
  const menu: Action[] = [
    standalone ? { label: '하위 문서 만들기', onPress: () => sheets.openCreate(childCtx) } : { label: '새 문서 (이 문서와 연결)', onPress: () => sheets.openCreate({ area, links: [{ ref, title }] }) },
    ...(standalone && data?.frontmatter.status !== 'archived' ? [{ label: '이동…', onPress: () => sheets.openMove({ ref, title, parent }) }] : []),
    ...(standalone && parent
      ? [{ label: '맨 위로', onPress: () => void docsApi.move(scope, { ref, parent: null }).then(() => toast('맨 위로 옮겼어요'), (e: unknown) => toast(e instanceof ApiError ? e.message : '옮긴 결과를 확인하지 못했어요')).finally(() => void refreshDoc()) }]
      : []),
    { label: '링크 공유', onPress: () => void Share.share({ message: docLink(ref) }) },
    { label: '새로 읽기', onPress: () => void Promise.all([doc.refresh(), source.refresh()]) },
  ]
  // 머리 단추는 최신 메뉴·개요를 ref 로 읽고, 보이는 값이 바뀔 때만 옵션을 다시 넣어요
  const latest = useRef({ menu, headings, title })
  latest.current = { menu, headings, title }
  const headingKey = headings.map((h) => h.start + ':' + (h.heading?.title ?? '')).join('|')
  const favored = fav.isFavorite(ref)
  const toggleFav = fav.toggle
  const scrollTo = (start: number) => scroll.current?.scrollTo({ y: Math.max(0, bodyY.current + (offsets.current[start] ?? 0) - 12), animated: true })
  useLayoutEffect(() => {
    navigation.setOptions({
      title: data ? kindLabel(data.kind) : '문서',
      headerRight: () => (
        <View style={s.head}>
          <Pressable accessibilityRole="button" accessibilityLabel={favored ? '즐겨찾기 빼기' : '즐겨찾기'} hitSlop={8} onPress={() => toggleFav(ref)}>
            <SymbolView name={favored ? 'star.fill' : 'star'} size={22} tintColor={c.ink} />
          </Pressable>
          {headingKey ? (
            <Pressable accessibilityRole="button" accessibilityLabel="개요" hitSlop={8} onPress={() => showActions(latest.current.headings.map((h) => ({ label: `${'  '.repeat((h.heading?.level ?? 1) - 1)}${h.heading?.title}`, onPress: () => scrollTo(h.start) })), '개요')}>
              <SymbolView name="list.bullet.indent" size={22} tintColor={c.ink} />
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="문서 메뉴" hitSlop={8} onPress={() => showActions(latest.current.menu, latest.current.title)}>
            <SymbolView name="ellipsis.circle" size={22} tintColor={c.ink} />
          </Pressable>
        </View>
      ),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, data?.kind, favored, headingKey, ref, c.ink, toggleFav])
  if (missing)
    return (
      <Screen>
        <Empty title="문서를 찾을 수 없어요" body="지워졌거나 이 계정의 문서가 아니에요" action={{ label: '목록으로', onPress: () => navigation.goBack() }} />
      </Screen>
    )
  const ancestors = data?.ancestors ?? []
  const editButton = editable && !editing && note.state ? <Button title="편집" onPress={() => setEditing(true)} /> : undefined
  const editability = source.data ? noteEditability(source.data) : null
  return (
    <Screen onRefresh={async () => { await Promise.all([doc.refresh(), source.refresh()]) }} keyboard={editing} scrollRef={scroll} bottomBar={editButton}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.crumbs} accessibilityLabel="문서 위치">
        <Pressable accessibilityRole="button" onPress={() => goDocsRoot(navigation)} hitSlop={8}>
          <Text style={styles.meta}>문서</Text>
        </Pressable>
        {crumbs(ancestors, 3).map((cr, i) =>
          'gap' in cr ? (
            <Pressable key={`gap${i}`} accessibilityRole="button" accessibilityLabel="숨긴 상위 문서" onPress={() => showActions(ancestors.slice(1, -2).map((a) => ({ label: a.title || '제목 없음', onPress: () => openDoc(a) })), '상위 문서')} hitSlop={8}>
              <Text style={styles.meta}>› …</Text>
            </Pressable>
          ) : (
            <Pressable key={cr.ref} accessibilityRole="button" onPress={() => openDoc(cr)} hitSlop={8}>
              <Text style={styles.meta} numberOfLines={1}>
                › {cr.title || '제목 없음'}
              </Text>
            </Pressable>
          ),
        )}
        <Text style={styles.strong} numberOfLines={1}>
          › {title}
        </Text>
      </ScrollView>
      <Loaded query={doc}>
        {(d) => (
          <View style={s.page}>
            {d.frontmatter.status === 'archived' ? <NoteNotice message="보관된 문서예요. 기본 속성은 복원한 뒤 고칠 수 있어요. 사용자 속성과 본문은 고칠 수 있어요." /> : null}
            {stopped ? (
              <NoteNotice message="서버나 계정이 바뀌어 저장을 멈췄어요. 초안을 내보내거나 목록으로 돌아가 주세요.">
                {note.state && note.state.draft !== note.state.base ? <Button variant="outline" title="내 초안 내보내기" onPress={() => void exportDraft(note.state?.draft ?? '')} /> : null}
                <Button variant="outline" title="목록으로" onPress={() => goDocsRoot(navigation)} />
              </NoteNotice>
            ) : null}
            <DocMeta doc={d} queue={queue} knownVersion={known} schema={sheets.schema.data} draftKey={draftKey} onDraft={setMetaDraft} alive={alive} />
            {wikiNote ? (
              <Text accessibilityRole="alert" style={styles.meta}>
                {wikiNote}
              </Text>
            ) : null}
            <View onLayout={(e) => (bodyY.current = e.nativeEvent.layout.y)} style={s.body}>
              {source.data === undefined ? (
                <Text style={styles.meta}>{source.status === 'error' ? (source.error instanceof ApiError && source.error.status === 404 ? '노트가 없어요' : '노트를 불러오지 못했어요') : '노트를 불러오는 중이에요'}</Text>
              ) : !note.state ? (
                <Text style={styles.meta}>노트를 준비하는 중이에요</Text>
              ) : editing && note.saver ? (
                <NoteEditor state={note.state} saver={note.saver} storageOk={note.storageOk} reload={() => notesApi.source(origin, ref)} pickImage={() => pickAndUpload(scope)} onDone={() => setEditing(false)} onAdopted={() => queue.reset()} />
              ) : (
                <>
                  {!editable && !stopped && editability && !editability.editable ? <NoteNotice message={editability.reason} /> : null}
                  {heldDraft !== null && !stopped ? (
                    <NoteNotice message="이 기기에 보관한 내 초안이 있어요. 내보내서 웹에서 합치거나 지워 주세요.">
                      <Button variant="outline" title="내 초안 내보내기" onPress={() => void exportDraft(heldDraft)} />
                      <Button variant="plain" title="보관한 초안 지우기" onPress={() => Alert.alert('보관한 초안을 지울까요?', '먼저 내보냈는지 확인해 주세요. 지운 초안은 되살릴 수 없어요.', [{ text: '취소', style: 'cancel' }, { text: '지우기', style: 'destructive', onPress: note.discard }])} />
                    </NoteNotice>
                  ) : null}
                  {editable && note.state.status !== 'clean' ? (
                    <NoteNotice message={note.state.status === 'dirty' || note.state.status === 'saving' ? '저장 중이거나 저장 안 된 변경이 있어요' : (note.state.message ?? '자동 저장이 멈췄어요. 편집에서 확인해 주세요')}>
                      {editable ? <Button variant="outline" title="편집에서 확인" onPress={() => setEditing(true)} /> : null}
                    </NoteNotice>
                  ) : null}
                  {sections.length ? (
                    sections.map((sec) => (
                      <View key={sec.start} onLayout={(e) => (offsets.current[sec.start] = e.nativeEvent.layout.y)}>
                        <NoteView
                          md={sec.md}
                          onWiki={(t) => void onWiki(t)}
                          onLink={(href) => {
                            if (externalLink(href)) void WebBrowser.openBrowserAsync(href)
                          }}
                          onToggleTask={
                            editable && note.saver && (note.state?.status === 'clean' || note.state?.status === 'dirty')
                              ? (line) => {
                                  note.saver?.edit(toggleTask(draft, sec.start + line))
                                  void note.saver?.flush()
                                }
                              : undefined
                          }
                        />
                      </View>
                    ))
                  ) : (
                    <Text style={styles.meta}>{editable ? '아직 노트가 없어요. 편집을 눌러 써요' : '노트가 없어요'}</Text>
                  )}
                </>
              )}
            </View>
            <DocTags doc={d} alive={alive} onTag={(tag) => goDocsRoot(navigation, { tag })} />
            <DocRelations doc={d} wikiTerms={wikiLinks(draft)} onWiki={(t) => void onWiki(t)} onOpen={openDoc} />
            {standalone ? <DocChildren doc={d} onOpen={openDoc} onCreate={() => sheets.openCreate(childCtx)} onFolder={() => navigation.push('DocFolder', { parent: ref, title })} /> : null}
          </View>
        )}
      </Loaded>
      <Sheet visible={!!choices} title="열 문서 고르기" onClose={() => setChoices(null)}>
        <Text style={styles.meta}>{choices?.message}</Text>
        <View style={styles.group}>
          {choices?.hits.map((h) => (
            <Button
              key={h.ref}
              variant="plain"
              title={`${h.title} · ${kindLabel(h.kind)} · ${statusLabel(h.status)}`}
              onPress={() => {
                setChoices(null)
                openDoc(h)
              }}
            />
          ))}
        </View>
      </Sheet>
      {sheets.elements}
    </Screen>
  )
}
const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  crumbs: { gap: space.sm, alignItems: 'center' },
  page: { gap: space.lg },
  body: { gap: space.md },
})

