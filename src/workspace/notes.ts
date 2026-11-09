// 노트. 출처: board/apps/server/server/notes.ts 의 "에이전트는 노트를 덧붙이기만, 사람이 고친 노트(person_edited)는 덮지 않기" 규칙.
// 바꾼 점: Tiptap HTML 변환·문서 색인 없이 마크다운 한 덩어리로 저장해요(ref 는 item:<id> 또는 signal:<id>).
// 글은 절대 잘라내지 않아요(리뷰 지적 1): 사람 저장이 상한을 넘으면 거절(413), 에이전트 덧붙임이 넘치면 노트는 그대로 두고
// 덧붙일 글을 note_overflow 에 따로 보관해요. 사람 저장은 버전(baseUpdatedAt)을 확인해서, 그사이 의회가 붙인 글을 지우지 않아요(지적 9).
import type { Database } from "bun:sqlite"

export const NOTE_MAX = 50_000
export type Note = { ref: string; md: string; by: string; updatedAt: number; personEdited: boolean; overflow?: number }
type Row = { ref: string; md: string; by: string; updated_at: number; person_edited: number }

/** 노트 저장 거절. status 413(너무 김) 또는 409(그사이 바뀜) */
export class NoteRejected extends Error {
  status: 409 | 413
  current: Note | null
  constructor(status: 409 | 413, message: string, current: Note | null) { super(message); this.status = status; this.current = current }
}

export function initNotes(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS notes(ref TEXT PRIMARY KEY, md TEXT NOT NULL, by TEXT NOT NULL, updated_at INTEGER NOT NULL, person_edited INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS note_overflow(id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL, md TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS note_overflow_ref ON note_overflow(ref, id);`)
}
const pub = (r: Row, overflow: number): Note => ({ ref: r.ref, md: r.md, by: r.by, updatedAt: r.updated_at, personEdited: !!r.person_edited, ...(overflow ? { overflow } : {}) })

export function getNote(db: Database, ref: string): Note | null {
  const r = db.query("SELECT * FROM notes WHERE ref=?").get(ref) as Row | null
  if (!r) return null
  const n = (db.query("SELECT COUNT(*) n FROM note_overflow WHERE ref=?").get(ref) as { n: number }).n
  return pub(r, n)
}

/** 노트가 가득 차서 따로 보관한 덧붙임(오래된 것부터) */
export function noteOverflow(db: Database, ref: string): { by: string; at: number; md: string }[] {
  return db.query("SELECT by, at, md FROM note_overflow WHERE ref=? ORDER BY id").all(ref) as { by: string; at: number; md: string }[]
}

/**
 * 사람이 쓴 노트 저장(통째로). person_edited 를 켜요. 자르지 않아요: NOTE_MAX 를 넘으면 NoteRejected(413).
 * opts.baseUpdatedAt 을 주면 저장된 노트의 updatedAt 과 같을 때만 저장해요(아니면 NoteRejected(409), 그사이 의회가 붙인 글을 지키려고)
 */
export function putNote(db: Database, ref: string, md: string, now = Date.now(), opts: { baseUpdatedAt?: number } = {}): Note {
  return db.transaction(() => {
    const cur = getNote(db, ref)
    if (md.length > NOTE_MAX) throw new NoteRejected(413, "노트가 너무 길어요(" + md.length + "자, 최대 " + NOTE_MAX + "자). 자르지 않고 저장하지 않았어요", cur)
    if (opts.baseUpdatedAt !== undefined && (cur?.updatedAt ?? 0) !== opts.baseUpdatedAt) throw new NoteRejected(409, "그사이 노트가 바뀌었어요(의회 결과가 붙었을 수 있어요). 다시 불러온 뒤 저장해 주세요", cur)
    db.query("INSERT INTO notes(ref,md,by,updated_at,person_edited) VALUES (?,?,?,?,1) ON CONFLICT(ref) DO UPDATE SET md=excluded.md, by=excluded.by, updated_at=excluded.updated_at, person_edited=1")
      .run(ref, md, "person", now)
    return getNote(db, ref)!
  })()
}

/**
 * 에이전트·의회가 덧붙이기. 기존 글(사람 글 포함)은 그대로 두고 끝에 더해요.
 * 더하면 NOTE_MAX 를 넘을 때는 노트를 자르지 않고, 덧붙일 글을 note_overflow 에 보관한 뒤 (들어가면) 노트 끝에 한 줄로 알려요
 */
export function appendNote(db: Database, ref: string, md: string, by: string, now = Date.now()): Note {
  return db.transaction(() => {
    const cur = getNote(db, ref)
    const add = md.trim()
    const next = (cur?.md ? cur.md.trimEnd() + "\n\n" : "") + add
    if (next.length <= NOTE_MAX) {
      db.query("INSERT INTO notes(ref,md,by,updated_at,person_edited) VALUES (?,?,?,?,0) ON CONFLICT(ref) DO UPDATE SET md=excluded.md, updated_at=excluded.updated_at")
        .run(ref, next, by, now)
      return getNote(db, ref)!
    }
    db.query("INSERT INTO note_overflow(ref,by,at,md) VALUES (?,?,?,?)").run(ref, by, now, add)
    const pointer = "\n\n(노트가 가득 차서 " + by + " 의 결과 " + add.length + "자를 따로 보관했어요)"
    const base = cur?.md ?? ""
    const md2 = base.trimEnd().length + pointer.length <= NOTE_MAX ? base.trimEnd() + pointer : base
    db.query("INSERT INTO notes(ref,md,by,updated_at,person_edited) VALUES (?,?,?,?,0) ON CONFLICT(ref) DO UPDATE SET md=excluded.md, updated_at=excluded.updated_at")
      .run(ref, md2, by, now)
    return getNote(db, ref)!
  })()
}
