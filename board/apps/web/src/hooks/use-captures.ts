// AI로 할 일 추가: 실행 목록(브라우저 저장), 결과 폴링, 시작·되돌리기·다시 시도·멈추기. 빠른 추가 Provider 가 하나 갖는다.
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { CaptureHints, CaptureResponse } from "@direction-board/contracts"
import { useCatalog, useChoice } from "@/components/model-picker"
import { api, ApiError, type Run } from "@/lib/api"
import { CAPTURE_STORE, phaseOf, readCaptures, saveCaptures, type CaptureEntry, type CapturesRead, type Phase } from "@/lib/capture"
import { isCaptureEntry, splitCaptures } from "@direction-board/contracts/capture"
import { planFileDiscard, type PlanResult } from "@direction-board/contracts/slot-store"
import { compareAndWrite, seeKey, type WebPlan } from "@/lib/store-plan"
import { storeProblemText, type SlotNotice } from "@direction-board/contracts/quick-recovery"
import type { Draft } from "@/lib/quick-add"

export type CapturePage = { view: string; board?: string; work?: string }
export type StartResult = { ok: true; existing?: boolean } | { ok: false; error: string }
export type Captures = {
  /** 이 화면에서 AI 실행을 쓸 수 있는가(/api/models 가 열려야 함: 이 맥 주인만) */
  available: boolean
  entries: CaptureEntry[]
  views: Record<string, CaptureResponse | undefined>
  phases: Record<string, Phase>
  start: (text: string, draft: Draft | null, hints: CaptureHints | undefined) => Promise<StartResult>
  undo: (id: string, ref: string) => Promise<void>
  retry: (id: string) => Promise<void>
  stop: (id: string) => Promise<void>
  dismiss: (id: string) => void
  /** 칩 목록을 읽지 못했거나 깨졌을 때(규칙 E, 리뷰 22): 안내 + 다시 읽기(실제로 다시 읽음) + 버리고 새로(확인창 뒤). 그동안 새 정리·저장 없음 */
  issue: { notice: SlotNotice | null; reread: () => void; plan?: () => WebPlan | null; apply?: (plan: WebPlan) => PlanResult; retry?: () => void } | null
  /** 트레이를 펼쳤는지. 홈이 같은 기준으로 "지금 보이는 실패"를 셈 */
  expanded: boolean
  setExpanded: (v: boolean) => void
}
const storage = () => (typeof window === "undefined" ? null : window.localStorage)
const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

