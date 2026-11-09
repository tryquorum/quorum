// 팝업 안에서 의회 실행 따라 보기. 접기(fold)는 콘솔의 console/stream.ts applyEvent 를 그대로 써요(같은 계약 v1 이벤트).
// 출처: board/apps/web/src/hooks/use-run-watch.ts 의 "끝날 때까지 따라가고, 끊기면 다시 붙되 같은 seq 는 버리기".
import { useEffect, useState } from "react"
import { applyEvent, emptyRun, type RunView } from "@/console/stream"
import type { QuorumEvent } from "@/lib/contract"
import { call, openEvents } from "./api"

export function useRunWatch(runId: string | null | undefined): RunView | null {
  const [view, setView] = useState<RunView | null>(null)
  useEffect(() => {
    if (!runId) { setView(null); return }
    setView({ ...emptyRun(), runId, status: "connecting" })
    const es = openEvents("/api/runs/" + encodeURIComponent(runId) + "/events")
    let finished = false
    es.onmessage = (m) => {
      try { const e = JSON.parse(m.data) as QuorumEvent; setView((v) => applyEvent(v ?? emptyRun(), e)) } catch { /* 읽을 수 없는 줄은 건너뛰어요 */ }
    }
    es.addEventListener("done", () => { finished = true; es.close(); setView((v) => (v && (v.status === "running" || v.status === "connecting") ? { ...v, status: v.errors.length ? "error" : "done" } : v)) })
    es.onerror = () => { if (!finished && es.readyState === EventSource.CLOSED) setView((v) => (v ? { ...v, status: "error", failure: "The event stream closed before the run finished" } : v)) }
    return () => { finished = true; es.close() }
  }, [runId])
  return view
}

export type MemoryHit = { slug: string; title: string; snippet: string; score: number; decision?: "pass" | "hold" | "reject" }
/** gbrain 기억 검색(GET /api/memory). 판정 기록이면 pass/hold/reject 를 뽑아 보여 줘요 */
export function useMemory(q: string): { hits: MemoryHit[] | null; error: string | null } {
  const [state, setState] = useState<{ hits: MemoryHit[] | null; error: string | null }>({ hits: null, error: null })
  useEffect(() => {
    if (!q.trim()) { setState({ hits: [], error: null }); return }
    let live = true
    setState({ hits: null, error: null })
    call<{ results: MemoryHit[] }>("/api/memory?q=" + encodeURIComponent(q.slice(0, 200)))
      .then((d) => {
        if (!live) return
        const hits = (d.results || []).slice(0, 3).map((h) => {
          const m = /"decision"\s*:\s*"(pass|hold|reject)"/.exec(h.snippet) ?? /\b(pass|hold|reject)\b/.exec(h.snippet)
          return { ...h, ...(m ? { decision: m[1] as MemoryHit["decision"] } : {}) }
        })
        setState({ hits, error: null })
      })
      .catch((e: unknown) => { if (live) setState({ hits: [], error: e instanceof Error ? e.message : String(e) }) })
    return () => { live = false }
  }, [q])
  return state
}
