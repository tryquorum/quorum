// 보드 캔버스의 순수 계산(옛 보드 index.html 과 같은 규칙: 영역(frame)이 먼저 깔리고, 그 위에 메모·글·목표, 연결은 선)
import type { Item } from '@direction-board/contracts'

export const CANVAS_TYPES = new Set(['sticky', 'text', 'goal', 'frame'])
export const MIN_W = 40
export const MIN_H = 30
/** 앞(왼쪽·위) 여백은 작게 해서 처음 열면 항목이 바로 보이고, 뒤(오른쪽·아래)는 넉넉히 비워 더할 자리를 둬요 */
export const LEAD = 40
export const PAD = 400

/** 캔버스에 그릴 항목(할 일·연결은 빼요). 영역이 먼저, 그다음 z 순서 */
export function canvasItems(items: Item[], boardId: string | undefined): Item[] {
  return items
    .filter((i) => i.boardId === boardId && !i.deleted && CANVAS_TYPES.has(i.type))
    .sort((a, b) => (a.type === 'frame' ? 0 : 1) - (b.type === 'frame' ? 0 : 1) || (Number(a.z) || 0) - (Number(b.z) || 0))
}
export const linksOf = (items: Item[], boardId: string | undefined) => items.filter((i) => i.boardId === boardId && !i.deleted && i.type === 'link')

/** 글·목표는 옛 보드에서 높이가 글에 맞춰 늘어나요. 앱은 저장된 높이와 한 줄 높이 중 큰 것 */
export const heightOf = (it: Item) => (it.type === 'text' || it.type === 'goal' ? Math.max(it.h, 56) : it.h)

/** 그릴 범위: 모든 항목을 담고 앞 LEAD·뒤 PAD 만큼 여유. 원점 이동값(ox, oy)을 더하면 화면 좌표 */
export function canvasBounds(items: Item[]) {
  if (!items.length) return { ox: LEAD, oy: LEAD, width: 1200, height: 1600 }
  const minX = Math.min(...items.map((i) => i.x))
  const minY = Math.min(...items.map((i) => i.y))
  const maxX = Math.max(...items.map((i) => i.x + i.w))
  const maxY = Math.max(...items.map((i) => i.y + heightOf(i)))
  return { ox: LEAD - minX, oy: LEAD - minY, width: Math.max(800, maxX - minX + LEAD + PAD), height: Math.max(1000, maxY - minY + LEAD + PAD) }
}

/** 두 항목 가운데를 잇는 선(길이·각도·가운데 점). 둘 중 하나가 없으면 null */
export function linkLine(items: Item[], link: Item): { x: number; y: number; length: number; angle: number } | null {
  const a = items.find((i) => i.id === link.from)
  const b = items.find((i) => i.id === link.to)
  if (!a || !b) return null
  const ax = a.x + a.w / 2, ay = a.y + heightOf(a) / 2, bx = b.x + b.w / 2, by = b.y + heightOf(b) / 2
  const length = Math.hypot(bx - ax, by - ay)
  return { x: (ax + bx) / 2, y: (ay + by) / 2, length, angle: Math.atan2(by - ay, bx - ax) }
}

/** 끌어 옮긴 거리(화면 점)를 확대 배율로 나눠 캔버스 좌표로. 크기는 최소값 아래로 줄지 않아요 */
export const moved = (it: Item, dx: number, dy: number, zoom: number): Item => ({ ...it, x: Math.round(it.x + dx / zoom), y: Math.round(it.y + dy / zoom) })
export const resized = (it: Item, dx: number, dy: number, zoom: number): Item => ({ ...it, w: Math.max(MIN_W, Math.round(it.w + dx / zoom)), h: Math.max(MIN_H, Math.round(it.h + dy / zoom)) })

/** 새 항목 기본값(옛 보드 도구와 같은 크기). at 은 보이는 화면 가운데의 캔버스 좌표 */
export function newCanvasItem(type: 'sticky' | 'text' | 'goal' | 'frame', id: string, boardId: string, at: { x: number; y: number }, z: number): Item {
  const size = type === 'frame' ? { w: 480, h: 320 } : type === 'sticky' ? { w: 200, h: 160 } : type === 'goal' ? { w: 260, h: 90 } : { w: 240, h: 60 }
  return { id, boardId, type, text: '', x: Math.round(at.x - size.w / 2), y: Math.round(at.y - size.h / 2), ...size, z, ...(type === 'sticky' ? { color: 'yellow' } : {}), ...(type === 'goal' ? { due: null, done: false } : {}) }
}
/** 연결 하나: 이미 있으면(어느 방향이든) null */
export function newLink(items: Item[], id: string, boardId: string, from: string, to: string, z: number): Item | null {
  if (from === to || items.some((i) => i.type === 'link' && !i.deleted && ((i.from === from && i.to === to) || (i.from === to && i.to === from)))) return null
  return { id, boardId, type: 'link', from, to, text: '', x: 0, y: 0, w: 40, h: 30, z }
}
