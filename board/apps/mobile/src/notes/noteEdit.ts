// 노트 편집 화면(NoteEditor)의 순수 부분: 저장 상태 → 안내 띠와 단추, 떠날 때 고를 것, 도구 줄 글 넣기. React 없이 시험해요(noteEdit.test.ts).
// 주인은 레인 2(로드맵 공용 부품 표), 레인 1 의 일 노트도 같이 써요.
import type { NoteState } from './noteSaver'

export type BannerAction = 'reload' | 'adopt' | 'saveMerged' | 'export'
export type Banner = { message: string; actions: BannerAction[] }

/** 편집 막힘·충돌·불명·합치기·오류일 때의 띠. 평소(clean·dirty·saving)에는 없음 */
export function noteBanner(s: NoteState): Banner | null {
  if (!s.editable) return { message: s.message ?? '웹 편집기의 서식 중 iOS 가 그대로 지킬 수 없는 것이 있어 편집을 막았어요. 웹에서 고쳐 주세요', actions: s.backups.length || s.draft !== s.base ? ['export'] : [] }
  if (s.status === 'conflict' || s.status === 'unknown') {
    const base = s.message ?? (s.status === 'conflict' ? '다른 곳에서 변경됐어요. 내 초안은 보존되어 있어요.' : '저장 결과를 확인하지 못했어요. 다시 보내지 않아요.')
    return { message: s.reloaded ? `${base} 서버 노트를 불러왔어요(버전 ${s.reloaded.version}). 내 초안을 내보낸 뒤 서버 노트를 채택하고 직접 합쳐 주세요.` : base, actions: s.reloaded ? ['export', 'adopt'] : ['export', 'reload'] }
  }
  if (s.status === 'merging') return { message: `서버 버전 ${s.version} 의 노트예요. 보관한 내 초안을 보며 직접 합친 뒤 저장해 주세요. 자동 저장은 멈춰 있어요.`, actions: ['saveMerged', 'export'] }
  if (s.status === 'error') return { message: s.message ?? '저장하지 못했어요', actions: ['export'] }
  return null
}

export function statusLine(s: NoteState): string {
  if (!s.editable) return '읽기 전용'
  switch (s.status) {
    case 'clean':
      return '저장됨'
    case 'dirty':
      return '저장 안 됨'
    case 'saving':
      return '저장 중…'
    case 'merging':
      return '합치는 중'
    default:
      return '자동 저장 멈춤'
  }
}

/**
 * 떠날 때: free(그냥), save(저장하고 나가기 / 머물기), stopped(멈춘 초안 — 기기에 두고 나가기·내보내기·머물기).
 * 기기 보관을 확인하지 못했으면 kept=false 라 "기기에 두고 나가기"를 주지 않아요(내보내기·버리기·머물기만).
 */
export function leaveChoice(s: NoteState | null, storageOk: boolean): { kind: 'free' } | { kind: 'save' | 'stopped'; kept: boolean } {
  if (!s) return { kind: 'free' }
  const unsaved = s.status !== 'clean' || s.backups.length > 0
  if (!unsaved) return { kind: 'free' }
  if (s.status === 'dirty' || s.status === 'saving') return { kind: 'save', kept: storageOk }
  return { kind: 'stopped', kept: storageOk }
}

export type Selection = { start: number; end: number }
/** 굵게·[[ ]] 처럼 고른 글을 감싸요. 고른 글이 없으면 표지만 넣고 커서를 가운데로 */
export function wrap(md: string, sel: Selection, open: string, close = open): { md: string; sel: Selection } {
  const inner = md.slice(sel.start, sel.end)
  const next = md.slice(0, sel.start) + open + inner + close + md.slice(sel.end)
  const at = sel.start + open.length
  return { md: next, sel: { start: at, end: at + inner.length } }
}
/** 제목·글머리·할 일처럼 줄 앞에 표지를 붙여요(이미 있으면 그대로) */
export function prefixLine(md: string, sel: Selection, prefix: string): { md: string; sel: Selection } {
  const lineStart = md.lastIndexOf('\n', sel.start - 1) + 1
  if (md.startsWith(prefix, lineStart)) return { md, sel }
  const next = md.slice(0, lineStart) + prefix + md.slice(lineStart)
  return { md: next, sel: { start: sel.start + prefix.length, end: sel.end + prefix.length } }
}
/** 커서 자리에 글을 넣어요(사진 링크 등). 줄 가운데면 앞뒤로 줄을 바꿔 그림 문단으로 */
export function insertBlock(md: string, sel: Selection, block: string): { md: string; sel: Selection } {
  const before = md.slice(0, sel.start)
  const after = md.slice(sel.end)
  const pre = before && !before.endsWith('\n') ? '\n\n' : ''
  const post = after && !after.startsWith('\n') ? '\n\n' : ''
  const next = before + pre + block + post + after
  const at = before.length + pre.length + block.length
  return { md: next, sel: { start: at, end: at } }
}
