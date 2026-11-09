// 항목(사람이 기록한 할 일). 출처: board/apps/server/server.ts 의 items 표(data JSON + seq), cleanItem() 의 검사,
// readItem/writeItem 흐름, 그리고 capture.ts findDuplicate 의 "같은 키 + 같은 글이면 같은 제출, 다른 글이면 충돌" 규칙.
// 바꾼 점: 판(board)·공간 없이 한 목록이고, 종류는 todo 하나, 좌표 대신 due(YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM)만 둬요.
// 사람 글 보호(방향판 규칙): 사람이 쓴 제목(textBy=person)은 의회·에이전트가 바꾸지 못하고, 사람 기록(log)은 서버가 지우지 않아요.
import type { Database } from "bun:sqlite"
import { appendLog, type LogLine } from "./item-log"
import { normTitle } from "./text"
import { parse as parseWhen } from "./when"
import { findSameTodo } from "./dedup"

export type ItemData = {
  type: "todo" | "goal"; text: string; raw?: string; done: boolean; due: string | null; log: LogLine[]; runId?: string; textBy: "person" | "council"
  /** capture = Quorum 빠른 기록, direction-board = 3070 에서 읽어 온 사본 */
  source?: "capture" | "direction-board"; sourceId?: string
  remindAt?: string; area?: string; boardId?: string; space?: string; goalId?: string; placed?: boolean; doneAt?: number
}
export type Item = ItemData & { id: string; by: string; createdAt: number; updatedAt: number; seq: number; localEdited: boolean }
type Row = { id: string; data: string; by: string; created_at: number; updated_at: number; deleted: number; seq: number; client_key: string | null; source: string | null; source_id: string | null; local_edited: number }
export type Fail = { status: number; error: string }

const WHEN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/
const RUN = /^[A-Za-z0-9_-]{1,80}$/
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "")
export const TEXT_MAX = 2000

