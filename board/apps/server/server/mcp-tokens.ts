import type { Database } from "bun:sqlite";
import type { McpToken, McpTokenCreated, McpTokenList } from "@direction-board/contracts/settings";
import type { Listener, User } from "./auth.ts";

// 연결별 MCP 토큰. 설계: docs/internals/mcp-tokens.md, 결정: structure/decisions/ADR-0007-mcp-tokens.md
// 원문은 만드는 응답에서 한 번만 나가고 DB 에는 SHA-256 해시만 남아요. 원문·해시는 로그에도 쓰지 않아요.

const PREFIX = "dbt_";
const ACTIVE_LIMIT = 20;
const REVOKED_SHOWN = 20;
const TOUCH_EVERY = 60_000;

type Row = { id: string; owner: string; name: string; prefix: string; created_at: number; last_used_at: number | null; revoked_at: number | null };

export function initMcpTokens(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS mcp_tokens(
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL, prefix TEXT NOT NULL,
    created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER);
  CREATE UNIQUE INDEX IF NOT EXISTS mcp_tokens_hash ON mcp_tokens(hash);`);
}

const sha256 = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
const view = (r: Row): McpToken => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at });
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

/** 토큰 이름: 앞뒤 공백 제거 1~40자, 제어 문자 거절 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

/**
 * 만들기·폐기 요청이 그 리스너의 자기 Origin 에서 왔는지. Origin 이 있으면 정확히 같아야 하고,
 * Sec-Fetch-Site 가 있으면 same-origin·none 만. Origin 없는 CLI 요청은 받아요(감사 1의 2번).
 */
export function sameOriginMutation(req: Request, listener: Listener, publicOrigin: string): boolean {
  const site = req.headers.get("sec-fetch-site")?.toLowerCase();
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  const own = listener === "public" ? publicOrigin.replace(/\/+$/, "") : `http://${req.headers.get("host") || ""}`;
  return origin === own;
}

export function createMcpTokens(db: Database, now: () => number = Date.now) {
  const insert = db.transaction((row: Row & { hash: string }) => {
    const active = (db.query("SELECT COUNT(*) AS n FROM mcp_tokens WHERE revoked_at IS NULL").get() as { n: number }).n;
    if (active >= ACTIVE_LIMIT) return false;
    db.query("INSERT INTO mcp_tokens(id,owner,name,hash,prefix,created_at,last_used_at,revoked_at) VALUES (?,?,?,?,?,?,NULL,NULL)")
      .run(row.id, row.owner, row.name, row.hash, row.prefix, row.created_at);
    return true;
  });

  function list(): McpTokenList {
    const active = db.query("SELECT * FROM mcp_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC").all() as Row[];
    const revoked = db.query("SELECT * FROM mcp_tokens WHERE revoked_at IS NOT NULL ORDER BY revoked_at DESC LIMIT ?").all(REVOKED_SHOWN) as Row[];
    return { tokens: [...active, ...revoked].map(view) };
  }

  function create(owner: string, name: string): McpTokenCreated | null {
    const secret = PREFIX + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const row = { id: crypto.randomUUID().replace(/-/g, "").slice(0, 16), owner, name, hash: sha256(secret), prefix: secret.slice(0, PREFIX.length + 8), created_at: now(), last_used_at: null, revoked_at: null };
    if (!insert(row)) return null;
    return { token: view(row), secret };
  }

  function revoke(id: string): McpToken | null {
    db.query("UPDATE mcp_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(now(), id);
    const row = db.query("SELECT * FROM mcp_tokens WHERE id=?").get(id) as Row | null;
    return row ? view(row) : null;
  }

  /** 그 사람의 살아 있는 연결 토큰을 모두 폐기해요(파일럿에서 강등·비활성·허용 해제 때). 폐기한 수 */
  function revokeOwner(owner: string): number {
    return db.query("UPDATE mcp_tokens SET revoked_at=? WHERE owner=? AND revoked_at IS NULL").run(now(), owner).changes;
  }

  /** /mcp Bearer 값 → 폐기되지 않은 연결 토큰의 만든 사람. 마지막 사용은 60초에 한 번만 써요 */
  function authenticate(secret: string): { owner: string } | null {
    if (!secret.startsWith(PREFIX) || secret.length > 128) return null;
    const row = db.query("SELECT id, owner FROM mcp_tokens WHERE hash=? AND revoked_at IS NULL").get(sha256(secret)) as { id: string; owner: string } | null;
    if (!row) return null;
    const t = now();
    db.query("UPDATE mcp_tokens SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<=?)").run(t, row.id, t - TOUCH_EVERY);
    return { owner: row.owner };
  }

  /** GET/POST /api/mcp-tokens, DELETE /api/mcp-tokens/:id — 맥 주인 사람만 */
  /** stillAllowed: 본문을 읽은 뒤 만들기 바로 전에 다시 보는 권한(파일럿: 지금도 활성 관리자인지). 만들기까지 await 가 없어 강등과 엇갈리지 않아요 */
  async function api(req: Request, parts: string[], u: User, ctx: { macOwner: boolean; listener: Listener; publicOrigin: string; stillAllowed?: () => boolean }): Promise<Response | null> {
    if (parts[1] !== "mcp-tokens") return null;
    if (!ctx.macOwner || u.agent) return json({ error: "only the Mac owner can manage MCP tokens" }, 403);
    const m = req.method;
    if (m !== "GET" && !sameOriginMutation(req, ctx.listener, ctx.publicOrigin)) return json({ error: "origin not allowed" }, 403);
    if (parts.length === 2 && m === "GET") return json(list());
    if (parts.length === 2 && m === "POST") {
      const body = await req.json().catch(() => null) as { name?: unknown } | null;
      const name = cleanName(body?.name);
      if (!name) return json({ error: "name must be 1-40 characters without control characters" }, 400);
      if (ctx.stillAllowed && !ctx.stillAllowed()) return json({ error: "only the Mac owner can manage MCP tokens" }, 403);
      const made = create(u.email, name);
      return made ? json(made, 201) : json({ error: `at most ${ACTIVE_LIMIT} active tokens; revoke one first` }, 409);
    }
    if (parts.length === 3 && m === "DELETE") {
      if (!/^[a-f0-9]{16}$/.test(parts[2])) return json({ error: "token not found" }, 404);
      const token = revoke(parts[2]);
      return token ? json({ token }) : json({ error: "token not found" }, 404);
    }
    return json({ error: "method not allowed" }, 405);
  }

  return { list, create, revoke, revokeOwner, authenticate, api };
}
