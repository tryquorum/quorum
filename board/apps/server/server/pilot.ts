// 파일럿(뉴럴아케이드) 모드: AUTH_MODE=google 일 때 Google 로그인·허용 목록·역할·이슈 보내기를 묶어요. 설계: docs/internals/pilot.md
// 멤버는 회사 공간(회사 판)만 보고 쓰고, 개인 공간·운영 순회·연결 토큰·AI 실행·문서·접근 관리는 관리자만 해요.
// Access 모드(지금 개인 방향판)에서는 이 파일의 어떤 규칙도 켜지지 않고 모두 관리자예요.
import type { Database } from "bun:sqlite"
import { dirname, join } from "node:path"
import { filesApi } from "./files.ts"
import type { Me } from "@direction-board/contracts/api"
import { createAccess, initAccess } from "./access.ts"
import { createGoogleAuth, loginPage } from "./google-auth.ts"
import { initIssues, issuesApi, syncIssueSignals, type IssueDeps } from "./issues.ts"
import { defaultWorkspaceId, ensureWorkspace } from "./spaces.ts"
import { enableWorkspaceScope, spaceMoveProblem } from "./docs/scope.ts"
import type { LogPolicy } from "./item-log.ts"

export type Role = "admin" | "member"
type U = { email: string; agent: boolean }
const FILE = /^[0-9a-f-]{36}\.(png|jpg|gif|webp|avif)$/
const list = (v: string | undefined) => (v || "").split(",").map((s) => s.trim()).filter(Boolean)

/** 멤버가 부를 수 있는 API. 나머지는 403 */
export function memberAllowed(parts: string[], method: string): boolean {
  const p = parts[1], get = method === "GET"
  if (["me", "state", "changes"].includes(p)) return get
  if (p === "spaces" || p === "work" || p === "settings") return get
  if (p === "issues") return true
  // 노트 이미지 읽기: 볼 수 있는 회사 노트에 든 파일만(pilot.api 의 fileVisible). 올리기·로컬 경로는 관리자만
  if (p === "files") return get && parts.length === 3 && parts[2] !== "local"
  if (p === "signals") return get || method === "PATCH"
  // 회사 판의 항목 만들기·고치기·기록(판 보기 권한은 server.ts 의 visible 이 따로 확인)
  if (p === "boards" && parts[3] === "items") return (method === "POST" && (parts.length === 4 || parts[5] === "log")) || (method === "PUT" && parts.length === 5)
  return false
}

/** 파일럿의 회사 판. 없으면 만들어요(회사 공간 일이 사는 곳). 이벤트로 seq 를 올려 다른 탭이 알아채요 */
export function ensureCompanyBoard(db: Database, name: string, actor: string): string {
  const has = db.query("SELECT id FROM boards WHERE kind='company' AND deleted=0 ORDER BY created_at LIMIT 1").get() as { id: string } | null
  if (has) return has.id
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12)
  const t = Date.now()
  const seq = Number(db.query("INSERT INTO events(board_id,item_id,op,actor,at,payload) VALUES (?,NULL,'board.create',?,?,?)").run(id, actor, t, JSON.stringify({ name, kind: "company" })).lastInsertRowid)
  const areas = [{ id: "issue", name: "이슈", color: "#d0629b" }, { id: "general", name: "일반", color: "#8b8b94" }]
  db.query("INSERT INTO boards(id,name,kind,owner,created_at,updated_at,seq,meta) VALUES (?,?,'company',NULL,?,?,?,?)").run(id, name, t, t, seq, JSON.stringify({ areas }))
  return id
}

/** 회사 판의 새 항목은 공간을 보내지 않으면 기본 워크스페이스예요 */
export function boardDefaultSpace(db: Database, kind: string): string | undefined {
  return kind === "company" ? defaultWorkspaceId(db) ?? undefined : undefined
}

type PilotDeps = Pick<IssueDeps, "readItem" | "putItem" | "ingest"> & { dbPath: string; origin: string; revokeTokens: (email: string) => void }

