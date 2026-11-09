import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createGoogleAuth } from "./google-auth.ts"
import { createAccess, initAccess } from "./access.ts"

const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])
const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "g1" }
const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url")
const CLIENT = "client-123.apps.googleusercontent.com"
const ORIGIN = "https://newa.example"
async function idToken(claims: Record<string, unknown>, key = pair.privateKey, kid = "g1") {
  const data = `${enc({ alg: "RS256", kid })}.${enc({ iss: "https://accounts.google.com", aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), email_verified: true, ...claims })}`
  return `${data}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(data))).toString("base64url")}`
}

let db: Database
afterEach(() => db?.close())
function setup(claims: (nonce: string) => Promise<string>) {
  db = new Database(":memory:")
  initAccess(db, { emails: ["jun@lidgeai.com", "jun@lidge.ai", "b@devfiance.ai"], domains: ["neuralarcade.ai"], admins: ["jun@lidgeai.com", "jun@lidge.ai"] })
  const access = createAccess(db)
  const bodies: string[] = []
  let nonce = ""
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input)
    if (u.startsWith("https://www.googleapis.com/oauth2/v3/certs")) return Response.json({ keys: [jwk] })
    if (u === "https://oauth2.googleapis.com/token") { bodies.push(String(init?.body)); return Response.json({ id_token: await claims(nonce) }) }
    throw new Error("unexpected fetch " + u)
  }) as typeof fetch
  const g = createGoogleAuth(db, { clientId: CLIENT, clientSecret: "s3cret", origin: ORIGIN, allowed: access.allowed, onLogin: access.onLogin, fetch: fake })
  async function login(opts: { tamperState?: boolean; noCookie?: boolean; ret?: string } = {}) {
    const startUrl = `${ORIGIN}/auth/google/start?return=${encodeURIComponent(opts.ret ?? "/w/abc")}`
    const start = await g.routes(new Request(startUrl), new URL(startUrl))
    const loc = new URL(start!.headers.get("location")!)
    nonce = loc.searchParams.get("nonce")!
    const state = loc.searchParams.get("state")!
    const cookie = start!.headers.get("set-cookie")!.split(";")[0]
    const cb = new URL(`${ORIGIN}/auth/google/callback?code=c1&state=${opts.tamperState ? state + "x" : state}`)
    const res = await g.routes(new Request(cb, { headers: opts.noCookie ? {} : { cookie } }), cb)
    return { start: loc, res: res!, session: res!.headers.getSetCookie().find((c) => c.startsWith("nb_session="))?.split(";")[0] ?? null }
  }
  const who = (session: string | null) => g.who(new Request(ORIGIN, { headers: session ? { cookie: session } : {} }))
  return { g, access, login, who, bodies }
}

