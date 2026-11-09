import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { api, type Board, type ChangesResponse, type Item, type SignalsResponse, type StateResponse } from "@/lib/api"
import type { Me, Space } from "@direction-board/contracts"
import { EXPECT_USER, saveOutcome } from "@/lib/quick-slot"

export type Status = "loading" | "ok" | "error"
export type DataState = { status: Status; hasData: boolean; retry: () => Promise<void> }
/** 서버 쓰기 시각으로 더 새 값인지 */
const newer = (a: Item, b: Item | undefined, strict = false) => !b || (strict ? Number(a.updatedAt ?? 0) > Number(b.updatedAt ?? 0) : Number(a.updatedAt ?? 0) >= Number(b.updatedAt ?? 0))

/** effect 한 번의 생명주기(키 하나). StrictMode 나 키가 바뀌어 effect 가 다시 돌면 이전 생명주기의 늦은 응답은 아무것도 바꾸지 않는다 */
export type Life = { alive: boolean; key: string }
export const newLife = (key = ""): Life => ({ alive: true, key })
export type Runner = { run: () => Promise<void>; tick: () => void; schedule: (ms: number) => void; dispose: () => void; busy: () => boolean }

/**
 * 요청을 한 번에 하나만 돌리는 작은 실행기. 실행 상태(진행 중·한 번 더·타이머)는 실행기마다 따로, 생명주기만 공유.
 * run(): 진행 중이면 끝난 뒤 한 번 더 돌게 하고, 그 후속까지 끝나야 resolve 한다 (수동 다시 시도·저장 뒤 최신 반영).
 * tick(): 자동 호출. 진행 중이면 건너뛴다.
 */
export function makeRunner(life: Life, once: () => Promise<void>, after?: (r: Runner) => void): Runner {
  let inflight: Promise<void> | null = null
  let again = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const r: Runner = {
    run() {
      if (!life.alive) return Promise.resolve()
      if (inflight) {
        again = true
        return inflight
      }
      clearTimeout(timer)
      inflight = (async () => {
        try {
          do {
            again = false
            await once()
          } while (again && life.alive)
        } finally {
          // while 조건과 같은 동기 구간: 그 사이에 들어온 호출은 없다
          inflight = null
          if (life.alive) after?.(r)
        }
      })()
      return inflight
    },
    tick() {
      if (life.alive && !inflight) void r.run()
    },
    schedule(ms) {
      clearTimeout(timer)
      if (life.alive) timer = setTimeout(() => r.tick(), ms)
    },
    dispose() {
      clearTimeout(timer)
    },
    busy: () => !!inflight,
  }
  return r
}