export function initItems(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, data TEXT NOT NULL, by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL DEFAULT 1, client_key TEXT, source TEXT, source_id TEXT, local_edited INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS items_client_key ON items(client_key) WHERE client_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS items_source ON items(source, source_id) WHERE source_id IS NOT NULL;`)
}

const pub = (r: Row): Item => ({ ...(JSON.parse(r.data) as ItemData), id: r.id, by: r.by, createdAt: r.created_at, updatedAt: r.updated_at, seq: r.seq, localEdited: !!r.local_edited })
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12)

export function getItem(db: Database, id: string): Item | null {
  const r = db.query("SELECT * FROM items WHERE id=? AND deleted=0").get(id) as Row | null
  return r ? pub(r) : null
}
export function listItems(db: Database, opts: { done?: boolean } = {}): Item[] {
  const rows = db.query("SELECT * FROM items WHERE deleted=0 ORDER BY created_at DESC LIMIT 2000").all() as Row[]
  return rows.map(pub).filter((i) => opts.done || !i.done)
}
export function itemByRun(db: Database, runId: string): Item | null {
  return listItems(db, { done: true }).find((i) => i.runId === runId) ?? null
}
/** 사람이 고치면 local_edited 를 켜요: 가져온 사본이라도 그 뒤로는 3070 의 값이 Quorum 에서 고친 것을 덮지 않아요 */
function write(db: Database, id: string, data: ItemData, by: string, now: number) {
  db.query("UPDATE items SET data=?, by=?, updated_at=?, seq=seq+1, local_edited=CASE WHEN ?='person' THEN 1 ELSE local_edited END WHERE id=?").run(JSON.stringify(data), by, now, by, id)
}
const strip = ({ id: _i, by: _b, createdAt: _c, updatedAt: _u, seq: _s, localEdited: _l, ...d }: Item): ItemData => d

/**
 * 빠른 기록. 사람 글을 그대로 받아 날짜만 읽어 내요(when.ts). due 를 주면 그걸 써요.
 * clientKey 가 같으면: 같은 글이면 같은 제출(응답을 놓친 다시 보내기), 다른 글이면 409.
 * 같은 제목의 열린 일이 이미 있으면 새로 만들지 않고 그 일을 existed 로 돌려줘요(dedup.ts).
 */
export function createItem(db: Database, body: Record<string, unknown>, now = Date.now()): { item: Item; existed: "same" | "open" | null } | Fail {
  const raw = typeof body.text === "string" ? body.text.trim() : ""
  if (!raw) return { status: 400, error: "text required" }
  if (raw.length > TEXT_MAX) return { status: 400, error: "text too long (max " + TEXT_MAX + ")" }
  const clientKey = str(body.clientKey, 80) || null
  return db.transaction(() => {
    if (clientKey) {
      const row = db.query("SELECT * FROM items WHERE client_key=?").get(clientKey) as Row | null
      if (row) {
        const it = pub(row)
        return normTitle(it.raw ?? it.text) === normTitle(raw) ? { item: it, existed: "same" as const } : { status: 409, error: "같은 키로 다른 글이 이미 저장됐어요" }
      }
    }
    let text = raw
    let due: string | null = null
    if (body.due === null || typeof body.due === "string") {
      due = body.due && WHEN.test(String(body.due)) ? String(body.due) : null
    } else if (body.parseWhen !== false) {
      const w = parseWhen(raw, new Date(now))
      if (w && w.title.trim()) { due = w.at; text = w.title.trim() }
    }
    const same = findSameTodo(db, text, { now })
    if (same && !same.done) return { item: getItem(db, same.id)!, existed: "open" as const }
    const id = rid()
    const data: ItemData = { type: "todo", text, ...(text !== raw ? { raw } : {}), done: false, due, log: [], textBy: "person", source: "capture" }
    db.query("INSERT INTO items(id,data,by,created_at,updated_at,deleted,seq,client_key) VALUES (?,?,?,?,?,0,1,?)").run(id, JSON.stringify(data), "person", now, now, clientKey)
    return { item: getItem(db, id)!, existed: null }
  })()
}

/**
 * 사람이 고치기(화면). seq 를 주면 그 판이 아닐 때 409(다른 창에서 먼저 고친 것을 덮지 않게).
 * actor 가 person 이 아니면(의회·에이전트) 사람이 쓴 제목은 바꾸지 못해요.
 */
export function patchItem(db: Database, id: string, body: Record<string, unknown>, actor: "person" | "council" = "person", now = Date.now()): Item | Fail {
  return db.transaction(() => {
    const cur = getItem(db, id)
    if (!cur) return { status: 404, error: "item not found" }
    if (body.seq !== undefined && Number(body.seq) !== cur.seq) return { status: 409, error: "다른 곳에서 먼저 고쳤어요. 새로 불러온 뒤 다시 해 주세요" }
    const d = strip(cur)
    if (body.text !== undefined) {
      const t = typeof body.text === "string" ? body.text.trim() : ""
      if (!t) return { status: 400, error: "text required" }
      if (t.length > TEXT_MAX) return { status: 400, error: "text too long" }
      if (actor !== "person" && d.textBy === "person" && t !== d.text) return { status: 403, error: "사람이 쓴 글은 사람만 고쳐요" }
      d.text = t
      if (actor === "person") d.textBy = "person"
    }
    if (body.due !== undefined) {
      if (body.due !== null && !(typeof body.due === "string" && WHEN.test(body.due))) return { status: 400, error: "due must be YYYY-MM-DD or YYYY-MM-DDTHH:MM" }
      d.due = (body.due as string | null) ?? null
    }
    if (body.done !== undefined) { d.done = !!body.done; if (d.done) d.doneAt = now; else delete d.doneAt }
    if (body.runId !== undefined) {
      if (!(typeof body.runId === "string" && RUN.test(body.runId))) return { status: 400, error: "bad runId" }
      d.runId = body.runId
    }
    write(db, id, d, actor, now)
    return getItem(db, id)!
  })()
}

/** 기록 한 줄. by 가 agent·goat·system 이면 자동 기록(최근 80개만), 그 밖은 사람 기록(지우지 않음) */
export function logItem(db: Database, id: string, line: { by: string; text: string }, now = Date.now()): Item | Fail {
  const text = line.text.trim().slice(0, 2000)
  if (!text) return { status: 400, error: "text required" }
  return db.transaction(() => {
    const cur = getItem(db, id)
    if (!cur) return { status: 404, error: "item not found" }
    const d = strip(cur)
    const next = appendLog(d.log, { by: line.by, at: now, text })
    if (!Array.isArray(next)) return next
    d.log = next
    write(db, id, d, line.by === "person" ? "person" : cur.by, now)
    return getItem(db, id)!
  })()
}

export function archiveItem(db: Database, id: string, now = Date.now()): boolean {
  return db.query("UPDATE items SET deleted=1, updated_at=?, seq=seq+1 WHERE id=? AND deleted=0").run(now, id).changes > 0
}
