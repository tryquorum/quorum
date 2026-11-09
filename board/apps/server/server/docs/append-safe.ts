// onceKey append 의 최종 판정(PR #39 리뷰 13) — 합성성 검사. 개수·순번·태그 스택으로 새 구분선을 찾지 않아요.
// (a) 기존 md 의 블록 문맥이 경계에서 닫혀 있어야 해요: 저장될 md 의 렌더가 "기존 md 렌더 + 덧붙인 꼬리(구분 + 새 글)의 렌더" 와 정확히 같을 때만.
//     펜스·HTML 블록·이스케이프 무엇이든 경계를 넘어 새 글을 삼키면 렌더가 달라져요. 비교는 서버 md 렌더러(mdToNoteHtml)의 바탕 렌더(Bun.markdown.html)로 해요 —
//     mdToNoteHtml 의 할 일 목록 후처리는 블록 경계를 바꾸지 않고 공백만 다시 써서, 그대로 비교하면 체크리스트 노트가 늘 어긋나요.
// (b) HTML 은 기존 HTML 이 서버의 엄격 노트 모델(markdownEditable 판정이 쓰는 noteModel)을 통과할 때만 그 뒤에 붙여요(모델 밖 HTML 이면 멈춤).
// (c) md 렌더(mdToNoteHtml)도 같은 모델이어야 해요: 인라인 원시 HTML(이스케이프되지 않은 <pre> 등)은 md 렌더가 경계에서 나뉘어도 HTML 트리에서는 뒤 글을 삼키기 때문이에요.
// 하나라도 아니면 document.ts 가 422 unsafe-append·쓰기 0건. 모델 밖 노트에서 멈추는 것은 오탐이라도 받아들여요(사람 글 보존이 먼저).
import { noteModel } from './note-model.ts'

export function appendComposes(a: { mdBefore: string; mdAfter: string; htmlBefore: string; base: (md: string) => string; render: (md: string) => string }): boolean {
  if (!a.mdAfter.startsWith(a.mdBefore)) return false
  if (a.base(a.mdAfter) !== a.base(a.mdBefore) + a.base(a.mdAfter.slice(a.mdBefore.length))) return false
  return noteModel(a.htmlBefore) !== null && noteModel(a.render(a.mdBefore)) !== null
}
