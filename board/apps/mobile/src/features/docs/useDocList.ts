// 문서 목록 읽기: 첫 쪽은 레인 0 캐시(useQuery — 포커스·앱 복귀에 다시 읽고 실패해도 마지막 값을 지켜요), 다음 쪽은 이 화면 상태.
// 웹 docs-view 와 같이 목록 보기는 끝에 닿으면 다음 쪽, 아이콘·갤러리·열은 1,000개까지 자동으로 이어 읽어요.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchHit } from '@direction-board/contracts'
import { errorMessage } from '../../api/client'
import { docsApi, type DocFilters } from '../../api/docs'
import { useQuery, useScope } from '../../api/query'
import { useServer } from '../../server'
import { appendPage } from '@direction-board/contracts/doc-tree'
import { onDocsChanged } from './events'

export const AUTO_LOAD = 1000

export function useDocList(filters: DocFilters, enabled: boolean, auto: boolean) {
  const { origin } = useServer()
  const { generation, isCurrent } = useScope()
  const key = `docs/list/${JSON.stringify(filters)}`
  const first = useQuery(key, () => (enabled ? docsApi.search(origin, filters) : Promise.resolve({ results: [], total: 0 })))
  const [more, setMore] = useState<SearchHit[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 첫 쪽이 새로 오거나 필터·서버·로그인이 바뀌면 이어 읽은 쪽은 버려요. 그 전 커서로 늦게 온 쪽도 붙이지 않아요
  const page = useRef(0)
  useEffect(() => {
    page.current++
    setMore([])
    setCursor(undefined)
    setError('')
    setBusy(false)
  }, [first.data, generation, key])
  const refresh = first.refresh
  useEffect(() => onDocsChanged(() => void refresh()), [refresh])
  const results = appendPage(first.data?.results ?? [], more)
  const next = cursor === null ? undefined : (cursor ?? first.data?.nextCursor)
  const loadMore = useCallback(async () => {
    if (!next || busy) return
    const started = generation
    const p0 = page.current
    setBusy(true)
    setError('')
    try {
      const res = await docsApi.search(origin, { ...filters, cursor: next })
      if (!isCurrent(started) || p0 !== page.current) return
      setMore((rows) => appendPage(rows, res.results))
      setCursor(res.nextCursor ?? null)
    } catch (e) {
      if (isCurrent(started) && p0 === page.current) setError(errorMessage(e))
    } finally {
      if (p0 === page.current) setBusy(false)
    }
  }, [next, busy, generation, origin, filters, isCurrent])
  // 훑어보는 보기는 웹처럼 1,000개까지 이어 읽어요(실패하면 멈추고 다시 시도를 보여요)
  useEffect(() => {
    if (auto && next && !busy && !error && results.length < AUTO_LOAD && first.data) void loadMore()
  }, [auto, next, busy, error, results.length, first.data, loadMore])
  return { first, results, total: first.data?.total ?? 0, next, busy, error, loadMore, partial: !!next }
}
