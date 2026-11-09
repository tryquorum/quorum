import { expect, test } from 'bun:test'
import { ApiError, ConflictError, UnknownWriteError } from '../../api/client'
import { WriteQueue } from './writeQueue'

test('연속 쓰기는 앞 쓰기가 올린 version 으로 이어 보내요(거짓 409 없음)', async () => {
  const seen: Array<[number, number]> = []
  const q = new WriteQueue((from, to) => seen.push([from, to]))
  const sent: number[] = []
  await q.run(3, async (v) => (sent.push(v), { version: v + 1 }))
  await q.run(3, async (v) => (sent.push(v), { version: v + 1 }))
  expect(sent).toEqual([3, 4])
  expect(seen).toEqual([[3, 4], [4, 5]])
})

test('version 이 없거나 줄어든 응답은 줄을 막아요', async () => {
  const q = new WriteQueue()
  await expect(q.run(3, async () => ({}))).rejects.toThrow('저장 버전')
  expect(q.isBlocked).toBe(true)
  await expect(q.run(3, async () => ({ version: 4 }))).rejects.toThrow('저장 버전')
})

test('409·결과 불명은 막고, 서버가 거절한 쓰기(쓰이지 않음)는 막지 않아요', async () => {
  const rejected = new ApiError(400, 'bad', false, { error: 'bad' })
  const q1 = new WriteQueue()
  await expect(q1.run(1, async () => Promise.reject(rejected))).rejects.toBe(rejected)
  expect(q1.isBlocked).toBe(false)
  expect(await q1.run(1, async (v) => ({ version: v + 1 }))).toEqual({ version: 2 })

  const q2 = new WriteQueue()
  await expect(q2.run(1, async () => Promise.reject(new ConflictError(409, 'changed', false, { error: 'changed' })))).rejects.toBeInstanceOf(ConflictError)
  expect(q2.isBlocked).toBe(true)

  const q3 = new WriteQueue()
  await expect(q3.run(1, async () => Promise.reject(new UnknownWriteError(new Error('net'))))).rejects.toBeInstanceOf(UnknownWriteError)
  expect(q3.isBlocked).toBe(true)
  q3.reset()
  expect(await q3.run(1, async (v) => ({ version: v + 1 }))).toEqual({ version: 2 })
})

test('서버·계정이 바뀌면 줄에 서 있던 쓰기도 보내지 않아요(막지는 않음)', async () => {
  let alive = true
  const q = new WriteQueue(undefined, () => alive)
  const sent: number[] = []
  alive = false
  await expect(q.run(1, async (v) => (sent.push(v), { version: v + 1 }))).rejects.toThrow('서버나 로그인이 바뀌어')
  expect(sent).toEqual([])
  expect(q.isBlocked).toBe(false)
})

test('쓰기는 하나씩 차례로 가요', async () => {
  const q = new WriteQueue()
  const order: string[] = []
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const a = q.run(1, async (v) => {
    order.push('a start')
    await gate
    order.push('a end')
    return { version: v + 1 }
  })
  const b = q.run(1, async (v) => (order.push(`b ${v}`), { version: v + 1 }))
  await Promise.resolve()
  release()
  await Promise.all([a, b])
  expect(order).toEqual(['a start', 'a end', 'b 2'])
})
