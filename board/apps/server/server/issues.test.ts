// 이슈 보내기: 보내는 중에(파일을 쓰는 사이) 비활성·허용 해제되면 커밋 직전 다시 확인해 거절하고, 아무것도 남기지 않아요
import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initIssues, issuesApi, type IssueDeps } from "./issues.ts"

const WS = "ws_0123456789ab"
function setup(activeAfterWrite: boolean) {
  const db = new Database(":memory:")
  db.exec("CREATE TABLE items(board_id TEXT, id TEXT, data TEXT, by TEXT, updated_at INTEGER, deleted INTEGER DEFAULT 0, seq INTEGER, space TEXT, PRIMARY KEY(board_id,id))")
  db.exec("CREATE TABLE signals(id TEXT, owner TEXT, space TEXT)")
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)")
  db.query("INSERT INTO workspaces VALUES (?, '회사', 'a', 1, 1, 0)").run(WS)
  initIssues(db)
  const uploadsDir = mkdtempSync(join(tmpdir(), "issues-test-"))
  let checks = 0
  const ingested: unknown[] = []
  const deps: IssueDeps = {
    companyBoard: () => "cb",
    readItem: (bid, iid) => { const r = db.query("SELECT data FROM items WHERE board_id=? AND id=?").get(bid, iid) as { data: string } | null; return r ? { data: JSON.parse(r.data) } : null },
    putItem: (bid, iid, data, actor, space) => { db.query("INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq,space) VALUES (?,?,?,?,?,0,1,?) ON CONFLICT(board_id,id) DO UPDATE SET data=excluded.data").run(bid, iid, JSON.stringify(data), actor, Date.now(), space ?? null) },
    ingest: (_o, raw) => { ingested.push(raw); return raw },
    admins: ["admin@x.ai"], isAdmin: (e) => e === "admin@x.ai", uploadsDir,
    active: () => (checks++ === 0 ? true : activeAfterWrite),
  }
  return { db, deps, uploadsDir, ingested }
}
const send = (deps: IssueDeps, db: Database) => {
  const f = new FormData()
  f.set("title", "프린터 고장 났어요"); f.set("body", "3층 프린터"); f.set("urgency", "normal")
  f.append("files", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])], "a.png", { type: "image/png" }))
  const url = new URL("http://x/api/issues")
  return issuesApi(db, new Request(url, { method: "POST", body: f }), url, ["api", "issues"], { email: "b@x.ai", agent: false }, deps)
}

test("파일을 쓰는 사이 비활성되면 커밋 직전 확인에서 거절하고 할 일·이슈·사건·첨부를 남기지 않아요", async () => {
  const t = setup(false)
  const res = await send(t.deps, t.db)
  expect(res!.status).toBe(403)
  expect((t.db.query("SELECT COUNT(*) AS n FROM issues").get() as { n: number }).n).toBe(0)
  expect((t.db.query("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n).toBe(0)
  expect(t.ingested).toHaveLength(0)
  expect(existsSync(join(t.uploadsDir, "issues")) ? readdirSync(join(t.uploadsDir, "issues")) : []).toEqual([])
})

test("계속 활성이면 할 일·이슈·관리자 사건을 함께 남겨요", async () => {
  const t = setup(true)
  const res = await send(t.deps, t.db)
  expect(res!.status).toBe(201)
  expect((t.db.query("SELECT COUNT(*) AS n FROM issues").get() as { n: number }).n).toBe(1)
  expect((t.db.query("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n).toBe(1)
  expect(t.ingested).toHaveLength(1)
})

test("동시에 보낸 이슈도 빈도·첨부 한도를 커밋 직전에 다시 봐서 넘치지 않아요", async () => {
  const t = setup(true)
  t.deps.limits = { perWindow: 1 }
  const both = await Promise.all([send(t.deps, t.db), send(t.deps, t.db)])
  expect(both.map((r) => r!.status).sort()).toEqual([201, 429])
  const u = setup(true)
  u.deps.limits = { userBytes: 15 }
  const two = await Promise.all([send(u.deps, u.db), send(u.deps, u.db)])
  expect(two.map((r) => r!.status).sort()).toEqual([201, 413])
  expect(existsSync(join(u.uploadsDir, "issues")) ? readdirSync(join(u.uploadsDir, "issues")).length : 0).toBe(1)
})


test("한 사람이 짧은 시간에 너무 많이 보내면 429, 첨부 저장 한도를 넘으면 413 이에요", async () => {
  const t = setup(true)
  t.deps.limits = { perWindow: 2, userBytes: 15 }
  expect((await send(t.deps, t.db))!.status).toBe(201)
  expect((await send(t.deps, t.db))!.status).toBe(413) // 이미 10바이트 + 10바이트 > 15
  t.db.exec("UPDATE issues SET files='[]'")
  expect((await send(t.deps, t.db))!.status).toBe(201)
  expect((await send(t.deps, t.db))!.status).toBe(429)
})

test("트랜잭션이 실패하면 쓴 첨부 폴더를 지워 고아 파일이 남지 않아요(실패 주입)", async () => {
  const t = setup(true)
  t.deps.putItem = () => { throw new Error("주입한 실패") }
  await expect(send(t.deps, t.db)).rejects.toThrow("주입한 실패")
  expect((t.db.query("SELECT COUNT(*) AS n FROM issues").get() as { n: number }).n).toBe(0)
  expect(existsSync(join(t.uploadsDir, "issues")) ? readdirSync(join(t.uploadsDir, "issues")) : []).toEqual([])
})

test("첨부 쓰기가 중간에 실패해도 이 이슈 폴더를 남기지 않아요(실패 주입)", async () => {
  const t = setup(true)
  const origWrite = Bun.write
  let n = 0
  ;(Bun as unknown as { write: typeof Bun.write }).write = (async (...a: Parameters<typeof Bun.write>) => { if (n++ >= 0) throw new Error("디스크 실패"); return origWrite(...a) }) as typeof Bun.write
  try {
    const f = new FormData()
    f.set("title", "두 장 첨부"); f.set("body", ""); f.set("urgency", "normal")
    for (let i = 0; i < 2; i++) f.append("files", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, i])], `${i}.png`, { type: "image/png" }))
    const url = new URL("http://x/api/issues")
    await expect(issuesApi(t.db, new Request(url, { method: "POST", body: f }), url, ["api", "issues"], { email: "b@x.ai", agent: false }, t.deps)).rejects.toThrow("디스크 실패")
  } finally { (Bun as unknown as { write: typeof Bun.write }).write = origWrite }
  expect(existsSync(join(t.uploadsDir, "issues")) ? readdirSync(join(t.uploadsDir, "issues")) : []).toEqual([])
  expect((t.db.query("SELECT COUNT(*) AS n FROM issues").get() as { n: number }).n).toBe(0)
})
