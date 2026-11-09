// 호스팅 공용 상태(.quorum/hosted.db): 연결 토큰, 감사 기록. 그리고 메모리 속 속도 제한.
// 사람마다의 일(사건·실행·대기열)은 여기 없고 각자 테넌트 DB 에 있어요(src/hosted/tenants.ts).
import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { createMcpTokens } from "./tokens"

export type AuditEntry = { at: number; email: string | null; action: string; detail: string }

/** 고정 창 대신 미끄럼 창으로 세요: 지난 windowMs 동안 limit 번까지. 키마다 시각 목록을 들고 있어요 */
export function createLimiter(now: () => number = Date.now) {
  const hits = new Map<string, number[]>()
  function take(key: string, limit: number, windowMs: number): boolean {
    const t = now()
    const list = (hits.get(key) || []).filter((x) => x > t - windowMs)
    if (list.length >= limit) { hits.set(key, list); return false }
    list.push(t)
    hits.set(key, list)
    if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((x) => x > t - 3600_000)) hits.delete(k)
    return true
  }
  return { take }
}
export type Limiter = ReturnType<typeof createLimiter>

export function openHosted(path: string, now: () => number = Date.now) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path, { create: true })
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 3000;")
  db.exec("CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, email TEXT, action TEXT NOT NULL, detail TEXT NOT NULL); CREATE INDEX IF NOT EXISTS audit_email ON audit(email, id);")
  const tokens = createMcpTokens(db, now)
  /** 감사 기록 한 줄. detail 에 비밀값(토큰 원문·해시)을 넣지 않아요. 오래된 기록은 5만 줄만 남겨요 */
  function audit(email: string | null, action: string, detail = "") {
    db.query("INSERT INTO audit(at,email,action,detail) VALUES (?,?,?,?)").run(now(), email, action.slice(0, 60), detail.slice(0, 400))
    db.query("DELETE FROM audit WHERE id <= (SELECT MAX(id) FROM audit) - 50000").run()
  }
  function auditFor(email: string, limit = 100): AuditEntry[] {
    return db.query("SELECT at, email, action, detail FROM audit WHERE email=? ORDER BY id DESC LIMIT ?").all(email, Math.min(500, limit)) as AuditEntry[]
  }
  return { db, tokens, audit, auditFor, limiter: createLimiter(now) }
}
export type Hosted = ReturnType<typeof openHosted>
