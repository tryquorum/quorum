import { describe, expect, test } from "bun:test"
import { hashFor, parseHash } from "./route"

describe("workspace route", () => {
  test("view and popup round-trip through the hash", () => {
    const r = parseHash("#/inbox?open=i:abc123")
    expect(r).toEqual({ view: "inbox", open: { kind: "item", id: "abc123" } })
    expect(hashFor(r)).toBe("#/inbox?open=i:abc123")
    expect(parseHash(hashFor({ view: "signals", open: { kind: "signal", id: "s9" } }))).toEqual({ view: "signals", open: { kind: "signal", id: "s9" } })
  })
  test("goal pages keep the goal id; unknown views fall back to now; bad open is ignored", () => {
    expect(parseHash("#/goal/g1")).toEqual({ view: "goals", goal: "g1" })
    expect(hashFor({ view: "goals", goal: "g1", open: { kind: "item", id: "g1" } })).toBe("#/goal/g1?open=i:g1")
    expect(parseHash("#/nope")).toEqual({ view: "now" })
    expect(parseHash("#/now?open=x:../../etc")).toEqual({ view: "now" })
    expect(parseHash("")).toEqual({ view: "now" })
  })
})
