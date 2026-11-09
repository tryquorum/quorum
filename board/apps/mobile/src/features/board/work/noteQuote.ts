// 일 상세의 노트·대화 잇기(웹 work-view.tsx toNote·askAbout·makeWork 와 같은 규칙). 순수 함수라 bun 으로 시험해요.
import type { Run } from '@direction-board/contracts'
import { ScopeChangedError, UnknownWriteError } from '../../../api/client'
import type { Block, Inline } from '../../../notes/markdown'

/** 대화 답 하나를 노트 끝에 붙일 마크다운(웹은 <h3>질문 첫 줄</h3> + 답) */
export function answerToNote(run: Pick<Run, 'prompt' | 'output'>): { md: string } | null {
  const out = run.output.trim()
  if (!out) return null
  const heading = (run.prompt.split('\n')[0] ?? '').replace(/^\s*#+\s*/, '').replace(/\s*#+\s*$/, '').trim().slice(0, 60)
  return { md: heading ? `### ${heading}\n\n${out}` : out }
}

const inlineText = (nodes: Inline[]): string =>
  nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
        case 'code':
          return n.v
        case 'br':
          return '\n'
        case 'wiki':
          return n.label
        case 'img':
          return n.alt
        default:
          return inlineText(n.c)
      }
    })
    .join('')

function blockText(b: Block, depth = 0): string {
  switch (b.t) {
    case 'h':
    case 'p':
      return inlineText(b.c).trim()
    case 'code':
      return b.v
    case 'hr':
      return ''
    case 'quote':
      return b.blocks.map((x) => blockText(x, depth)).filter(Boolean).join('\n')
    case 'list':
      return b.items
        .map((item, i) => {
          const mark = (b.ordered ? `${b.start + i}.` : '-') + (item.checked === null ? '' : item.checked ? ' [x]' : ' [ ]')
          const [first, ...rest] = item.blocks
          const head = `${'  '.repeat(depth)}${mark} ${first && first.t !== 'list' ? blockText(first, depth + 1) : ''}`.trimEnd()
          const tail = (first && first.t === 'list' ? [first, ...rest] : rest).map((x) => (x.t === 'list' ? blockText(x, depth + 1) : `${'  '.repeat(depth + 1)}${blockText(x, depth + 1)}`))
          return [head, ...tail].filter((l) => l.trim()).join('\n')
        })
        .join('\n')
  }
}

/** 노트의 맨 위 블록을 고를 수 있는 글로(빈 블록·가로줄은 빼요) */
export const noteBlocks = (blocks: Block[]) => blocks.map((b) => blockText(b)).filter((t) => t.trim())

/** 고른 블록을 노트 순서대로 이어 인용 글로 */
export const quoteOf = (blocks: string[], picked: Set<number>) => blocks.filter((_, i) => picked.has(i)).join('\n')

/** 고른 부분으로 만들 새 일(웹 makeWork): 첫 줄이 제목(200자), 제목보다 길면 본문(4000자) */
export function workFromQuote(sel: string, parentTitle: string) {
  const title = (sel.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return {
    source: 'note',
    kind: 'info',
    lane: 'main',
    title,
    reason: `「${parentTitle.slice(0, 60)}」 노트에서 만든 일`,
    body: sel.length > title.length ? sel.slice(0, 4000) : null,
  }
}

/** 쓰기 하나의 결과: 됨 / 서버가 거절함 / 결과를 모름(응답 유실 등, 실제로는 됐을 수 있음) / 범위(서버·로그인)가 바뀌어 보내지 않음 */
export type Outcome = 'ok' | 'failed' | 'unknown' | 'scope'
export const outcomeOf = (e: unknown): Outcome => (e instanceof ScopeChangedError ? 'scope' : e instanceof UnknownWriteError ? 'unknown' : 'failed')

/** 새 일 만들기 알림: 만든 것은 성공으로, 연결·초안이 실패했거나 결과를 모르거나 범위가 바뀌어 보내지 않았으면 무엇이고 어디서 확인·다시 하는지 */
export const makeWorkNotice = (r: { linked: Outcome; drafted: Outcome }) =>
  [
    '새 일로 만들었어요',
    r.linked === 'failed' ? '이 일과 잇지 못했어요(연결 갈래에서 다시 이어 주세요)' : r.linked === 'unknown' ? '이 일과 이어졌는지 확인하지 못했어요(연결 갈래에서 확인해 주세요)' : r.linked === 'scope' ? '로그인이 바뀌어 잇기는 하지 않았어요(원래 계정에서 연결 갈래로 이어 주세요)' : null,
    r.drafted === 'ok' ? 'AI가 노트 초안을 쓰는 중' : r.drafted === 'failed' ? 'AI 초안을 시작하지 못했어요(새 일에서 ✦ AI로 초안 쓰기)' : r.drafted === 'scope' ? '로그인이 바뀌어 AI 초안은 시작하지 않았어요' : 'AI 초안이 시작됐는지 확인하지 못했어요(새 일 노트에서 확인한 뒤 필요하면 ✦ AI로 초안 쓰기)',
  ]
    .filter(Boolean)
    .join(' · ')
