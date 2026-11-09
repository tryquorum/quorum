// AI 대화 화면의 순수 규칙(웹 command-dock·chat-pane 과 같은 판단). 화면은 Thread.tsx·Chat.tsx.
import type { Run } from '@direction-board/contracts'
import type { ModelChoice } from '@direction-board/contracts/models'
import type { ContinueRun, NewRun, RunPage } from '../../api/runs'

/** 이어 물을 수 있는 대화: 마지막 턴이 세션을 만들었고, 돌고 있지 않고, 대화(chat)로 시작했어요(웹 command-dock 과 같음) */
export function continuable(runs: Run[]): Run | null {
  const last = runs[runs.length - 1]
  if (!last || !last.session_id || last.status === 'running') return null
  return (runs[0]?.kind ?? 'chat') === 'chat' ? last : null
}

/** 노트에서 고른 부분을 붙인 첫 질문(웹 chat-pane 과 같은 형식). 질문이 비면 "이 부분을 설명해줘" */
export function quotedPrompt(question: string, quote: string | null | undefined): string {
  const q = question.trim()
  if (!quote) return q
  return `${q || '이 부분을 설명해줘'}\n\n노트에서 고른 부분:\n${quote.split('\n').map((l) => `> ${l}`).join('\n')}`
}

/**
 * 보낼 본문. 이어 묻기면 마지막 턴을 부모로(모델은 서버가 부모 것을 써요), 새 대화면 고른 모델.
 * target 은 "이 일과 함께 보내기"를 켰을 때만(웹: 칩을 켜야 target, page.work 는 늘 화면 문맥).
 */
export function runBody(input: {
  prompt: string
  page?: RunPage
  last: Run | null
  choice: ModelChoice | null
  target: string | null
}): NewRun | ContinueRun | null {
  const { prompt, page, last, choice, target } = input
  if (!prompt.trim()) return null
  const base = page ? { prompt, page } : { prompt }
  if (last) return { ...base, target: last.target, parent: last.id, provider: last.provider, model: last.model, effort: last.effort ?? choice?.effort ?? 'high' }
  if (!choice) return null
  return { ...base, target, provider: choice.provider, model: choice.model, effort: choice.effort }
}

/** 보낸 뒤 입력칸: 보낸 글이 그대로면 비우고, 그사이 더 썼으면 남겨요 */
export const afterSend = (current: string, sent: string) => (current === sent ? '' : current)

/** 그 일(target)의 실행을 대화로 묶어요(AI 정리 초안은 빼고, 최근 대화 먼저). 웹 chat-pane useThreads 와 같음 */
export type TargetThread = { id: string; title: string; model: string; running: boolean; updated: number; status: Run['status']; count: number }
export function groupThreads(runs: Run[]): TargetThread[] {
  const m = new Map<string, TargetThread>()
  for (const r of [...runs].sort((a, b) => a.created_at - b.created_at)) {
    if (r.kind === 'draft') continue
    const k = r.thread || r.id
    const t = m.get(k) ?? { id: k, title: r.prompt.split('\n')[0].slice(0, 60), model: r.model_name || r.model, running: false, updated: 0, status: r.status, count: 0 }
    t.running ||= r.status === 'running'
    t.updated = Math.max(t.updated, r.finished_at || r.created_at)
    t.status = r.status
    t.count++
    m.set(k, t)
  }
  return [...m.values()].sort((a, b) => b.updated - a.updated)
}

const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const cellsOf = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

/**
 * 앱 마크다운 읽기(notes/NoteView)에는 표가 없어요. 폰 폭에서 열을 맞추기도 어려워서, AI 답의 GFM 표는 줄마다 한 항목으로 바꿔요:
 * "- **첫 칸** — 머리 값 · 머리 값". 코드 펜스 안은 건드리지 않아요.
 */
export function tablesAsList(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const f = line.match(FENCE)
    if (f) {
      const mark = f[1]?.[0] ?? '`'
      fence = fence === null ? mark : fence === mark ? null : fence
      out.push(line)
      continue
    }
    if (fence === null && TABLE_ROW.test(line) && TABLE_SEP.test(lines[i + 1] ?? '')) {
      const head = cellsOf(line)
      let j = i + 2
      for (; j < lines.length && TABLE_ROW.test(lines[j] ?? ''); j++) {
        const row = cellsOf(lines[j] ?? '')
        const rest = row.slice(1).map((c, k) => (c ? `${head[k + 1] ? `${head[k + 1]} ` : ''}${c}` : '')).filter(Boolean)
        out.push(`- **${row[0] || '—'}**${rest.length ? ` — ${rest.join(' · ')}` : ''}`)
      }
      i = j - 1
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}
