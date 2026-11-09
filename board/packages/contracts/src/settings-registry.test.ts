import { describe, expect, test } from "bun:test"
import { searchSettings, SETTING_ITEMS, SETTINGS_SECTIONS, type SettingItem, type SettingsSection } from "./settings-registry.ts"

describe("settings registry", () => {
  test("requested queries find the setting and its section", () => {
    const first = (q: string) => searchSettings(q)[0]
    expect(first("mcp")?.section).toBe("connections")
    expect(first("연결")?.section).toBe("connections")
    expect(first("테마")?.id).toBe("theme")
    expect(first("dark mode")?.id).toBe("theme")
    expect(first("토큰")?.id).toBe("mcp-tokens")
    expect(first("token")?.id).toBe("mcp-tokens")
    expect(first("단축키")?.section).toBe("shortcuts")
    expect(first("keyboard")?.section).toBe("shortcuts")
    expect(searchSettings("")).toEqual([])
    expect(searchSettings("없는 설정 이름")).toEqual([])
  })
  test("운영 순회 검색", () => {
    expect(searchSettings("순회").map((i) => i.section)).toEqual(["ops", "ops", "ops", "ops"])
    expect(searchSettings("지시문")[0]?.id).toBe("ops-prompt")
  })
  test("every item points at a known section and ids are unique", () => {
    const sections = new Set(SETTINGS_SECTIONS.map((s) => s.id))
    expect(SETTING_ITEMS.every((i) => sections.has(i.section))).toBe(true)
    expect(new Set(SETTING_ITEMS.map((i) => i.id)).size).toBe(SETTING_ITEMS.length)
  })
  test("앱이 넘긴 항목·섹션 이름으로 찾아요", () => {
    const items: SettingItem[] = [{ id: "gestures", title: "제스처", section: "shortcuts", synonyms: ["swipe", "밀기"] }]
    const sections: SettingsSection[] = [{ id: "shortcuts", title: "제스처", synonyms: ["gesture"] }]
    expect(searchSettings("밀기", 8, items, sections).map((i) => i.id)).toEqual(["gestures"])
    expect(searchSettings("gesture", 8, items, sections).map((i) => i.id)).toEqual(["gestures"])
    expect(searchSettings("테마", 8, items, sections)).toEqual([])
  })
})
