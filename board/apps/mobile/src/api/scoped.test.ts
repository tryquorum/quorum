import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { configureAuth, resumeClient, scopedClient } from './client'
import { ScopeChangedError } from './queryStore'

// 구조 1(머지 전 새 리뷰 2, P1): 다단계 흐름은 시작 때 범위(서버 주소 + 로그인 주체)를 잡은 클라이언트로만 보내고,
// 그 클라이언트의 모든 요청은 보내기 직전에 지금 범위와 비교해 다르면 보내지 않아요.
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
const token = (email: string, n = 1) => `${b64({ alg: 'RS256' })}.${b64({ email, exp: Math.floor(Date.now() / 1000) + 3600, n })}.sig`
const O = 'https://board.test'
const originalFetch = globalThis.fetch
let sent: string[] = []
let session: { origin: string; token: string } | null = null
afterEach(() => {
  globalThis.fetch = originalFetch
  configureAuth({ session: () => null, expired: () => {} })
})
function setup(email: string) {
  sent = []
  session = { origin: O, token: token(email) }
  configureAuth({ session: () => session as never, expired: () => {} })
  globalThis.fetch = Object.assign(async (url: string | URL | Request) => { sent.push(String(url)); return Response.json({ ok: true }) }, { preconnect: originalFetch.preconnect })
}

describe('범위 고정 클라이언트', () => {
  test('같은 범위면 보내요(같은 계정의 토큰 갱신도 같은 범위)', async () => {
    setup('a@x.test')
    const c = scopedClient(O)
    await c.request('/api/state')
    session = { origin: O, token: token('a@x.test', 2) }
    await c.write('/api/x', 'POST', {})
    expect(sent).toEqual([O + '/api/state', O + '/api/x'])
  })
  test('다른 계정으로 바뀌면 보내지 않고 ScopeChangedError(읽기·쓰기 모두)', async () => {
    setup('a@x.test')
    const c = scopedClient(O)
    session = { origin: O, token: token('b@x.test') }
    await expect(c.write('/api/docs/item%3Ab%3A1/write', 'POST', { mode: 'replace', md: 'x', expectedVersion: 3 })).rejects.toBeInstanceOf(ScopeChangedError)
    await expect(c.request('/api/docs/item%3Ab%3A1/note')).rejects.toBeInstanceOf(ScopeChangedError)
    expect(sent).toEqual([])
  })
  test('로그아웃·화면의 서버가 바뀌어도 멈춰요', async () => {
    setup('a@x.test')
    let view = O
    const c = scopedClient(O, () => view === O)
    view = 'https://other.test'
    await expect(c.request('/api/state')).rejects.toBeInstanceOf(ScopeChangedError)
    view = O
    session = null
    await expect(c.request('/api/state')).rejects.toBeInstanceOf(ScopeChangedError)
    expect(sent).toEqual([])
  })
})

// 다단계 흐름 모듈은 전역 클라이언트(workApi·notesApi·callFor·client 의 request/write)를 쓰지 않아요
const FLOWS = [
  'features/board/quick/captureFlow.ts',
  'features/board/quick/captureApi.ts',
  'features/board/quick/create.ts',
  'features/board/quick/createScoped.ts',
  'features/board/work/addAnswer.ts',
  'features/board/work/toNote.ts',
  'features/board/work/insertDraft.ts',
  'features/board/work/makeWork.ts',
]
const GLOBAL = /\bworkApi\b|\bnotesApi\b|\bcallFor\(|import\s*\{[^}]*\b(request|write|api)\b[^}]*\}\s*from\s*'[./]*api\/client'/
describe('다단계 흐름은 범위 고정 클라이언트만', () => {
  for (const f of FLOWS)
    test(f, () => {
      const src = readFileSync(join(import.meta.dir, '..', f), 'utf8')
      expect(src.match(GLOBAL)?.[0] ?? null).toBeNull()
    })
  test('AI 정리 칩의 요청은 범위 고정 클라이언트로 만들어요(useCaptures)', () => {
    const src = readFileSync(join(import.meta.dir, '../features/board/quick/useCaptures.ts'), 'utf8')
    expect(src).toContain('captureApiFor(')
    expect(src.match(/workApi\.(startCapture|effects|undo|retry|stop)/)?.[0] ?? null).toBeNull()
  })
})

