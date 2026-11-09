import { useCallback } from 'react'
import type { Board, Item, StateResponse } from '@direction-board/contracts'
import { BOARD_KEY } from '../../../api/board'
import { UnknownWriteError } from '../../../api/client'
import { useQueryStore } from '../../../api/query'
import { useWriteScope } from '../../../api/scope'
import { workOps } from '../../../api/work'
import { useToast } from '../../../ui/Toast'

const fail = (e: unknown) => (e instanceof UnknownWriteError ? e.message : '저장하지 못해 되돌렸어요')

/** 보드 항목 지우기(낙관적). 그 항목에 걸린 연결도 함께 지워요(옛 보드 dropWithLinks) */
export function useDeleteItems() {
  const store = useQueryStore()
  const scope = useWriteScope()
  const toast = useToast()
  return useCallback(
    async (boardId: string, ids: string[]) => {
      const state = store.get(BOARD_KEY).data as StateResponse | undefined
      const gone = new Set(ids)
      for (const i of state?.items ?? []) if (i.boardId === boardId && i.type === 'link' && (gone.has(String(i.from)) || gone.has(String(i.to)))) gone.add(i.id)
      try {
        await store.mutate<StateResponse, unknown>(BOARD_KEY, {
          apply: (d) => ({ ...d, items: d.items.filter((i) => !(i.boardId === boardId && gone.has(i.id))) }),
          send: () => Promise.all([...gone].map((id) => workOps(scope).deleteItem(boardId, id))),
          unknown: (e) => e instanceof UnknownWriteError,
        })
        return true
      } catch (e) {
        toast(fail(e))
        return false
      }
    },
    [store, scope, toast],
  )
}

/** 판 영역 바꾸기(낙관적, 서버가 돌려준 판으로 맞춤) */
export function useSaveAreas() {
  const store = useQueryStore()
  const scope = useWriteScope()
  const toast = useToast()
  return useCallback(
    async (board: Board, areas: { id?: string; name: string; color?: string }[]) => {
      try {
        await store.mutate<StateResponse, Board>(BOARD_KEY, {
          apply: (d) => ({ ...d, boards: d.boards.map((b) => (b.id === board.id ? { ...b, areas: areas.map((a, i) => ({ id: a.id ?? `new${i}`, name: a.name, color: a.color ?? board.areas[i]?.color ?? '' })) } : b)) }),
          send: () => workOps(scope).saveBoard(board.id, { areas }),
          commit: (d, saved) => ({ ...d, boards: d.boards.map((b) => (b.id === board.id ? { ...b, areas: saved.areas } : b)) }),
          unknown: (e) => e instanceof UnknownWriteError,
        })
        return true
      } catch (e) {
        toast(fail(e))
        return false
      }
    },
    [store, scope, toast],
  )
}
export type { Item }
