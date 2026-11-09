import { describe, expect, test } from 'bun:test'
import type { NoteSource, WriteResult } from '@direction-board/contracts'
import { ApiError, ConflictError, ScopeChangedError, UnknownWriteError } from '../../../api/client'
import { addAnswerToNote, type NoteIO } from './addAnswer'

// 대화 답 → 노트에 넣기. 늘 읽은 버전을 보낸 append(서버가 기존 md·HTML 을 그대로 두고 가로줄 뒤에, 리뷰 11 불변식 — noteInvariant.test.ts).
// 멱등은 서버 onceKey("run:<실행 id>", 노트 쓰기와 같은 트랜잭션 기록)로: 결과를 모르거나 409 뒤 다시 보내도 서버가 duplicate 로 막아요.
// 같은 노트·같은 실행 작업은 기기에서 하나로 묶어요. 범위가 바뀌면 범위 고정 클라이언트가 ScopeChangedError 로 멈춰요.
const REF = 'item:b:1'
let seq = 0
const run = (p: Partial<{ id: string; prompt: string; output: string; target: string | null; applied: number }> = {}) => ({ id: 'r' + ++seq, prompt: '질문\n둘째 줄', output: '답이에요', target: REF, applied: 0, ...p })
const src = (p: Partial<NoteSource>): NoteSource => ({ ref: REF, html: '<p>앞 글</p>', md: '앞 글', version: 3, personEdited: true, markdownEditable: true, onceKey: true, ...p })
const res = (p: Partial<WriteResult> = {}): WriteResult => ({ ref: REF, version: 4, applied: 1, warnings: [], ...p })
function io(sources: (NoteSource | Error)[], over: Partial<NoteIO> = {}) {
  const calls: string[] = []
  const q = [...sources]
  const base: NoteIO = {
    scope: 'https://board.test|a@x.test',
    source: async () => { calls.push('source'); const s = q.shift() ?? sources.at(-1); if (!s) throw new Error('no source'); if (s instanceof Error) throw s; return s },
    seen: async () => { calls.push('seen'); return src({ onceApplied: false }) },
    append: async (md, v, key) => { calls.push(`append:${v}:${key}:${md}`); return res() },
    start: async () => { calls.push('start'); return {} },
    markApplied: async () => { calls.push('applied'); return {} },
  }
  return { calls, io: { ...base, ...over } }
}