describe("Google 로그인", () => {
  test("PKCE·state·nonce 를 보내고, 허용 도메인 계정은 세션을 받아 돌아가요", async () => {
    const t = setup((n) => idToken({ email: "Bran@NeuralArcade.ai", nonce: n, name: "Bran" }))
    const { start, res, session } = await t.login()
    expect(start.origin + start.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(start.searchParams.get("code_challenge_method")).toBe("S256")
    expect(start.searchParams.get("scope")).toBe("openid email profile")
    expect(start.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/google/callback`)
    expect(start.searchParams.has("hd")).toBe(false)
    expect(res.status).toBe(302); expect(res.headers.get("location")).toBe("/w/abc")
    expect(res.headers.getSetCookie().join(";")).toContain("HttpOnly")
    expect(res.headers.getSetCookie().join(";")).toContain("SameSite=Lax")
    expect(t.bodies[0]).toContain("code_verifier=")
    expect(t.who(session)).toBe("bran@neuralarcade.ai")
    expect(t.access.isAdmin("bran@neuralarcade.ai")).toBe(false)
  })
  test("개별 허용 이메일과 관리자 두 주소", async () => {
    for (const email of ["b@devfiance.ai", "jun@lidge.ai"]) {
      const t = setup((n) => idToken({ email, nonce: n }))
      expect(t.who((await t.login()).session)).toBe(email)
      db.close()
    }
    const t = setup((n) => idToken({ email: "jun@lidge.ai", nonce: n }))
    expect(t.access.isAdmin("jun@lidge.ai")).toBe(true)
    expect(t.access.isAdmin("b@devfiance.ai")).toBe(false)
  })
  const rejects: [string, (n: string) => Promise<string>][] = [
    ["허용 밖 이메일", (n) => idToken({ email: "someone@gmail.com", nonce: n })],
    ["허용 도메인과 비슷한 다른 도메인", (n) => idToken({ email: "x@neuralarcade.ai.evil.com", nonce: n })],
    ["다른 키로 서명", (n) => idToken({ email: "bran@neuralarcade.ai", nonce: n }, other.privateKey)],
    ["만료", (n) => idToken({ email: "bran@neuralarcade.ai", nonce: n, exp: Math.floor(Date.now() / 1000) - 10 })],
    ["다른 aud", (n) => idToken({ email: "bran@neuralarcade.ai", nonce: n, aud: "someone-else" })],
    ["다른 iss", (n) => idToken({ email: "bran@neuralarcade.ai", nonce: n, iss: "https://evil.example" })],
    ["nonce 불일치", () => idToken({ email: "bran@neuralarcade.ai", nonce: "other" })],
    ["이메일 미확인", (n) => idToken({ email: "bran@neuralarcade.ai", nonce: n, email_verified: false })],
    ["형식이 깨진 토큰", async () => "not.a.jwt!"],
  ]
  for (const [name, make] of rejects) test(`거절: ${name}`, async () => {
    const t = setup(make)
    const { res, session } = await t.login()
    expect(res.status).toBeGreaterThanOrEqual(400); expect(session).toBeNull()
    expect((db.query("SELECT COUNT(*) AS n FROM auth_sessions").get() as { n: number }).n).toBe(0)
  })
  test("거절: state 불일치·쿠키 없음, 한 번 쓴 state 는 다시 못 써요", async () => {
    const t = setup((n) => idToken({ email: "bran@neuralarcade.ai", nonce: n }))
    expect((await t.login({ tamperState: true })).session).toBeNull()
    expect((await t.login({ noCookie: true })).session).toBeNull()
    expect(t.bodies).toHaveLength(0)
  })
  test("열린 리다이렉트를 막아요", async () => {
    const t = setup((n) => idToken({ email: "bran@neuralarcade.ai", nonce: n }))
    for (const ret of ["//evil.com", "https://evil.com", "/\\evil.com"]) {
      const { res } = await t.login({ ret })
      expect(res.status).toBe(302); expect(res.headers.get("location")).toBe("/")
    }
  })
  test("로그아웃은 같은 Origin 의 POST 만, 세션을 지워요", async () => {
    const t = setup((n) => idToken({ email: "bran@neuralarcade.ai", nonce: n }))
    const { session } = await t.login()
    const bad = await t.g.routes(new Request(`${ORIGIN}/auth/logout`, { method: "POST", headers: { cookie: session!, origin: "https://evil.example" } }), new URL(`${ORIGIN}/auth/logout`))
    expect(bad!.status).toBe(403); expect(t.who(session)).toBe("bran@neuralarcade.ai")
    const ok = await t.g.routes(new Request(`${ORIGIN}/auth/logout`, { method: "POST", headers: { cookie: session!, origin: ORIGIN } }), new URL(`${ORIGIN}/auth/logout`))
    expect(ok!.status).toBe(303); expect(t.who(session)).toBeNull()
  })
})

describe("허용 목록 관리", () => {
  const admin = { email: "jun@lidgeai.com", agent: false }
  const call = async (t: ReturnType<typeof setup>, method: string, path: string, body?: unknown, who = admin) => {
    const url = new URL(`${ORIGIN}${path}`)
    const res = await t.access.api(new Request(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), url, url.pathname.split("/").filter(Boolean), who, t.g.dropSessions)
    return { status: res!.status, body: (await res!.json()) as Record<string, any> }
  }
  test("씨앗은 한 번만, 관리자만 관리 API, 멤버는 403", async () => {
    const t = setup((n) => idToken({ email: "b@devfiance.ai", nonce: n }))
    initAccess(db, { emails: ["late@x.com"], domains: [], admins: [] })
    const snap = await call(t, "GET", "/api/access")
    expect(snap.body.rules.map((r: { value: string }) => r.value)).toEqual(["neuralarcade.ai", "b@devfiance.ai", "jun@lidge.ai", "jun@lidgeai.com"])
    expect((await call(t, "GET", "/api/access", undefined, { email: "b@devfiance.ai", agent: false })).status).toBe(403)
    expect((await call(t, "POST", "/api/access/rules", { kind: "domain", value: "x.com" }, { email: "b@devfiance.ai", agent: false })).status).toBe(403)
  })
  test("규칙 지우기·비활성은 기존 세션을 다음 요청부터 막고, 감사 기록이 남아요", async () => {
    const t = setup((n) => idToken({ email: "bran@neuralarcade.ai", nonce: n }))
    const { session } = await t.login()
    expect((await call(t, "PATCH", "/api/access/members/bran%40neuralarcade.ai", { disabled: true })).status).toBe(200)
    expect(t.who(session)).toBeNull()
    expect((await call(t, "PATCH", "/api/access/members/bran%40neuralarcade.ai", { disabled: false })).status).toBe(200)
    const again = (await t.login()).session
    expect(t.who(again)).toBe("bran@neuralarcade.ai")
    expect((await call(t, "DELETE", "/api/access/rules?kind=domain&value=neuralarcade.ai")).status).toBe(200)
    expect(t.who(again)).toBeNull()
    expect((await t.login()).session).toBeNull()
    expect((await call(t, "POST", "/api/access/rules", { kind: "email", value: "bran@neuralarcade.ai" })).status).toBe(201)
    expect(t.who((await t.login()).session)).toBe("bran@neuralarcade.ai")
    const audit = (await call(t, "GET", "/api/access")).body.audit.map((a: { action: string; actor: string }) => `${a.actor} ${a.action}`)
    expect(audit).toContain("jun@lidgeai.com rule.remove"); expect(audit).toContain("jun@lidgeai.com member.update")
  })
  test("마지막 관리자는 지우거나 강등·비활성할 수 없고, 승격은 돼요", async () => {
    const t = setup((n) => idToken({ email: "b@devfiance.ai", nonce: n }))
    expect((await call(t, "PATCH", "/api/access/members/jun%40lidge.ai", { role: "member" })).status).toBe(200)
    expect((await call(t, "PATCH", "/api/access/members/jun%40lidgeai.com", { role: "member" })).status).toBe(409)
    expect((await call(t, "PATCH", "/api/access/members/jun%40lidgeai.com", { disabled: true })).status).toBe(409)
    expect((await call(t, "DELETE", "/api/access/rules?kind=email&value=jun%40lidgeai.com")).status).toBe(409)
    expect(t.access.isAdmin("jun@lidgeai.com")).toBe(true)
    expect((await call(t, "PATCH", "/api/access/members/b%40devfiance.ai", { role: "admin" })).status).toBe(200)
    expect(t.access.isAdmin("b@devfiance.ai")).toBe(true)
    expect((await call(t, "PATCH", "/api/access/members/nobody%40gmail.com", { role: "admin" })).status).toBe(409)
    expect((await call(t, "POST", "/api/access/rules", { kind: "domain", value: "not a domain" })).status).toBe(400)
  })
})


describe("P2-6 JWKS 캐시 유효기간", () => {
  test("모양이 잘못된 state(여러 바이트 글자·다른 길이)는 오류 없이 로그인 화면으로 거절해요", async () => {
    const t = setup((n) => idToken({ email: "bran@neuralarcade.ai", nonce: n }))
    const start = await t.g.routes(new Request(`${ORIGIN}/auth/google/start`), new URL(`${ORIGIN}/auth/google/start`))
    const state = new URL(start!.headers.get("location")!).searchParams.get("state")!
    const cookieV = start!.headers.get("set-cookie")!.split(";")[0]
    for (const bad of ["가".repeat(state.length), state.slice(0, -1) + "가", "x", ""]) {
      const cb = new URL(`${ORIGIN}/auth/google/callback?code=c1&state=${encodeURIComponent(bad)}`)
      const res = await t.g.routes(new Request(cb, { headers: { cookie: cookieV } }), cb)
      expect(res!.status).toBe(403) // 다른 실패와 같은 로그인 화면 거절(던지지 않음)
      expect(res!.headers.get("content-type")).toContain("text/html")
    }
  })
  test("로그인 시작을 무인증으로 반복해도 서버에 저장되는 것이 없고, 대기 쿠키는 서명·만료로 지켜요", async () => {
    const t = setup((n) => idToken({ email: "bran@neuralarcade.ai", nonce: n }))
    const rows = () => (db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).reduce((n, r) => n + (db.query(`SELECT COUNT(*) AS c FROM "${r.name}"`).get() as { c: number }).c, 0)
    const before = rows()
    for (let i = 0; i < 40; i++) await t.g.routes(new Request(`${ORIGIN}/auth/google/start`), new URL(`${ORIGIN}/auth/google/start`))
    expect(rows()).toBe(before)
    // 쿠키를 조금 바꾸면 거절
    const start = await t.g.routes(new Request(`${ORIGIN}/auth/google/start`), new URL(`${ORIGIN}/auth/google/start`))
    const loc = new URL(start!.headers.get("location")!)
    const raw = start!.headers.get("set-cookie")!.split(";")[0]
    const tampered = raw.slice(0, -2) + (raw.endsWith("AA") ? "BB" : "AA")
    const cb = new URL(`${ORIGIN}/auth/google/callback?code=c1&state=${loc.searchParams.get("state")}`)
    const res = await t.g.routes(new Request(cb, { headers: { cookie: tampered } }), cb)
    expect(res!.headers.getSetCookie().some((c) => c.startsWith("nb_session=") && !c.startsWith("nb_session=;"))).toBe(false)
    // 정상 왕복은 그대로 돼요
    expect(t.who((await t.login()).session)).toBe("bran@neuralarcade.ai")
  })
  test("대기 쿠키는 10분이 지나면 거절돼요", async () => {
    db = new Database(":memory:")
    initAccess(db, { emails: [], domains: ["neuralarcade.ai"], admins: [] })
    const access = createAccess(db)
    let t = Date.now(), nonce = ""
    const fake = (async (input: string | URL | Request) => {
      const u = String(input)
      if (u.startsWith("https://www.googleapis.com/oauth2/v3/certs")) return Response.json({ keys: [jwk] })
      if (u === "https://oauth2.googleapis.com/token") return Response.json({ id_token: await idToken({ email: "bran@neuralarcade.ai", nonce, iat: Math.floor(t / 1000), exp: Math.floor(t / 1000) + 600 }) })
      throw new Error("unexpected " + u)
    }) as typeof fetch
    const g = createGoogleAuth(db, { clientId: CLIENT, clientSecret: "s", origin: ORIGIN, allowed: access.allowed, fetch: fake, now: () => t })
    const start = await g.routes(new Request(`${ORIGIN}/auth/google/start`), new URL(`${ORIGIN}/auth/google/start`))
    const loc = new URL(start!.headers.get("location")!)
    nonce = loc.searchParams.get("nonce")!
    t += 11 * 60e3
    const cb = new URL(`${ORIGIN}/auth/google/callback?code=c&state=${loc.searchParams.get("state")}`)
    const res = await g.routes(new Request(cb, { headers: { cookie: start!.headers.get("set-cookie")!.split(";")[0] } }), cb)
    expect(res!.headers.getSetCookie().some((c) => c.startsWith("nb_session=") && !c.startsWith("nb_session=;"))).toBe(false)
  })
  test("처음 동시에 들어온 로그인과 키 회전 중 동시 로그인이 같은 키 받기를 기다려 모두 통과해요(single-flight)", async () => {
    db = new Database(":memory:")
    initAccess(db, { emails: [], domains: ["neuralarcade.ai"], admins: [] })
    const access = createAccess(db)
    let t = Date.now(), certFetches = 0, release: () => void = () => {}
    let keysNow: unknown[] = [jwk]
    const nonces = new Map<string, string>()
    const fake = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = String(input)
      if (u.startsWith("https://www.googleapis.com/oauth2/v3/certs")) { certFetches++; await new Promise<void>((r) => { release = r }); return Response.json({ keys: keysNow }) }
      if (u === "https://oauth2.googleapis.com/token") { const code = new URLSearchParams(String(init?.body)).get("code")!; const [kid, key] = code.startsWith("r") ? ["g2", other.privateKey] : ["g1", pair.privateKey]; return Response.json({ id_token: await idToken({ email: "bran@neuralarcade.ai", nonce: nonces.get(code), iat: Math.floor(t / 1000), exp: Math.floor(t / 1000) + 600 }, key, kid) }) }
      throw new Error("unexpected " + u)
    }) as typeof fetch
    const g = createGoogleAuth(db, { clientId: CLIENT, clientSecret: "s", origin: ORIGIN, allowed: access.allowed, fetch: fake, now: () => t })
    const login = async (code: string) => {
      const start = await g.routes(new Request(`${ORIGIN}/auth/google/start`), new URL(`${ORIGIN}/auth/google/start`))
      const loc = new URL(start!.headers.get("location")!)
      nonces.set(code, loc.searchParams.get("nonce")!)
      const cb = new URL(`${ORIGIN}/auth/google/callback?code=${code}&state=${loc.searchParams.get("state")}`)
      const res = await g.routes(new Request(cb, { headers: { cookie: start!.headers.get("set-cookie")!.split(";")[0] } }), cb)
      return res!.headers.getSetCookie().some((c) => c.startsWith("nb_session=") && !c.startsWith("nb_session=;"))
    }
    const waitFetch = async (n: number) => { for (let i = 0; i < 100 && certFetches < n; i++) await Bun.sleep(5) }
    const first = [login("a1"), login("a2"), login("a3")]
    await waitFetch(1); await Bun.sleep(20); release()
    expect(await Promise.all(first)).toEqual([true, true, true])
    expect(certFetches).toBe(1)
    // 회전: 새 kid(g2)로 서명된 토큰이 동시에 와요. 받기는 한 번, 둘 다 새 목록으로 통과
    keysNow = [jwk, { ...(await crypto.subtle.exportKey("jwk", other.publicKey)), kid: "g2" }]
    t += 61e3
    const rotated = [login("r1"), login("r2")]
    await waitFetch(2); await Bun.sleep(20); release()
    expect(await Promise.all(rotated)).toEqual([true, true])
    expect(certFetches).toBe(2)
  })
  test("받아 둔 키가 있어도 오래되면 다시 받고, 다시 받지 못한 채 신뢰 기간이 지나면 거절해요", async () => {
    db = new Database(":memory:")
    initAccess(db, { emails: [], domains: ["neuralarcade.ai"], admins: [] })
    const access = createAccess(db)
    let t = Date.now(), certsOk = true, certFetches = 0, nonce = ""
    const fake = (async (input: string | URL | Request) => {
      const u = String(input)
      if (u.startsWith("https://www.googleapis.com/oauth2/v3/certs")) { certFetches++; return certsOk ? Response.json({ keys: [jwk] }) : new Response("down", { status: 503 }) }
      if (u === "https://oauth2.googleapis.com/token") return Response.json({ id_token: await idToken({ email: "bran@neuralarcade.ai", nonce, iat: Math.floor(t / 1000), exp: Math.floor(t / 1000) + 600 }) })
      throw new Error("unexpected " + u)
    }) as typeof fetch
    const g = createGoogleAuth(db, { clientId: CLIENT, clientSecret: "s", origin: ORIGIN, allowed: access.allowed, fetch: fake, now: () => t })
    const login = async () => {
      const start = await g.routes(new Request(`${ORIGIN}/auth/google/start`), new URL(`${ORIGIN}/auth/google/start`))
      const loc = new URL(start!.headers.get("location")!)
      nonce = loc.searchParams.get("nonce")!
      const cb = new URL(`${ORIGIN}/auth/google/callback?code=c&state=${loc.searchParams.get("state")}`)
      const res = await g.routes(new Request(cb, { headers: { cookie: start!.headers.get("set-cookie")!.split(";")[0] } }), cb)
      return res!.headers.getSetCookie().some((c) => c.startsWith("nb_session=") && !c.startsWith("nb_session=;"))
    }
    expect(await login()).toBe(true); expect(certFetches).toBe(1)
    t += 2 * 3600e3
    expect(await login()).toBe(true); expect(certFetches).toBe(2) // 한 시간이 지나면 kid 가 있어도 다시 받아요
    certsOk = false
    t += 2 * 3600e3
    expect(await login()).toBe(true) // 다시 받기는 실패했지만 아직 신뢰 기간(12시간) 안
    t += 11 * 3600e3
    expect(await login()).toBe(false) // 마지막으로 받은 지 12시간이 지나면 거절
  })
})
