import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
process.env.ASIDE_ACCOUNT = "u_spaces_test_no_account"
const { initSignals, ingest } = await import("./signals.ts")
const { initRuns } = await import("./runs.ts")
const { initWorks } = await import("./works.ts")
const { initDocs, stopDocsRefresh } = await import("./docs/storage.ts")
const { runActions } = await import("./actions.ts")
const { findSameTodo } = await import("./dedup.ts")
const { searchDocs, docsSchema } = await import("./docs/search.ts")
const { writeAgentNote } = await import("./notes.ts")
const { cleanSpaceName, ensureWorkspace, initSpaces, listSpaces, resolveSpace, spacesApi } = await import("./spaces.ts")

let db: Database
const OWNER = "a@x.com"
function makeDb() {
  const d = new Database(":memory:")
  d.exec(`CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT, board_id TEXT, item_id TEXT, op TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT);
    CREATE TABLE boards(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, owner TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL, meta TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE items(board_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, by TEXT, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL, PRIMARY KEY(board_id, id));
    INSERT INTO boards(id,name,kind,owner,created_at,updated_at,seq) VALUES ('pb','나','personal','${OWNER}',1,1,1);`)
  initSignals(d); initRuns(d); initWorks(d); initDocs(d)
  return d
}
// server.ts upsertItem 과 같은 규칙: space 를 주지 않으면 기존 공간을 지켜요
function putItem(bid: string, iid: string, data: Record<string, unknown>, actor: string, space?: string) {
  const seq = Number(db.query("INSERT INTO events(board_id,item_id,op,actor,at) VALUES (?,?,?,?,?)").run(bid, iid, "item.upsert", actor, Date.now()).lastInsertRowid)
  db.query(`INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq,space) VALUES (?,?,?,?,?,0,?,?)
    ON CONFLICT(board_id,id) DO UPDATE SET data=excluded.data, by=excluded.by, updated_at=excluded.updated_at, deleted=0, seq=excluded.seq, space=COALESCE(excluded.space, items.space)`).run(bid, iid, JSON.stringify(data), actor, Date.now(), seq, space ?? null)
}
const readItem = (bid: string, iid: string) => {
  const r = db.query("SELECT data FROM items WHERE board_id=? AND id=? AND deleted=0").get(bid, iid) as { data: string } | null
  return r ? { data: JSON.parse(r.data) as Record<string, unknown> } : null
}
const deps = { personalBoard: (o: string) => (o === OWNER ? { id: "pb", areas: [] } : null), readItem, putItem, ingest: (o: string, raw: Record<string, unknown>) => ingest(db, o, raw, true) }
const act = (actions: Record<string, unknown>[]) => runActions(db, OWNER, actions, deps).results
const spaceOf = (iid: string) => (db.query("SELECT space FROM items WHERE board_id='pb' AND id=?").get(iid) as { space: string | null }).space
let ws = ""

beforeEach(() => {
  db = makeDb(); initSpaces(db); ensureWorkspace(db, OWNER)
  ws = listSpaces(db)[1].id
})
afterEach(() => { stopDocsRefresh(db); db.close() })