/** 본문 상한: 이슈 보내기(이미지 3장×5MB + 글)만 크게, Google 로그인 경로는 작게, 나머지 1MiB. Bun.serve 의 maxRequestBodySize 는 BODY_MAX */
export const BODY_MAX = 17 * 1024 * 1024
const bodyCap = (path: string, method: string) => ((path === "/api/issues" || path === "/api/files") && method === "POST" ? 16 * 1024 * 1024 : path.startsWith("/auth/") ? 64 * 1024 : 1024 * 1024)
const BIG_AT_ONCE = 2
const ITEM_BYTES = 64 * 1024
const RATE_WINDOW_MS = 10 * 60e3
const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d)
/** 사람별 빈도: 최근 10분에 센 수 + n 이 limit 이하면 세고 true */
function takeRate(map: Map<string, number[]>, key: string, n: number, limit: number): boolean {
  const t = Date.now(), recent = (map.get(key) ?? []).filter((x) => t - x < RATE_WINDOW_MS)
  if (recent.length + n > limit) { map.set(key, recent); return false }
  map.set(key, [...recent, ...Array<number>(n).fill(t)])
  return true
}
const BODIES_AT_ONCE = 16
let bigInFlight = 0
let bodiesInFlight = 0
const tooLarge = () => Response.json({ error: "본문이 너무 커요" }, { status: 413 })

/**
 * 파일럿에서 본문 있는 요청 받기. 인증할 수 있는 건 본문을 읽기 전에 거절(401)하고, 길이 머리·실제 받은 양이 상한을 넘으면 413,
 * 큰 업로드는 동시에 BIG_AT_ONCE 개까지(넘으면 503). 다 받은 본문으로 새 Request 를 돌려줘요 — 그 뒤에 사람·역할을 다시 봐요(server.ts)
 */
export async function admitBody(req: Request, url: URL, authed: boolean): Promise<Request | Response> {
  // /auth 경로는 본문이 필요 없어요. 로그아웃(POST)은 본문을 읽지 않고 버리고, 다른 메서드·경로의 본문은 읽기 전에 거절해요
  if (url.pathname.startsWith("/auth/")) return url.pathname === "/auth/logout" && req.method === "POST" ? new Request(req.url, { method: "POST", headers: req.headers }) : Response.json({ error: "method not allowed" }, { status: 405 })
  if (!authed) return Response.json({ error: "login required" }, { status: 401 })
  const stream = req.body
  if (!stream) return req
  const cap = bodyCap(url.pathname, req.method)
  const declared = Number(req.headers.get("content-length") ?? NaN)
  if (Number.isFinite(declared) && declared > cap) return tooLarge()
  const big = cap > 1024 * 1024
  if (bodiesInFlight >= BODIES_AT_ONCE || (big && bigInFlight >= BIG_AT_ONCE)) return Response.json({ error: "보내는 중인 요청이 많아요. 잠시 뒤에 다시 보내 주세요" }, { status: 503 })
  bodiesInFlight++
  if (big) bigInFlight++
  // 받는 시간 제한: 보통 30초, 큰 업로드 2분(시험은 PILOT_BODY_TIMEOUT_MS 로 줄여요). 넘으면 408
  const limit = (Number(process.env.PILOT_BODY_TIMEOUT_MS) || 30_000) * (big ? 4 : 1)
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<"late">((r) => { timer = setTimeout(() => r("late"), limit) })
  try {
    const reader = stream.getReader()
    const parts: Uint8Array[] = []
    let total = 0
    for (;;) {
      const got = await Promise.race([reader.read(), late])
      if (got === "late") { void reader.cancel().catch(() => undefined); return Response.json({ error: "본문을 받는 시간이 지났어요" }, { status: 408 }) }
      const { done, value } = got
      if (done) break
      total += value.byteLength
      if (total > cap) { await reader.cancel().catch(() => undefined); return tooLarge() }
      parts.push(value)
    }
    return new Request(req, { method: req.method, body: Buffer.concat(parts) })
  } finally { clearTimeout(timer); bodiesInFlight--; if (big) bigInFlight-- }
}

