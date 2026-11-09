import { compareWorkOrder, type Item, type Signal } from '@direction-board/contracts'

export function sortBoardItems(items: Item[]): Item[] {
  return items
    .filter((i) => !i.deleted && (i.type === 'todo' || i.type === 'goal'))
    .sort((a, b) => compareWorkOrder(a, b))
}

// 웹의 home.tsx:57-70과 같은 분류와 task 기준 중복 제거.
export function homeSignals(signals: Signal[]) {
  const open = signals.filter((s) => s.status === 'open')
  const seen = new Set<string>()
  return {
    decisions: open.filter((s) => s.lane === 'now' || s.lane === 'decide'),
    running: open
      .filter((s) => s.lane === 'running')
      .filter((s) => {
        const key = s.task || s.id
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }),
    awaiting: open.filter((s) => s.lane === 'review').sort((a, b) => b.updated_at - a.updated_at),
  }
}
