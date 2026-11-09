import { describe, expect, test } from 'bun:test'
import type { Run } from '@direction-board/contracts'
import { afterSend, continuable, groupThreads, quotedPrompt, runBody, tablesAsList } from './runLogic'

const run = (id: string, extra: Partial<Run> = {}): Run => ({
  id, target: null, prompt: id, provider: 'aside', model: 'm1', model_name: 'M1', effort: 'high', status: 'done', session_id: 's', parent: null, thread: 't',
  output: '', error: null, error_kind: null, retry_of: null, last_activity_at: null, created_at: 1, finished_at: 2, kind: 'chat', ...extra,
})
const choice = { provider: 'aside', model: 'm2', effort: 'low' }

describe('이어 묻기', () => {
  test('마지막 턴이 세션을 만들었고 끝났고 대화로 시작했을 때만', () => {
    expect(continuable([run('a'), run('b')])?.id).toBe('b')
    expect(continuable([run('a', { session_id: null })])).toBeNull()
    expect(continuable([run('a', { status: 'running' })])).toBeNull()
    expect(continuable([run('a', { kind: 'capture' }), run('b')])).toBeNull()
    expect(continuable([])).toBeNull()
  })
  test('본문: 이어 묻기는 부모·부모 모델·부모 target, 새 대화는 고른 모델과 켠 target', () => {
    const last = run('b', { target: 'item:b:1' })
    expect(runBody({ prompt: '더', last, choice, target: null })).toEqual({ prompt: '더', target: 'item:b:1', parent: 'b', provider: 'aside', model: 'm1', effort: 'high' })
    expect(runBody({ prompt: '새', last: null, choice, target: 'item:b:2', page: { view: 'list', work: 'item:b:2' } })).toEqual({ prompt: '새', page: { view: 'list', work: 'item:b:2' }, target: 'item:b:2', provider: 'aside', model: 'm2', effort: 'low' })
    expect(runBody({ prompt: '  ', last: null, choice, target: null })).toBeNull()
    expect(runBody({ prompt: '새', last: null, choice: null, target: null })).toBeNull()
  })
  test('보낸 뒤 더 쓴 글은 남겨요', () => {
    expect(afterSend('안녕', '안녕')).toBe('')
    expect(afterSend('안녕 더', '안녕')).toBe('안녕 더')
  })
  test('인용은 웹과 같은 형식', () => {
    expect(quotedPrompt('', '첫 줄\n둘째')).toBe('이 부분을 설명해줘\n\n노트에서 고른 부분:\n> 첫 줄\n> 둘째')
    expect(quotedPrompt(' 왜? ', null)).toBe('왜?')
  })
})

describe('일에 붙은 대화 묶기', () => {
  test('초안은 빼고 대화별로, 최근 대화 먼저', () => {
    const rows = groupThreads([
      run('a', { thread: 'a', created_at: 1, finished_at: 2 }),
      run('a2', { thread: 'a', parent: 'a', created_at: 3, finished_at: 9, status: 'error' }),
      run('b', { thread: 'b', created_at: 4, finished_at: 5 }),
      run('d', { thread: 'd', kind: 'draft', created_at: 6 }),
    ])
    expect(rows.map((t) => [t.id, t.count, t.status])).toEqual([['a', 2, 'error'], ['b', 1, 'done']])
  })
})

describe('표를 줄 목록으로', () => {
  test('GFM 표는 줄마다 한 항목, 펜스 안과 표 아닌 파이프는 그대로', () => {
    const md = ['앞', '| 이름 | 상태 | 수 |', '|---|---|---:|', '| 계약서 | 확인 필요 | 2 |', '| 메일 |  | 10 |', '뒤 a | b', '```', '| x | y |', '|---|---|', '```'].join('\n')
    expect(tablesAsList(md).split('\n')).toEqual(['앞', '- **계약서** — 상태 확인 필요 · 수 2', '- **메일** — 수 10', '뒤 a | b', '```', '| x | y |', '|---|---|', '```'])
  })
})
