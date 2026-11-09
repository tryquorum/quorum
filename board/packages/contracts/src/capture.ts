// AI로 할 일 추가(capture): 웹·iOS 화면이 함께 쓰는 순수 함수. 서버 계약은 packages/contracts(CaptureHints·CaptureEffect).
import { normTitle } from "./text.ts"
import type { CaptureEffect, CaptureEffectOp, CaptureHints, Run, Signal } from "./api.ts"
import { filledProps, type Draft, type QuickArea } from "./quick-add.ts"

/** 브라우저에 남겨 두는 AI 정리 한 건: 새로고침·페이지 이동 뒤에도 칩을 되살리고, 실패하면 초안 전체로 다시 쓰게 한다 */
export type CaptureEntry = {
  id: string; clientKey: string; text: string; draft: Draft | null; startedAt: number; dismissed?: boolean
  /** 실행이 끝났다고(성공·실패·멈춤·사라짐) 확인함. 개수 제한은 이것만 정리해요 — 닫기(dismissed)는 숨기기일 뿐이에요(iOS 리뷰 9) */
  ended?: boolean
  /** 보낸 힌트. 시작 응답을 잃어 보냈는지 모르는 칩(iOS, id 가 "unsent:")을 같은 clientKey·같은 본문으로 다시 확인할 때 써요 */
  hints?: CaptureHints
  /** 시작 범위(iOS: 서버 주소 + 로그인 주체). 보냈는지 모르는 칩의 "다시 확인"은 이 범위에서만 */
  scope?: string
}
export type Phase = "running" | "done" | "failed"
/** 웹 localStorage 또는 iOS 의 기기 파일을 메모리에 올린 저장소 */
export type StorageLike = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }

export const CAPTURE_STORE = "db:captures"
/** 시작 응답을 잃어 보냈는지 모르는 칩의 id 머리(iOS). id 는 늘 이 머리 + clientKey */
export const UNSENT = "unsent:"
const KEEP = 10

/** 제목과 노트를 AI에게 보낼 원문 하나로 */
export const captureText = (title: string, note: string) => [title.trim(), note.trim()].filter(Boolean).join("\n\n")

/** 시트·한 줄에서 사람이 고른 것을 힌트로. 영역은 이름으로 보낸다(AI가 /api/act 에 이름으로 쓴다) */
export function captureHints(d: Pick<Draft, "kind" | "at" | "areaId" | "tags" | "props">, areas: QuickArea[]): CaptureHints | undefined {
  const h: CaptureHints = {}
  const area = areas.find((a) => a.id === d.areaId)
  if (area) h.area = area.name
  if (d.at) h.at = d.kind === "goal" ? d.at.slice(0, 10) : d.at
  if (d.tags.length) h.tags = d.tags
  if (d.kind === "goal") h.type = "goal"
  const props = filledProps(d.props).map((p) => ({ key: p.key.trim(), type: p.type, value: p.value.trim() }))
  if (props.length) h.props = props
  return Object.keys(h).length ? h : undefined
}

export const phaseOf = (run: Pick<Run, "status"> | null | undefined): Phase => (!run || run.status === "running" ? "running" : run.status === "done" ? "done" : "failed")

/** 지금 도는 같은 글(정규화)이 있으면 그 항목. 화면에서 같은 글을 두 번 보내지 않게 */
export function activeSame(entries: CaptureEntry[], phases: Record<string, Phase | undefined>, text: string): CaptureEntry | null {
  const key = normTitle(text)
  if (!key) return null
  return entries.find((e) => !e.dismissed && (phases[e.id] ?? "running") === "running" && normTitle(e.text) === key) ?? null
}

export const OP_LABEL: Record<CaptureEffectOp, string> = { created: "새로", merged: "기존에 추가", updated: "고침", decision: "결정" }

