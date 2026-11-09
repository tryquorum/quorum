import { describe, expect, test } from 'bun:test'
import { ApiError, ConflictError, UnknownWriteError } from '../api/client'
import { NoteSaver, type NoteState, type WriteNote } from './noteSaver'

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
const make = (write: WriteNote, opts: { editable?: boolean; check?: (md: string) => string | null; restored?: NoteState } = {}) =>
  new NoteSaver({ md: 'base', version: 3, editable: opts.editable ?? true }, write, () => {}, opts.check, opts.restored)

describe('iOS 노트 저장', () => {
  test('고치면 기준 version 으로 보내고 받은 version 으로 깨끗해져요', async () => {
    const calls: [string, number][] = []
    const s = make(async (md, v) => (calls.push([md, v]), { version: v + 1 }))
    s.edit('next')
    await s.flush()
    expect(calls).toEqual([['next', 3]])
    expect(s.state).toMatchObject({ status: 'clean', base: 'next', version: 4 })
  })
  test('저장 중 더 고치면 끝난 뒤 새 version 으로 한 번 더 보내요', async () => {
    const first = deferred<{ version: number }>()
    const calls: [string, number][] = []
    const s = make((md, v) => (calls.push([md, v]), calls.length === 1 ? first.promise : Promise.resolve({ version: 5 })))
    s.edit('a')
    const p = s.flush()
    s.edit('ab')
    first.resolve({ version: 4 })
    await p
    expect(calls).toEqual([['a', 3], ['ab', 4]])
    expect(s.state).toMatchObject({ status: 'clean', version: 5, draft: 'ab' })
  })
  test('409 면 충돌로 멈추고 초안과 서버 내용을 지켜요', async () => {
    let calls = 0
    const s = make(async () => {
      calls++
      throw new ConflictError(409, 'changed', false, { error: 'changed', current: { version: 9, md: '남의 글', truncated: false } })
    })
    s.edit('내 글')
    await s.flush()
    s.edit('내 글 더')
    await s.flush()
    expect(calls).toBe(1)
    expect(s.state).toMatchObject({ status: 'conflict', draft: '내 글 더', current: { version: 9, md: '남의 글' } })
  })
  test('결과를 모르면 불명으로 멈추고 다시 보내지 않아요', async () => {
    let calls = 0
    const s = make(async () => {
      calls++
      throw new UnknownWriteError(new Error('lost'))
    })
    s.edit('a')
    await s.flush()
    await s.flush()
    expect(calls).toBe(1)
    expect(s.state).toMatchObject({ status: 'unknown', draft: 'a', inflight: { md: 'a', version: 3 } })
  })
  test('버전 없는 응답도 불명이에요', async () => {
    const s = make(async () => ({}))
    s.edit('a')
    await s.flush()
    expect(s.state.status).toBe('unknown')
  })
  test('서버가 확실히 거절하면 오류로 멈추고 고치면 다시 저장할 수 있어요', async () => {
    const s = make(async () => {
      throw new ApiError(413, 'too large', false, { error: 'too large' })
    })
    s.edit('a')
    await s.flush()
    expect(s.state.status).toBe('error')
    s.edit('b')
    expect(s.state.status).toBe('dirty')
  })
  test('새로 불러와도 자동으로 깨끗해지지 않고, 복사한 뒤에만 채택해 직접 합쳐요', async () => {
    const calls: [string, number][] = []
    let fail = true
    const s = make(async (md, v) => {
      calls.push([md, v])
      if (fail) throw new UnknownWriteError(new Error('lost'))
      return { version: v + 1 }
    })
    s.edit('mine')
    await s.flush()
    s.reload({ version: 4, md: 'mine', truncated: false }, true)
    expect(s.state.status).toBe('unknown')
    expect(s.adopt(false)).toBe(false)
    expect(s.adopt(true)).toBe(true)
    expect(s.state).toMatchObject({ status: 'merging', base: 'mine', version: 4, draft: 'mine', backups: ['mine'] })
    s.edit('merged')
    await s.flush()
    expect(calls.length).toBe(1)
    fail = false
    await s.saveMerged()
    expect(calls[1]).toEqual(['merged', 4])
    expect(s.state).toMatchObject({ status: 'clean', version: 5 })
  })
  test('채택한 노트가 편집할 수 없으면 읽기로 바뀌고 내 초안은 보관돼요', async () => {
    const s = make(async () => {
      throw new ConflictError(409, 'changed', false, { error: 'changed' })
    })
    s.edit('mine')
    await s.flush()
    s.reload({ version: 7, md: '<표가 든 노트>', truncated: false }, false)
    s.adopt(true)
    expect(s.state).toMatchObject({ status: 'clean', editable: false, backups: ['mine'] })
    s.edit('x')
    expect(s.state.draft).toBe('<표가 든 노트>')
  })
  test('검사에 걸린 초안·200,000자 초과는 보내지 않아요', async () => {
    let calls = 0
    const s = make(async () => (calls++, { version: 4 }), { check: (md) => (md.includes('|') ? '표는 iOS 에서 저장할 수 없어요' : null) })
    s.edit('| a |')
    await s.flush()
    expect(s.state).toMatchObject({ status: 'error', message: '표는 iOS 에서 저장할 수 없어요' })
    s.edit('x'.repeat(200001))
    await s.flush()
    expect(s.state.status).toBe('error')
    expect(calls).toBe(0)
  })
  test('같은 화면의 제목·속성 쓰기가 올린 version 은 깨끗하고 기준이 같을 때만 따라가요', () => {
    const s = make(async () => ({ version: 1 }))
    s.acceptExternalVersion(2, 5)
    expect(s.state.version).toBe(3)
    s.acceptExternalVersion(3, 4)
    expect(s.state.version).toBe(4)
  })
  test('저장 중에 꺼진 초안을 복원하면 불명으로 시작해요', () => {
    const s = make(async () => ({ version: 1 }), { restored: { status: 'saving', base: 'b', version: 3, draft: 'd', inflight: { md: 'd', version: 3 }, backups: [], editable: true } })
    expect(s.state).toMatchObject({ status: 'unknown', draft: 'd' })
  })
})

describe('보관한 초안 되살리기', () => {
  const saved = (patch: Partial<NoteState>): NoteState => ({ status: 'dirty', base: 'base', version: 3, draft: '내 초안', backups: [], editable: true, ...patch })
  test('지금 서버가 편집을 막은 노트면 초안은 두고 저장하지 않아요', async () => {
    let calls = 0
    const s = new NoteSaver({ md: 'base', version: 3, editable: false }, async () => (calls++, { version: 4 }), () => {}, undefined, saved({}))
    await s.flush()
    expect(calls).toBe(0)
    expect(s.state).toMatchObject({ status: 'error', editable: false, draft: '내 초안' })
  })
  test('보관한 뒤 서버 version 이 바뀌었으면 충돌로 시작해요', async () => {
    let calls = 0
    const s = new NoteSaver({ md: '남의 새 글', version: 5, editable: true }, async () => (calls++, { version: 6 }), () => {}, undefined, saved({}))
    await s.flush()
    expect(calls).toBe(0)
    expect(s.state).toMatchObject({ status: 'conflict', draft: '내 초안', current: { version: 5, md: '남의 새 글' } })
  })
  test('같은 version 이면 이어서 저장해요', async () => {
    const s = new NoteSaver({ md: 'base', version: 3, editable: true }, async (_md, v) => ({ version: v + 1 }), () => {}, undefined, saved({}))
    await s.flush()
    expect(s.state).toMatchObject({ status: 'clean', version: 4, base: '내 초안' })
  })
})
