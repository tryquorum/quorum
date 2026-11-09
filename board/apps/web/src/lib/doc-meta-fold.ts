// 문서 속성 절을 접을지 판단하고 접힌 요약 글을 만들어요. 사람이 쓴 값·오류가 접힌 칸에 숨지 않게 하는 규칙이 여기 있어요.
import type { DocProp } from "@/lib/docs-api"
import { koDateLabel } from "@/lib/ko-date"

export type MetaFoldState = {
  unreadable: boolean
  error: string
  conflict: unknown
  blocked: boolean
  busy: boolean
  storageError: boolean
  draftKeys: number
  newKey: string
  basicChanged: boolean
}

/** 저장 안 된 값·오류·저장 중 하나라도(복원한 초안은 그 값이 영역·속성 초안 등으로 드러나서 따로 보지 않아요) 있으면 속성 표를 접으면 안 돼요 */
export function metaAtRisk(s: MetaFoldState): boolean {
  return s.unreadable || !!s.error || !!s.conflict || s.blocked || s.busy || s.storageError || s.draftKeys > 0 || !!s.newKey.trim() || s.basicChanged
}

const STATUS: Record<string, string> = { open: "열림", done: "끝남", archived: "보관" }

/** 접힌 요약 칸들: 영역 · 상태 · 날짜 · 속성 n (값 없는 칸은 빼요) */
export function metaSummary(m: { area: string; status: string; due: string; props: DocProp[] }): string[] {
  return [m.area, STATUS[m.status] ?? m.status, koDateLabel(m.due), m.props.length ? `속성 ${m.props.length}` : ""].filter(Boolean)
}