/** 결과 머리말: "할 일 2개를 올렸어요 · 결정 1개" */
export function summarize(effects: CaptureEffect[]): string {
  const live = effects.filter((e) => !e.undone)
  const n = (op: CaptureEffectOp) => live.filter((e) => e.op === op).length
  const parts = [n("created") && `새로 ${n("created")}개`, n("merged") + n("updated") && `기존 일 ${n("merged") + n("updated")}개에 추가`, n("decision") && `결정 ${n("decision")}개`].filter(Boolean)
  return parts.length ? `AI가 올렸어요 · ${parts.join(" · ")}` : "AI가 올린 항목이 없어요"
}

/** 실패 종류별 한 줄(서버 run-errors.ts 의 뜻과 같게, 짧게) */
const FAILED: Record<string, string> = {
  interrupted: "서버가 다시 시작돼서 멈췄어요", aside_offline: "Aside 브라우저가 꺼져 있어요", launch: "Aside 를 실행하지 못했어요",
  auth: "Aside 로그인이 풀렸어요", rate_limit: "사용 한도에 걸렸어요", model: "고른 모델을 쓸 수 없어요", network: "연결이 끊겼어요",
}
export const failureText = (run: Pick<Run, "status" | "error_kind">) => (run.status === "stopped" ? "멈췄어요" : FAILED[run.error_kind ?? ""] ?? "AI가 정리하지 못했어요")
/** 실패 종류를 모를 때 보여 줄 진단 한 줄: 비어 있지 않은 마지막 줄, 120자 */
export const lastLine = (error: string | null | undefined) => (error ?? "").split("\n").map((l) => l.trim()).filter(Boolean).at(-1)?.slice(0, 120) ?? ""

/** 트레이에 기본으로 보이는 실패·결과 줄 수. 트레이와 홈이 같은 값을 써요 */
export const SHOWN = 3
/** 트레이에 지금 보이는 항목: 닫지 않은 것 중 최근 것부터, 접혀 있으면 SHOWN 개 */
export function visibleEntries(entries: CaptureEntry[], expanded: boolean): CaptureEntry[] {
  const live = entries.filter((e) => !e.dismissed).reverse()
  return expanded ? live : live.slice(0, SHOWN)
}
/** 대화에서 마지막으로 끝난 실행 id(사건은 이 실행의 결과로 갱신돼요) */
export function lastFinishedRun(runs: Pick<Run, "id" | "finished_at" | "created_at">[]): string | null {
  const done = runs.filter((r) => typeof r.finished_at === "number")
  done.sort((a, b) => (a.finished_at ?? 0) - (b.finished_at ?? 0) || a.created_at - b.created_at)
  return done.at(-1)?.id ?? null
}
/**
 * 트레이에 보이는 AI 정리 실패와 같은 결정 칸 사건(같은 실패를 두 곳에 띄우지 않기).
 * 같은 대화(run:<thread>)에서 마지막으로 끝난 실행이 트레이의 실패한 실행일 때만 숨겨요. 모르면 보여요.
 */
export function hiddenFailures(signals: Pick<Signal, "id" | "kind" | "ref">[], shown: { run: Pick<Run, "id" | "thread" | "status"> | undefined }[], lastFinished: Record<string, string | null | undefined>): Set<string> {
  const refs = new Set<string>()
  for (const { run } of shown) {
    if (!run || run.status !== "error") continue
    const thread = run.thread || run.id
    if (lastFinished[thread] === run.id) refs.add(`run:${thread}`)
  }
  return new Set(signals.filter((s) => s.kind === "error" && !!s.ref && refs.has(s.ref)).map((s) => s.id))
}

/** 홈 결정 칸과 사이드바 "홈" 배지가 함께 쓰는 열린 결정(now + decide) 개수. 트레이에 이미 보이는 AI 정리 실패(hidden)는 뺀다 */
export function openDecideCount(signals: readonly Pick<Signal, "id" | "lane" | "status">[], hidden?: ReadonlySet<string>): number {
  return signals.filter((s) => (s.lane === "decide" || s.lane === "now") && s.status === "open" && !hidden?.has(s.id)).length
}