/** 보드 데이터 (할 일, 목표, 영역). /api/state 한 번 + /api/changes 5초 폴링. 실패해도 마지막 내용은 남기고 다시 시도한다 */
export function useBoard() {
  const [boards, setBoards] = useState<Board[]>([])
  const [items, setItems] = useState<Record<string, Item>>({})
  const [me, setMe] = useState("")
  const [profile, setProfile] = useState<Me | null>(null)
  const [spaces, setSpaces] = useState<Space[]>([])
  const [status, setStatus] = useState<Status>("loading")
  const [hasData, setHasData] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const confirmed = useRef(new Map<string, Item>()) // 서버가 확인한 값 (저장 실패 때 여기로 되돌린다)
  const failed = useRef(new Set<string>())
  const saveSeq = useRef(new Map<string, number>()) // 같은 항목을 연달아 저장하면 마지막 저장이 화면을 정한다
  const putChain = useRef(new Map<string, Promise<unknown>>()) // 같은 항목의 PUT 은 바꾼 순서대로 하나씩
  const resync = useRef(false) // 놓쳤을 수 있는 변경이 있으면 다음 회차에 전체를 다시 읽는다
  const writeEpoch = useRef(0)
  const seq = useRef(0)
  const hasDataRef = useRef(false)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const runnerRef = useRef<Runner | null>(null)

  const merge = useCallback((list: Item[]) => {
    setItems((prev) => {
      const next = { ...prev }
      for (const it of list) {
        const k = it.boardId + ":" + it.id
        if (it.deleted) delete next[k]
        else next[k] = it
      }
      return next
    })
  }, [])

  const once = useCallback(
    async (life: Life) => {
      const live = (l: Life) => l.alive
      try {
        const full = !hasDataRef.current || (resync.current && putChain.current.size === 0)
        if (full) {
          if (!live(life)) return
          const first = !hasDataRef.current
          if (first) setStatus("loading")
          const epoch = writeEpoch.current
          const s = await api<StateResponse>("/api/state")
          if (!live(life)) return
          // 읽는 사이 저장이 있었으면 이 스냅숏은 버리고 다음 회차에 다시 (최초 읽기는 그대로 반영)
          if (!first && (epoch !== writeEpoch.current || putChain.current.size > 0)) return
          seq.current = s.seq
          setMe(s.me.email)
          setProfile(s.me)
          if (s.spaces) setSpaces(s.spaces)
          setBoards(s.boards)
          const fresh = s.items.filter((it) => !it.deleted).map((it) => [it.boardId + ":" + it.id, it] as const)
          confirmed.current = new Map(fresh)
          failed.current.clear()
          setSaveFailed(false)
          resync.current = false
          setItems((cur) => {
            const next: Record<string, Item> = Object.fromEntries(fresh)
            for (const k of putChain.current.keys()) {
              if (cur[k]) next[k] = cur[k] // 저장 중인 항목은 방금 바꾼 값 유지
            }
            return next
          })
          hasDataRef.current = true
          setHasData(true)
        } else {
          const c = await api<ChangesResponse>("/api/changes?since=" + seq.current)
          if (!live(life)) return
          seq.current = c.seq
          // 다른 탭·기기에서 만들거나 이름을 바꾼 공간
          if (c.spaces) setSpaces((prev) => (JSON.stringify(prev) === JSON.stringify(c.spaces) ? prev : c.spaces ?? prev))
          if (c.boards.length) setBoards((prev) => {
            const m = new Map(prev.map((b) => [b.id, b]))
            for (const b of c.boards) {
              if (b.deleted) m.delete(b.id)
              else m.set(b.id, b)
            }
            return [...m.values()]
          })
          if (c.items.length) {
            // 늦게 온 오래된 값은 버리고, 방금 바꿔서 저장 중인 항목은 화면을 덮지 않는다
            for (const it of c.items) {
              const k = it.boardId + ":" + it.id
              const cur = confirmed.current.get(k)
              const same = cur && Number(cur.updatedAt ?? 0) === Number(it.updatedAt ?? 0)
              if ((same && JSON.stringify(cur) !== JSON.stringify(it)) || putChain.current.has(k)) resync.current = true
            }
            const fresh = c.items.filter((it) => newer(it, confirmed.current.get(it.boardId + ":" + it.id), true))
            for (const it of fresh) {
              const k = it.boardId + ":" + it.id
              if (it.deleted) confirmed.current.delete(k)
              else confirmed.current.set(k, it)
              failed.current.delete(k)
            }
            merge(fresh.filter((it) => !putChain.current.has(it.boardId + ":" + it.id)))
            setSaveFailed(failed.current.size > 0)
          }
        }
        setStatus("ok")
      } catch {
        if (live(life)) setStatus("error") // 마지막으로 불러온 내용은 그대로
      }
    },
    [merge],
  )

  useEffect(() => {
    const life = newLife("board")
    // 끝나면 (실패했어도) 5초 뒤 다시
    const runner = makeRunner(life, () => once(life), (r) => r.schedule(5000))
    runnerRef.current = runner
    void runner.run()
    return () => {
      life.alive = false
      runner.dispose()
    }
  }, [once])

  const reload = useCallback(() => runnerRef.current?.run() ?? Promise.resolve(), [])

  /**
   * 항목 저장. 결과는 셋: 저장됨(true)·확실한 거절(false, 서버 4xx)·결과 불명("unknown", 네트워크·5xx — 서버에 닿았을 수 있어요).
   * 빠른 추가는 셋을 나눠 결과 불명이면 읽어서 확인만 해요(PR #39 리뷰 16). 다른 화면은 save(참·거짓)를 써요
   */
  const saveKnown = useCallback(
    async (it: Item, opts?: { expectUser?: string }): Promise<boolean | "unknown" | "scope"> => {
      const k = it.boardId + ":" + it.id
      writeEpoch.current++
      const n = (saveSeq.current.get(k) ?? 0) + 1
      saveSeq.current.set(k, n)
      const latest = () => saveSeq.current.get(k) === n
      merge([it])
      const { boardId, by, updatedAt, deleted, ...body } = it as Item & { by?: string; updatedAt?: number }
      void by
      void updatedAt
      void deleted
      const prevPut = putChain.current.get(k) ?? Promise.resolve()
      const put = prevPut.catch(() => undefined).then(() => api<Item>("/api/boards/" + boardId + "/items/" + it.id, { method: "PUT", body: JSON.stringify(body), ...(opts?.expectUser ? { headers: { [EXPECT_USER]: opts.expectUser } } : {}) }))
      putChain.current.set(k, put)
      void put.catch(() => undefined).finally(() => {
        if (putChain.current.get(k) === put) putChain.current.delete(k)
      })
      try {
        const r = await put
        if (newer(r, confirmed.current.get(k))) confirmed.current.set(k, r) // 앞선 성공까지 반영된 서버 값
        if (!latest()) return true // 뒤이은 저장이 화면을 정한다
        merge([r])
        failed.current.delete(k)
        setSaveFailed(failed.current.size > 0)
        return true
      } catch (e) {
        const outcome = saveOutcome(e)
        if (!latest()) return outcome
        // 이 저장의 값이 아직 화면에 있으면 서버가 확인한 값으로 되돌린다 (뒤이은 저장이 진행 중이면 그대로). 자동으로 다시 보내지 않는다
        const rolledBack = itemsRef.current[k] === it
        if (rolledBack) {
          const back = confirmed.current.get(k)
          setItems((cur) => {
            if (cur[k] !== it) return cur
            const next = { ...cur }
            if (back) next[k] = back
            else delete next[k]
            return next
          })
        }
        failed.current.add(k)
        setSaveFailed(true)
        if (outcome === "scope") toast("다른 계정에서 시작한 추가라 저장하지 않았어요", { description: "그 계정으로 돌아가면 이어서 해요" })
        else if (outcome === "unknown") toast("저장됐는지 확인하지 못했어요", { description: "다시 불러오면 서버의 값이 보여요" })
        else toast(rolledBack ? "저장하지 못해 되돌렸어요" : "저장하지 못했어요", { description: "잠시 뒤 다시 해 주세요" })
        return outcome
      }
    },
    [merge],
  )
  const save = useCallback(async (it: Item): Promise<boolean> => (await saveKnown(it)) === true, [saveKnown])

  const list = useMemo(() => Object.values(items), [items])
  const personal = boards.find((b) => b.kind === "personal" && b.mine) || boards[0]
  return { boards, items: list, me, profile, spaces, status, hasData, saveFailed, reload, save, saveKnown, personal }
}

