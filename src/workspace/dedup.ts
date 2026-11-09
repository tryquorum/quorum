// 같은 일을 두 번 만들지 않기. 출처: board/apps/server/server/dedup.ts findSameTodo (공간 구분은 뺐어요).
// 비교는 보수적으로: 공백·문장부호·대소문자만 무시한 제목이 완전히 같을 때만 같은 일로 봐요.
import type { Database } from "bun:sqlite"
import { normTitle, SAME_TITLE_MIN } from "./text"

export const DONE_RECENT_MS = 14 * 864e5
export type SameTodo = { id: string; title: string; done: boolean; updatedAt: number }

export function findSameTodo(db: Database, title: string, opts: { doneWithinMs?: number; excludeId?: string; now?: number } = {}): SameTodo | null {
  const want = normTitle(title)
  if (want.length < SAME_TITLE_MIN) return null
  const t = opts.now ?? Date.now()
  const rows = db.query("SELECT id, data, updated_at FROM items WHERE deleted=0").all() as { id: string; data: string; updated_at: number }[]
  let open: SameTodo | null = null
  let done: SameTodo | null = null
  for (const r of rows) {
    if (r.id === opts.excludeId) continue
    let d: any
    try { d = JSON.parse(r.data) } catch { continue }
    if (normTitle(String(d.text || "")) !== want) continue
    const hit: SameTodo = { id: r.id, title: String(d.text || ""), done: !!d.done, updatedAt: r.updated_at }
    if (!hit.done) { if (!open || hit.updatedAt > open.updatedAt) open = hit }
    else if (opts.doneWithinMs !== undefined && t - hit.updatedAt <= opts.doneWithinMs) { if (!done || hit.updatedAt > done.updatedAt) done = hit }
  }
  return open || done
}
