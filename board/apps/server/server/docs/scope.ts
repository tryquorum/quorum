// 문서 범위(work_notes·doc_index 등의 owner 칸 값): 보통은 사람 이메일이에요. 파일럿에서 회사 판의 회사(워크스페이스) 공간 일은
// 그 워크스페이스 id 를 범위로 써서 노트·태그·속성·색인이 한 벌이에요(관리자 여럿과 멤버가 같은 노트를 봐요). 설계: docs/internals/pilot.md
// 개인 방향판(파일럿이 아닌 서버)에서는 켜지지 않고 지금처럼 사람 범위예요.
import type { Database } from "bun:sqlite"
import { PERSONAL, resolveSpace } from "../spaces.ts"

const scoped = new WeakSet<Database>()
const WS = /^ws_[0-9a-f]{12}$/
/** 파일럿이 시작할 때 한 번 */
export function enableWorkspaceScope(db: Database): void { scoped.add(db) }
/** 파일럿 서버인지(워크스페이스 범위가 켜졌는지). 파일럿에서만 기록 상한 같은 정책을 켜요 */
export const isPilotDb = (db: Database): boolean => scoped.has(db)
/** 이 범위 값이 워크스페이스인지(사람 이메일은 아님) */
export const isWorkspaceScope = (owner: string): boolean => WS.test(owner)

/** 워크스페이스 범위(owner=ws id)가 다룰 수 있는 항목인지: 회사 판에 있고 지금 공간이 그 워크스페이스 */
export function workspaceItem(db: Database, owner: string, bid: string, iid: string): boolean {
  if (!isWorkspaceScope(owner)) return false
  const r = db.query("SELECT b.kind, i.space FROM items i JOIN boards b ON b.id=i.board_id WHERE i.board_id=? AND i.id=?").get(bid, iid) as { kind: string; space: string | null } | null
  return r?.kind === "company" && r.space === owner
}

/** ref 의 문서 범위: 파일럿 회사 판의 워크스페이스 공간 항목이면 그 워크스페이스, 아니면 사람 */
export function scopeOf(db: Database, owner: string, ref: unknown): string {
  if (!scoped.has(db) || typeof ref !== "string" || !ref.startsWith("item:")) return owner
  const [, bid, iid] = ref.split(":")
  const r = db.query("SELECT b.kind, i.space FROM items i JOIN boards b ON b.id=i.board_id WHERE i.board_id=? AND i.id=?").get(bid, iid) as { kind: string; space: string | null } | null
  return r && r.kind === "company" && r.space && r.space !== PERSONAL ? r.space : owner
}

/** 검색 범위: 파일럿에서 space 로 워크스페이스를 고르면 그 워크스페이스 범위에서 찾아요. 없거나 개인이면 사람 범위 */
export function searchScope(db: Database, owner: string, space: unknown): string {
  if (!scoped.has(db) || space === undefined || space === null) return owner
  const ws = resolveSpace(db, space)
  return ws && ws !== PERSONAL ? ws : owner
}

/** 이 일(ref)에 어느 범위든 문서(노트·태그·속성)가 있는지 */
function hasDocs(db: Database, ref: string): boolean {
  return !!db.query("SELECT 1 FROM work_notes WHERE ref=? UNION ALL SELECT 1 FROM doc_tag_sources WHERE ref=? UNION ALL SELECT 1 FROM doc_props WHERE ref=? LIMIT 1").get(ref, ref, ref)
}

/**
 * 항목의 공간을 next 로 쓸 때 막을 이유(파일럿에서만, 없으면 null).
 * - 회사 판에는 개인 공간 일을 두지 않아요(400).
 * - 이미 있는 항목의 문서 범위가 바뀌는 이동(회사 판에서 개인↔회사, 회사↔다른 회사)은 그 일에 노트·태그·속성이 하나라도 있으면 409.
 *   범위를 옮기는 이전(노트·태그·속성·색인·버전을 충돌 검사와 함께 한 트랜잭션으로)을 만들기 전까지는 글이 안 보이게 되는 이동을 하지 않아요.
 */
export function spaceMoveProblem(db: Database, bid: string, iid: string | null, next: string | undefined): { status: 400 | 409; error: string } | null {
  if (!scoped.has(db) || next === undefined) return null
  const board = db.query("SELECT kind FROM boards WHERE id=?").get(bid) as { kind: string } | null
  if (board?.kind !== "company") return null
  const row = iid ? db.query("SELECT space FROM items WHERE board_id=? AND id=?").get(bid, iid) as { space: string | null } | null : null
  // 공간이 그대로인 저장(회사 판에 남아 있던 옛 개인 항목을 관리자가 고칠 때 포함)은 막지 않아요
  if (row && (row.space || PERSONAL) === next) return null
  if (next === PERSONAL) return { status: 400, error: "파일럿 회사 판에는 회사 공간 일만 둬요(새 개인 일·개인으로 옮기기 불가)" }
  if (!row) return null
  return hasDocs(db, `item:${bid}:${iid}`) ? { status: 409, error: "노트·태그·속성이 있는 일은 아직 공간을 옮길 수 없어요(옮기면 그 글이 다른 범위에 남아 안 보여요). 새 일로 만들어 옮겨 적어 주세요" } : null
}
