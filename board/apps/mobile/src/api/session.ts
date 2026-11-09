// Cloudflare Access 로그인 흐름의 순수 부분. 앱 상태·Keychain 은 auth.tsx 에 있어요.
export const AUTH_CALLBACK = 'direction://auth'
export type AccessSession = { origin: string; token: string }
export type TokenClaims = { exp: number; email: string | null }
const STATE = /^[A-Za-z0-9_-]{32,128}$/

export function encodeState(bytes: Uint8Array): string {
  if (bytes.length < 24) throw new Error('state 에 쓸 무작위 바이트가 부족해요')
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function loginUrl(origin: string, state: string): string {
  return `${origin}/api/mobile/auth?state=${encodeURIComponent(state)}`
}
/** 콜백 주소에서 토큰을 꺼내요. 다른 주소이거나 이번에 보낸 state 와 다르면 받지 않아요. */
export function readCallback(url: string, expectedState: string): string {
  if (!STATE.test(expectedState)) throw new Error('로그인 요청 정보가 올바르지 않아요')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('로그인 응답을 읽지 못했어요')
  }
  if (`${parsed.protocol}//${parsed.host}${parsed.pathname}` !== AUTH_CALLBACK)
    throw new Error('로그인 응답 주소가 달라요')
  const states = parsed.searchParams.getAll('state')
  if (states.length !== 1 || states[0] !== expectedState) throw new Error('로그인 요청과 응답이 맞지 않아요')
  const tokens = parsed.searchParams.getAll('token')
  if (tokens.length !== 1 || !tokenClaims(tokens[0])) throw new Error('로그인 응답에 토큰이 없어요')
  return tokens[0]
}
/** 서명은 서버와 Cloudflare 가 검증해요. 앱은 만료 시각과 표시할 이메일만 읽어요. */
export function tokenClaims(token: string): TokenClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload: unknown = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)))
    if (typeof payload !== 'object' || payload === null) return null
    const { exp, email } = payload as { exp?: unknown; email?: unknown }
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return null
    return { exp, email: typeof email === 'string' ? email : null }
  } catch {
    return null
  }
}
/** 30초 안에 끝나는 토큰도 만료로 봐요(요청이 가는 동안 끝나지 않도록). */
export function isExpired(token: string, now = Date.now()): boolean {
  const claims = tokenClaims(token)
  return !claims || claims.exp * 1000 <= now + 30_000
}
