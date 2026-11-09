// 사람별 MCP 연결 토큰. 출처: board/apps/server/server/mcp-tokens.ts (방향판 2ee6e8a) — 원문은 만드는 응답에서 한 번만, DB 에는 SHA-256 해시만,
// 이름 검사(cleanName), sameOriginMutation, 마지막 사용은 60초에 한 번만 기록, 폐기는 revoked_at.
// 바꾼 점: 방향판은 맥 주인 한 사람만 토큰을 다뤘지만 Quorum 호스팅은 로그인한 사람마다 자기 토큰만 보고·만들고·폐기해요(모든 쿼리에 owner 조건).
// 활성 토큰은 사람마다 5개까지. 원문·해시는 로그·감사 기록에 쓰지 않아요. 폐기는 다음 요청부터 바로 막혀요(캐시 없음).
import type { Database } from "bun:sqlite"

const PREFIX = "qmcp_"
export const ACTIVE_LIMIT = 5
const REVOKED_SHOWN = 10
const TOUCH_EVERY = 60_000

type Row = { id: string; owner: string; name: string; prefix: string; created_at: number; last_used_at: number | null; revoked_at: number | null }
export type McpToken = { id: string; name: string; prefix: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null }

export function initMcpTokens(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS mcp_tokens(
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL, prefix TEXT NOT NULL,
    created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER);
  CREATE UNIQUE INDEX IF NOT EXISTS mcp_tokens_hash ON mcp_tokens(hash);
  CREATE INDEX IF NOT EXISTS mcp_tokens_owner ON mcp_tokens(owner, revoked_at);`)
}

const sha256 = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex")
const view = (r: Row): McpToken => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at })

/** 토큰 이름: 앞뒤 공백 제거 1~40자, 제어 문자 거절 (board 그대로) */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const name = raw.trim()
  // eslint-disable-next-line no-control-regex
  if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

/** 만들기·폐기 요청이 공개 Origin 에서 왔는지. Origin 이 있으면 정확히 같아야 하고, Sec-Fetch-Site 가 있으면 same-origin·none 만 (board 그대로) */
export function sameOriginMutation(req: Request, publicOrigin: string): boolean {
  const site = req.headers.get("sec-fetch-site")?.toLowerCase()
  if (site && site !== "same-origin" && site !== "none") return false
  const origin = req.headers.get("origin")
  if (origin === null) return true
  return origin === publicOrigin.replace(/\/+$/, "")
}

export function createMcpTokens(db: Database, now: () => number = Date.now) {
  initMcpTokens(db)
  const insert = db.transaction((row: Row & { hash: string }) => {
    const active = (db.query("SELECT COUNT(*) AS n FROM mcp_tokens WHERE owner=? AND revoked_at IS NULL").get(row.owner) as { n: number }).n
    if (active >= ACTIVE_LIMIT) return false
    db.query("INSERT INTO mcp_tokens(id,owner,name,hash,prefix,created_at,last_used_at,revoked_at) VALUES (?,?,?,?,?,?,NULL,NULL)")
      .run(row.id, row.owner, row.name, row.hash, row.prefix, row.created_at)
    return true
  })

  function list(owner: string): { tokens: McpToken[] } {
    const active = db.query("SELECT * FROM mcp_tokens WHERE owner=? AND revoked_at IS NULL ORDER BY created_at DESC").all(owner) as Row[]
    const revoked = db.query("SELECT * FROM mcp_tokens WHERE owner=? AND revoked_at IS NOT NULL ORDER BY revoked_at DESC LIMIT ?").all(owner, REVOKED_SHOWN) as Row[]
    return { tokens: [...active, ...revoked].map(view) }
  }

  function create(owner: string, name: string): { token: McpToken; secret: string } | null {
    const secret = PREFIX + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
    const row = { id: crypto.randomUUID().replace(/-/g, "").slice(0, 16), owner, name, hash: sha256(secret), prefix: secret.slice(0, PREFIX.length + 6), created_at: now(), last_used_at: null, revoked_at: null }
    if (!insert(row)) return null
    return { token: view(row), secret }
  }

  /** 자기 토큰만 폐기해요. 다른 사람 토큰 id 는 없는 것과 같아요(null) */
  function revoke(owner: string, id: string): McpToken | null {
    db.query("UPDATE mcp_tokens SET revoked_at=? WHERE id=? AND owner=? AND revoked_at IS NULL").run(now(), id, owner)
    const row = db.query("SELECT * FROM mcp_tokens WHERE id=? AND owner=?").get(id, owner) as Row | null
    return row ? view(row) : null
  }

  /** /mcp Bearer 값 → 폐기되지 않은 토큰의 주인. 마지막 사용은 60초에 한 번만 써요 */
  function authenticate(secret: string): { owner: string; id: string } | null {
    if (!secret.startsWith(PREFIX) || secret.length > 128) return null
    const row = db.query("SELECT id, owner FROM mcp_tokens WHERE hash=? AND revoked_at IS NULL").get(sha256(secret)) as { id: string; owner: string } | null
    if (!row) return null
    const t = now()
    db.query("UPDATE mcp_tokens SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<=?)").run(t, row.id, t - TOUCH_EVERY)
    return { owner: row.owner, id: row.id }
  }

  /** 그 사람 토큰이 최근에 쓰였는지(연결 카드의 "Aside connected") */
  function lastUsed(owner: string): number | null {
    const r = db.query("SELECT MAX(last_used_at) AS t FROM mcp_tokens WHERE owner=? AND revoked_at IS NULL").get(owner) as { t: number | null }
    return r.t
  }

  return { list, create, revoke, authenticate, lastUsed }
}
export type McpTokens = ReturnType<typeof createMcpTokens>
