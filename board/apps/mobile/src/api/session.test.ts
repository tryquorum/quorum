import { expect, test } from 'bun:test'
import { AUTH_CALLBACK, encodeState, isExpired, loginUrl, readCallback, tokenClaims } from './session'

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
const fakeToken = (payload: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`
const state = encodeState(new Uint8Array(32).map((_, i) => i * 7))
const token = fakeToken({ exp: Math.floor(Date.now() / 1000) + 3600, email: 'jun@lidgeai.com' })
const callback = (query: string) => `${AUTH_CALLBACK}?${query}`

test('state 는 서버가 받는 base64url 43자예요', () => {
  expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(() => encodeState(new Uint8Array(8))).toThrow()
  expect(loginUrl('https://direction.lidgeai.com', state)).toBe(
    `https://direction.lidgeai.com/api/mobile/auth?state=${state}`,
  )
})
test('보낸 state 와 같은 콜백에서만 토큰을 꺼내요', () => {
  expect(readCallback(callback(`state=${state}&token=${token}`), state)).toBe(token)
  const other = encodeState(new Uint8Array(32).fill(1))
  expect(() => readCallback(callback(`state=${other}&token=${token}`), state)).toThrow('맞지 않아요')
  expect(() => readCallback(callback(`state=${state}&state=${state}&token=${token}`), state)).toThrow()
  expect(() => readCallback(callback(`token=${token}`), state)).toThrow()
  expect(() => readCallback(callback(`state=${state}`), state)).toThrow('토큰이 없어요')
  expect(() => readCallback(callback(`state=${state}&token=garbage`), state)).toThrow('토큰이 없어요')
  expect(() => readCallback(`direction://evil?state=${state}&token=${token}`, state)).toThrow('주소가 달라요')
  expect(() => readCallback(`https://evil.example/auth?state=${state}&token=${token}`, state)).toThrow()
  expect(() => readCallback(callback(`state=${state}&token=${token}`), 'short')).toThrow()
})
test('토큰에서 만료와 이메일만 읽고, 30초 안에 끝나면 만료로 봐요', () => {
  expect(tokenClaims(token)?.email).toBe('jun@lidgeai.com')
  expect(tokenClaims('a.b')).toBeNull()
  expect(tokenClaims(fakeToken({ email: 'x' }))).toBeNull()
  const now = Date.now()
  expect(isExpired(token, now)).toBe(false)
  expect(isExpired(fakeToken({ exp: Math.floor(now / 1000) + 10 }), now)).toBe(true)
  expect(isExpired(fakeToken({ exp: (now + 30_000) / 1000 }), now)).toBe(true)
  expect(isExpired(fakeToken({ exp: (now + 31_000) / 1000 }), now)).toBe(false)
  expect(isExpired(fakeToken({ exp: Math.floor(now / 1000) - 10 }), now)).toBe(true)
  expect(isExpired('not-a-token', now)).toBe(true)
})
