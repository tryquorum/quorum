// 목표에 붙인 할 일의 공간(PR #39 리뷰 5·6). 공간의 원본은 서버예요: 웹·iOS·옛 클라이언트·AI(/api/act·MCP board_act)가
// space 를 빠뜨려도 회사 판 기본 워크스페이스로 보내지 않고 목표의 공간을 물려받아요. 다른 공간이면 거절해요. 설계: docs/internals/spaces.md
import type { Database } from "bun:sqlite"
import { itemSpace } from "./spaces.ts"

export type GoalSpace = { space: string | undefined; from: string | null } | { error: string }

export const GOAL_SPACE_MISMATCH = "할 일의 공간이 목표의 공간과 달라요. 목표와 같은 공간으로 보내거나 목표 없이 만들어 주세요"

/** 같은 판의 목표(지워지지 않은 goal)의 공간. 공간 없는 옛 항목·공간 열이 없는 옛 DB 는 개인(spaces.ts itemSpace). 목표가 아니면 null */
export function goalSpaceOf(db: Database, bid: string, iid: string): string | null {
  const row = db.query("SELECT data FROM items WHERE board_id=? AND id=? AND deleted=0").get(bid, iid) as { data: string } | null
  if (!row) return null
  try { return (JSON.parse(row.data) as { type?: unknown }).type === "goal" ? itemSpace(db, bid, iid) : null } catch { return null }
}

/**
 * REST 항목 POST·PUT 의 판정. item: 정리된 항목(type·goalId), asked: 요청이 보낸 공간(resolveSpace 뒤, 안 보냈으면 undefined).
 * fresh: 새 항목이면 안 보낸 공간을 목표에서 물려받아요. linked: 이미 있는 항목의 goalId 가 바뀌었으면
 * 보낸 공간(없으면 저장된 공간 current)을 목표와 비교해 다르면 거절해요(옮기지 않음). from: 물려받은 목표의 공간(안내용)
 * goalId 는 그대로인데 공간을 옮기는 저장(asked ≠ current)도 목표와 비교해요(목표에 붙은 채 다른 공간으로 옮기지 않게)
 */
export function goalSpace(db: Database, bid: string, item: { type?: unknown; goalId?: unknown }, asked: string | undefined, how: { fresh: boolean; linked: boolean; current?: string | null }): GoalSpace {
  const keep = { space: asked, from: null }
  const moved = !how.fresh && asked !== undefined && asked !== (how.current || "personal")
  if (!(how.fresh || how.linked || moved) || item.type !== "todo" || typeof item.goalId !== "string" || !item.goalId) return keep
  const want = goalSpaceOf(db, bid, item.goalId)
  if (!want) return keep
  if (asked === undefined && how.fresh) return { space: want, from: want }
  if ((asked ?? (how.current || "personal")) !== want) return { error: GOAL_SPACE_MISMATCH }
  return keep
}

/** 물려받은 공간을 공간 규칙이 막으면(예: 파일럿 회사 판의 개인 목표) 목표 때문이라고 안내해요 */
export const goalBlocked = (g: GoalSpace, error: string) =>
  "from" in g && g.from ? `이 목표는 ${g.from === "personal" ? "개인" : "다른"} 공간이라 여기에 할 일을 붙일 수 없어요(목표의 공간을 물려받아요): ${error}` : error
