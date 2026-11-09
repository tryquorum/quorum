import { describe, expect, test } from 'bun:test'
import { NoteSaver, noteVersion, type NoteSaveState } from './note-save.ts'

// 웹·iOS 가 같이 쓰는 노트 저장 규칙: 사람 초안은 늘 남고, 결과를 모르는 쓰기는 다시 보내지 않아요.
const draft = (text: string) => ({ html: `<p>${text}</p>`, text })
const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

describe('NoteSaver', () => {
  test('409 이면 충돌로 멈추고 서버 현재 글과 내 초안을 함께 들고 있어요', async () => {
    const calls: unknown[] = []
    const saver = new NoteSaver(3, async (body) => {
      calls.push(body)
      throw Object.assign(new Error('HTTP 409'), { status: 409, body: { current: { version: 4, md: '다른 기기 글', truncated: false } } })
    }, () => {})
    saver.edit(draft('내 글'))
    await saver.flush()
    expect(calls).toEqual([{ ...draft('내 글'), expectedVersion: 3 }])
    expect(saver.state.status).toBe('conflict')
    expect(saver.state.draft).toEqual(draft('내 글'))
    expect(saver.state.current).toEqual({ version: 4, md: '다른 기기 글', truncated: false })
    saver.edit(draft('내 글 더'))
    await saver.flush()
    expect(calls.length).toBe(1)
  })

  test('응답을 못 받으면 결과 불명으로 멈추고 다시 보내지 않아요', async () => {
    let calls = 0
    const saver = new NoteSaver(1, async () => { calls++; throw new Error('network') }, () => {})
    saver.edit(draft('a'))
    await saver.flush()
    expect(saver.state.status).toBe('unknown')
    expect(saver.state.draft).toEqual(draft('a'))
    await saver.flush()
    expect(calls).toBe(1)
  })

  test('버전을 지키는 노트인데 서버가 버전을 돌려주지 않으면 불명이에요', async () => {
    const saver = new NoteSaver(2, async () => ({ updated_at: 1 }), () => {})
    saver.edit(draft('a'))
    await saver.flush()
    expect(saver.state.status).toBe('unknown')
    expect(saver.state.draft).toEqual(draft('a'))
  })

  test('서버 버전을 읽지 못한 노트는 저장하지 않아요', async () => {
    let calls = 0
    const saver = new NoteSaver(noteVersion(true, { version: -1 }), async () => { calls++; return { version: 1, updated_at: 1 } }, () => {})
    expect(saver.state.status).toBe('error')
    saver.edit(draft('a'))
    await saver.flush()
    expect(calls).toBe(0)
  })

  test('저장 중에 더 쓴 글은 첫 저장이 끝난 뒤 새 버전으로 이어 저장해요', async () => {
    const first = deferred<{ version: number; updated_at: number }>()
    const bodies: { text: string; expectedVersion?: number }[] = []
    const saver = new NoteSaver(1, (body) => {
      bodies.push(body)
      return bodies.length === 1 ? first.promise : Promise.resolve({ version: 3, updated_at: 2 })
    }, () => {})
    saver.edit(draft('a'))
    const flushing = saver.flush()
    saver.edit(draft('ab'))
    expect(saver.state.status).toBe('saving')
    first.resolve({ version: 2, updated_at: 1 })
    await flushing
    expect(bodies.map((b) => [b.text, b.expectedVersion])).toEqual([['a', 1], ['ab', 2]])
    expect(saver.state).toMatchObject({ status: 'clean', version: 3, draft: null })
  })

  test('저장 중에 꺼졌던 상태를 복원하면 결과 불명으로 시작해요', () => {
    const restored: NoteSaveState = { status: 'saving', protected: true, version: 5, draft: draft('a') }
    const saver = new NoteSaver(5, async () => ({ version: 6, updated_at: 1 }), () => {}, restored)
    expect(saver.state.status).toBe('unknown')
    expect(saver.state.draft).toEqual(draft('a'))
  })
})

