// 공간(space): 할 일·사건이 개인 것인지 회사(워크스페이스) 것인지. 설계: docs/internals/spaces.md, 결정: structure/decisions/ADR-0011-spaces.md
// 값은 "personal" 또는 워크스페이스 id(ws_ + 12 hex). items.space·signals.space 가 NULL 이면 개인이에요(이행은 칸 추가뿐).
import type { Database } from "bun:sqlite"
import type { Space, SpaceId } from "@direction-board/contracts/api"

type U = { email: string; agent: boolean }
type Row = { id: string; name: string; created_by: string; created_at: number; updated_at: number }

export const PERSONAL = "personal"
const ALIASES = new Set(["personal", "개인"])
const ID = /^ws_[0-9a-f]{12}$/
const MAX_WORKSPACES = 8
const DEFAULT_NAME = "회사"
const now = () => Date.now()
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } })

const ready = new WeakMap<Database, boolean>()
/** 공간 표·칸이 있는지. 서버는 시작할 때 initSpaces 를 부르고, 옛 스키마만 만든 시험 DB 에서는 모든 일이 개인이에요 */
export function spacesReady(db: Database): boolean {
  let v = ready.get(db)
  if (v === undefined) {
    const has = (table: string) => (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === "space")
    v = !!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspaces'").get() && has("items") && has("signals")
    ready.set(db, v)
  }
  return v
}

export function initSpaces(db: Database) {
  db.exec("CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)")
  for (const table of ["items", "signals"]) {
    const cols = new Set((db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name))
    if (cols.size && !cols.has("space")) db.exec(`ALTER TABLE ${table} ADD COLUMN space TEXT`)
  }
  ready.delete(db)
}

const live = (db: Database) => (spacesReady(db) ? (db.query("SELECT * FROM workspaces WHERE deleted=0 ORDER BY created_at, id").all() as Row[]) : [])
const view = (r: Row): Space => ({ id: r.id as SpaceId, kind: "workspace", name: r.name })

/** 개인 먼저, 워크스페이스는 만든 순서 */
export function listSpaces(db: Database): Space[] {
  return [{ id: PERSONAL, kind: "personal", name: "개인" }, ...live(db).map(view)]
}

/** 다른 탭·기기가 /api/changes 로 알아채도록 seq 를 올린다 */
function logSpaceEvent(db: Database, op: string, actor: string, payload: unknown) {
  db.query("INSERT INTO events(board_id,item_id,op,actor,at,payload) VALUES (NULL,NULL,?,?,?,?)").run(op, actor, now(), JSON.stringify(payload))
}

/** 살아 있는 워크스페이스가 없으면 "회사" 하나를 만든다. 한 문장이라 동시 첫 요청에도 하나만 생겨요 */
export function ensureWorkspace(db: Database, email: string, name = DEFAULT_NAME) {
  if (!spacesReady(db)) return
  const id = "ws_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12)
  const t = now()
  const made = db.query("INSERT INTO workspaces(id,name,created_by,created_at,updated_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM workspaces WHERE deleted=0)").run(id, name, email, t, t).changes
  if (made) logSpaceEvent(db, "space.create", email, { id, name })
}

/** 처음 만든 살아 있는 워크스페이스(회사 판 항목의 기본 공간) */
export function defaultWorkspaceId(db: Database): SpaceId | null {
  const first = live(db)[0]
  return first ? (first.id as SpaceId) : null
}

/** 워크스페이스 이름: 1~40자, 제어 문자·별칭(personal·개인)·ws_ 로 시작하는 이름은 안 돼요 */
export function cleanSpaceName(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const name = raw.trim()
  // eslint-disable-next-line no-control-regex
  if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f]/.test(name)) return null
  if (ALIASES.has(name.toLowerCase()) || name.toLowerCase().startsWith("ws_")) return null
  return name
}

/**
 * 보낸 공간 값 → 공간 id. undefined: 보내지 않음(기존 값 유지), null: 모르는 값(거절해야 함).
 * 찾는 순서: 별칭(personal·개인) → 살아 있는 워크스페이스 id → 이름(대소문자 무시)
 */
export function resolveSpace(db: Database, raw: unknown): SpaceId | null | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== "string") return null
  const v = raw.trim()
  if (ALIASES.has(v.toLowerCase())) return PERSONAL
  const rows = live(db)
  if (ID.test(v)) return rows.some((r) => r.id === v) ? (v as SpaceId) : null
  const hit = rows.find((r) => r.name.toLowerCase() === v.toLowerCase())
  return hit ? (hit.id as SpaceId) : null
}

