import { expect, test } from "bun:test"
import { koDateLabel } from "./ko-date"

test("날짜만·시각 있는 값을 한국어로", () => {
  expect(koDateLabel("2026-11-08")).toBe("11월 8일 (일)")
  expect(koDateLabel("2026-11-08T15:05")).toBe("11월 8일 (일) 오후 3:05")
  expect(koDateLabel("2026-11-08T00:30")).toBe("11월 8일 (일) 오전 12:30")
  expect(koDateLabel("2026-11-08T12:00")).toBe("11월 8일 (일) 오후 12:00")
  expect(koDateLabel("2026-12-31T23:59")).toBe("12월 31일 (목) 오후 11:59")
})

test("빈 값은 빈 글, 읽을 수 없거나 없는 날짜는 원문", () => {
  expect(koDateLabel("")).toBe("")
  expect(koDateLabel(null)).toBe("")
  expect(koDateLabel(undefined)).toBe("")
  expect(koDateLabel("다음 주")).toBe("다음 주")
  expect(koDateLabel("2026-02-30")).toBe("2026-02-30")
  expect(koDateLabel("2026-11-08T99:99")).toBe("2026-11-08T99:99")
  expect(koDateLabel("2026-11-08T24:00")).toBe("2026-11-08T24:00")
  expect(koDateLabel("2026-11-08T12:60")).toBe("2026-11-08T12:60")
  expect(koDateLabel("2026-11-08x")).toBe("2026-11-08x")
  expect(koDateLabel("2026-11-08T23:59:30")).toBe("11월 8일 (일) 오후 11:59")
})