describe("이행과 기본 공간", () => {
  test("옛 스키마에 칸만 더하고 기존 행은 그대로(NULL = 개인), 두 번 불러도 같아요", () => {
    const d = makeDb()
    d.query("INSERT INTO items(board_id,id,data,updated_at,seq) VALUES ('pb','old','{\"type\":\"todo\",\"text\":\"옛 할 일\"}',1,1)").run()
    const before = d.query("SELECT data, updated_at FROM items").all()
    initSpaces(d); initSpaces(d)
    expect(d.query("SELECT data, updated_at FROM items").all()).toEqual(before)
    expect((d.query("SELECT space FROM items").get() as { space: unknown }).space).toBeNull()
    expect((d.query("PRAGMA table_info(signals)").all() as { name: string }[]).filter((c) => c.name === "space")).toHaveLength(1)
    d.close()
  })
  test("기본 워크스페이스는 한 번만 생기고 이름·id·별칭으로 찾아요", () => {
    ensureWorkspace(db, OWNER); ensureWorkspace(db, "b@x.com")
    expect(listSpaces(db).map((s) => s.kind)).toEqual(["personal", "workspace"])
    expect(String(resolveSpace(db, "회사"))).toBe(ws)
    expect(String(resolveSpace(db, ws))).toBe(ws)
    expect(resolveSpace(db, "개인")).toBe("personal")
    expect(resolveSpace(db, undefined)).toBeUndefined()
    expect(resolveSpace(db, "ws_000000000000")).toBeNull()
    expect(resolveSpace(db, "없는 회사")).toBeNull()
    expect(resolveSpace(db, 3)).toBeNull()
  })
  test("이름: 예약어·ws_·겹침은 거절, 에이전트는 바꿀 수 없어요, 바꾸면 이벤트가 남아요", async () => {
    expect(cleanSpaceName("Personal")).toBeNull(); expect(cleanSpaceName("ws_abc")).toBeNull(); expect(cleanSpaceName(" 뉴럴아케이드 ")).toBe("뉴럴아케이드")
    const call = async (method: string, path: string, body: unknown, agent = false) => {
      const res = await spacesApi(db, new Request(`http://x${path}`, { method, body: JSON.stringify(body) }), path.split("/").filter(Boolean), { email: OWNER, agent })
      return { status: res!.status, body: (await res!.json()) as Record<string, any> }
    }
    expect((await call("PATCH", `/api/spaces/${ws}`, { name: "뉴럴아케이드" })).status).toBe(200)
    expect((await call("POST", "/api/spaces", { name: "뉴럴아케이드" })).status).toBe(409)
    expect((await call("POST", "/api/spaces", { name: "lidge" }, true)).status).toBe(403)
    expect((await call("POST", "/api/spaces", { name: "lidge" })).status).toBe(201)
    expect((await call("PATCH", "/api/spaces/ws_000000000000", { name: "x" })).status).toBe(404)
    expect(resolveSpace(db, "회사")).toBeNull()
    expect((db.query("SELECT COUNT(*) AS n FROM events WHERE op LIKE 'space.%'").get() as { n: number }).n).toBe(3)
  })
})

