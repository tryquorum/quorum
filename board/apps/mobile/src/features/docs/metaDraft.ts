// 문서 속성(제목·영역·상태·날짜·사용자 속성) 편집의 순수 부분: 종류별로 고칠 수 있는 칸, 접힌 요약 줄, 접으면 안 되는 상태, 보관한 입력 복원.
// 웹 document-metadata.tsx·doc-meta-fold.ts 와 같은 규칙이고, 권한 원본은 서버 apps/server/server/docs/meta.ts 예요.
import type { DocProp } from '@direction-board/contracts'
import { statusLabel } from './labels'

export type FieldRules = { title: boolean; area: boolean; due: boolean; status: boolean; props: boolean; dueWithTime: boolean; titleHint?: string }
/** 000_plan.md "종류별로 고칠 수 있는 것" 표 그대로 */
export function fieldRules(kind: string, status: string): FieldRules {
  const archived = status === 'archived'
  const basic = !archived && ['doc', 'todo', 'goal'].includes(kind)
  const title = !archived && ['doc', 'todo', 'goal', 'signal'].includes(kind)
  return {
    title,
    area: basic,
    due: basic,
    status: !archived,
    props: true,
    dueWithTime: kind === 'todo',
    titleHint: kind === 'run' ? '대화 제목은 첫 질문이라 바꿀 수 없어요' : archived ? '보관된 문서는 복원한 뒤 제목을 바꿀 수 있어요' : undefined,
  }
}

export type MetaInputs = { title: string; area: string; status: string; due: string; propDrafts: Record<string, string>; newKey: string }
export type MetaGuard = { busy: boolean; blocked: boolean; conflict: boolean; error: string; storageError: boolean }
/** 저장 안 된 값·오류·저장 중이면 속성 절을 접을 수 없어요(웹 metaAtRisk). base 는 서버가 확인한 값 */
export function metaAtRisk(inputs: MetaInputs, base: { title: string; area: string; status: string; due: string }, g: MetaGuard, titleFocused: boolean): boolean {
  const basicChanged = (!titleFocused && inputs.title.trim() !== base.title) || inputs.area !== base.area || inputs.status !== base.status || inputs.due !== base.due
  return !!g.error || g.conflict || g.blocked || g.busy || g.storageError || Object.keys(inputs.propDrafts).length > 0 || !!inputs.newKey.trim() || basicChanged
}
export function riskText(g: MetaGuard): string {
  return g.busy ? '저장하는 중이에요' : g.error || g.conflict || g.blocked || g.storageError ? '속성 저장을 확인해 주세요' : '저장 안 된 변경이 있어요'
}
/** 접힌 요약: 영역 · 상태 · 날짜 · 속성 n (값 없는 칸은 빼요) */
export function metaSummary(m: { area: string; status: string; due: string; props: DocProp[] }): string {
  return [m.area, statusLabel(m.status), m.due ? m.due.replace('T', ' ') : '', m.props.length ? `속성 ${m.props.length}` : ''].filter(Boolean).join(' · ') || '속성'
}

/** 기기에 보관한 속성 입력(저장 중·막힘이던 것). 다시 열면 막힌 상태로 돌아와 서버를 확인하게 해요 */
export type SavedMeta = { version: number; inputs: MetaInputs; blocked: boolean; conflict: boolean }
export function restoreMeta(saved: SavedMeta | null): { inputs: MetaInputs; version: number; guard: Partial<MetaGuard> } | null {
  if (!saved || typeof saved.version !== 'number' || !saved.inputs || typeof saved.inputs.title !== 'string') return null
  return {
    inputs: { ...saved.inputs, propDrafts: saved.inputs.propDrafts ?? {}, newKey: saved.inputs.newKey ?? '' },
    version: saved.version,
    guard: saved.blocked || saved.conflict ? { blocked: true, conflict: saved.conflict, error: '이전에 저장을 확인하지 못해 입력값을 보관했어요. 서버 상태를 확인해 주세요.' } : {},
  }
}
