import { describe, expect, test } from "bun:test"
import { findModel, pickEffort, searchModels, validChoice, type ModelCatalog } from "./models.ts"

const cat: ModelCatalog = {
  providers: [
    { id: "aside", label: "Aside", status: "ok", models: [{ id: "a1", name: "Alpha", efforts: ["low", "high", "xhigh"] }, { id: "a2", name: "Beta", efforts: ["medium"] }] },
    { id: "old", label: "Old", status: "expired", models: [{ id: "o1", name: "Omega", efforts: ["high"] }] },
  ],
  default: { provider: "aside", modelId: "a1", effort: "high" },
}

describe("모델 고르기", () => {
  test("쓸 수 있는 값은 그대로, 만료·없는 모델은 서버 기본", () => {
    expect(validChoice(cat, { provider: "aside", model: "a2", effort: "medium" })).toEqual({ provider: "aside", model: "a2", effort: "medium" })
    expect(validChoice(cat, { provider: "old", model: "o1", effort: "high" })).toEqual({ provider: "aside", model: "a1", effort: "high" })
    expect(validChoice(cat, { provider: "aside", model: "gone", effort: "high" })?.model).toBe("a1")
    expect(validChoice(cat, null)?.model).toBe("a1")
    expect(validChoice(null, null)).toBeNull()
  })
  test("모델을 바꾸면 수준은 같으면 유지, 없으면 high, 그것도 없으면 마지막", () => {
    expect(pickEffort({ id: "x", name: "x", efforts: ["low", "xhigh"] }, "xhigh")).toBe("xhigh")
    expect(pickEffort({ id: "x", name: "x", efforts: ["low", "high"] }, "max")).toBe("high")
    expect(pickEffort({ id: "x", name: "x", efforts: ["low", "medium"] }, "max")).toBe("medium")
  })
  test("찾기와 검색", () => {
    expect(findModel(cat, { provider: "aside", model: "a2" })?.model.name).toBe("Beta")
    expect(findModel(cat, { provider: "aside", model: "nope" })).toBeNull()
    expect(searchModels(cat, "old").map((h) => h.model.id)).toEqual(["o1"])
    expect(searchModels(cat, "  ")).toEqual([])
  })
})
