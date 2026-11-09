// 앱 자체 Google 로그인(파일럿: newa.lidgeai.com). 설계: docs/internals/google-login.md
// OIDC authorization code + PKCE(S256), state·nonce, id_token 서명(RS256, Google JWKS)·iss·aud·exp·nonce·email_verified 검증.
// 허용 판정은 서버의 허용 목록(access.ts, DB 원본)만 봐요(여러 도메인이라 hd 는 쓰지 않음). 세션은 서버 DB 의 무작위 토큰(해시 저장) + HttpOnly·Secure·SameSite=Lax 쿠키.
// 비밀(client secret)·토큰·id_token 원문은 로그에 쓰지 않아요.
import type { Database } from "bun:sqlite"
import { timingSafeEqual } from "node:crypto"

export type GoogleConfig = {
  clientId: string; clientSecret: string; origin: string
  /** 들어올 수 있는 이메일인지(허용 목록·비활성). 로그인 때와 세션을 쓸 때마다 봐요 */
  allowed: (email: string) => boolean
  onLogin?: (email: string, name: string) => void
  fetch?: typeof globalThis.fetch; now?: () => number
}
type Claims = { iss?: unknown; aud?: unknown; exp?: unknown; iat?: unknown; nonce?: unknown; email?: unknown; email_verified?: unknown; name?: unknown }

