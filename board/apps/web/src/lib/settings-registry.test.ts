import { describe, expect, test } from "bun:test"
import { legacySettingsHash, parseSettingsHash, settingsHash } from "./settings-registry"

describe("settings hash", () => {
  test("hash round trip keeps section and only known items", () => {
    expect(parseSettingsHash(settingsHash("connections", "mcp-tokens"))).toEqual({ section: "connections", item: "mcp-tokens" })
    expect(parseSettingsHash("#/settings")).toEqual({ section: null, item: null })
    expect(parseSettingsHash("#/settings/nope?item=bogus")).toEqual({ section: null, item: null })
    expect(parseSettingsHash("#/settingsx")).toBeNull()
    expect(parseSettingsHash("#/home")).toBeNull()
  })
  test("운영 순회 옛 주소", () => {
    expect(legacySettingsHash("#/ops")).toBe("#/settings/ops")
    expect(legacySettingsHash("#ops")).toBe("#/settings/ops")
    expect(legacySettingsHash("#/ops?x=1")).toBe("#/settings/ops")
    expect(legacySettingsHash("#/opsx")).toBeNull()
    expect(legacySettingsHash("#/settings/ops")).toBeNull()
    // 옛 항목 id(ops-summary)로 온 링크는 섹션만 열어요
    expect(parseSettingsHash("#/settings/ops?item=ops-summary")).toEqual({ section: "ops", item: null })
  })
})
