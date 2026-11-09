import { useCallback, useEffect, useSyncExternalStore } from "react"
import type { OpsResponse, OpsSettings } from "@direction-board/contracts/api"
import { api, ApiError } from "@/lib/api"

// 운영 순회 상태 하나를 사이드바 칩과 설정 › 운영 순회가 함께 읽어요. 폴러는 하나:
// 구독자가 없으면 멈추고, 설정이 열려 있으면 전체(full), 칩만 있으면 가벼운 모양(?lite=1).
// 도는 중이면 4초, 아니면 30초. 탭이 숨으면 멈추고 다시 보이면 바로 읽어요. 403(맥 주인 아님)이면 멈춰요.
export type OpsStatus = "loading" | "ok" | "error" | "forbidden"
export type OpsSnapshot = { data: OpsResponse | null; status: OpsStatus; full: boolean }
type Sub = { full: boolean; cb: () => void }

const subs = new Set<Sub>()
let snap: OpsSnapshot = { data: null, status: "loading", full: false }
let timer: ReturnType<typeof setTimeout> | undefined
let inflight: Promise<void> | null = null
let again = false
/** 쓰기가 시작·끝날 때 올려요. 그 사이 시작한 읽기는 버려요(늦게 온 옛 값이 방금 쓴 값을 덮지 않게) */
let writeEpoch = 0
let writing = 0

const emit = (next: Partial<OpsSnapshot>) => {
  snap = { ...snap, ...next }
  for (const s of subs) s.cb()
}
const wantFull = () => [...subs].some((s) => s.full)
const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden"

function schedule() {
  clearTimeout(timer)
  if (!subs.size || hidden() || snap.status === "forbidden") return
  const running = snap.data?.runs.some((r) => r.status === "running")
  timer = setTimeout(() => void refreshOps(), running ? 4000 : 30000)
}

async function once() {
  const full = wantFull()
  const epoch = writeEpoch
  try {
    const data = await api<OpsResponse>(full ? "/api/ops" : "/api/ops?lite=1")
    // 쓰는 중이면 버리고 기다려요(쓰기가 끝나면 putOps 가 다시 읽어요). 쓰기가 막 끝났으면 한 번만 더 읽어요
    if (writing) return
    if (epoch !== writeEpoch) { again = true; return }
    // 설정이 전체를 읽은 뒤 칩의 가벼운 응답이 지시문 초안을 지우지 않게
    emit({ data: full || !snap.data ? data : { ...snap.data, ...data, default_text: snap.data.default_text ?? data.default_text }, status: "ok", full })
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) emit({ status: "forbidden" })
    else if (epoch === writeEpoch && !writing) emit({ status: "error" })
  }
}

/** 지금 읽기. 읽는 중이면 끝난 뒤 한 번 더 */
export function refreshOps(): Promise<void> {
  if (inflight) { again = true; return inflight }
  clearTimeout(timer)
  inflight = (async () => {
    try {
      do { again = false; await once() } while (again && subs.size)
    } finally {
      inflight = null
      schedule()
    }
  })()
  return inflight
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!hidden() && subs.size && snap.status !== "forbidden") void refreshOps()
    else schedule()
  })
}

function subscribe(sub: Sub) {
  subs.add(sub)
  // 처음 구독이거나, 전체가 필요한데 가벼운 것만 있으면 바로 읽어요
  if (subs.size === 1 || (sub.full && !snap.full)) void refreshOps()
  return () => {
    subs.delete(sub)
    if (!subs.size) clearTimeout(timer)
  }
}

export function useOps(full = false): OpsSnapshot {
  const sub = useCallback((cb: () => void) => subscribe({ full, cb }), [full])
  const value = useSyncExternalStore(sub, () => snap, () => snap)
  // 맥 주인 확인이 바뀌었을 수 있으니(다시 로그인) 설정을 열 때는 403 이어도 한 번 더 읽어요
  useEffect(() => { if (full && snap.status === "forbidden") { snap = { ...snap, status: "loading" }; void refreshOps() } }, [full])
  return value
}

/** 쓰기 하나. 성공하면 받은 설정을 바로 반영하고 다시 읽어요. 409 면 서버의 지금 설정을 담은 ApiError */
export async function putOps(patch: Partial<OpsSettings> & { base_rev?: number }): Promise<OpsSettings> {
  writeEpoch++
  writing++
  try {
    const r = await api<{ ops: OpsSettings }>("/api/ops", { method: "PUT", body: JSON.stringify(patch) })
    const ops = { ...r.ops, enabled: !!r.ops.enabled }
    if (snap.data) emit({ data: { ...snap.data, ops } })
    return ops
  } finally {
    writeEpoch++
    writing--
    void refreshOps()
  }
}

/** 지금 순회 돌리기. 실패하면 서버가 준 이유(이미 도는 중 등)를 담은 ApiError */
export async function runSweepNow() {
  try {
    return await api<{ id: string }>("/api/ops/run", { method: "POST" })
  } finally {
    await refreshOps()
  }
}

export async function stopSweep(id: string) {
  try {
    await api(`/api/runs/${encodeURIComponent(id)}/stop`, { method: "POST" })
  } finally {
    await refreshOps()
  }
}

/** 순회 대화(실행 기록과 마지막 답)를 AI 명령창의 결과 창으로 열어요. 홈에서 대화 결과를 여는 길과 같아요 */
export function openRunThread(runId: string) {
  window.dispatchEvent(new CustomEvent("dock:open", { detail: { thread: runId } }))
}

/** 저장하지 않은 지시문 고침이 있으면(설정 › 운영 순회 편집기, 이 탭) 순회 전에 물어요. 순회는 저장된 지시문으로 돌아요 */
export function confirmUnsavedPrompt(): boolean {
  let draft = false
  try { draft = !!sessionStorage.getItem("db:ops-draft") } catch { /* 저장소를 못 읽으면 묻지 않아요 */ }
  return !draft || window.confirm("저장하지 않은 지시문 고침이 있어요. 이번 순회는 저장된 지시문으로 돌아요. 그래도 돌릴까요?")
}
