// 파일럿(회사 판이 있는 서버)에서 운영 순회 카드가 공간에 맞는 판에 생기고, 같은 key·같은 제목 판단도 그 판·그 공간 안에서 하는지.
// 파일럿의 로컬 리스너는 순회 보고를 받지 않지만(무인증 경로 없음), 이 규칙은 같은 코드라 opsApi 를 직접 불러 확인해요.
import { beforeEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { initOps, opsApi } from "./ops.ts"

const WS = "ws_0123456789ab"
let db: Database
const read = (bid: string, iid: string) => { const r = db.query("SELECT data FROM items WHERE board_id=? AND id=?").get(bid, iid) as { data: string } | null; return r ? { data: JSON.parse(r.data) } : null }
const deps = {
  personalBoard: () => ({ id: "pb", areas: [] }),
  companyBoard: () => ({ id: "cb", areas: [] }),
  readItem: read,
  putItem: (bid: string, iid: string, data: Record<string, unknown>, _actor: string, space?: string) => {
    db.query("INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq,space) VALUES (?,?,?,'agent',?,0,1,?) ON CONFLICT(board_id,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, space=COALESCE(excluded.space, items.space)").run(bid, iid, JSON.stringify(data), Date.now(), space ?? null)
  },
  ingest: () => ({ id: "s1" }),
  startRun: async () => ({}),
  port: 0,
}
beforeEach(() => {
  db = new Database(":memory:")
  db.exec("CREATE TABLE items(board_id TEXT, id TEXT, data TEXT, by TEXT, updated_at INTEGER, deleted INTEGER DEFAULT 0, seq INTEGER, space TEXT, PRIMARY KEY(board_id,id))")
  db.exec("CREATE TABLE signals(id TEXT, owner TEXT, ref TEXT, title TEXT, lane TEXT, status TEXT, updated_at INTEGER, space TEXT)")
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)")
  db.query("INSERT INTO workspaces VALUES (?, '회사', 'a', 1, 1, 0)").run(WS)
  db.exec("CREATE TABLE work_notes(owner TEXT, ref TEXT, html TEXT, text TEXT, by TEXT, updated_at INTEGER, PRIMARY KEY(owner,ref))")
  db.exec("CREATE TABLE work_links(id TEXT, owner TEXT, a TEXT, b TEXT, label TEXT, by TEXT, created_at INTEGER)")
  db.exec("CREATE TABLE boards(id TEXT, kind TEXT, owner TEXT, deleted INTEGER DEFAULT 0)")
  db.exec("INSERT INTO boards VALUES ('pb','personal','a',0),('cb','company',NULL,0)")
  initOps(db)
})
const report = async (body: unknown) => {
  const url = new URL("http://localhost/api/ops/report")
  const res = await opsApi(db, new Request(url, { method: "POST", body: JSON.stringify(body) }), url, { email: "a", agent: false }, ["api", "ops", "report"], true, deps)
  return (await res!.json()) as { cards: number; merged: number; errors: string[] }
}
const rows = () => db.query("SELECT board_id, space, data FROM items").all() as { board_id: string; space: string | null; data: string }[]

test("회사 공간 카드는 회사 판에, 개인 카드는 개인 판에 생기고, 같은 key 는 회사 판의 그 카드를 갱신해요", async () => {
  const r = await report({ summary: "s", checked: [], cards: [{ key: "deploy", title: "배포 점검하기", note: "## 상황\n배포 전 점검", space: WS }, { key: "errand", title: "개인 심부름 하기", note: "## 상황\n개인 심부름" }] })
  expect(r.errors).toEqual([]); expect(r.cards).toBe(2)
  expect(rows().map((x) => [x.board_id, x.space, JSON.parse(x.data).text]).sort()).toEqual([["cb", WS, "배포 점검하기"], ["pb", "personal", "개인 심부름 하기"]])
  await report({ summary: "s2", checked: [], cards: [{ key: "deploy", title: "배포 점검하기", note: "## 상황\n배포 전 점검 둘째", space: WS }] })
  expect(rows().filter((x) => JSON.parse(x.data).text === "배포 점검하기")).toHaveLength(1)
})

test("같은 제목이라도 개인 공간 카드는 회사 판의 회사 일에 합치지 않아요", async () => {
  await report({ summary: "s", checked: [], cards: [{ key: "k1", title: "주간 회의 준비하기", note: "## 상황\n회사 회의", space: WS }] })
  const r = await report({ summary: "s", checked: [], cards: [{ key: "k2", title: "주간 회의 준비하기", note: "## 상황\n개인 준비" }] })
  expect(r.merged).toBe(0); expect(r.cards).toBe(1)
  expect(rows().map((x) => x.board_id).sort()).toEqual(["cb", "pb"])
})
