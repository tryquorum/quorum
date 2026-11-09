// 같은 일을 두 번 만들지 않기: AI 대화(/api/act)와 운영 순회(/api/ops/report)가 새 할 일을 만들기 전에 쓴다.
// 비교는 보수적으로: 공백·문장부호·대소문자만 무시한 제목이 완전히 같을 때만 같은 일로 본다.
// 비슷한 일(표현이 다른 것)은 프롬프트에 기존 목록을 보여 줘서 AI가 고르게 한다.
import type { Database } from "bun:sqlite"
import { normTitle, SAME_TITLE_MIN } from "@direction-board/contracts/text"
import { spacesReady } from "./spaces.ts"

export const DONE_RECENT_MS = 14 * 864e5

/** 제목 비교 규칙은 웹 빠른 추가와 함께 쓰려고 packages/contracts/src/text.ts 에 있어요 */
export { normTitle }

export type SameTodo = { ref: string; iid: string; title: string; done: boolean; updatedAt: number; opsKey?: string }

/**
 * 한 판에서 제목이 같은 할 일·목표를 찾는다. 열린 것을 먼저, 끝낸 것은 최근 doneWithinMs 안에 끝낸 것만.
 * 비교할 글자가 4자 미만이면 잘못 합칠 수 있어서 찾지 않는다.
 */
/** space 를 주면 그 공간(NULL 은 개인)의 일만 봐요. 개인 일과 회사 일은 제목이 같아도 다른 일이에요 */
export function findSameTodo(db: Database, boardId: string, title: string, opts: { doneWithinMs?: number; excludeIid?: string; now?: number; space?: string } = {}): SameTodo | null {
  const want = normTitle(title)
  if (want.length < SAME_TITLE_MIN) return null
  const t = opts.now ?? Date.now()
  const rows = db.query(`SELECT id, data, updated_at, ${spacesReady(db) ? "COALESCE(space,'personal')" : "'personal'"} AS space FROM items WHERE board_id=? AND deleted=0`).all(boardId) as { id: string; data: string; updated_at: number; space: string }[]
  let open: SameTodo | null = null
  let done: SameTodo | null = null
  for (const r of rows) {
    if (r.id === opts.excludeIid) continue
    if (opts.space !== undefined && r.space !== opts.space) continue
    let d: any
    try { d = JSON.parse(r.data) } catch { continue }
    if (d?.type !== "todo" && d?.type !== "goal") continue
    if (normTitle(String(d.text || "")) !== want) continue
    const hit: SameTodo = { ref: "item:" + boardId + ":" + r.id, iid: r.id, title: String(d.text || ""), done: !!d.done, updatedAt: r.updated_at, ...(d.opsKey ? { opsKey: String(d.opsKey) } : {}) }
    if (!hit.done) { if (!open || hit.updatedAt > open.updatedAt) open = hit }
    else if (opts.doneWithinMs !== undefined && t - hit.updatedAt <= opts.doneWithinMs) { if (!done || hit.updatedAt > done.updatedAt) done = hit }
  }
  return open || done
}