export function useCaptures(page: CapturePage | undefined): Captures {
  const cat = useCatalog()
  const [choice] = useChoice(cat)
  const [read, setRead] = useState<CapturesRead>(() => { const s = storage(); return s ? readCaptures(s) : { ok: true, entries: [] } })
  const [entries, setEntriesRaw] = useState<CaptureEntry[]>(() => (read.ok ? read.entries : []))
  // 이 화면이 칩을 바꿨을 때만 저장해요(처음 그림에서 쓰지 않아요 — 읽지 못한 목록을 빈 목록으로 덮지 않게, 규칙 E)
  const dirty = useRef(false)
  const setEntries: typeof setEntriesRaw = useCallback((v) => { dirty.current = true; setEntriesRaw(v) }, [])
  const readOk = read.ok
  const [views, setViews] = useState<Record<string, CaptureResponse | undefined>>({})
  const [expanded, setExpanded] = useState(false)
  const entriesRef = useRef(entries)
  const viewsRef = useRef(views)
  entriesRef.current = entries
  viewsRef.current = views
  // 쓰기 실패는 알리고(이 탭에서는 계속 보여요) "다시 저장"으로 같은 목록을 다시 써요
  const [writeFailed, setWriteFailed] = useState(false)
  const save = useCallback((list: CaptureEntry[]) => { const s = storage(); if (s) setWriteFailed(!saveCaptures(s, list)) }, [])
  useEffect(() => { if (dirty.current && readOk) save(entries) }, [entries, readOk, save])
  const reread = useCallback(() => {
    const s = storage()
    const r: CapturesRead = s ? readCaptures(s) : { ok: true, entries: [] }
    setRead(r)
    if (r.ok) { dirty.current = false; setEntriesRaw(r.entries) }
  }, [])
  // 깨진 칩 목록 버리고 새로(규칙 F — PR #43 리뷰 2): 누를 때 지금 읽어 계획(배열이면 깨진 칩만, 아니면 통째로 — 확인창 글이 밝혀요), 확인창 뒤 그 계획만.
  // 그사이 바뀌었거나 다시 읽기가 실패하면 아무것도 지우지 않아요(성한 칩까지 지우는 길이 없어요)
  const plan = useCallback((): WebPlan | null => {
    const s = storage()
    return s ? planFileDiscard({ key: CAPTURE_STORE, seen: seeKey(s, CAPTURE_STORE) }, (v) => Array.isArray(v) && v.every(isCaptureEntry), [] as CaptureEntry[], "AI 정리 칩", splitCaptures) : null
  }, [])
  const apply = useCallback((p: WebPlan): PlanResult => {
    const s = storage()
    const r: PlanResult = s ? compareAndWrite(s, p) : "changed"
    reread()
    return r
  }, [reread])
  const retrySave = useCallback(() => save(entriesRef.current), [save])
  const issue = !read.ok
    ? { notice: { kind: read.problem, text: storeProblemText("AI 정리 칩", read.problem) } as SlotNotice, reread, plan, apply }
    : writeFailed ? { notice: { kind: "write", text: "AI 정리 칩을 기기에 남기지 못했어요 · 이 탭에서는 계속 보여요" } as SlotNotice, reread, retry: retrySave } : null

  const patch = useCallback((id: string, f: (e: CaptureEntry) => CaptureEntry) => setEntries((list) => list.map((e) => (e.id === id ? f(e) : e))), [])
  const refresh = useCallback(async (id: string) => {
    try {
      const v = await api<CaptureResponse>(`/api/runs/${encodeURIComponent(id)}/effects`)
      setViews((s) => ({ ...s, [id]: v }))
    } catch (e) {
      // 실행이 없거나(지운 DB) 이 화면에서 볼 수 없으면 칩을 접는다. 그 밖의 오류는 다음 번에 다시 묻는다
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) patch(id, (x) => ({ ...x, dismissed: true }))
    }
  }, [patch])
  useEffect(() => {
    const tick = () => { for (const e of entriesRef.current) if (!e.dismissed && phaseOf(viewsRef.current[e.id]?.run) === "running") void refresh(e.id) }
    tick()
    const t = setInterval(tick, 2000)
    return () => clearInterval(t)
  }, [refresh])

  const add = (e: CaptureEntry) => setEntries((list) => [...list.filter((x) => x.id !== e.id), e])
  const start = useCallback<Captures["start"]>(async (text, draft, hints) => {
    if (!readOk) return { ok: false, error: "AI 정리 칩 목록을 기기에서 읽지 못했어요 · 다시 읽거나 버리고 새로 시작해 주세요" }
    const clientKey = crypto.randomUUID()
    const body = JSON.stringify({ kind: "capture", prompt: text, clientKey, hints, page, ...(choice ? { provider: choice.provider, model: choice.model, effort: choice.effort } : {}) })
    const send = () => api<Run>("/api/runs", { method: "POST", body })
    try {
      // 응답을 놓쳤으면(연결 오류) 같은 키로 한 번 더: 서버가 같은 실행을 돌려준다
      const run = await send().catch((e: unknown) => (e instanceof ApiError ? Promise.reject(e) : send()))
      add({ id: run.id, clientKey, text, draft, startedAt: run.created_at || Date.now() })
      // 다시 보내서 이미 끝난 실행을 받았을 수도 있으니 결과를 바로 한 번 읽는다
      void refresh(run.id)
      return { ok: true }
    } catch (e) {
      const existing = e instanceof ApiError && e.status === 409 && e.body && typeof e.body === "object" && "run" in e.body ? (e.body as { run?: Run }).run : undefined
      if (existing?.id) {
        // 같은 글이 이미 정리 중: 칩이 있으면 그대로(남겨 둔 초안 유지), 없으면 지금 초안으로 붙인다
        const id = existing.id
        if (!entriesRef.current.some((x) => x.id === id)) add({ id, clientKey: "", text: existing.prompt, draft, startedAt: existing.created_at })
        else patch(id, (x) => ({ ...x, dismissed: false }))
        void refresh(existing.id)
        return { ok: true, existing: true }
      }
      return { ok: false, error: message(e, "AI에게 맡기지 못했어요") }
    }
  }, [page, choice, refresh, patch, readOk])

  const undo = useCallback(async (id: string, ref: string) => {
    try { await api(`/api/runs/${encodeURIComponent(id)}/undo`, { method: "POST", body: JSON.stringify({ ref }) }) }
    catch (e) { toast(message(e, "되돌리지 못했어요")) }
    await refresh(id)
  }, [refresh])
  const retry = useCallback(async (id: string) => {
    let next: Run | undefined
    try { next = await api<Run>(`/api/runs/${encodeURIComponent(id)}/retry`, { method: "POST" }) }
    catch (e) {
      next = e instanceof ApiError && e.status === 409 && e.body && typeof e.body === "object" && "run" in e.body ? (e.body as { run?: Run }).run : undefined
      if (!next) { toast(message(e, "다시 시도하지 못했어요")); return }
    }
    const nextId = next.id
    patch(id, (x) => ({ ...x, id: nextId, startedAt: next.created_at || Date.now() }))
    // 응답을 놓친 뒤 받은 다시 시도는 이미 끝났을 수 있으니, 계보 전체 결과를 서버에서 바로 다시 읽는다
    await refresh(nextId)
  }, [patch, refresh])
  const stop = useCallback(async (id: string) => {
    try { await api(`/api/runs/${encodeURIComponent(id)}/stop`, { method: "POST" }) } catch (e) { toast(message(e, "멈추지 못했어요")) }
    await refresh(id)
  }, [refresh])
  const dismiss = useCallback((id: string) => patch(id, (x) => ({ ...x, dismissed: true })), [patch])

  const phases = Object.fromEntries(entries.map((e) => [e.id, phaseOf(views[e.id]?.run)]))
  return { available: !!cat && readOk, entries, views, phases, start, undo, retry, stop, dismiss, issue, expanded, setExpanded }
}
