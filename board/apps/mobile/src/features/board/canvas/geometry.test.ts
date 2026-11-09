import { expect, test } from 'bun:test'
import type { Item } from '@direction-board/contracts'
import { canvasBounds, canvasItems, linkLine, moved, newLink, resized } from './geometry'

const it = (p: Partial<Item>): Item => ({ id: 'a', boardId: 'b', type: 'sticky', text: '', x: 0, y: 0, w: 100, h: 100, ...p })

test('영역이 먼저, 할 일·연결·지운 것·다른 판은 빼요', () => {
  const list = canvasItems([it({ id: '1', z: 2 }), it({ id: 'f', type: 'frame', z: 9 }), it({ id: 't', type: 'todo' }), it({ id: 'l', type: 'link' }), it({ id: 'd', deleted: true }), it({ id: 'o', boardId: 'x' })], 'b')
  expect(list.map((i) => i.id)).toEqual(['f', '1'])
})
test('범위는 항목을 모두 담고 원점을 옮겨요', () => {
  const b = canvasBounds([it({ x: -500, y: 100 }), it({ x: 900, y: 1500, w: 200 })])
  expect(b.ox).toBe(40 + 500)
  expect(b.width).toBe(900 + 200 + 500 + 40 + 400)
})
test('연결선은 두 가운데를 이어요, 끊긴 연결은 null', () => {
  const items = [it({ id: 'a', x: 0, y: 0 }), it({ id: 'b', x: 300, y: 400 })]
  expect(linkLine(items, it({ type: 'link', from: 'a', to: 'b' }))).toEqual({ x: 200, y: 250, length: 500, angle: Math.atan2(400, 300) })
  expect(linkLine(items, it({ type: 'link', from: 'a', to: 'gone' }))).toBeNull()
})
test('끌기는 확대 배율로 나누고 크기는 최소값 아래로 안 줄어요', () => {
  expect(moved(it({ x: 10, y: 10 }), 50, -20, 2)).toMatchObject({ x: 35, y: 0 })
  expect(resized(it({ w: 100, h: 100 }), -500, -500, 1)).toMatchObject({ w: 40, h: 30 })
})
test('같은 두 항목의 연결은 방향이 달라도 한 번만', () => {
  const items = [it({ id: 'l', type: 'link', from: 'a', to: 'b' })]
  expect(newLink(items, 'n', 'b', 'b', 'a', 1)).toBeNull()
  expect(newLink(items, 'n', 'b', 'a', 'a', 1)).toBeNull()
  expect(newLink(items, 'n', 'b', 'a', 'c', 1)).toMatchObject({ type: 'link', from: 'a', to: 'c' })
})