describe('(리뷰 3) 복구 기록의 재개는 시작 범위로만', () => {
  test('저장된 범위와 지금 범위가 다르면 보내지 않고 "다른 계정에서 시작" 안내, 원래 계정으로 돌아오면 보내요', async () => {
    setup('a@x.test')
    const pinned = scopedClient(O).scope
    session = { origin: O, token: token('b@x.test') }
    const c = resumeClient(O, pinned)
    await expect(c.write('/api/x', 'POST', {})).rejects.toThrow('다른 계정에서 시작한 작업이에요')
    expect(sent).toEqual([])
    session = { origin: O, token: token('a@x.test', 3) }
    await c.write('/api/x', 'POST', {})
    expect(sent).toEqual([O + '/api/x'])
  })
  // 결과 불명·부분 완료로 남기는 복구 기록은 시작 범위(scope)를 같이 저장하고, 재개는 resumeClient(그 범위)로만 해요
  const RECORDS: [string, RegExp][] = [
    ['../../../packages/contracts/src/quick-recovery.ts', /Pending = \{[^}]*scope: string/], // 빠른 추가 실패 기록(웹·iOS 한 줄·시트·목표 할 일 공용, 리뷰 16 에서 계약으로)
    ['features/board/quick/createScoped.ts', /resumeClient\(/], // 빠른 추가 재개
    ['features/board/quick/captureFlow.ts', /scope: this\.api\.scope/], // AI 정리 보냈는지 모르는 칩
  ]
  for (const [f, re] of RECORDS)
    test(f, () => {
      expect(re.test(readFileSync(join(import.meta.dir, '..', f), 'utf8'))).toBe(true)
    })
  test('빠른 추가 화면 셋은 실패 기록을 직접 만들지 않고 공용 흐름(create.ts → createScoped.ts createWithRecord → 계약 submitWithRecord)으로만', () => {
    const create = readFileSync(join(import.meta.dir, '../features/board/quick/createScoped.ts'), 'utf8')
    expect(create).toContain('submitWithRecord(')
    const flow = readFileSync(join(import.meta.dir, '../../../../packages/contracts/src/quick-recovery.ts'), 'utf8')
    expect(flow).toContain('pendingFrom(')
    expect(flow).toContain('retryPlan(')
    for (const f of ['features/board/quick/QuickAddBar.tsx', 'features/board/quick/QuickAddSheet.tsx', 'features/board/work/GoalOverview.tsx']) {
      const src = readFileSync(join(import.meta.dir, '..', f), 'utf8')
      expect(src.match(/set(Pending|Failure)\(\{\s*id:/)?.[0] ?? null).toBeNull()
      expect(src).toContain('inputLocked(')
    }
  })
})

describe('(리뷰 4) 빠른 추가 화면은 영속 기록 자리와 닫기 확인·✦ 막기를 써요', () => {
  const read = (f: string) => readFileSync(join(import.meta.dir, '..', f), 'utf8')
  test('상세 시트: 시트 자리 기록 + 닫기·이탈 확인', () => {
    const src = read('features/board/quick/QuickAddSheet.tsx')
    expect(src).toContain("usePendingSlot(slotName)")
    expect(src).toContain('beforeRemove')
    expect(src).toContain('closeGuard(')
  })
  test('한 줄: 한 줄 자리 기록 + 잠긴 동안 ✦ 막기', () => {
    const src = read('features/board/quick/QuickAddBar.tsx')
    expect(src).toContain("usePendingSlot(slotName)")
    expect(src).toContain('aiAllowed(')
  })
  // 기기 실측(리뷰 4 고침 확인 중): 결과 불명으로 입력이 잠기면 Enter 를 누를 수 없어 다시 시도할 길이 없었어요
  test('잠긴 한 줄·목표 할 일에도 확인·다시 보내기·이어 하기 단추와 버리기(확인창)가 있어요(입력이 잠겨 Enter 로는 못 보내요)', () => {
    for (const f of ['features/board/quick/QuickAddBar.tsx', 'features/board/work/GoalOverview.tsx']) {
      const src = read(f)
      expect(src).toMatch(/label=\{[^\n]*retryLabel\([^\n]*onPress=\{[^\n]*(submit|add)\(\)/)
      // 버리기는 누르면 계획(기록·쓰던 초안)을 만들고 그 글의 확인창을 띄워요(PR #43 리뷰 3 — askDiscard 안의 confirmDiscard)
      expect(src).toContain('<Chip label="버리기" onPress={() => void askDiscard()} />')
      expect(src).toMatch(/const askDiscard = async \(\) => \{\s*const plan = await planDiscardBoth\(slot, edit\)\s*if \(!plan\) return toast\(CHANGED_TEXT\)\s*confirmDiscard\(/)
    }
  })
  // 리뷰 6: 기록 자리를 못 읽었거나 깨졌으면 세 화면 모두 그 안내(다시 읽기·버리고 새로)를 보여요. 제출 막기는 usePendingSlot 의 세 번째 값(slotGate)
  test('세 화면 모두 기록 자리 문제 안내를 그려요', () => {
    for (const f of ['features/board/quick/QuickAddBar.tsx', 'features/board/quick/QuickAddSheet.tsx', 'features/board/work/GoalOverview.tsx']) {
      const src = read(f)
      expect(src).toMatch(/usePendingSlot\([^)]*\)/)
      expect(src).toContain('<SlotIssueNotice issue={slotIssue} />')
    }
  })
  test('목표 할 일: 목표마다 자리', () => {
    expect(read('features/board/work/GoalOverview.tsx')).toContain("slotFor('goal', { boardId: goal.boardId, goalId: goal.id })")
  })
})
