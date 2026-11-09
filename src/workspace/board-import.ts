// 방향판(3070) 읽기 전용 가져오기. 출처: board/apps/web/src/hooks/use-data.ts useBoard() 의 동기화 —
// 처음엔 GET /api/state 한 번, 그 뒤엔 GET /api/changes?since=<seq> 로 바뀐 것만(deleted:true 는 지우기), 놓쳤을 수 있으면 다시 전체.
// 사건은 GET /api/signals 를 60초마다. 여기서는 GET 만 해요(get() 이 method 를 GET 으로 고정). 3070 에 쓰지 않고 3070 DB 파일도 열지 않아요.
// 가져온 것은 .quorum/workspace.db 의 사본(source="direction-board", source_id=원래 id). Quorum 에서 사람이 고친 사본(local_edited)은 다시 덮지 않아요.
import type { Database } from "bun:sqlite"
import { ingestSignal } from "./signals"
import type { ItemData } from "./items"

export type BoardArea = { id: string; name: string; color: string }
export type BoardMeta = { boards: { id: string; name: string; kind: string; areas: BoardArea[] }[]; spaces: { id: string; kind: string; name: string }[]; me: { email: string } | null }
export type ImportStatus = { ok: boolean; at: number | null; error: string | null; seq: number; items: number; signals: number; base: string }
export type GetJson = (url: string, init: { method: "GET" }) => Promise<unknown>

const OPEN_LANES = new Set(["now", "decide", "main", "review", "running"])
const WHEN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "")

