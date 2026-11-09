import type { OpsReportCounts, OpsResponse, OpsRun } from "./api.ts"

// 순회 상태·결과를 사람 말로. 칩·팝오버·설정이 같이 써요

const pad = (n: number) => String(n).padStart(2, "0")
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/** 다음 순회 시각: 오늘이면 14:03, 내일이면 "내일 08:00", 그 뒤면 "11/9 08:00" */
export function whenLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const today = new Date(now)
  const tomorrow = new Date(now + 864e5)
  if (dayKey(d) === dayKey(today)) return hm(d)
  if (dayKey(d) === dayKey(tomorrow)) return `내일 ${hm(d)}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hm(d)}`
}

/** "사건 3 · 할 일 2 · 합침 1" (0 은 빼요). 다 0 이면 "올린 것 없음" */
export function countsLabel(c: OpsReportCounts): string {
  const parts = ([["사건", c.signals], ["할 일", c.cards], ["합침", c.merged], ["닫음", c.closed]] as const).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`)
  return parts.length ? parts.join(" · ") : "올린 것 없음"
}

const firstLine = (s: string | null | undefined) => (s || "").split("\n").find((l) => l.trim()) || ""
export const hasReportCounts = (c: OpsReportCounts): boolean => c.signals + c.cards + c.merged + c.closed > 0

/** 지난 순회 한 줄 요약과 강조 단계: 실제 올린 것이 있거나 도는 중일 때만 active, 보고 없음·올린 것 없음은 muted */
export function runLine(r: Pick<OpsRun, "status" | "report" | "error">): { text: string; tone: "error" | "active" | "muted" } {
  if (r.status === "error") return { text: r.report ? countsLabel(r.report.counts) : firstLine(r.error) || "실패했어요", tone: "error" }
  if (r.status === "running") return { text: r.report ? countsLabel(r.report.counts) : "돌아보는 중", tone: "active" }
  if (r.report) return { text: countsLabel(r.report.counts), tone: hasReportCounts(r.report.counts) ? "active" : "muted" }
  return { text: "보고 없음", tone: "muted" }
}

export type ChipState = { tone: "running" | "error" | "off" | "idle"; label: string }
/** 사이드바 칩 한 줄. 도는 중 > 마지막 실패 > 꺼짐 > 다음 시각 */
export function chipState(data: Pick<OpsResponse, "ops" | "runs" | "next_at">, now = Date.now()): ChipState {
  const last: OpsRun | undefined = data.runs[0]
  if (last?.status === "running") return { tone: "running", label: "순회 도는 중" }
  if (!data.ops.enabled) return { tone: "off", label: "순회 꺼짐" }
  const next = data.next_at ? `다음 ${whenLabel(data.next_at, now)}` : "활동 시간 없음"
  if (last?.status === "error") return { tone: "error", label: `순회 실패 · ${next}` }
  return { tone: "idle", label: `순회 · ${next}` }
}

export const STATUS_KO: Record<string, string> = { running: "도는 중", done: "끝남", error: "실패", stopped: "멈춤" }
