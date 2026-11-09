// 노트 끝에 새 글(대화 답·AI 초안)을 붙여도 되는지 앱 쪽 앞단 판정. 순수 함수라 bun 으로 시험해요(review12·noteInvariant.test.ts).
// 불변식(PR #39 리뷰 10~13): 넣은 뒤 저장 md 는 기존 md 로, 저장 HTML 은 기존 HTML 로 정확히 시작하고 새 글은 기존 요소 밖이에요 — 아니면 쓰기 0건으로 멈춰요.
// 늘 onceKey append 로 보내요(서버가 원본 md·HTML 을 그대로 두고 md 에는 가로줄(---), HTML 에는 <hr> 뒤에 붙여요).
// 최종 판정은 서버의 합성성 검사예요(docs/append-safe.ts — 렌더가 경계에서 나뉘어 합쳐지는지, 기존 HTML·md 렌더가 엄격 노트 모델 안인지, 아니면 422 unsafe-append).
// 앱은 HTML 문법을 쫓지 않는 보수적 허용 목록만 둬요: 닫히지 않은 코드 펜스가 있거나, 펜스·인라인 코드 밖 md 에 "<" 가 하나라도 있으면(이스케이프 여부 무관) 멈춰요.
// HTML 쪽은 서버 판정에 맡기고, 서버의 422 는 쓰기 0건 안내로 보여요(결과 불명 아님).
export type NotePlan = { kind: 'append' } | { kind: 'stop'; reason: string }

const FENCE = /^ {0,3}(\u0060{3,}|~{3,})(.*)$/
/** 펜스 밖 글(줄 목록)과 끝까지 닫히지 않은 펜스가 있는지 */
function outsideFences(md: string): { text: string[]; open: boolean } {
  const text: string[] = []
  let open: { ch: string; len: number } | null = null
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const m = FENCE.exec(line)
    const run = m?.[1] ?? ''
    if (open) {
      if (m && run.charAt(0) === open.ch && run.length >= open.len && !(m[2] ?? '').trim()) open = null
      continue
    }
    if (m && !(run.charAt(0) === '\u0060' && (m[2] ?? '').includes('\u0060'))) {
      open = { ch: run.charAt(0), len: run.length }
      continue
    }
    text.push(line)
  }
  return { text, open: !!open }
}
const INLINE_CODE = /(\u0060+)[^\u0060]*?\1/g
/** 펜스·인라인 코드 밖에 "<" 가 있는지(태그·주석·자동 링크·이스케이프 무엇이든) */
export function mdHasAngle(md: string): boolean {
  return outsideFences(md).text.join('\n').replace(INLINE_CODE, '').includes('<')
}
export const mdOpenFence = (md: string) => outsideFences(md).open

const STOP_FENCE = '노트 끝에 닫히지 않은 코드 블록이 있어 넣지 않았어요 · 웹에서 블록을 닫은 뒤 다시 넣어 주세요'
const STOP_ANGLE = '노트에 HTML 일 수 있는 글자(<)가 있어 앱에서는 넣지 않았어요 · 웹에서 넣어 주세요'
/** 붙일지 멈출지(html 은 서버가 판정해요) */
export function planNoteAdd(md: string): NotePlan {
  if (mdOpenFence(md)) return { kind: 'stop', reason: STOP_FENCE }
  if (mdHasAngle(md)) return { kind: 'stop', reason: STOP_ANGLE }
  return { kind: 'append' }
}
/** 서버의 최종 판정 거절(422 unsafe-append, 쓰기 0건) */
export const unsafeAppend = (e: unknown) => !!e && typeof e === 'object' && (e as { status?: unknown }).status === 422 && String((e as { message?: unknown }).message ?? '').startsWith('unsafe-append')
export const UNSAFE_APPEND_TEXT = '이 노트는 서버가 안전하게 붙일 수 있는 모양이 아니라 넣지 않았어요(아무것도 바뀌지 않았어요) · 웹에서 넣어 주세요'
