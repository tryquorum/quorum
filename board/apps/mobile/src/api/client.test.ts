import { afterEach, expect, test } from 'bun:test'
import { ApiError, ConflictError, GlobalWriteError, UnknownWriteError, api, configureAuth, errorMessage, globalClient, imageSource, request, scopedClient } from './client'
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
const fakeToken = (payload: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  configureAuth({ session: () => null, expired: () => {} })
})
async function message(response: Response | Error) {
  globalThis.fetch = Object.assign(
    async () => {
      if (response instanceof Error) throw response
      return response
    },
    { preconnect: originalFetch.preconnect },
  )
  try {
    await api.state('https://example.test')
  } catch (error) {
    return errorMessage(error)
  }
  throw new Error('expected request failure')
}
test('Access 리디렉트는 로그인 안내를 보여요', async () => {
  const response = Response.json({})
  Object.defineProperty(response, 'url', { value: 'https://team.cloudflareaccess.com/login' })
  expect(await message(response)).toBe('로그인이 필요해요')
})
test('성공 HTML은 로그인 안내를 보여요', async () => {
  expect(
    await message(new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })),
  ).toBe('로그인이 필요해요')
})
test('401은 로그인 안내를 보여요', async () => {
  expect(await message(new Response('', { status: 401 }))).toBe('로그인이 필요해요')
})
test('403은 허용되지 않은 요청을 알려요', async () => {
  expect(await message(new Response('', { status: 403 }))).toBe('이 서버에서 허용하지 않은 요청이에요')
})
test('다른 HTTP 오류는 상태 코드를 보여요', async () => {
  expect(await message(new Response('', { status: 500 }))).toBe('불러오지 못했어요 (HTTP 500)')
})
test('네트워크 오류는 연결 실패를 알려요', async () => {
  expect(await message(new TypeError('offline'))).toBe('서버에 닿지 않아요')
})
test('iOS fetch 가 던지는 일반 Error 도 연결 실패로 보여요', async () => {
  // 시뮬레이터에서 http://127.0.0.1:9 로 바꿨을 때 실제로 받은 오류 문장이에요.
  expect(await message(new Error('fetch failed: Could not connect to the server.'))).toBe('서버에 닿지 않아요')
})
test('문서 페이지를 이어 읽고 버전이 바뀌면 멈춰요', async () => {
  let calls = 0
  globalThis.fetch = Object.assign(
    async () => {
      calls++
      return Response.json({
        ref: 'doc:a',
        kind: 'doc',
        title: 'A',
        version: 1,
        frontmatter: {},
        markdown: calls === 1 ? '앞' : '뒤',
        truncated: calls === 1,
        ...(calls === 1 ? { nextOffset: 1 } : {}),
        links: { in: 0, out: 0 },
      })
    },
    { preconnect: originalFetch.preconnect },
  )
  expect((await api.doc('https://example.test', 'doc:a')).markdown).toBe('앞뒤')
  calls = 0
  globalThis.fetch = Object.assign(
    async () => {
      calls++
      return Response.json({
        ref: 'doc:a',
        kind: 'doc',
        title: 'A',
        version: calls,
        frontmatter: {},
        markdown: '앞',
        truncated: true,
        nextOffset: calls,
        links: { in: 0, out: 0 },
      })
    },
    { preconnect: originalFetch.preconnect },
  )
  await expect(api.doc('https://example.test', 'doc:a')).rejects.toThrow('문서가 바뀌었어요')
})

const live = fakeToken({ exp: Math.floor(Date.now() / 1000) + 3600 })
function withSession(token: string, origin = 'https://example.test') {
  const session = { origin, token }
  const expired: string[] = []
  configureAuth({ session: () => session, expired: (s) => void expired.push(s === session ? s.token : 'other') })
  return { expired: () => expired.length, tokens: expired }
}
function capture(response: () => Response) {
  const seen: Headers[] = []
  globalThis.fetch = Object.assign(
    async (_: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers))
      return response()
    },
    { preconnect: originalFetch.preconnect },
  )
  return seen
}
test('로그인한 서버에만 cf-access-token 을 붙여요', async () => {
  const auth = withSession(live)
  const seen = capture(() => Response.json({ signals: [] }))
  await api.signals('https://example.test')
  expect(seen[0].get('cf-access-token')).toBe(live)
  await api.signals('https://other.test')
  expect(seen[1].get('cf-access-token')).toBeNull()
  expect(auth.expired()).toBe(0)
})
test('만료된 토큰은 보내지 않고 다시 로그인하게 해요', async () => {
  const auth = withSession(fakeToken({ exp: Math.floor(Date.now() / 1000) - 1 }))
  const seen = capture(() => Response.json({}))
  expect(await api.signals('https://example.test').catch(errorMessage)).toBe('로그인이 필요해요')
  expect(seen).toHaveLength(0)
  expect(auth.expired()).toBe(1)
})
test('토큰을 붙인 요청이 401 이나 Access 로그인으로 가면 토큰을 버려요', async () => {
  const auth = withSession(live)
  capture(() => new Response('', { status: 401 }))
  await api.signals('https://example.test').catch(() => {})
  capture(() => {
    const response = new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })
    Object.defineProperty(response, 'url', { value: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' })
    return response
  })
  await api.signals('https://example.test').catch(() => {})
  expect(auth.tokens).toEqual([live, live])
  // 서버 오류나 JSON 이 아닌 응답(프록시 오류 페이지)은 로그인 문제가 아니라 토큰을 지켜요
  capture(() => new Response('', { status: 500 }))
  await api.signals('https://example.test').catch(() => {})
  capture(() => new Response('<html>bad gateway</html>', { headers: { 'content-type': 'text/html' } }))
  expect(await api.signals('https://example.test').catch(errorMessage)).toBe('서버 응답을 읽지 못했어요')
  expect(auth.expired()).toBe(2)
})
test('HTTP 서버에는 같은 주소여도 토큰을 붙이지 않아요', async () => {
  withSession(live, 'http://192.168.0.2:3070')
  const seen = capture(() => Response.json({ signals: [] }))
  await api.signals('http://192.168.0.2:3070')
  expect(seen[0].get('cf-access-token')).toBeNull()
})
test('다른 서버의 401 은 로그인 토큰을 지우지 않아요', async () => {
  const auth = withSession(live)
  capture(() => new Response('', { status: 401 }))
  await api.signals('https://other.test').catch(() => {})
  expect(auth.expired()).toBe(0)
})