describe('대화 답 → 노트에 넣기', () => {
  test('(리뷰 11) 고칠 수 있는 노트도 onceKey·읽은 버전을 붙인 append(새 답만 보냄), 넣은 뒤 서버 실행에 적용 표시', async () => {
    const r = run(); const t = io([src({})])
    expect(await addAnswerToNote(t.io, REF, r)).toBe('added')
    expect(t.calls).toEqual(['source', `append:3:run:${r.id}:### 질문\n\n답이에요`, 'applied'])
  })
  test('409 면 다시 읽어 최신 버전으로 다시 append', async () => {
    const r = run(); let n = 0
    const t = io([src({ markdownEditable: false }), src({ markdownEditable: true, md: '앞 글\n\n웹에서 고침', version: 5 })], { append: async (md, v, key) => { t.calls.push(`append:${v}:${key}`); if (n++ === 0) throw new ConflictError(409, 'changed', true, {}); return res() } })
    expect(await addAnswerToNote(t.io, REF, r)).toBe('added')
    expect(t.calls.slice(0, 3)).toEqual(['source', `append:3:run:${r.id}`, 'source'])
    expect(t.calls[3]).toBe(`append:5:run:${r.id}`)
  })
  test('서버가 같은 onceKey 를 이미 받았다면(duplicate) 다시 붙이지 않아요 — 본문이 달라졌어도·다른 기기에서 넣었어도', async () => {
    const t = io([src({ md: '사람이 고친 노트' })], { append: async () => res({ applied: 0, duplicate: true, warnings: ['duplicate'] }) })
    expect(await addAnswerToNote(t.io, REF, run())).toBe('already')
  })
  test('서버 실행이 이 노트를 위해 이미 적용 표시돼 있으면 보내지 않아요(다른 일의 실행이면 무시)', async () => {
    const t = io([src({})])
    expect(await addAnswerToNote(t.io, REF, run({ applied: 1 }))).toBe('already')
    expect(t.calls).toEqual([])
    expect(await addAnswerToNote(t.io, REF, run({ applied: 1, target: 'item:b:2' }))).toBe('added')
    expect(t.calls).not.toContain('applied')
  })
  test('(리뷰 9·10) 결과를 모르면 다시 보내지 않고 onceKey 로 읽어 확인만 — 적용됐으면 넣음(확인 길에서는 적용 표시도 안 보냄)', async () => {
    const r = run()
    const t = io([src({})], { append: async (md, v, key) => { t.calls.push(`append:${v}:${key}`); throw new UnknownWriteError(new Error('net')) }, seen: async () => (t.calls.push('seen'), src({ onceApplied: true })) })
    expect(await addAnswerToNote(t.io, REF, r)).toBe('added')
    expect(t.calls).toEqual(['source', `append:3:run:${r.id}`, 'seen'])
  })
  test('onceKey 를 모르는 옛 서버: 결과를 모른 뒤 다시 읽은 노트에 그 답이 있으면 넣은 것(다시 보내지 않아요)', async () => {
    const r = run()
    const t = io([src({ onceKey: undefined })], { append: async (md, v, key) => { t.calls.push(`append:${v}:${key}`); throw new UnknownWriteError(new Error('net')) }, seen: async () => src({ onceKey: undefined, md: '앞 글\n\n### 질문\n\n답이에요', version: 4 }) })
    expect(await addAnswerToNote(t.io, REF, r)).toBe('added')
    expect(t.calls.filter((c) => c.startsWith('append')).length).toBe(1)
  })
  test('(리뷰 3) onceKey 를 알리지 않는 옛 서버: 결과를 모르면 다시 읽어 같지 않아도 자동으로 다시 보내지 않고 결과 불명', async () => {
    const t = io([src({ onceKey: undefined })], { append: async (md, v, key) => { t.calls.push(`append:${v}:${key}`); throw new UnknownWriteError(new Error('net')) }, seen: async () => src({ onceKey: undefined, md: '앞 글' }) })
    await expect(addAnswerToNote(t.io, REF, run())).rejects.toBeInstanceOf(UnknownWriteError)
    expect(t.calls.filter((c) => c.startsWith('append')).length).toBe(1)
  })
  test('계속 결과를 모르면 결과 불명을 그대로 던져요(실패라 하지 않음)', async () => {
    const t = io([src({})], { append: async () => { throw new UnknownWriteError(new Error('net')) } })
    await expect(addAnswerToNote(t.io, REF, run())).rejects.toBeInstanceOf(UnknownWriteError)
  })
  test('같은 노트·같은 실행을 겹쳐 누르면 하나로 묶어요(서버에는 한 번)', async () => {
    const r = run()
    let release!: () => void
    const gate = new Promise<void>((ok) => (release = ok))
    const t = io([src({})], { append: async (md, v, key) => { t.calls.push(`append:${key}`); await gate; return res() } })
    const a = addAnswerToNote(t.io, REF, r)
    const b = addAnswerToNote(t.io, REF, r)
    release()
    expect(await Promise.all([a, b])).toEqual(['added', 'added'])
    expect(t.calls.filter((c) => c.startsWith('append')).length).toBe(1)
  })
  test('범위가 바뀌면(범위 고정 클라이언트의 ScopeChangedError) 그 자리에서 멈춰요', async () => {
    const t = io([src({})], { append: async () => { throw new ScopeChangedError() } })
    await expect(addAnswerToNote(t.io, REF, run())).rejects.toBeInstanceOf(ScopeChangedError)
    expect(t.calls).toEqual(['source'])
  })
  test('노트가 없으면(404) 빈 노트를 만든 뒤 붙여요', async () => {
    const r = run()
    const t = io([new ApiError(404, 'Document not found', true), src({ md: '', html: '', version: 1 })])
    expect(await addAnswerToNote(t.io, REF, r)).toBe('added')
    expect(t.calls.slice(0, 4)).toEqual(['source', 'start', 'source', `append:1:run:${r.id}:### 질문\n\n답이에요`])
  })
  test('계속 바뀌면 알려요', async () => {
    const t = io([src({})], { append: async () => { throw new ConflictError(409, 'changed', true, {}) } })
    await expect(addAnswerToNote(t.io, REF, run())).rejects.toThrow('노트가 계속 바뀌고 있어요')
  })
})
