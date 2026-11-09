import { expect, test } from "bun:test"
import { lastInputWasPointer, trackInputModality } from "./input-modality"

test("마지막 입력이 포인터인지 키보드인지 따라가요", () => {
  const t = new EventTarget()
  const stop = trackInputModality(t)
  expect(lastInputWasPointer()).toBe(false)
  t.dispatchEvent(new Event("pointerdown"))
  expect(lastInputWasPointer()).toBe(true)
  t.dispatchEvent(new Event("keydown"))
  expect(lastInputWasPointer()).toBe(false)
  stop()
})

test("떼고 나면 듣지 않고, 다른 대상에 다시 붙일 수 있어요", () => {
  const a = new EventTarget()
  trackInputModality(a)()
  a.dispatchEvent(new Event("pointerdown"))
  expect(lastInputWasPointer()).toBe(false)
  const b = new EventTarget()
  const stop = trackInputModality(b)
  b.dispatchEvent(new Event("pointerdown"))
  expect(lastInputWasPointer()).toBe(true)
  stop()
})