/** 사건 (signals). 15초마다 다시 읽는다 (화면이 숨겨져 있거나 읽는 중이면 건너뜀) */
export function useSignals() {
  const [data, setData] = useState<SignalsResponse>({ signals: [], collectors: [], rules: [], stats: { interrupts_today: 0 } })
  const [status, setStatus] = useState<Status>("loading")
  const [hasData, setHasData] = useState(false)
  const hasDataRef = useRef(false)
  const runnerRef = useRef<Runner | null>(null)

  const once = useCallback(async (life: Life) => {
    const live = (l: Life) => l.alive
    try {
      if (!hasDataRef.current && live(life)) setStatus("loading")
      const next = await api<SignalsResponse>("/api/signals")
      if (!live(life)) return
      setData(next)
      hasDataRef.current = true
      setHasData(true)
      setStatus("ok")
    } catch {
      if (live(life)) setStatus("error")
    }
  }, [])

  useEffect(() => {
    const life = newLife("signals")
    const runner = makeRunner(life, () => once(life))
    runnerRef.current = runner
    void runner.run()
    const t = setInterval(() => {
      if (!document.hidden) runner.tick()
    }, 15000)
    return () => {
      life.alive = false
      clearInterval(t)
      runner.dispose()
    }
  }, [once])

  const load = useCallback(() => runnerRef.current?.run() ?? Promise.resolve(), [])
  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      setData((d) => ({
        ...d,
        signals: d.signals.map((s) => (s.id === id && typeof body.status === "string" ? { ...s, status: body.status as never } : s)),
      }))
      await api("/api/signals/" + id, { method: "PATCH", body: JSON.stringify(body) }).catch(() => null)
      void load()
    },
    [load],
  )
  const clearSamples = useCallback(async () => {
    await api("/api/signals?sample=1", { method: "DELETE" }).catch(() => null)
    void load()
  }, [load])
  const deleteRule = useCallback(
    async (id: string) => {
      await api("/api/rules/" + id, { method: "DELETE" }).catch(() => null)
      void load()
    },
    [load],
  )
  return { ...data, status, hasData, load, patch, clearSamples, deleteRule }
}


/** localStorage 에 붙은 작은 상태 */
export function useStored<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : init
    } catch {
      return init
    }
  })
  useEffect(() => {
    try {
      const raw = JSON.stringify(v)
      if (localStorage.getItem(key) !== raw) {
        localStorage.setItem(key, raw)
        window.dispatchEvent(new CustomEvent("db:stored", { detail: key }))
      }
    } catch {
      /* ignore */
    }
  }, [key, v])
  // 같은 키를 쓰는 다른 화면(첫 화면·사이드바·전체 목록)이나 다른 탭이 바꾸면 따라간다
  useEffect(() => {
    const pull = () => {
      try {
        const raw = localStorage.getItem(key)
        if (raw) setV((cur) => (JSON.stringify(cur) === raw ? cur : (JSON.parse(raw) as T)))
      } catch {
        /* ignore */
      }
    }
    const onLocal = (e: Event) => (e as CustomEvent).detail === key && pull()
    const onTab = (e: StorageEvent) => e.key === key && pull()
    window.addEventListener("db:stored", onLocal)
    window.addEventListener("storage", onTab)
    return () => {
      window.removeEventListener("db:stored", onLocal)
      window.removeEventListener("storage", onTab)
    }
  }, [key])
  return [v, setV] as const
}
