// Cloudflare Access 로그인 확인: 공개 리스너(quorum.lidgeai.com → 터널 → 127.0.0.1:4318)에 온 요청의 사람을 알아내요.
// 출처: board/apps/server/server/auth.ts (방향판 2ee6e8a) 의 normalizeTeam, createAuth(키 목록 받기·캐시·쿨다운·12시간 상한, verifyAccessJwt),
// who() 의 Cf-Access-Jwt-Assertion 헤더 → CF_Authorization 쿠키 순서, publicCsrfAllowed. 검증 규칙은 한 줄도 느슨하게 하지 않았어요.
// 바꾼 점: Quorum 공개 리스너는 사람 로그인만 받아요. AGENT_TOKEN Bearer 와 DEV_LOCAL_USER 경로는 뺐고(로컬 4317 은 local-guard 가 맡아요),
// 공개 리스너에서는 ALLOWED_EMAILS 가 비어 있으면 아무도 들어오지 못해요(board 의 listener === "public" 규칙과 같음).
export type User = { email: string }
export type AccessConfig = { team: string; aud: string; allowed: string[]; fetch?: typeof globalThis.fetch; now?: () => number }

export function normalizeTeam(team: string): string {
  const name = team.trim().replace(/^https:\/\//i, "").replace(/\/+$/, "")
  return name.includes(".") ? name : name + ".cloudflareaccess.com"
}

export function parseAllowed(raw: string | undefined): string[] {
  return (raw || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
}

export function createAccess(config: AccessConfig) {
  const team = normalizeTeam(config.team)
  const now = config.now || Date.now
  const get = config.fetch || globalThis.fetch
  let certs: { keys: JsonWebKey[] } | null = null
  let certsAt = 0
  let lastFetchAt: number | null = null
  let fetching: Promise<boolean> | null = null
  const keys = new Map<string, CryptoKey>()
  const b64u = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
  const kidOf = (k: JsonWebKey) => (k as JsonWebKey & { kid?: string }).kid
  function refresh(): Promise<boolean> {
    if (fetching) return fetching
    lastFetchAt = now()
    fetching = (async () => {
      const response = await get("https://" + team + "/cdn-cgi/access/certs")
      if (!response.ok) return false
      const body = (await response.json()) as { keys: JsonWebKey[] }
      if (!Array.isArray(body.keys)) return false
      certs = body; certsAt = now(); keys.clear()
      return true
    })().finally(() => { fetching = null })
    return fetching
  }
  async function accessKey(kid: string): Promise<CryptoKey | null> {
    const coolingDown = !fetching && lastFetchAt !== null && now() - lastFetchAt < 60_000
    if (!certs || now() - certsAt >= 3600_000) {
      // 조회 실패 뒤 60초는 다시 받지 않는다. 만료된 키 목록은 새로 받기 전까지 그대로 쓴다
      if (!coolingDown) await refresh().catch(() => false)
      // 갱신이 계속 실패해도 오래된 키 목록은 받은 뒤 12시간까지만 쓴다(철회된 키를 무기한 믿지 않도록)
      if (!certs || now() - certsAt >= 12 * 3600_000) return null
    } else if (!certs.keys.some((k) => kidOf(k) === kid) && (fetching || lastFetchAt === null || now() - lastFetchAt >= 60_000)) {
      if (!(await refresh().catch(() => false))) return null
    }
    const cached = keys.get(kid)
    if (cached) return cached
    const jwk = certs?.keys.find((k) => kidOf(k) === kid)
    if (!jwk) return null
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])
    keys.set(kid, key)
    return key
  }
  async function verifyAccessJwt(token: string): Promise<string | null> {
    try {
      const parts = token.split(".")
      if (parts.length !== 3 || parts.some((p) => !p || !/^[A-Za-z0-9_-]+$/.test(p))) return null
      const [h, p, s] = parts
      const header = JSON.parse(new TextDecoder().decode(b64u(h))) as { alg?: unknown; kid?: unknown }
      const payload = JSON.parse(new TextDecoder().decode(b64u(p))) as { aud?: unknown; iss?: unknown; exp?: unknown; nbf?: unknown; email?: unknown }
      if (header.alg !== "RS256" || typeof header.kid !== "string") return null
      if (!config.aud || !(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(config.aud)) return null
      if (payload.iss !== "https://" + team || typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp * 1000 <= now()) return null
      if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf) || payload.nbf * 1000 > now())) return null
      if (typeof payload.email !== "string" || !payload.email) return null
      const key = await accessKey(header.kid)
      if (!key || !(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(s), new TextEncoder().encode(h + "." + p)))) return null
      return payload.email.toLowerCase()
    } catch { return null }
  }
  async function who(req: Request): Promise<User | null> {
    let jwt = req.headers.get("cf-access-jwt-assertion")
    if (!jwt) {
      const value = (req.headers.get("cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1]
      try { jwt = value ? decodeURIComponent(value) : null } catch { return null }
    }
    if (!jwt) return null
    const email = await verifyAccessJwt(jwt)
    if (!email || !config.allowed.includes(email)) return null
    return { email }
  }
  return { who, verifyAccessJwt }
}

/** 공개 리스너의 교차 사이트 쓰기 막기. GET 은 통과, 쓰기는 Origin 이 PUBLIC_ORIGIN 과 같거나 Origin 없이 cross-site 가 아닐 때만 (board auth.ts 그대로) */
export function publicCsrfAllowed(req: Request, origin: string): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true
  const supplied = req.headers.get("origin")
  return supplied !== null ? supplied === origin : req.headers.get("sec-fetch-site")?.toLowerCase() !== "cross-site"
}
