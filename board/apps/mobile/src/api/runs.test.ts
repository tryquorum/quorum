import { afterEach, expect, test } from 'bun:test'
import { ApiError, ConflictError, scopedClient, UnknownWriteError } from './client'
import { runsApi } from './runs'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
type Seen = { url: string; method: string; body: unknown }
function serve(reply: (seen: Seen) => Response): Seen[] {
  const log: Seen[] = []
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const seen = { url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined }
      log.push(seen)
      return reply(seen)
    },
    { preconnect: originalFetch.preconnect },
  )
  return log
}
const O = 'http://127.0.0.1:3173'
const run = (id: string) => ({ id, status: 'running', prompt: 'p' })

test('새 대화와 이어 묻기는 같은 POST /api/runs 에 본문만 달라요', async () => {
  const log = serve(() => Response.json(run('r1')))
  await runsApi.start(scopedClient(O), { prompt: '안녕', target: null, provider: 'aside', model: 'm', effort: 'high' })
  await runsApi.start(scopedClient(O), { prompt: '더', target: 'item:b:1', parent: 'r1', provider: 'aside', model: 'm', effort: 'high', page: { view: 'home', work: 'item:b:1' } })
  expect(log.map((l) => [l.method, l.url])).toEqual([['POST', O + '/api/runs'], ['POST', O + '/api/runs']])
  expect(log[0]?.body).toEqual({ prompt: '안녕', target: null, provider: 'aside', model: 'm', effort: 'high' })
  expect(log[1]?.body).toMatchObject({ parent: 'r1', target: 'item:b:1', page: { view: 'home', work: 'item:b:1' } })
})

test('이미 다시 시도한 실행은 409 본문의 실행으로', async () => {
  serve(() => Response.json({ error: 'already retried', run: run('r2') }, { status: 409 }))
  expect((await runsApi.retry(scopedClient(O), 'r1')).id).toBe('r2')
})

test('본문에 실행이 없는 409 는 그대로 던져요', async () => {
  serve(() => Response.json({ error: '이 실행은 다시 시도할 수 없어요' }, { status: 409 }))
  await expect(runsApi.retry(scopedClient(O), 'r1')).rejects.toBeInstanceOf(ConflictError)
})

test('서버가 거절한 403 은 쓰이지 않은 ApiError, 5xx 는 결과 불명', async () => {
  serve(() => Response.json({ error: 'agents cannot start runs' }, { status: 403 }))
  const rejected = await runsApi.stop(scopedClient(O), 'r1').catch((e: unknown) => e)
  expect(rejected).toBeInstanceOf(ApiError)
  expect((rejected as ApiError).rejected).toBe(true)
  serve(() => new Response('bad gateway', { status: 502, headers: { 'content-type': 'text/html' } }))
  await expect(runsApi.seen(scopedClient(O), 'r1')).rejects.toBeInstanceOf(UnknownWriteError)
})

test('대화·일 실행·목록 주소', async () => {
  const log = serve(() => Response.json({ runs: [], threads: [] }))
  await runsApi.thread(O, 'a b')
  await runsApi.forTarget(O, 'item:b:1')
  await runsApi.threads(O)
  expect(log.map((l) => l.url)).toEqual([O + '/api/runs?thread=a%20b', O + '/api/runs?target=item%3Ab%3A1', O + '/api/runs/threads?limit=40'])
})
