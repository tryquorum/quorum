// 계층 트리 보기의 순수 부분: 읽어 둔 가지와 펼침으로 보이는 줄을 만들고, 형제 순서 옮기기 요청을 만들어요(웹 트리의 끌어 놓기 대신).
// 규칙: docs/internals/doc-hierarchy.md(독립 문서만, 8단, 순환·보관 거절은 서버가 409·400).
import type { MoveInput, SearchHit } from '@direction-board/contracts'

export type Branch = { items: SearchHit[]; next?: string; state: 'loading' | 'ok' | 'error' }
export type TreeLine =
  | { type: 'doc'; hit: SearchHit; level: number; stale: boolean; index: number; siblings: SearchHit[]; open: boolean; hasChildren: boolean }
  | { type: 'more' | 'error' | 'loading' | 'empty'; parent: string | null; level: number; cursor?: string }
export const branchKey = (parent: string | null) => parent ?? 'root'

/** 맨 위부터 펼친 가지만 따라 내려가며 줄을 만들어요. 가지가 읽는 중·오류면 그 가지 줄은 옛 위치일 수 있어 stale */
export function visibleLines(branches: Record<string, Branch>, open: Set<string>): TreeLine[] {
  const out: TreeLine[] = []
  const walk = (parent: string | null, level: number, seen: Set<string>) => {
    const b = branches[branchKey(parent)]
    if (!b) return
    const stale = b.state !== 'ok'
    b.items.forEach((hit, index) => {
      const hasChildren = (hit.children ?? 0) > 0
      const isOpen = hasChildren && open.has(hit.ref) && !seen.has(hit.ref)
      out.push({ type: 'doc', hit, level, stale, index, siblings: b.items, open: isOpen, hasChildren })
      if (isOpen) walk(hit.ref, level + 1, new Set([...seen, hit.ref]))
    })
    if (b.state === 'loading' && !b.items.length) out.push({ type: 'loading', parent, level })
    else if (b.state === 'error') out.push({ type: 'error', parent, level })
    else if (b.state === 'ok' && !b.items.length && level === 1) out.push({ type: 'empty', parent, level })
    if (b.next && b.state !== 'loading') out.push({ type: 'more', parent, level, cursor: b.next })
  }
  walk(null, 1, new Set())
  return out
}

/** 위로 한 칸(바로 앞 형제 앞으로) / 아래로 한 칸(바로 뒤 형제 뒤로). 끝이면 null */
export function siblingMove(siblings: SearchHit[], index: number, dir: 'up' | 'down'): MoveInput | null {
  const hit = siblings[index]
  if (!hit) return null
  const parent = hit.parent ?? null
  if (dir === 'up') return index > 0 ? { ref: hit.ref, parent, before: siblings[index - 1].ref } : null
  return index < siblings.length - 1 ? { ref: hit.ref, parent, after: siblings[index + 1].ref } : null
}
