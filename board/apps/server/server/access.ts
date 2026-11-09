// 파일럿 접근 관리: 누가 Google 로그인으로 들어올 수 있는지(허용 이메일·도메인), 역할(관리자·멤버), 비활성, 감사 기록.
// 원본은 DB 예요. env(ACCESS_SEED_*·ADMIN_EMAILS)는 첫 시작 때 한 번 넣는 씨앗이에요. 설계: docs/internals/pilot.md
import type { Database } from "bun:sqlite"
import type { AccessAudit, AccessMember, AccessResponse, AccessRule } from "@direction-board/contracts/api"

type U = { email: string; agent: boolean }
type MemberRow = { email: string; role: "admin" | "member"; disabled: number; name: string | null; first_login_at: number | null; last_login_at: number | null; updated_at: number }
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/
const now = () => Date.now()
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } })
const err = (status: number, error: string) => json({ error }, status)
const domainOf = (email: string) => email.split("@")[1] || ""

export type AccessSeed = { emails: string[]; domains: string[]; admins: string[] }

export function initAccess(db: Database, seed: AccessSeed) {
  db.exec(`CREATE TABLE IF NOT EXISTS access_rules(kind TEXT NOT NULL CHECK(kind IN ('email','domain')), value TEXT NOT NULL, added_by TEXT NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY(kind, value));
    CREATE TABLE IF NOT EXISTS members(email TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin','member')), disabled INTEGER NOT NULL DEFAULT 0, name TEXT, first_login_at INTEGER, last_login_at INTEGER, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS access_audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, at INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT);
    CREATE TABLE IF NOT EXISTS access_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  // 씨앗은 한 번만: 그 뒤에 관리자가 지운 규칙을 다시 살리지 않아요
  db.transaction(() => {
    if (db.query("SELECT 1 FROM access_meta WHERE key='seeded'").get()) return
    const t = now()
    const clean = (v: string) => v.trim().toLowerCase()
    for (const e of [...seed.emails, ...seed.admins].map(clean).filter((e) => EMAIL.test(e))) db.query("INSERT OR IGNORE INTO access_rules VALUES ('email',?,'seed',?)").run(e, t)
    for (const d of seed.domains.map(clean).filter((d) => DOMAIN.test(d))) db.query("INSERT OR IGNORE INTO access_rules VALUES ('domain',?,'seed',?)").run(d, t)
    for (const a of seed.admins.map(clean).filter((e) => EMAIL.test(e))) db.query("INSERT OR IGNORE INTO members(email,role,updated_at) VALUES (?,'admin',?)").run(a, t)
    db.query("INSERT INTO access_meta VALUES ('seeded',?)").run(String(t))
    db.query("INSERT INTO access_audit(actor,at,action,target,detail) VALUES ('seed',?,'seed','access',?)").run(t, JSON.stringify(seed))
  })()
}

export function createAccess(db: Database) {
  const member = (email: string) => db.query("SELECT * FROM members WHERE email=?").get(email) as MemberRow | null
  const ruled = (email: string) => !!db.query("SELECT 1 FROM access_rules WHERE (kind='email' AND value=?) OR (kind='domain' AND value=?)").get(email, domainOf(email))
  /** 지금 들어올 수 있는지: 허용 규칙에 맞고 비활성이 아님. 세션마다 요청마다 다시 봐요(지우면 바로 막혀요) */
  const allowed = (email: string) => { const e = email.toLowerCase(); return ruled(e) && !member(e)?.disabled }
  const isAdmin = (email: string) => { const m = member(email.toLowerCase()); return !!m && m.role === "admin" && !m.disabled && ruled(m.email) }
  const activeAdmins = () => (db.query("SELECT * FROM members WHERE role='admin' AND disabled=0").all() as MemberRow[]).filter((m) => ruled(m.email)).length
  const audit = (actor: string, action: string, target: string, detail?: unknown) =>
    db.query("INSERT INTO access_audit(actor,at,action,target,detail) VALUES (?,?,?,?,?)").run(actor, now(), action, target, detail === undefined ? null : JSON.stringify(detail))

  /** 로그인 성공 때: 멤버 줄을 만들거나 마지막 로그인 시각을 적어요 */
  function onLogin(email: string, name: string) {
    const t = now()
    db.query(`INSERT INTO members(email,role,name,first_login_at,last_login_at,updated_at) VALUES (?,'member',?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''), members.name), first_login_at=COALESCE(members.first_login_at, excluded.first_login_at), last_login_at=excluded.last_login_at`).run(email, name, t, t, t)
    audit(email, "login", email)
  }

  function snapshot(): AccessResponse {
    const rules = (db.query("SELECT * FROM access_rules ORDER BY kind, value").all() as { kind: "email" | "domain"; value: string; added_by: string; added_at: number }[])
      .map((r): AccessRule => ({ kind: r.kind, value: r.value, addedBy: r.added_by, addedAt: r.added_at }))
    const members = (db.query("SELECT * FROM members ORDER BY role, email").all() as MemberRow[])
      .map((m): AccessMember => ({ email: m.email, role: m.role, disabled: !!m.disabled, name: m.name, firstLoginAt: m.first_login_at, lastLoginAt: m.last_login_at, allowed: ruled(m.email) }))
    const auditRows = (db.query("SELECT * FROM access_audit ORDER BY id DESC LIMIT 100").all() as { id: number; actor: string; at: number; action: string; target: string; detail: string | null }[])
      .map((a): AccessAudit => ({ id: a.id, actor: a.actor, at: a.at, action: a.action, target: a.target, detail: a.detail }))
    return { rules, members, audit: auditRows }
  }

  /** 바꾸기는 한 트랜잭션: 바꾼 뒤 살아 있는 관리자가 없으면 되돌려요(마지막 관리자 보호) */
  function change(fn: () => string | null): string | null {
    let problem: string | null = null
    try {
      db.transaction(() => {
        problem = fn()
        if (!problem && activeAdmins() < 1) problem = "마지막 관리자는 지우거나 강등·비활성할 수 없어요"
        if (problem) throw new Error("rollback")
      })()
    } catch (e) { if (!problem) throw e }
    return problem
  }

  /** GET /api/access, POST·DELETE /api/access/rules, PATCH /api/access/members/:email — 관리자만 */
  /** revoke: "all" 은 세션과 연결 토큰, "tokens" 는 연결 토큰만(강등 — 세션은 남고 역할은 요청마다 다시 봐요) */
  async function api(req: Request, url: URL, parts: string[], u: U, revoke: (email: string, what: "all" | "tokens") => void): Promise<Response | null> {
    if (parts[1] !== "access") return null
    if (u.agent || !isAdmin(u.email)) return err(403, "관리자만 접근을 관리할 수 있어요")
    const m = req.method
    if (parts.length === 2 && m === "GET") return json(snapshot())
    const body = m === "GET" || m === "DELETE" ? null : ((await req.json().catch(() => null)) as Record<string, unknown> | null)
    // 본문을 읽는 사이 강등·비활성됐을 수 있어요. 여기서부터 바꾸기·폐기까지는 await 없이 한 트랜잭션이에요
    if (!isAdmin(u.email)) return err(403, "관리자만 접근을 관리할 수 있어요")
    if (parts[2] === "rules" && (m === "POST" || m === "DELETE")) {
      const kind = String((m === "POST" ? body?.kind : url.searchParams.get("kind")) ?? "")
      const value = String((m === "POST" ? body?.value : url.searchParams.get("value")) ?? "").trim().toLowerCase()
      if (kind !== "email" && kind !== "domain") return err(400, "kind must be email or domain")
      if (!(kind === "email" ? EMAIL : DOMAIN).test(value)) return err(400, kind === "email" ? "올바른 이메일이 아니에요" : "올바른 도메인이 아니에요")
      const problem = change(() => {
        if (m === "POST") {
          if (!db.query("INSERT OR IGNORE INTO access_rules VALUES (?,?,?,?)").run(kind, value, u.email, now()).changes) return "이미 있는 규칙이에요"
          audit(u.email, "rule.add", `${kind}:${value}`)
        } else {
          if (!db.query("DELETE FROM access_rules WHERE kind=? AND value=?").run(kind, value).changes) return "없는 규칙이에요"
          audit(u.email, "rule.remove", `${kind}:${value}`)
          // 규칙을 지워 들어올 수 없게 된 사람의 세션·연결 토큰은 같은 트랜잭션에서 끊어요
          for (const mm of db.query("SELECT email FROM members").all() as { email: string }[]) if (!allowed(mm.email)) revoke(mm.email, "all")
        }
        return null
      })
      if (problem) return err(409, problem)
      return json(snapshot(), m === "POST" ? 201 : 200)
    }
    if (parts[2] === "members" && parts[3] && m === "PATCH") {
      const email = decodeURIComponent(parts[3]).toLowerCase()
      if (!EMAIL.test(email)) return err(400, "올바른 이메일이 아니에요")
      const role = body?.role, disabled = body?.disabled
      if (role !== undefined && role !== "admin" && role !== "member") return err(400, "role must be admin or member")
      if (disabled !== undefined && typeof disabled !== "boolean") return err(400, "disabled must be boolean")
      if (role === undefined && disabled === undefined) return err(400, "role or disabled required")
      const problem = change(() => {
        if (!member(email)) {
          if (!ruled(email)) return "허용 목록에 없는 이메일이에요. 먼저 이메일이나 도메인을 허용해 주세요"
          db.query("INSERT INTO members(email,role,updated_at) VALUES (?,'member',?)").run(email, now())
        }
        if (role !== undefined) db.query("UPDATE members SET role=?, updated_at=? WHERE email=?").run(role, now(), email)
        if (disabled !== undefined) db.query("UPDATE members SET disabled=?, updated_at=? WHERE email=?").run(disabled ? 1 : 0, now(), email)
        audit(u.email, "member.update", email, { ...(role !== undefined ? { role } : {}), ...(disabled !== undefined ? { disabled } : {}) })
        // 비활성은 세션과 연결 토큰, 강등은 연결 토큰을 같은 트랜잭션에서 폐기해요(되돌리면 폐기도 되돌아가요)
        if (disabled === true) revoke(email, "all")
        else if (role === "member") revoke(email, "tokens")
        return null
      })
      if (problem) return err(409, problem)
      return json(snapshot())
    }
    return err(405, "method not allowed")
  }

  return { allowed, isAdmin, onLogin, api, snapshot }
}