/**
 * 칩 기록 하나의 모양 검사(iOS 는 저장 파일의 모든 항목이 지나야 읽어요 — 하나라도 깨지면 막고 안내).
 * 빈 id, 키가 비었거나 id 와 맞지 않는 보냈는지 모르는 칩, 모양이 틀린 초안·힌트·표시·범위는 깨짐(iOS 리뷰 9)
 */
export const isCaptureEntry = (x: unknown): x is CaptureEntry => {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false
  const e = x as Record<string, unknown>
  if (typeof e.id !== "string" || !e.id || typeof e.clientKey !== "string" || typeof e.text !== "string" || typeof e.startedAt !== "number") return false
  if (e.id.startsWith(UNSENT) && (!e.clientKey || e.id !== UNSENT + e.clientKey)) return false
  const d = e.draft as Record<string, unknown> | null | undefined
  if (d !== null && d !== undefined && (typeof d !== "object" || Array.isArray(d) || typeof d.boardId !== "string" || typeof d.title !== "string")) return false
  if (e.hints !== undefined && (!e.hints || typeof e.hints !== "object" || Array.isArray(e.hints))) return false
  if ((e.dismissed !== undefined && typeof e.dismissed !== "boolean") || (e.ended !== undefined && typeof e.ended !== "boolean")) return false
  return e.scope === undefined || typeof e.scope === "string"
}
const isEntry = isCaptureEntry
/**
 * 개수 제한(KEEP): 끝난 칩(finished)만 오래된 것부터 정리해요. 보냈는지 모르는 칩·진행 중 칩은 개수와 상관없이 남겨요
 * (결과를 모르는 기록을 지우면 같은 키로 다시 확인할 길이 사라져요, iOS 리뷰 8)
 */
export function trimCaptures(entries: CaptureEntry[], finished: (e: CaptureEntry) => boolean, keep = KEEP): CaptureEntry[] {
  let extra = entries.length - keep
  if (extra <= 0) return entries
  return entries.filter((e) => (extra > 0 && finished(e) ? (extra--, false) : true))
}
/**
 * 웹 칩 목록 읽기(규칙 E, 리뷰 22): 못 읽음(read)·깨짐(corrupt)을 "칩 없음"과 나눠요. 항목 하나라도 칩 모양이 아니면 깨짐 —
 * 걸러 내고 저장하면 결과를 모르는 칩의 키가 사라져요(iOS 와 같은 규칙)
 */
export type CapturesRead = { ok: true; entries: CaptureEntry[] } | { ok: false; problem: "read" | "corrupt" }
export function readCaptures(storage: StorageLike): CapturesRead {
  let raw: string | null
  try { raw = storage.getItem(CAPTURE_STORE) } catch { return { ok: false, problem: "read" } }
  if (raw === null) return { ok: true, entries: [] }
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) && v.every(isEntry) ? { ok: true, entries: v } : { ok: false, problem: "corrupt" }
  } catch { return { ok: false, problem: "corrupt" } }
}
/** 최근 KEEP 개만 남긴다. 저장 못 하면 false(이번 탭에서는 계속 보인다) */
export function saveCaptures(storage: StorageLike, entries: CaptureEntry[]): boolean {
  try { storage.setItem(CAPTURE_STORE, JSON.stringify(entries.slice(-KEEP))); return true } catch { return false }
}
/**
 * 깨진 칩 목록을 버릴 때 나누기(PR #43 리뷰): 배열이면 성한 칩은 남기고 깨진 칩만 버려요(칩 하나의 깨짐이 다른 칩에 닿지 않게).
 * 배열이 아니면 null — 화면은 확인창에 칩이 모두 버려진다고 밝혀요(slot-store recordsDiscardText)
 */
export function splitCaptures(v: unknown): { keep: CaptureEntry[]; dropped: number; kept: number } | null {
  if (!Array.isArray(v)) return null
  const keep = v.filter(isEntry)
  return { keep, dropped: v.length - keep.length, kept: keep.length }
}
