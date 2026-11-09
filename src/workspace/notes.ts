// 노트. 출처: board/apps/server/server/notes.ts 의 "에이전트는 노트를 덧붙이기만, 사람이 고친 노트(person_edited)는 덮지 않기" 규칙.
// 바꾼 점: Tiptap HTML 변환·문서 색인 없이 마크다운 한 덩어리로 저장해요(ref 는 item:<id> 또는 signal:<id>).
import type { Database } from "bun:sqlite"

export type Note = { ref: string; md: string; by: string; updatedAt: number; personEdited: boolean }
type Row = { ref: string; md: string; by: string; updated_at: number; person_edited: number }

export function initNotes(db: Database) {
  db.exec("CREATE TABLE IF NOT EXISTS notes(ref TEXT PRIMARY KEY, md TEXT NOT NULL, by TEXT NOT NULL, updated_at INTEGER NOT NULL, person_edited INTEGER NOT NULL DEFAULT 0)")
}
const pub = (r: Row): Note => ({ ref: r.ref, md: r.md, by: r.by, updatedAt: r.updated_at, personEdited: !!r.person_edited })

export function getNote(db: Database, ref: string): Note | null {
  const r = db.query("SELECT * FROM notes WHERE ref=?").get(ref) as Row | null
  return r ? pub(r) : null
}

/** 사람이 쓴 노트 저장(통째로). person_edited 를 켜요 */
export function putNote(db: Database, ref: string, md: string, now = Date.now()): Note {
  db.query("INSERT INTO notes(ref,md,by,updated_at,person_edited) VALUES (?,?,?,?,1) ON CONFLICT(ref) DO UPDATE SET md=excluded.md, by=excluded.by, updated_at=excluded.updated_at, person_edited=1")
    .run(ref, md.slice(0, 50_000), "person", now)
  return getNote(db, ref)!
}

/** 에이전트·의회가 덧붙이기. 기존 글(사람 글 포함)은 그대로 두고 끝에 더해요 */
export function appendNote(db: Database, ref: string, md: string, by: string, now = Date.now()): Note {
  const cur = getNote(db, ref)
  const next = (cur?.md ? cur.md.trimEnd() + "\n\n" : "") + md.trim()
  db.query("INSERT INTO notes(ref,md,by,updated_at,person_edited) VALUES (?,?,?,?,0) ON CONFLICT(ref) DO UPDATE SET md=excluded.md, updated_at=excluded.updated_at")
    .run(ref, next.slice(-50_000), by, now)
  return getNote(db, ref)!
}
