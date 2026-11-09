// 문서 화면들이 같이 쓰는 시트와 길게 누르기 동작(웹 키 m·F2·Space·N 의 자리). 화면마다 이 훅을 부르고 elements 를 그려요.
import React, { useCallback, useState } from 'react'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { SearchHit } from '@direction-board/contracts'
import { moveError } from '@direction-board/contracts/doc-tree'
import { ApiError } from '../../api/client'
import { docsApi } from '../../api/docs'
import { useQuery, useScope } from '../../api/query'
import type { StackParams } from '../../navigation/routes'
import { useServer } from '../../server'
import type { Action } from '../../ui/actions'
import { Sheet } from '../../ui/Sheet'
import { useToast } from '../../ui/Toast'
import { CreateSheet, type CreateContext } from './CreateSheet'
import { docsChanged } from './events'
import { MoveSheet, type MoveTarget } from './MoveSheet'
import { canRename, renameDoc } from './rename'
import { useFavorites } from './store'
import { siblingMove } from './tree'
import { DocFacts, DocHead } from './views'
import { useWriteScope } from '../../api/scope'

type Nav = NativeStackNavigationProp<StackParams>
export type MenuExtras = { siblings?: SearchHit[]; index?: number; stale?: boolean }

export function useDocSheets() {
  const navigation = useNavigation<Nav>()
  const { origin } = useServer()
  const scope = useWriteScope()
  const toast = useToast()
  const { generation, isCurrent } = useScope()
  const fav = useFavorites()
  const schema = useQuery('docs/schema', () => docsApi.schema(origin))
  const [create, setCreate] = useState<CreateContext | null>(null)
  const [move, setMove] = useState<MoveTarget | null>(null)
  const [preview, setPreview] = useState<SearchHit | null>(null)
  const open = useCallback((d: { ref: string; title: string }) => navigation.push('Doc', { ref: d.ref, title: d.title }), [navigation])
  const moveTo = useCallback(
    async (input: Parameters<typeof docsApi.move>[1], label: string, at: number) => {
      if (!isCurrent(at)) return toast('서버나 계정이 바뀌어 옮기지 않았어요')
      try {
        await docsApi.move(scope, input)
        toast(label)
      } catch (e) {
        toast(e instanceof ApiError ? moveError(e.status, e.message) : '옮긴 결과를 확인하지 못했어요. 목록을 새로 읽었어요')
      } finally {
        docsChanged()
      }
    },
    [origin, toast, isCurrent],
  )
  /** 행·카드 길게 누르기 동작(웹 메뉴·단축키와 같은 항목). 계층 동작은 독립 문서만 */
  const actions = useCallback(
    (d: SearchHit, extra: MenuExtras = {}): Action[] => {
      const standalone = d.ref.startsWith('doc:')
      const list: Action[] = [{ label: '미리보기', onPress: () => setPreview(d) }]
      if (canRename(d)) list.push({ label: '제목 바꾸기', onPress: () => { const at = generation; void renameDoc(origin, scope, d.ref, toast, () => isCurrent(at)) } })
      if (standalone && d.status !== 'archived') list.push({ label: '하위 문서 만들기', onPress: () => setCreate({ parent: { ref: d.ref, title: d.title }, area: d.area, links: [{ ref: d.ref, title: d.title }], linksOn: false }) })
      if (standalone && (d.children ?? 0) > 0) list.push({ label: '하위 문서 보기', onPress: () => navigation.push('DocFolder', { parent: d.ref, title: d.title }) })
      if (standalone && !extra.stale) {
        list.push({ label: '이동…', onPress: () => setMove({ ref: d.ref, title: d.title, parent: d.parent ?? null }) })
        if (extra.siblings && extra.index !== undefined) {
          const up = siblingMove(extra.siblings, extra.index, 'up')
          const down = siblingMove(extra.siblings, extra.index, 'down')
          if (up) list.push({ label: '위로 한 칸', onPress: () => void moveTo(up, '위로 옮겼어요', generation) })
          if (down) list.push({ label: '아래로 한 칸', onPress: () => void moveTo(down, '아래로 옮겼어요', generation) })
        }
        if (d.parent) list.push({ label: '맨 위로', onPress: () => void moveTo({ ref: d.ref, parent: null }, '맨 위로 옮겼어요', generation) })
      }
      list.push({ label: fav.isFavorite(d.ref) ? '즐겨찾기 빼기' : '즐겨찾기', onPress: () => fav.toggle(d.ref) })
      return list
    },
    [origin, toast, navigation, moveTo, fav, generation, isCurrent],
  )
  const elements = (
    <>
      <CreateSheet
        visible={!!create}
        context={create ?? {}}
        schema={schema.data}
        onClose={() => setCreate(null)}
        onCreated={(ref, title) => {
          setCreate(null)
          navigation.push('Doc', { ref, title })
        }}
      />
      <MoveSheet doc={move} onClose={() => setMove(null)} />
      <Sheet
        visible={!!preview}
        title={preview?.title || '미리보기'}
        onClose={() => setPreview(null)}
        action={preview ? { label: '열기', onPress: () => { const p = preview; setPreview(null); open(p) } } : undefined}
      >
        {preview ? (
          <>
            <DocFacts doc={preview} />
            <DocHead doc={preview} />
          </>
        ) : null}
      </Sheet>
    </>
  )
  return { actions, elements, openCreate: setCreate, openMove: setMove, open, schema }
}
