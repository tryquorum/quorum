import { expect, test } from "bun:test"
import { parseBody, verifyResult } from "./spec"
import def from "./defs/luma-blasts.json"

// Shape observed from api2.luma.com/event/get-blasts on 2026-11-09 (content trimmed).
const realBlasts = {
  blasts: [
    { blast: { api_id: "ep-grOiM0kUEi", content_text: "Today's wifi access", sent_at: "2026-11-09T00:28:49.818Z" }, author: { name: "Host" } },
    { blast: { api_id: "ep-pfXKfOvyhq", content_text: "The venue is on COEX 2F", sent_at: "2026-11-08T06:45:22.052Z" }, author: { name: "Host" } },
  ],
}

test("luma-blasts parses and verifies the real get-blasts response shape", () => {
  const result = parseBody(realBlasts, def.parse as never) as { id: string; message: string; created_at: string }[]
  expect(() => verifyResult(result, def.verify as never)).not.toThrow()
  expect(result[0]).toEqual({ id: "ep-grOiM0kUEi", message: "Today's wifi access", created_at: "2026-11-09T00:28:49.818Z" })
})

import { Database } from "bun:sqlite"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RecipeStore } from "./store"

test("a shipped defs file with a higher version replaces the stored definition", () => {
  const dir = mkdtempSync(join(tmpdir(), "quorum-defs-"))
  const base = { id: "t-shape", site: "test", intent: "t", vars: [], request: { method: "GET", url: "https://example.test/a" }, parse: { path: "a" }, verify: {}, discover: {} }
  writeFileSync(join(dir, "t-shape.json"), JSON.stringify({ ...base, version: 1 }))
  const store = new RecipeStore(new Database(":memory:"), dir)
  expect(store.current("t-shape").parse).toEqual({ path: "a" })
  writeFileSync(join(dir, "t-shape.json"), JSON.stringify({ ...base, version: 2, parse: { path: "b" } }))
  expect(store.current("t-shape").version).toBe(2)
  expect(store.current("t-shape").parse).toEqual({ path: "b" })
})
