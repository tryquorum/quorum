import { expect, test } from "bun:test"
import { createScrollActivity } from "./scroll-activity"

function fakeTimers() {
  let next = 1
  const live = new Map<number, () => void>()
  return {
    live,
    set: (fn: () => void) => { const id = next++; live.set(id, fn); return id },
    clear: (id: unknown) => { live.delete(id as number) },
    fire: () => { const fns = [...live.values()]; live.clear(); fns.forEach((fn) => fn()) },
  }
}

test("스크롤을 이어서 해도 한 번 켜고, 타이머는 요소마다 하나예요", () => {
  const t = fakeTimers()
  const log: string[] = []
  const touch = createScrollActivity<{ id: string }>((el, on) => log.push(`${el.id}:${on}`), 700, t)
  const a = { id: "a" }
  touch(a); touch(a); touch(a)
  expect(log).toEqual(["a:true"])
  expect(t.live.size).toBe(1)
  t.fire()
  expect(log).toEqual(["a:true", "a:false"])
})

test("영역마다 따로 켜고 끄며, 끈 뒤 다시 스크롤하면 다시 켜요", () => {
  const t = fakeTimers()
  const log: string[] = []
  const touch = createScrollActivity<{ id: string }>((el, on) => log.push(`${el.id}:${on}`), 700, t)
  const a = { id: "a" }, b = { id: "b" }
  touch(a); touch(b)
  expect(t.live.size).toBe(2)
  t.fire()
  touch(a)
  expect(log).toEqual(["a:true", "b:true", "a:false", "b:false", "a:true"])
})