export function initBoardImport(db: Database) {
  db.exec("CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
}
export const readMeta = (db: Database): BoardMeta => {
  const r = db.query("SELECT value FROM kv WHERE key='board.meta'").get() as { value: string } | null
  try { return r ? (JSON.parse(r.value) as BoardMeta) : { boards: [], spaces: [], me: null } } catch { return { boards: [], spaces: [], me: null } }
}
const writeKv = (db: Database, key: string, v: unknown) => db.query("INSERT INTO kv(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(v))

/** 방향판 항목 하나 → 사본 데이터. todo·goal 만, 나머지(sticky·frame·link)는 null */
export function boardItemData(it: any): ItemData | null {
  if (!it || (it.type !== "todo" && it.type !== "goal")) return null
  const log = Array.isArray(it.log) ? it.log.filter((l: any) => l && typeof l.text === "string").map((l: any) => ({ by: str(l.by, 80) || "unknown", at: Number(l.at) || 0, text: str(l.text, 2000), ...(typeof l.id === "string" ? { id: l.id } : {}) })) : []
  return {
    type: it.type, text: str(it.text, 5000) || "(제목 없음)", done: !!it.done,
    due: it.type === "goal" && typeof it.due === "string" && WHEN.test(it.due) ? it.due : null,
    ...(typeof it.remindAt === "string" && WHEN.test(it.remindAt) ? { remindAt: it.remindAt } : {}),
    ...(typeof it.area === "string" ? { area: it.area } : {}),
    ...(typeof it.goalId === "string" ? { goalId: it.goalId } : {}),
    boardId: str(it.boardId, 80), space: str(it.space, 80) || "personal", placed: !!it.placed,
    log, textBy: it.agent ? "council" : "person", source: "direction-board", sourceId: str(it.boardId, 80) + ":" + String(it.id),
  }
}

/** 사본 넣기·갱신. 사람이 Quorum 에서 고친 사본은 건드리지 않아요. 돌려주는 값: 바뀐 행 수 */
export function upsertBoardItem(db: Database, it: any, now: number): number {
  const sid = typeof it?.id === "string" ? it.boardId + ":" + it.id : ""
  if (!sid) return 0
  const cur = db.query("SELECT id, local_edited, data FROM items WHERE source='direction-board' AND source_id=?").get(sid) as { id: string; local_edited: number; data: string } | null
  const data = it.deleted ? null : boardItemData(it)
  if (!data) {
    if (cur && !cur.local_edited) return db.query("UPDATE items SET deleted=1, updated_at=?, seq=seq+1 WHERE id=? AND deleted=0").run(now, cur.id).changes
    return 0
  }
  if (cur) {
    if (cur.local_edited) return 0
    const json = JSON.stringify(data)
    if (json === cur.data) return db.query("UPDATE items SET deleted=0 WHERE id=? AND deleted=1").run(cur.id).changes
    return db.query("UPDATE items SET data=?, by=?, updated_at=?, deleted=0, seq=seq+1 WHERE id=?").run(json, str(it.by, 120) || "direction-board", Number(it.updatedAt) || now, cur.id).changes
  }
  const id = "db" + crypto.randomUUID().replace(/-/g, "").slice(0, 10)
  const at = Number(it.updatedAt) || now
  db.query("INSERT INTO items(id,data,by,created_at,updated_at,deleted,seq,source,source_id) VALUES (?,?,?,?,?,0,1,'direction-board',?)").run(id, JSON.stringify(data), str(it.by, 120) || "direction-board", at, at, sid)
  return 1
}

/** 방향판 사건 → 사건 사본(ref board:<id>). 열린 칸(now·decide·main·review·running)만 넣고, 닫힌 것은 사본도 닫아요(사람이 처리한 것은 그대로) */
export function upsertBoardSignal(db: Database, s: any, now: number): number {
  if (!s || typeof s.id !== "string" || typeof s.title !== "string") return 0
  const ref = "board:" + s.id
  const open = s.status !== "resolved" && OPEN_LANES.has(String(s.lane))
  const exists = db.query("SELECT id FROM signals WHERE ref=?").get(ref)
  if (!open && !exists) return 0
  const kind = ["start", "progress", "done", "error", "question", "approval", "deadline", "auth", "info"].includes(s.kind) ? s.kind : "info"
  const r = ingestSignal(db, {
    ref, source: "direction-board", kind, title: s.title, body: str(s.body, 8000) || null,
    lane: open ? s.lane : "info", reason: open ? str(s.reason, 300) || null : "방향판에서 닫혔어요",
    meta: { sourceId: s.id, from: "direction-board", boardSource: str(s.source, 40), url: str(s.url, 1000) || null, due: typeof s.due === "number" ? s.due : null },
  }, now)
  return typeof r === "string" ? 0 : 1
}

export function createBoardImport(db: Database, opts: { base: string; get?: GetJson; now?: () => number }) {
  const clock = opts.now ?? Date.now
  const base = opts.base.replace(/\/$/, "")
  const getJson: GetJson = opts.get ?? (async (url, init) => {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } })
    if (!res.ok) throw new Error("HTTP " + res.status + " " + url)
    return res.json()
  })
  /** 3070 에는 GET 만. 다른 method 로 부를 길이 없어요 */
  const get = (path: string) => getJson(base + path, { method: "GET" }) as Promise<any>
  const status: ImportStatus = { ok: false, at: null, error: null, seq: 0, items: 0, signals: 0, base }
  let full = true

  async function syncItems() {
    const now = clock()
    if (full) {
      const s = await get("/api/state")
      if (!s || !Array.isArray(s.items)) throw new Error("/api/state: items 가 없어요")
      const seen = new Set<string>()
      db.transaction(() => {
        for (const it of s.items) { if (it && !it.deleted && typeof it.id === "string") seen.add(it.boardId + ":" + it.id); upsertBoardItem(db, it, now) }
        // 전체 목록에 없는 사본(3070 에서 지워진 것)은 사본도 지워요(사람이 고친 것은 남겨요)
        const rows = db.query("SELECT id, source_id FROM items WHERE source='direction-board' AND deleted=0 AND local_edited=0").all() as { id: string; source_id: string }[]
        for (const r of rows) if (!seen.has(r.source_id)) db.query("UPDATE items SET deleted=1, updated_at=?, seq=seq+1 WHERE id=?").run(now, r.id)
        writeKv(db, "board.meta", {
          boards: (s.boards || []).filter((b: any) => !b.deleted).map((b: any) => ({ id: b.id, name: b.name, kind: b.kind, areas: (b.areas || []).map((a: any) => ({ id: a.id, name: a.name, color: a.color })) })),
          spaces: s.spaces || [], me: s.me?.email ? { email: s.me.email } : null,
        } satisfies BoardMeta)
      })()
      status.seq = Number(s.seq) || 0
      full = false
    } else {
      const c = await get("/api/changes?since=" + status.seq)
      if (!c || !Array.isArray(c.items)) throw new Error("/api/changes: items 가 없어요")
      db.transaction(() => { for (const it of c.items) upsertBoardItem(db, it, now) })()
      if (Array.isArray(c.boards) && c.boards.length) full = true // 영역·판이 바뀌면 다음 회차에 전체를 다시
      status.seq = Number(c.seq) || status.seq
    }
    status.items = (db.query("SELECT COUNT(*) n FROM items WHERE source='direction-board' AND deleted=0").get() as { n: number }).n
  }
  async function syncSignals() {
    const g = await get("/api/signals")
    const list = Array.isArray(g) ? g : Array.isArray(g?.signals) ? g.signals : null
    if (!list) throw new Error("/api/signals: signals 가 없어요")
    const now = clock()
    let n = 0
    db.transaction(() => { for (const s of list) n += upsertBoardSignal(db, s, now) })()
    status.signals = n
  }
  /** 한 회차. 실패하면 다음 회차에 전체부터(board useBoard 의 resync 처럼) */
  async function tick(withSignals: boolean): Promise<ImportStatus> {
    try {
      await syncItems()
      if (withSignals) await syncSignals()
      status.ok = true
      status.error = null
      status.at = clock()
    } catch (e) {
      full = true
      status.ok = false
      status.error = e instanceof Error ? e.message : String(e)
    }
    return { ...status }
  }
  let timers: ReturnType<typeof setInterval>[] = []
  return {
    status: () => ({ ...status }),
    tick,
    start(everyMs = 15_000, signalsMs = 60_000) {
      void tick(true)
      timers = [setInterval(() => void tick(false), everyMs), setInterval(() => void syncSignals().catch((e) => { status.error = String(e) }), signalsMs)]
    },
    stop() { for (const t of timers) clearInterval(t); timers = [] },
  }
}