describe("같은 일 판정은 공간 안에서", () => {
  test("같은 제목 개인 일이 있어도 회사 task 는 새로 만들고, 같은 공간이면 합쳐요", () => {
    const first = act([{ do: "task", title: "견적서 보내기", note: "## 상황\n개인 견적" }])[0]
    const company = act([{ do: "task", title: "견적서 보내기", note: "## 상황\n회사 견적", space: "회사" }])[0]
    expect(company.ok).toBe(true); expect(company.existing).toBeUndefined(); expect(company.ref).not.toBe(first.ref)
    expect(spaceOf(String(company.ref).split(":")[2])).toBe(ws)
    const again = act([{ do: "task", title: "견적서 보내기", note: "## 상황\n회사 견적 추가", space: ws }])[0]
    expect(again.existing).toBe(true); expect(again.ref).toBe(company.ref)
    expect(findSameTodo(db, "pb", "견적서 보내기", { space: "personal" })?.ref).toBe(first.ref)
  })
  test("공간을 빼면 link 한 목표의 공간을 따르고, 모르는 공간은 거절해요", () => {
    const goal = act([{ do: "task", type: "goal", title: "파일럿 시작하기", note: "## 상황\n회사 목표", space: ws }])[0]
    const sub = act([{ do: "task", title: "로그인 붙이기", note: "## 상황\n하위 할 일", link: goal.ref }])[0]
    expect(spaceOf(String(sub.ref).split(":")[2])).toBe(ws)
    const bad = act([{ do: "task", title: "아무거나 하기", note: "## 상황\n모르는 공간", space: "없는회사" }])[0]
    expect(bad.ok).toBe(false); expect(bad.error).toContain("unknown space")
    expect((db.query("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n).toBe(2)
  })
  test("update 의 space 로 옮기고, 완료·제목만 고치면 공간을 지켜요", () => {
    const t = act([{ do: "task", title: "회의록 정리하기", note: "## 상황\n옮길 일" }])[0]
    const iid = String(t.ref).split(":")[2]
    expect(act([{ do: "update", ref: t.ref, space: ws }])[0].ok).toBe(true)
    expect(spaceOf(iid)).toBe(ws)
    act([{ do: "done", ref: t.ref, why: "끝" }, { do: "update", ref: t.ref, title: "회의록 정리해 보내기" }])
    expect(spaceOf(iid)).toBe(ws)
    expect(act([{ do: "update", ref: t.ref, space: "nope" }])[0].ok).toBe(false)
    expect(act([{ do: "update", ref: t.ref, space: "personal" }])[0].ok).toBe(true)
    expect(spaceOf(iid)).toBe("personal")
  })
})

describe("사건의 공간", () => {
  test("decide 는 연결한 일의 공간을 따르고, 같은 질문이 개인과 회사에 따로 서요", () => {
    const t = act([{ do: "task", title: "계약서 검토하기", note: "## 상황\n회사 일", space: ws }])[0]
    const c = act([{ do: "decide", title: "계약 기간을 1년으로 할까요", link: t.ref }])[0]
    const p = act([{ do: "decide", title: "계약 기간을 1년으로 할까요" }])[0]
    expect(c.ok && p.ok).toBe(true); expect(c.ref).not.toBe(p.ref)
    const sp = (ref: unknown) => (db.query("SELECT space FROM signals WHERE id=?").get(String(ref).slice(7)) as { space: string | null }).space
    expect(sp(c.ref)).toBe(ws); expect(sp(p.ref) ?? "personal").toBe("personal")
    expect(act([{ do: "decide", title: "계약 기간을 1년으로 할까요", link: t.ref }])[0].existing).toBe(true)
  })
  test("같은 ref 를 다른 공간으로 보내면 거절하고, 같거나 빼면 갱신해요", () => {
    const first = ingest(db, OWNER, { ref: "ops:gh:1", kind: "info", title: "회사 저장소 알림", space: ws }, true)
    expect(first.space).toBe(ws)
    expect(ingest(db, OWNER, { ref: "ops:gh:1", kind: "info", title: "바뀐 제목", space: "personal" }, true)).toContain("다른 공간")
    expect(ingest(db, OWNER, { ref: "ops:gh:1", kind: "info", title: "바뀐 제목" }, true).space).toBe(ws)
    expect(ingest(db, OWNER, { ref: "ops:gh:2", kind: "info", title: "모르는 공간", space: "x" }, true)).toContain("unknown space")
    // work 로 이어받기: 실행 사건처럼 대상 일이 회사면 회사
    const t = act([{ do: "task", title: "배포 확인하기", note: "## 상황\n회사 일", space: ws }])[0]
    expect(ingest(db, OWNER, { ref: "run:r1", kind: "start", title: "실행", work: t.ref }, true).space).toBe(ws)
  })
})

describe("검색 필터", () => {
  test("space 로 거르면 total·페이지가 같은 수이고, 결과·schema 에 공간이 나와요", () => {
    const refs: string[] = []
    for (let i = 0; i < 3; i++) refs.push(String(act([{ do: "task", title: `회사 일 번호 ${i}`, note: "## 상황\n공통 단어 바나나", space: ws }])[0].ref))
    act([{ do: "task", title: "개인 일 하나", note: "## 상황\n공통 단어 바나나" }])
    const page1 = searchDocs(db, OWNER, { q: "바나나", space: ws, limit: 2 })
    expect(page1.total).toBe(3); expect(page1.results.every((r) => r.space === ws)).toBe(true)
    const page2 = searchDocs(db, OWNER, { q: "바나나", space: ws, limit: 2, cursor: page1.nextCursor })
    expect(page2.results).toHaveLength(1)
    expect(() => searchDocs(db, OWNER, { q: "바나나", space: "personal", limit: 2, cursor: page1.nextCursor })).toThrow()
    expect(searchDocs(db, OWNER, { q: "바나나", space: "personal" }).total).toBe(1)
    expect(searchDocs(db, OWNER, { q: "바나", space: ws }).total).toBe(3) // 3자 미만은 LIKE 길
    expect(() => searchDocs(db, OWNER, { space: "없는회사" })).toThrow()
    // 옮긴 직후 새 값으로
    act([{ do: "update", ref: refs[0], space: "personal" }])
    expect(searchDocs(db, OWNER, { q: "바나나", space: ws }).total).toBe(2)
    expect(docsSchema(db, OWNER).spaces?.map((s) => s.id)).toEqual(["personal", ws])
    writeAgentNote(db, OWNER, refs[1], "더하기", "append")
  })
})
