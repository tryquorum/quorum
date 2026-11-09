import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api, ApiError } from "@/lib/api"
import { makeRunner, newLife, type Life, type Runner } from "@/hooks/use-data"
import { RecentCache, sameJson } from "@/lib/work-cache"

export type Brief = { ref: string; type: string; title: string; source: string; lane?: string; status: string; area?: string | null; due?: number | null; when?: string | null; updated_at: number }
export type Link = { id: string; label: string | null; dir: "in" | "out"; by: string; other: Brief }
export type Work = {
  ref: string
  self: Brief
  signal: null | {
    id: string; source: string; kind: string; title: string; body: string | null; url: string | null; area: string | null; task: string | null; agent: string | null
    lane: string; reason: string | null; status: string; private: boolean; sample: boolean; needs_ai: boolean; due: number | null; created_at: number; updated_at: number
  }
  runs: unknown[]
  noteVersioning?: boolean
  note: { html: string; text: string; md?: string; version?: number; by: string; updated_at: number } | null
  links: Link[]
  flow: { why: string; item: Brief }[]
  timeline: { at: number; kind: string; text: string }[]
}

type Status = "loading" | "ok" | "missing" | "error"
/** 최근에 연 일 상세. 다시 열 때 바로 그리는 데만 써요(work-cache.ts) */
const recent = new RecentCache<Work>(40)
const cached = (ref: string | null) => (ref ? recent.get(ref) ?? null : null)

/**
 * 일 하나의 상세를 불러와요. 캐시가 있으면 그걸 먼저 보여 주고 뒤에서 새로 받아요.
 * fresh: 이 화면(마운트)이 이 일의 최신 응답을 받았는지. 그 전에는 보이기만 하고 쓰는 동작·편집기를 켜지 않아요.
 * 같은 내용이 다시 오면 보이는 객체를 그대로 둬서 다시 그리지 않아요. 한 번 받은 뒤의 실패·404 는 보이던 내용을 지키고 상태만 바꿔요.
 */
export function useWork(ref: string | null) {
  const bound = useMemo(() => ({ life: null as Life | null, runner: null as Runner | null }), [ref])
  const current = useRef(bound)
  current.current = bound
  const [data, setData] = useState<{ key: typeof bound; w: Work | null; status: Status; fresh: boolean }>(() => ({ key: bound, w: cached(ref), status: "loading", fresh: false }))
  useEffect(() => {
    const life = newLife(ref || "")
    bound.life = life
    const live = () => life.alive && life.key === (ref || "") && current.current === bound && bound.life === life
    setData((prev) => (prev.key === bound ? prev : { key: bound, w: cached(ref), status: "loading", fresh: false }))
    const runner = makeRunner(life, async () => {
      if (!ref || !live()) return
      try {
        const w = await api<Work>(`/api/work/${encodeURIComponent(ref)}`, { signal: AbortSignal.timeout(15000) })
        if (!live()) return
        recent.set(ref, w)
        setData((prev) => {
          const same = prev.key === bound && prev.w !== null && sameJson(prev.w, w)
          if (same && prev.status === "ok" && prev.fresh) return prev
          return { key: bound, w: same ? prev.w : w, status: "ok", fresh: true }
        })
      } catch (e) {
        if (!live()) return
        const missing = e instanceof ApiError && e.status === 404
        if (missing) recent.delete(ref)
        setData((prev) => {
          const mine = prev.key === bound
          const fresh = mine && prev.fresh
          // 캐시로만 그린 상태에서 404 면 보여 줄 게 없어요(보관함 화면). 받은 적이 있으면 지금처럼 내용을 지켜요
          return { key: bound, w: mine && (fresh || !missing) ? prev.w : null, status: missing ? "missing" : "error", fresh }
        })
      }
    })
    bound.runner = runner
    void runner.run()
    return () => { life.alive = false; runner.dispose() }
  }, [bound, ref])
  const load = useCallback(() => bound.life?.alive && current.current === bound ? bound.runner?.run() ?? Promise.resolve() : Promise.resolve(), [bound])
  return { ...(data.key === bound ? data : { w: cached(ref), status: "loading" as const, fresh: false }), load }
}