export function createPilot(db: Database, env: Record<string, string | undefined>, deps: PilotDeps) {
  initIssues(db)
  // 노트 이미지(/api/files)를 누가 올렸는지. 파일럿에서 읽기 권한을 정할 때 써요(fileVisible)
  db.exec("CREATE TABLE IF NOT EXISTS file_uploads(name TEXT PRIMARY KEY, uploader TEXT NOT NULL, created_at INTEGER NOT NULL)")
  if (env.AUTH_MODE !== "google") return null
  const clientId = env.GOOGLE_CLIENT_ID || "", clientSecret = env.GOOGLE_CLIENT_SECRET || ""
  if (!clientId || !clientSecret) throw new Error("AUTH_MODE=google needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET")
  // 파일럿은 로컬 리스너도 Google 세션·관리자 연결 토큰만 받아요. server.ts 가 DEV_LOCAL_USER 를 버려요
  if (env.DEV_LOCAL_USER) console.warn("[board] pilot: DEV_LOCAL_USER is ignored (no unauthenticated local access in AUTH_MODE=google)")
  const name = env.WORKSPACE_NAME || "회사"
  initAccess(db, { emails: list(env.ACCESS_SEED_EMAILS), domains: list(env.ACCESS_SEED_DOMAINS), admins: list(env.ADMIN_EMAILS) })
  const access = createAccess(db)
  const google = createGoogleAuth(db, { clientId, clientSecret, origin: deps.origin, allowed: access.allowed, onLogin: access.onLogin })
  const role = (u: U): Role => (!u.agent && access.isAdmin(u.email) ? "admin" : "member")
  // 회사 공간 일의 노트·문서 색인은 그 워크스페이스 범위에 둬요(멤버가 일 상세에서 읽고, 관리자는 회사 공간 검색으로 찾음)
  enableWorkspaceScope(db)
  // 권한 회수: "all" 은 비활성·허용 해제(세션과 연결 토큰), "tokens" 는 강등(세션은 남고 역할은 요청마다 다시 봐요)
  const revoke = (email: string, what: "all" | "tokens") => { if (what === "all") google.dropSessions(email); deps.revokeTokens(email) }
  // 멤버 쓰기 한도(관리자는 없음): 항목 하나 기록 빼고 64KB, 10분에 PILOT_MEMBER_WRITES(120)번, 마지막으로 쓴 회사 판 항목 합 PILOT_MEMBER_BYTES(5MB), 회사 판 전체 PILOT_WORKSPACE_BYTES(100MB).
  // 빈도는 이 프로세스 메모리에서 세요(다시 띄우면 처음부터)
  const writes = new Map<string, number[]>(), logAdds = new Map<string, number[]>()
  // 멤버 기여량 표. 처음 만들 때 지금 회사 판에서 마지막 작성자별 크기로 한 번 채워요
  if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='member_usage'").get()) {
    db.exec("CREATE TABLE member_usage(email TEXT PRIMARY KEY, bytes INTEGER NOT NULL DEFAULT 0)")
    db.exec("INSERT INTO member_usage(email,bytes) SELECT i.by, SUM(LENGTH(CAST(i.data AS BLOB))) FROM items i JOIN boards b ON b.id=i.board_id WHERE b.kind='company' AND i.deleted=0 GROUP BY i.by")
  }
  /**
   * 최종 저장할 항목(data, 기록 포함)으로 멤버 한도를 봐요. 멤버 누적은 마지막 작성자와 상관없이 그 멤버가 늘린 바이트를 모은
   * 기여량(member_usage)이라 남의 항목에 /log 로 더한 것도 잡혀요. 줄이는 쓰기는 0 으로 쳐요(지워도 돌려주지 않음). 회사 판 전체는 지금 저장된 합
   */
  function memberWriteProblem(email: string, bid: string, iid: string, data: Record<string, unknown>): { status: number; error: string } | null {
    const size = Buffer.byteLength(JSON.stringify({ ...data, log: undefined })), full = Buffer.byteLength(JSON.stringify(data))
    if (size > ITEM_BYTES) return { status: 413, error: "항목이 너무 커요(기록 빼고 64KB)" }
    if (!takeRate(writes, email, 1, num(env.PILOT_MEMBER_WRITES, 120))) return { status: 429, error: "너무 자주 저장했어요. 잠시 뒤에 다시 해 주세요" }
    const bytes = (sql: string, ...a: string[]) => (db.query(sql).get(...a) as { n: number | null } | null)?.n ?? 0
    const company = "FROM items i JOIN boards b ON b.id=i.board_id WHERE b.kind='company' AND i.deleted=0 AND NOT (i.board_id=? AND i.id=?)"
    const before = bytes("SELECT LENGTH(CAST(data AS BLOB)) AS n FROM items WHERE board_id=? AND id=? AND deleted=0", bid, iid)
    const grow = Math.max(0, full - before)
    if (bytes("SELECT bytes AS n FROM member_usage WHERE email=?", email) + grow > num(env.PILOT_MEMBER_BYTES, 5 * 1024 * 1024)) return { status: 413, error: "내 저장 한도를 넘어요" }
    if (bytes(`SELECT SUM(LENGTH(CAST(i.data AS BLOB))) AS n ${company}`, bid, iid) + full > num(env.PILOT_WORKSPACE_BYTES, 100 * 1024 * 1024)) return { status: 507, error: "회사 공간 저장 한도를 넘어요. 관리자에게 알려 주세요" }
    // 이 검사 뒤 쓰기까지 await 가 없어요(server.ts). 통과한 쓰기의 늘어난 만큼을 기여량에 더해요
    if (grow) db.query("INSERT INTO member_usage(email,bytes) VALUES (?,?) ON CONFLICT(email) DO UPDATE SET bytes=bytes+excluded.bytes").run(email, grow)
    return null
  }
  const issueDeps: IssueDeps = {
    ...deps, companyBoard: () => ensureCompanyBoard(db, name, "system"), isAdmin: access.isAdmin, active: access.allowed, uploadsDir: join(deps.dbPath, "..", "uploads"),
    get admins() { return (db.query("SELECT email FROM members WHERE role='admin' AND disabled=0").all() as { email: string }[]).map((r) => r.email).filter(access.allowed) },
  }
  return {
    routes: google.routes,
    /** 공개 리스너의 사람: 세션 쿠키 → 허용된 이메일 */
    user: (req: Request) => { const email = google.who(req); return email ? { id: email, email, agent: false } : null },
    loginPage: (url: URL) => loginPage(url.pathname + url.search),
    role,
    /** 멤버는 소유와 무관하게 회사 공간만 봐요(server.ts·works.ts 가 이 값으로 걸러요) */
    shared: (u: U) => role(u) === "member",
    /** 연결 토큰(/mcp)을 쓸 수 있는 사람: 지금 허용되고 활성인 관리자만. 요청마다 다시 봐요 */
    tokenOwnerOk: (email: string) => access.isAdmin(email),
    /**
     * 항목 공간 쓰기 검사(REST POST·PUT). 멤버는 개인 공간에 쓸 수 없고(403) 이미 있는 항목의 공간을 옮길 수 없어요(403, 관리자만).
     * 그다음 회사 판 규칙(개인 공간 400, 문서가 있는 범위 이동 409: docs/scope.ts)
     */
    spaceWrite(u: U, bid: string, iid: string | null, next: string | undefined): { status: number; error: string } | null {
      const member = role(u) === "member"
      if (member && next === "personal") return { status: 403, error: "멤버는 회사 공간에만 쓸 수 있어요" }
      const cur = member && iid && next !== undefined ? db.query("SELECT space FROM items WHERE board_id=? AND id=?").get(bid, iid) as { space: string | null } | null : null
      if (cur && (cur.space || "personal") !== next) return { status: 403, error: "공간 옮기기는 관리자만 해요" }
      return spaceMoveProblem(db, bid, iid, next)
    },
    /** 파일럿의 기록 정책: 새 기록의 이름·시각·id 는 서버가, 한 요청 5개, 사람별 10분에 PILOT_LOG_ADDS(60)개 */
    /** 멤버 쓰기 한도(항목 크기·빈도·누적): 기록 추가를 포함한 모든 멤버 쓰기에서 최종 저장 값으로. 관리자는 null */
    memberWrite: (u: U, bid: string, iid: string, data: Record<string, unknown>) => (role(u) === "member" ? memberWriteProblem(u.email, bid, iid, data) : null),
    logPolicy: (u: U): LogPolicy => ({ humanLimit: true, actor: u.email, maxNew: 5, now: Date.now(), take: (n) => takeRate(logAdds, u.email, n, num(env.PILOT_LOG_ADDS, 60)) }),
    me: (u: U): Pick<Me, "role" | "issues" | "auth"> => ({ role: role(u), issues: true, auth: "google" }),
    /** /api/state 때: 기본 워크스페이스와 회사 판을 만들어 둬요. 회사 판의 공간 없는(NULL) 항목은 계약대로 개인이고 바꾸지 않아요 */
    prepare: (u: U) => { ensureWorkspace(db, u.email, name); ensureCompanyBoard(db, name, u.email) },
    /** 파일럿 회사 판(있으면) */
    companyBoardId: () => (db.query("SELECT id FROM boards WHERE kind='company' AND deleted=0 ORDER BY created_at LIMIT 1").get() as { id: string } | null)?.id ?? null,
    /** 관리 API·이슈·멤버 막기. null 이면 server.ts 의 다음 처리로 */
    async api(req: Request, url: URL, parts: string[], u: U): Promise<Response | null> {
      // 운영 순회는 파일럿에서 꺼요(관리자도). 개인 Aside 연결(주기 2)에서 실행마다 인증된 보고 경로로 다시 열어요
      if (parts[1] === "ops") return Response.json({ error: "파일럿에서는 운영 순회를 아직 쓰지 않아요. 개인 Aside 연결이 끝나면 각자 Aside 로 돌려요", reason: "pilot" }, { status: 403 })
      if (role(u) === "member") {
        if (!memberAllowed(parts, req.method)) return Response.json({ error: "관리자만 쓸 수 있어요" }, { status: 403 })
        // 멤버에게 사건 칸은 없어요(관리자에게 오는 이슈 사건·예전 개인 사건 포함). 빈 목록, 고치기는 404
        if (parts[1] === "signals") return parts.length === 2 && req.method === "GET"
          ? Response.json({ signals: [], rules: [], collectors: [], stats: { interrupts_today: 0 } }, { headers: { "cache-control": "no-store" } })
          : Response.json({ error: "signal not found" }, { status: 404 })
      }
      if (parts[1] === "files") {
        if (req.method === "POST" && parts.length === 2) {
          const res = await filesApi(req, url, parts, dirname(deps.dbPath), false)
          const made = res?.status === 201 ? ((await res.clone().json()) as { url: string }).url.split("/").pop() : null
          if (made) db.query("INSERT OR IGNORE INTO file_uploads(name,uploader,created_at) VALUES (?,?,?)").run(made, u.email, Date.now())
          return res
        }
        if (req.method === "GET" && parts.length === 3 && FILE.test(parts[2]) && !fileVisible(u, parts[2])) return Response.json({ error: "이 파일을 볼 수 없어요" }, { status: 403 })
      }
      // 관리자 사건 목록을 줄 때 끝난 이슈의 사건을 닫아요(결정 칸에서 빠지게, issues.ts syncIssueSignals)
      if (parts[1] === "signals" && parts.length === 2 && req.method === "GET") syncIssueSignals(db)
      return (await access.api(req, url, parts, u, revoke)) ?? (await issuesApi(db, req, url, parts, u, issueDeps))
    },
  }

  /**
   * 노트 이미지 읽기 권한(파일럿): 올린 사람, 또는 그 파일 주소가 든 노트를 볼 수 있는 사람.
   * 회사 노트(워크스페이스 범위, 회사 판의 그 공간 항목, 안 지운 것)는 멤버·관리자 모두, 개인 범위 노트는 그 사람만
   */
  function fileVisible(u: U, name: string): boolean {
    if ((db.query("SELECT uploader FROM file_uploads WHERE name=?").get(name) as { uploader: string } | null)?.uploader === u.email) return true
    const like = `%/api/files/${name}%`
    const shared = db.query(`SELECT 1 FROM work_notes n JOIN items i ON n.ref = 'item:' || i.board_id || ':' || i.id JOIN boards b ON b.id=i.board_id
      WHERE b.kind='company' AND b.deleted=0 AND i.deleted=0 AND i.space=n.owner AND (n.html LIKE ? OR COALESCE(n.md,n.text) LIKE ?) LIMIT 1`).get(like, like)
    if (shared) return true
    return role(u) === "admin" && !!db.query("SELECT 1 FROM work_notes WHERE owner=? AND (html LIKE ? OR COALESCE(md,text) LIKE ?) LIMIT 1").get(u.email, like, like)
  }
}
