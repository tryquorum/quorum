import { expect, test } from "bun:test"
import { metaAtRisk, metaSummary, type MetaFoldState } from "./doc-meta-fold"

const calm: MetaFoldState = { unreadable: false, error: "", conflict: null, blocked: false, busy: false, storageError: false, draftKeys: 0, newKey: "", basicChanged: false }

test("위험 상태가 하나도 없으면 접을 수 있어요", () => {
  expect(metaAtRisk(calm)).toBe(false)
  expect(metaAtRisk({ ...calm, newKey: "   " })).toBe(false)
})

test("위험 상태 하나하나가 접기를 막아요", () => {
  const cases: Partial<MetaFoldState>[] = [
    { unreadable: true }, { error: "저장하지 못했어요" }, { conflict: { version: 3 } }, { blocked: true },
    { busy: true }, { storageError: true }, { draftKeys: 1 }, { newKey: "단계" }, { basicChanged: true },
  ]
  for (const c of cases) expect(metaAtRisk({ ...calm, ...c })).toBe(true)
})

test("요약은 값 없는 칸을 빼고 날짜를 한국어로", () => {
  expect(metaSummary({ area: "업무", status: "open", due: "2026-11-08", props: [] })).toEqual(["업무", "열림", "11월 8일 (일)"])
  expect(metaSummary({ area: "", status: "done", due: "2026-11-08T15:05", props: [{ key: "a", type: "text", value: "x" }, { key: "b", type: "text", value: "y" }] })).toEqual(["끝남", "11월 8일 (일) 오후 3:05", "속성 2"])
})
