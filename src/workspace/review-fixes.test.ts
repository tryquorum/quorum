// 독립 리뷰(GO-WITH-FIXES) 지적 1–10 의 회귀 시험. 임시 DB, 가짜 실행기·가짜 3070(aside 는 부르지 않아요).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWorkspace, openWorkspaceDb } from "./api"
import { appendNote, getNote, NOTE_MAX, putNote } from "./notes"

let dir = ""
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "quorum-rf-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
const NOW = new Date(2026, 10, 9, 12, 0).getTime()
const call = async (ws: ReturnType<typeof createWorkspace>, method: string, path: string, body?: unknown) => {
  const req = new Request("http://127.0.0.1" + path, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) })
  const res = await ws.handle(req, new URL(req.url).pathname.split("/").filter(Boolean))
  return { status: res.status, body: (await res.json()) as any }
}

describe("1 · 노트는 앞을 잘라내지 않아요", () => {
  test("45,000자 사람 노트에 8,000자 에이전트 결과가 붙어도 사람 글은 한 글자도 안 빠져요", () => {
    const db = openWorkspaceDb(join(dir, "w.db"))
    const human = "사".repeat(45_000)
    putNote(db, "item:a", human, NOW)
    appendNote(db, "item:a", "결".repeat(8_000), "agent", NOW + 1)
    const n = getNote(db, "item:a")!
    expect(n.md.startsWith(human)).toBe(true)
    expect(n.md.length).toBeLessThanOrEqual(NOTE_MAX)
    const overflow = db.query("SELECT md FROM note_overflow WHERE ref=?").all("item:a") as { md: string }[]
    expect(overflow.map((o) => o.md.length)).toEqual([8_000])
  })
  test("사람이 상한보다 긴 노트를 저장하면 자르지 않고 413 으로 거절해요", async () => {
    const ws = createWorkspace({ path: join(dir, "w.db"), now: () => NOW })
    await call(ws, "PUT", "/api/ws/notes?ref=item:a", { md: "처음 글" })
    const r = await call(ws, "PUT", "/api/ws/notes?ref=item:a", { md: "x".repeat(60_000) })
    expect(r.status).toBe(413)
    expect(getNote(ws.db, "item:a")!.md).toBe("처음 글")
  })
})

describe("9 · 노트 저장은 버전을 확인해요", () => {
  test("팝업을 연 사이 의회가 붙인 결과를 사람 저장이 지우지 않아요(409), 최신 버전이면 저장돼요", async () => {
    let clock = NOW
    const ws = createWorkspace({ path: join(dir, "w.db"), now: () => clock })
    const first = (await call(ws, "PUT", "/api/ws/notes?ref=signal:s1", { md: "내 메모" })).body
    clock += 1000
    appendNote(ws.db, "signal:s1", "## 실행 결과\n의회 결과", "agent", clock)
    const stale = await call(ws, "PUT", "/api/ws/notes?ref=signal:s1", { md: "내 메모 고침", baseUpdatedAt: first.updatedAt })
    expect(stale.status).toBe(409)
    expect(getNote(ws.db, "signal:s1")!.md).toContain("의회 결과")
    const cur = getNote(ws.db, "signal:s1")!
    clock += 1000
    const ok = await call(ws, "PUT", "/api/ws/notes?ref=signal:s1", { md: cur.md + "\n내 덧붙임", baseUpdatedAt: cur.updatedAt })
    expect(ok.status).toBe(200)
    expect(ok.body.md).toContain("의회 결과")
  })
})