export const spaceValue = (v: string | null | undefined): SpaceId => (v || PERSONAL) as SpaceId

export function itemSpace(db: Database, bid: string, iid: string): SpaceId | null {
  if (!spacesReady(db)) return db.query("SELECT 1 FROM items WHERE board_id=? AND id=? AND deleted=0").get(bid, iid) ? PERSONAL : null
  const r = db.query("SELECT space FROM items WHERE board_id=? AND id=? AND deleted=0").get(bid, iid) as { space: string | null } | null
  return r ? spaceValue(r.space) : null
}

/** 일 주소의 공간. 할 일·목표와 사건만 공간을 가져요. 모르는 주소·다른 종류는 null */
export function spaceOfRef(db: Database, owner: string, ref: string): SpaceId | null {
  if (ref.startsWith("item:")) {
    const [, bid, iid] = ref.split(":")
    return bid && iid ? itemSpace(db, bid, iid) : null
  }
  if (ref.startsWith("signal:")) {
    if (!spacesReady(db)) return db.query("SELECT 1 FROM signals WHERE id=? AND owner=?").get(ref.slice(7), owner) ? PERSONAL : null
    const r = db.query("SELECT space FROM signals WHERE id=? AND owner=?").get(ref.slice(7), owner) as { space: string | null } | null
    return r ? spaceValue(r.space) : null
  }
  return null
}

/** 검색 필터용: 개인이 아닌 일·사건의 ref → 공간. 없는 ref 는 개인 */
export function spaceMap(db: Database, owner: string): Map<string, SpaceId> {
  const out = new Map<string, SpaceId>()
  if (!spacesReady(db)) return out
  for (const r of db.query("SELECT board_id, id, space FROM items WHERE space IS NOT NULL AND space<>'personal'").all() as { board_id: string; id: string; space: string }[]) out.set(`item:${r.board_id}:${r.id}`, r.space as SpaceId)
  for (const r of db.query("SELECT id, space FROM signals WHERE owner=? AND space IS NOT NULL AND space<>'personal'").all(owner) as { id: string; space: string }[]) out.set(`signal:${r.id}`, r.space as SpaceId)
  return out
}

/** GET/POST /api/spaces, PATCH /api/spaces/:id. 에이전트 토큰은 읽기만 */
export async function spacesApi(db: Database, req: Request, parts: string[], u: U): Promise<Response | null> {
  if (parts[1] !== "spaces") return null
  const m = req.method
  if (parts.length === 2 && m === "GET") return json({ spaces: listSpaces(db) })
  if (m !== "POST" && m !== "PATCH") return json({ error: "method not allowed" }, 405)
  if (u.agent) return json({ error: "only a person can change spaces" }, 403)
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null
  const name = cleanSpaceName(body?.name)
  if (!name) return json({ error: "name must be 1-40 characters, not personal/개인, not starting with ws_" }, 400)
  const taken = (except: string | null) => live(db).some((r) => r.id !== except && r.name.toLowerCase() === name.toLowerCase())
  if (parts.length === 2 && m === "POST") {
    if (live(db).length >= MAX_WORKSPACES) return json({ error: `at most ${MAX_WORKSPACES} workspaces` }, 409)
    if (taken(null)) return json({ error: "a workspace with that name already exists" }, 409)
    const id = "ws_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    const t = now()
    db.query("INSERT INTO workspaces(id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?)").run(id, name, u.email, t, t)
    logSpaceEvent(db, "space.create", u.email, { id, name })
    return json({ space: view(db.query("SELECT * FROM workspaces WHERE id=?").get(id) as Row) }, 201)
  }
  if (parts.length === 3 && m === "PATCH") {
    const row = db.query("SELECT * FROM workspaces WHERE id=? AND deleted=0").get(parts[2]) as Row | null
    if (!row) return json({ error: "space not found" }, 404)
    if (taken(row.id)) return json({ error: "a workspace with that name already exists" }, 409)
    db.query("UPDATE workspaces SET name=?, updated_at=? WHERE id=?").run(name, now(), row.id)
    logSpaceEvent(db, "space.update", u.email, { id: row.id, name })
    return json({ space: view({ ...row, name }) })
  }
  return json({ error: "unknown endpoint" }, 404)
}
