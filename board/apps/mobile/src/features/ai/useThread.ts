import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { Run } from '@direction-board/contracts'
import { ApiError } from '../../api/client'
import { useScope } from '../../api/query'
import { runsApi } from '../../api/runs'
import { useServer } from '../../server'

export type ThreadStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error'
type State = { id: string | null; runs: Run[]; truncated: boolean; status: ThreadStatus; error: unknown }
const IDLE: State = { id: null, runs: [], truncated: false, status: 'idle', error: null }

/** 화면이 보이고 앱이 앞에 있는지 */
export function useVisible(): boolean {
  const focused = useIsFocused()
  const [active, setActive] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'))
    return () => sub.remove()
  }, [])
  return focused && active
}

/**
 * 대화 하나의 턴. 늦게 온 응답은 요청 번호와 범위 세대로 버려요(웹 useDockThreads 와 같음).
 * 도는 턴이 있으면 화면이 보이는 동안 2.5초마다 다시 읽어요(배터리 때문에 웹 1초보다 길어요, mobile-ia.md).
 */
export function useThread(id: string | null) {
  const { origin } = useServer()
  const { generation, isCurrent } = useScope()
  const [state, setState] = useState<State>(IDLE)
  const req = useRef(0)
  const current = useRef(id)
  current.current = id
  const load = useCallback(
    async (quiet = false) => {
      if (!id) return
      const n = ++req.current
      const g = generation
      if (!quiet) setState((s) => (s.id === id && s.status === 'ready' ? s : { ...IDLE, id, status: 'loading' }))
      try {
        const r = await runsApi.thread(origin, id)
        if (n !== req.current || !isCurrent(g) || current.current !== id) return
        setState({ id, runs: r.runs, truncated: !!r.truncated, status: 'ready', error: null })
      } catch (error) {
        if (n !== req.current || !isCurrent(g) || current.current !== id) return
        setState((s) => ({ ...s, id, status: error instanceof ApiError && error.status === 404 ? 'missing' : 'error', error }))
      }
    },
    [id, origin, generation, isCurrent],
  )
  useEffect(() => {
    req.current++
    setState(id ? { ...IDLE, id, status: 'loading' } : IDLE)
    void load()
  }, [id, load])
  const ready = state.id === id && (state.status === 'ready' || (state.status === 'error' && state.runs.length > 0))
  const running = ready && state.runs.some((r) => r.status === 'running')
  const visible = useVisible()
  useEffect(() => {
    if (!running || !visible) return
    const t = setInterval(() => void load(true), 2500)
    return () => clearInterval(t)
  }, [running, visible, load])
  return { ...state, runs: state.id === id ? state.runs : [], ready, running, visible, load }
}

/** 1초마다 흐르는 지금 시각(경과·90초 안내용). 도는 동안만 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}