const SESSION = "nb_session"
const PENDING = "nb_oauth"
const SESSION_MS = 14 * 864e5
const PENDING_MS = 10 * 60e3
const STATE = /^[A-Za-z0-9_-]{43}$/
const TOUCH_MS = 5 * 60e3
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"])
const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN = "https://oauth2.googleapis.com/token"
const CERTS = "https://www.googleapis.com/oauth2/v3/certs"
const KEYS_REFRESH_MS = 3600e3
const KEYS_TRUST_MS = 12 * 3600e3

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url")
const random = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)))
const sha256 = (v: string) => new Bun.CryptoHasher("sha256").update(v).digest("hex")
const fromB64u = (v: string) => Uint8Array.from(Buffer.from(v, "base64url"))
export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=")
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}
const cookie = (name: string, value: string, maxAgeSec: number, path = "/") => `${name}=${value}; Path=${path}; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Lax`
const page = (status: number, title: string, body: string) => new Response(
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;display:grid;place-items:center;min-height:100svh;margin:0;background:#f7f7f5;color:#1f1f1f}main{max-width:360px;padding:32px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#666;margin:0 0 24px}a.btn{display:inline-flex;gap:10px;align-items:center;padding:10px 18px;border-radius:8px;background:#1f1f1f;color:#fff;text-decoration:none;font-weight:600}@media(prefers-color-scheme:dark){body{background:#161616;color:#eee}p{color:#aaa}a.btn{background:#eee;color:#111}}</style></head><body><main>${body}</main></body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" } })

/** 로그인 화면(서버가 그림). 웹 앱은 로그인한 뒤에만 받아요 */
export function loginPage(returnTo: string, note = "") {
  const href = `/auth/google/start?return=${encodeURIComponent(safeReturn(returnTo))}`
  return page(note ? 403 : 401, "방향판 로그인", `<h1>방향판 · 뉴럴아케이드</h1><p>${note || "회사 Google 계정으로 로그인해요."}</p><a class="btn" href="${href}">Google 로 로그인</a>`)
}
/** 돌아갈 주소는 같은 사이트의 경로만(열린 리다이렉트 막기) */
export function safeReturn(v: string | null | undefined): string {
  return typeof v === "string" && /^\/(?!\/)[^\\\s]*$/.test(v) && !v.startsWith("/auth/") ? v : "/"
}

export function initGoogleAuth(db: Database) {
  // 로그인 대기(state·nonce·PKCE verifier)는 서버에 두지 않고 암호화한 짧은 수명 쿠키에 둬요. 예전 대기 표는 지워요(10분짜리 임시 값뿐)
  db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions(hash TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
    DROP TABLE IF EXISTS auth_pending;`)
}

type Pending = { s: string; n: string; v: string; r: string; e: number }
/**
 * 로그인 대기 쿠키: AES-256-GCM(프로세스마다 새 키)으로 감싼 { state, nonce, verifier, return, 만료 }.
 * 서버 저장이 없어 무인증 반복 요청이 DB 를 키우지 못해요. 서버를 다시 띄우면 진행 중이던 로그인만 다시 시작하면 돼요
 */
function pendingBox() {
  const key = crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
  return {
    async seal(p: Pending): Promise<string> {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key, new TextEncoder().encode(JSON.stringify(p))))
      return b64u(new Uint8Array([...iv, ...ct]))
    },
    async open(v: string | null): Promise<Pending | null> {
      if (!v || !/^[A-Za-z0-9_-]{40,2000}$/.test(v)) return null
      try {
        const raw = fromB64u(v)
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await key, raw.slice(12))
        return JSON.parse(new TextDecoder().decode(plain)) as Pending
      } catch { return null }
    },
  }
}

export function createGoogleAuth(db: Database, cfg: GoogleConfig) {
  initGoogleAuth(db)
  const now = cfg.now || Date.now
  const get = cfg.fetch || globalThis.fetch
  const origin = cfg.origin.replace(/\/+$/, "")
  const redirectUri = `${origin}/auth/google/callback`
  let jwks: { keys: (JsonWebKey & { kid?: string })[] } | null = null
  let jwksAt = 0
  const keys = new Map<string, CryptoKey>()
  const box = pendingBox()

  let lastTry = 0
  let inflight: Promise<void> | null = null
  /** Google 공개키 목록 다시 받기. 실패하면 마지막으로 받은 목록을 그대로 둬요(신뢰 기간 안에서만 씀) */
  async function refreshKeys(): Promise<void> {
    lastTry = now()
    const r = await get(CERTS)
    if (!r.ok) return
    const body = (await r.json()) as { keys?: unknown }
    if (!Array.isArray(body.keys)) return
    jwks = { keys: body.keys as (JsonWebKey & { kid?: string })[] }; jwksAt = now(); keys.clear()
  }
  /**
   * kid 의 공개키. 받은 지 1시간이 지났거나 모르는 kid 면(60초에 한 번) 먼저 다시 받아요. 캐시에 키가 있어도 이 검사를 먼저 해요.
   * 다시 받지 못해도 마지막으로 받은 지 12시간까지만 그 목록을 믿고, 그 뒤에는 거절해요(철회된 키를 무기한 믿지 않게)
   */
  async function key(kid: string): Promise<CryptoKey | null> {
    const age = jwks ? now() - jwksAt : Infinity
    const known = !!jwks?.keys.some((k) => k.kid === kid)
    // 받는 중이면 그 받기를 같이 기다려요(single-flight). 처음 동시 로그인·키 회전 중 동시 요청이 빈 목록으로 거절되지 않게
    if (age > KEYS_REFRESH_MS || !known) {
      if (!inflight && now() - lastTry > 60e3) inflight = refreshKeys().catch(() => undefined).finally(() => { inflight = null })
      if (inflight) await inflight
    }
    if (!jwks || now() - jwksAt > KEYS_TRUST_MS) return null
    const cached = keys.get(kid)
    if (cached) return cached
    const jwk = jwks.keys.find((k) => k.kid === kid)
    if (!jwk) return null
    const k = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])
    keys.set(kid, k)
    return k
  }

  /** id_token 검증. 맞으면 이메일·이름, 아니면 거절 이유(로그용, 비밀 없음) */
  async function verify(idToken: string, nonce: string): Promise<{ email: string; name: string } | { error: string }> {
    const parts = idToken.split(".")
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { error: "malformed token" }
    let header: { alg?: unknown; kid?: unknown }, claims: Claims
    try { header = JSON.parse(Buffer.from(parts[0], "base64url").toString()); claims = JSON.parse(Buffer.from(parts[1], "base64url").toString()) } catch { return { error: "malformed token" } }
    if (header.alg !== "RS256" || typeof header.kid !== "string") return { error: "bad header" }
    const k = await key(header.kid).catch(() => null)
    if (!k || !(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", k, fromB64u(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)))) return { error: "bad signature" }
    if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) return { error: "bad issuer" }
    if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(cfg.clientId)) return { error: "bad audience" }
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now()) return { error: "expired" }
    if (typeof claims.iat === "number" && claims.iat * 1000 > now() + 5 * 60e3) return { error: "issued in the future" }
    if (claims.nonce !== nonce) return { error: "bad nonce" }
    if (claims.email_verified !== true || typeof claims.email !== "string") return { error: "email not verified" }
    const email = claims.email.toLowerCase()
    if (!cfg.allowed(email)) return { error: "account not allowed" }
    return { email, name: typeof claims.name === "string" ? claims.name.slice(0, 80) : "" }
  }

  async function start(url: URL): Promise<Response> {
    const state = random(), nonce = random(), verifier = random(48)
    const challenge = b64u(new Uint8Array(new Bun.CryptoHasher("sha256").update(verifier).digest()))
    const sealed = await box.seal({ s: state, n: nonce, v: verifier, r: safeReturn(url.searchParams.get("return")), e: now() + PENDING_MS })
    const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" })
    return new Response(null, { status: 302, headers: { location: `${AUTHORIZE}?${q}`, "set-cookie": cookie(PENDING, sealed, PENDING_MS / 1000, "/auth/google"), "cache-control": "no-store" } })
  }

  async function callback(req: Request, url: URL): Promise<Response> {
    const state = url.searchParams.get("state") || ""
    const code = url.searchParams.get("code") || ""
    const pending = await box.open(readCookie(req, PENDING))
    const clear = cookie(PENDING, "", 0, "/auth/google")
    const deny = (why: string, note = "로그인하지 못했어요. 다시 시도해 주세요.") => {
      console.warn("[google-login] rejected:", why)
      const r = loginPage("/", note); r.headers.append("set-cookie", clear); return r
    }
    if (url.searchParams.get("error")) return deny("provider error")
    // 모양(base64url 43자)과 바이트 길이를 먼저 봐요. 여러 바이트 글자가 섞인 state 로 비교가 던지지 않게(정상 거절)
    const a = Buffer.from(state), b = Buffer.from(typeof pending?.s === "string" ? pending.s : "")
    if (!code || !pending || !STATE.test(state) || a.length !== b.length || !timingSafeEqual(a, b)) return deny("state mismatch")
    if (pending.e < now()) return deny("state expired")
    const row = { nonce: pending.n, verifier: pending.v, return_to: safeReturn(pending.r) }
    let idToken = ""
    try {
      const r = await get(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: row.verifier }) })
      if (!r.ok) return deny(`token exchange ${r.status}`)
      const body = (await r.json()) as { id_token?: unknown }
      idToken = typeof body.id_token === "string" ? body.id_token : ""
    } catch { return deny("token exchange failed") }
    const who = await verify(idToken, row.nonce)
    if ("error" in who) return deny(who.error, who.error === "account not allowed" ? "이 계정으로는 들어올 수 없어요. 회사 계정으로 로그인하거나 관리자에게 허용을 요청해 주세요." : undefined)
    cfg.onLogin?.(who.email, who.name)
    const secret = random()
    db.query("INSERT INTO auth_sessions(hash,email,name,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?,?)").run(sha256(secret), who.email, who.name, now(), now() + SESSION_MS, now())
    const res = new Response(null, { status: 302, headers: { location: row.return_to, "cache-control": "no-store" } })
    res.headers.append("set-cookie", clear)
    res.headers.append("set-cookie", cookie(SESSION, secret, SESSION_MS / 1000))
    return res
  }

  /** 세션 쿠키 → 이메일. 만료·지운 세션은 null */
  function who(req: Request): string | null {
    const secret = readCookie(req, SESSION)
    if (!secret || !/^[A-Za-z0-9_-]{20,100}$/.test(secret)) return null
    const row = db.query("SELECT email, expires_at, last_seen_at FROM auth_sessions WHERE hash=?").get(sha256(secret)) as { email: string; expires_at: number; last_seen_at: number } | null
    if (!row || row.expires_at <= now()) return null
    // 허용 목록에서 지웠거나 비활성으로 바꾼 사람은 다음 요청부터 막아요
    if (!cfg.allowed(row.email)) return null
    if (now() - row.last_seen_at > TOUCH_MS) db.query("UPDATE auth_sessions SET last_seen_at=? WHERE hash=?").run(now(), sha256(secret))
    return row.email
  }

  function logout(req: Request): Response {
    const secret = readCookie(req, SESSION)
    if (secret) db.query("DELETE FROM auth_sessions WHERE hash=?").run(sha256(secret))
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": cookie(SESSION, "", 0), "cache-control": "no-store" } })
  }

  /** /auth/* 경로. 로그아웃은 POST 이고 Origin 이 이 사이트일 때만 */
  async function routes(req: Request, url: URL): Promise<Response | null> {
    if (url.pathname === "/auth/google/start" && req.method === "GET") return start(url)
    if (url.pathname === "/auth/google/callback" && req.method === "GET") return callback(req, url)
    if (url.pathname === "/auth/logout" && req.method === "POST") {
      if (req.headers.get("origin") !== origin) return new Response("origin not allowed", { status: 403 })
      return logout(req)
    }
    if (url.pathname.startsWith("/auth/")) return new Response("not found", { status: 404 })
    return null
  }

  /** 그 사람의 세션을 모두 끊어요(비활성·허용 해제) */
  const dropSessions = (email: string) => { db.query("DELETE FROM auth_sessions WHERE email=?").run(email.toLowerCase()) }

  return { routes, who, verify, dropSessions }
}