async function writeError(response: Response | Error) {
  globalThis.fetch = Object.assign(
    async () => {
      if (response instanceof Error) throw response
      return response
    },
    { preconnect: originalFetch.preconnect },
  )
  try {
    await scopedClient('https://example.test').write('/api/x', 'PUT', { a: 1 })
  } catch (error) {
    return error
  }
  throw new Error('expected write failure')
}
test('쓰기 409 는 서버가 돌려준 본문을 그대로 든 충돌이에요', async () => {
  const error = await writeError(Response.json({ error: '다른 곳에서 먼저 저장했어요', ops: { rev: 4 } }, { status: 409 }))
  expect(error).toBeInstanceOf(ConflictError)
  expect((error as ConflictError).body).toEqual({ error: '다른 곳에서 먼저 저장했어요', ops: { rev: 4 } })
})
test('서버 err() 의 JSON 4xx 는 거절이라 쓰이지 않았어요', async () => {
  const error = await writeError(Response.json({ error: 'bad' }, { status: 400 }))
  expect(error).toBeInstanceOf(ApiError)
  expect((error as ApiError).rejected).toBe(true)
})
test('JSON 이 아닌 4xx·5xx·끊긴 연결은 결과 불명이에요', async () => {
  for (const response of [new Response('<html>bad gateway</html>', { status: 404, headers: { 'content-type': 'text/html' } }), new Response('', { status: 502 }), new Error('network lost')]) {
    expect(await writeError(response)).toBeInstanceOf(UnknownWriteError)
  }
})

test('이미지 주소에는 같은 https 서버의 로그인만 붙여요', () => {
  const token = fakeToken({ exp: Math.floor(Date.now() / 1000) + 3600, email: 'a@b.c' })
  configureAuth({ session: () => ({ origin: 'https://board.test', token }), expired: () => {} })
  expect(imageSource('https://board.test', '/api/files/a.png')).toEqual({ uri: 'https://board.test/api/files/a.png', headers: { 'cf-access-token': token } })
  expect(imageSource('https://board.test', 'https://other.test/a.png')).toEqual({ uri: 'https://other.test/a.png' })
  expect(imageSource('https://board.test', 'https://board.test:8443/a.png')).toEqual({ uri: 'https://board.test:8443/a.png' })
  expect(imageSource('http://board.test', '/a.png')).toEqual({ uri: 'http://board.test/a.png' })
})

test('쓰기 뒤 JSON 이 아닌 성공 응답은 이미 적용됐을 수 있어 결과 불명이에요', async () => {
  expect(await writeError(new Response('<html>ok</html>', { headers: { 'content-type': 'text/html' } }))).toBeInstanceOf(UnknownWriteError)
})
test('Access 로그인 주소로 간 쓰기는 서버에 닿지 않은 확실한 거절이에요', async () => {
  const response = Response.json({})
  Object.defineProperty(response, 'url', { value: 'https://team.cloudflareaccess.com/login' })
  const error = await writeError(response)
  expect(error).toBeInstanceOf(ApiError)
  expect((error as ApiError).rejected).toBe(true)
})

// 규칙 A(014_write_inventory.md): 쓰기는 화면을 연 시점의 범위 고정 클라이언트로만. 전역 클라이언트·request 의 쓰기 메서드는 보내지 않아요
test('전역 클라이언트의 쓰기와 request 의 POST 는 보내지 않고 GlobalWriteError', async () => {
  const sent: string[] = []
  globalThis.fetch = Object.assign(async (url: string | URL | Request) => { sent.push(String(url)); return Response.json({ ok: true }) }, { preconnect: originalFetch.preconnect })
  await expect(globalClient('https://example.test').write('/api/boards/b/items/i', 'PUT', {})).rejects.toBeInstanceOf(GlobalWriteError)
  await expect(request('https://example.test', '/api/files', { method: 'POST', body: 'x' })).rejects.toBeInstanceOf(GlobalWriteError)
  expect(sent).toEqual([])
  await request('https://example.test', '/api/state')
  expect(sent).toEqual(['https://example.test/api/state'])
})
