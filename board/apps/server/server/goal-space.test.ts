// 목표에 붙여 새로 만드는 할 일은 목표의 공간을 물려받아요(리뷰 5 P1). 공간을 안 보내면 서버가 목표의 공간을,
// 보냈는데 목표와 다르면 400. 조용히 회사 판 기본 워크스페이스로 보내지 않아요. 파일럿(AUTH_MODE=google)과 Access 모드 둘 다.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { mcpCall, startIsolated, type Isolated } from "./test/isolated.ts"

type ItemJ = { id: string; text: string; space: string }
type StateJ = { boards: { id: string; kind: string; mine: boolean }[]; spaces: { id: string; kind: string }[]; items: ItemJ[] }
type Res<T> = { status: number; json: T }
type ActJ = { results: { ok: boolean; ref?: string; error?: string; existing?: boolean }[] }
const todo = (text: string, extra: Record<string, unknown> = {}) => ({ type: "todo", text, x: 0, y: 0, w: 1, h: 1, ...extra })
const goal = (text: string, extra: Record<string, unknown> = {}) => ({ type: "goal", text, x: 0, y: 0, w: 1, h: 1, ...extra })
const read = async <T>(res: Response): Promise<Res<T>> => ({ status: res.status, json: (await res.json().catch(() => null)) as T })

describe("파일럿: 목표의 공간을 물려받아요", () => {
  let s: Isolated
  const sessions: Record<string, string> = {}
  const ADMIN = "jun@lidgeai.com", MEMBER = "bran@neuralarcade.ai"
  beforeAll(async () => {
    s = await startIsolated({ AUTH_MODE: "google", GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret", ACCESS_SEED_DOMAINS: "neuralarcade.ai", ACCESS_SEED_EMAILS: "jun@lidgeai.com", ADMIN_EMAILS: "jun@lidgeai.com", WORKSPACE_NAME: "뉴럴아케이드" })
    const db = new Database(join(s.dir, "board.db"))
    for (const email of [ADMIN, MEMBER]) {
      const secret = crypto.randomUUID().replace(/-/g, "") + "abcdefgh"
      db.query("INSERT INTO auth_sessions(hash,email,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?)").run(new Bun.CryptoHasher("sha256").update(secret).digest("hex"), email, Date.now(), Date.now() + 864e5, Date.now())
      sessions[email] = `nb_session=${secret}`
    }
    db.close()
  }, 20000)
  afterAll(async () => { await s?.stop() })
  const call = <T>(who: string, method: string, path: string, body?: unknown) =>
    fetch(s.pub + path, { method, headers: { cookie: sessions[who] ?? "", ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }).then((r) => read<T>(r))

  test("두 번째 워크스페이스 목표의 새 할 일은 그 워크스페이스, 개인 목표(회사 판의 공간 없는 옛 항목)면 회사로 보내지 않고 400, 다르게 보내도 400", async () => {
    const st = (await call<StateJ>(ADMIN, "GET", "/api/state")).json
    const company = st.boards.find((b) => b.kind === "company")!.id
    const ws1 = st.spaces.find((x) => x.kind === "workspace")!.id
    const ws2 = (await call<{ space: { id: string } }>(ADMIN, "POST", "/api/spaces", { name: "둘째 회사" })).json.space.id
    const mk = async (body: unknown) => { const r = await call<ItemJ>(ADMIN, "POST", `/api/boards/${company}/items`, body); expect(r.status).toBe(201); return r.json }
    // 파일럿 회사 판에는 새 개인 일을 못 만들어서, 개인 목표는 공간 없는(NULL = 개인) 옛 항목으로 넣어요
    const db = new Database(join(s.dir, "board.db"))
    db.query("INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq) VALUES (?,?,?,?,?,0,?)").run(company, "oldgoal001", JSON.stringify(goal("개인 목표")), ADMIN, Date.now(), 999999)
    db.close()
    const gp = { id: "oldgoal001" }
    const g2 = await mk(goal("둘째 회사 목표", { space: ws2 }))
    expect(g2.space).toBe(ws2)

    // 개인 목표: 공간을 안 보내면 목표의 공간(개인)인데 파일럿 회사 판은 새 개인 일을 받지 않으니 400 + 안내(첫 워크스페이스로 보내지 않음)
    const personal = await call<{ error: string }>(ADMIN, "POST", `/api/boards/${company}/items`, todo("개인 목표의 할 일", { goalId: gp.id }))
    expect(personal.status).toBe(400)
    expect(personal.json.error).toContain("목표")
    expect((await call(ADMIN, "PUT", `/api/boards/${company}/items/goalsp0003`, todo("개인 목표의 할 일 PUT", { goalId: gp.id }))).status).toBe(400)
    // PUT(새 항목, 빠른 추가 경로): 두 번째 워크스페이스 목표 → 그 워크스페이스(첫 워크스페이스가 아님)
    const put = await call<ItemJ>(ADMIN, "PUT", `/api/boards/${company}/items/goalsp0001`, todo("둘째 목표의 할 일", { goalId: g2.id }))
    expect([put.status, put.json.space]).toEqual([200, ws2])
    // 목표와 다른 공간을 보내면 400(조용히 바꾸지 않음)
    expect((await call(ADMIN, "POST", `/api/boards/${company}/items`, todo("다른 공간", { goalId: g2.id, space: ws1 }))).status).toBe(400)
    expect((await call(ADMIN, "PUT", `/api/boards/${company}/items/goalsp0002`, todo("다른 공간 PUT", { goalId: gp.id, space: ws1 }))).status).toBe(400)
    // 같은 공간을 보내면 그대로
    expect((await mk(todo("같은 공간", { goalId: g2.id, space: ws2 }))).space).toBe(ws2)

    // 멤버: 둘째 워크스페이스 일은 보이고, 개인 목표는 보이지 않아요
    const texts = (await call<StateJ>(MEMBER, "GET", "/api/state")).json.items.map((i) => i.text)
    expect(texts).toContain("둘째 목표의 할 일")
    expect(texts).not.toContain("개인 목표")
    // 멤버가 둘째 워크스페이스 목표에 붙여 만들면 그 공간
    const byMember = await call<ItemJ>(MEMBER, "POST", `/api/boards/${company}/items`, todo("멤버가 둘째 목표에", { goalId: g2.id }))
    expect([byMember.status, byMember.json.space]).toEqual([201, ws2])
    // 멤버가 개인 목표에 붙여 만들면 회사 공간으로 보내지 않고 거절(멤버는 개인 공간에 못 써요)
    expect((await call(MEMBER, "POST", `/api/boards/${company}/items`, todo("멤버가 개인 목표에", { goalId: gp.id }))).status).toBeGreaterThanOrEqual(400)
    const all = (await call<StateJ>(ADMIN, "GET", "/api/state")).json.items.map((i) => i.text)
    for (const t of ["개인 목표의 할 일", "개인 목표의 할 일 PUT", "멤버가 개인 목표에", "다른 공간", "다른 공간 PUT"]) expect(all).not.toContain(t)
  })

  // 리뷰 6 P2: 이미 있는 할 일을 다른 공간의 목표에 붙이면(goalId 가 바뀜) 보낸 공간이 없어도 저장된 공간으로 비교해 400
  test("기존 할 일을 다른 공간의 목표에 붙이면 400, 같은 공간 목표면 그대로", async () => {
    const st = (await call<StateJ>(ADMIN, "GET", "/api/state")).json
    const company = st.boards.find((b) => b.kind === "company")!.id
    const ws1 = st.spaces.find((x) => x.kind === "workspace")!.id
    const g1 = (await call<ItemJ>(ADMIN, "POST", `/api/boards/${company}/items`, goal("첫 회사 목표", { space: ws1 }))).json
    const g2 = st.items.find((i) => i.text === "둘째 회사 목표")!
    const t = (await call<ItemJ>(ADMIN, "POST", `/api/boards/${company}/items`, todo("첫 회사의 할 일"))).json
    expect(t.space).toBe(ws1)
    expect((await call(ADMIN, "PUT", `/api/boards/${company}/items/${t.id}`, todo("첫 회사의 할 일", { goalId: g2.id }))).status).toBe(400)
    const ok = await call<ItemJ>(ADMIN, "PUT", `/api/boards/${company}/items/${t.id}`, todo("첫 회사의 할 일", { goalId: g1.id }))
    expect([ok.status, ok.json.space]).toEqual([200, ws1])
  })

  // 리뷰 7 P2: goalId 는 그대로인데 공간만 옮기는 저장, 연결 API(POST /api/work/links)로 할 일을 다른 공간 목표에 붙이기도 400
  test("목표에 붙은 할 일의 공간만 옮기거나, 연결 API 로 다른 공간 목표에 붙이면 400", async () => {
    const st = (await call<StateJ>(ADMIN, "GET", "/api/state")).json
    const company = st.boards.find((b) => b.kind === "company")!.id
    const ws1 = st.spaces.find((x) => x.kind === "workspace")!.id
    const g2 = st.items.find((i) => i.text === "둘째 회사 목표")!
    const onG2 = st.items.find((i) => i.text === "둘째 목표의 할 일")!
    expect((await call(ADMIN, "PUT", `/api/boards/${company}/items/${onG2.id}`, todo("둘째 목표의 할 일", { goalId: g2.id, space: ws1 }))).status).toBe(400)
    expect((await call(ADMIN, "PUT", `/api/boards/${company}/items/${onG2.id}`, todo("둘째 목표의 할 일 고침", { goalId: g2.id, space: g2.space }))).status).toBe(200)
    const loose = (await call<ItemJ>(ADMIN, "POST", `/api/boards/${company}/items`, todo("목표 없는 첫 회사 일", { space: ws1 }))).json
    const g1 = (await call<ItemJ>(ADMIN, "POST", `/api/boards/${company}/items`, goal("첫 회사 목표 둘", { space: ws1 }))).json
    expect((await call(ADMIN, "POST", "/api/work/links", { a: `item:${company}:${loose.id}`, b: `item:${company}:${g2.id}`, label: "위해서" })).status).toBe(400)
    expect((await call(ADMIN, "POST", "/api/work/links", { a: `item:${company}:${loose.id}`, b: `item:${company}:${g1.id}`, label: "위해서" })).status).toBe(201)
  })

  // 리뷰 6 P1: MCP board_act·REST /api/act 의 task 도 같은 규칙(목표의 공간을 물려받고, 다른 공간을 보내면 ok:false, 회사 판의 개인 목표는 거절).
  // 파일럿의 REST /api/act 는 사람 세션으로 열리지 않아요(로컬·AGENT_TOKEN 전용, 파일럿은 둘 다 없음) → 파일럿은 MCP 로, REST 는 아래 Access 모드에서
  test("MCP board_act task 는 목표의 공간을 따라요", async () => {
    const st = (await call<StateJ>(ADMIN, "GET", "/api/state")).json
    const company = st.boards.find((b) => b.kind === "company")!.id
    const ws1 = st.spaces.find((x) => x.kind === "workspace")!.id
    const g2 = st.items.find((i) => i.text === "둘째 회사 목표")!
    const ws2 = g2.space
    const db = new Database(join(s.dir, "board.db"))
    db.query("INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq) VALUES (?,?,?,?,?,0,?)").run(company, "oldgoal002", JSON.stringify(goal("옛 개인 목표")), ADMIN, Date.now(), 999998)
    db.close()
    const task = (title: string, extra: Record<string, unknown> = {}) => ({ do: "task", title, note: "## 상황\n목표에 붙일 할 일이에요", ...extra })
    const tok = (await call<{ secret: string }>(ADMIN, "POST", "/api/mcp-tokens", { name: "goal-space" })).json.secret
    const mcp = async (a: Record<string, unknown>) => (await mcpCall(s.pub, "tools/call", { authorization: `Bearer ${tok}` }, { name: "board_act", arguments: { actions: [a] } })).body.result.structuredContent.results[0] as ActJ["results"][number]
    // goalId 만 보내면 목표의 공간·판(첫 워크스페이스나 개인 판이 아님)
    const r1 = await mcp(task("액트 둘째 목표 할 일", { goalId: g2.id }))
    expect(r1.ok).toBe(true)
    expect(r1.ref?.startsWith(`item:${company}:`)).toBe(true)
    const made = (await call<StateJ>(ADMIN, "GET", "/api/state")).json.items.find((i) => i.text === "액트 둘째 목표 할 일")
    expect([made?.space, (made as { goalId?: string } | undefined)?.goalId]).toEqual([ws2, g2.id])
    // 다른 공간을 보내면 ok:false + 이유
    const r2 = await mcp(task("액트 다른 공간", { goalId: g2.id, space: ws1 }))
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain("목표")
    // 회사 판의 공간 없는 옛 개인 목표 → 회사로 보내지 않고 ok:false
    const m1 = await mcp(task("엠씨피 옛 개인 목표 할 일", { goalId: "oldgoal002" }))
    expect(m1.ok).toBe(false)
    expect(m1.error).toContain("목표")
    // MCP: 링크로 목표를 골라도 같은 판정, 같은 공간을 보내면 그대로
    const m2 = await mcp(task("엠씨피 둘째 목표 링크", { link: `item:${company}:${g2.id}`, space: ws1 }))
    expect(m2.ok).toBe(false)
    const m3 = await mcp(task("엠씨피 둘째 목표 할 일", { goalId: g2.id, space: ws2 }))
    expect(m3.ok).toBe(true)
    const all = (await call<StateJ>(ADMIN, "GET", "/api/state")).json.items
    expect(all.find((i) => i.text === "엠씨피 둘째 목표 할 일")?.space).toBe(ws2)
    for (const t of ["액트 다른 공간", "엠씨피 옛 개인 목표 할 일", "엠씨피 둘째 목표 링크"]) expect(all.map((i) => i.text)).not.toContain(t)
  })

  test("운영 순회 카드·이슈 카드는 goalId 를 넘기지 않아 이 규칙 밖이에요(그대로)", () => {
    for (const f of ["ops.ts", "issues.ts"]) expect(readFileSync(join(import.meta.dir, f), "utf8")).not.toContain("goalId")
  })
})

describe("Access 모드(개인 방향판): 그대로", () => {
  let s: Isolated
  beforeAll(async () => { s = await startIsolated() }, 20000)
  afterAll(async () => { await s?.stop() })
  const local = <T>(method: string, path: string, body?: unknown) =>
    fetch(s.local + path, { method, headers: { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }).then((r) => read<T>(r))
  test("개인 판 목표의 새 할 일은 개인, 목표 없는 항목·기존 항목 저장은 전과 같아요", async () => {
    const mine = (await local<StateJ>("GET", "/api/state")).json.boards.find((b) => b.kind === "personal" && b.mine)!.id
    const g = await local<ItemJ>("POST", `/api/boards/${mine}/items`, goal("개인 목표"))
    expect(g.status).toBe(201)
    const t = await local<ItemJ>("PUT", `/api/boards/${mine}/items/accgoal001`, todo("할 일", { goalId: g.json.id }))
    expect([t.status, t.json.space]).toEqual([200, "personal"])
    const plain = await local<ItemJ>("POST", `/api/boards/${mine}/items`, todo("목표 없음"))
    expect([plain.status, plain.json.space]).toEqual([201, "personal"])
    // 기존 항목을 공간과 함께 다시 저장(웹이 늘 하는 PUT)해도 그대로
    const again = await local<ItemJ>("PUT", `/api/boards/${mine}/items/accgoal001`, todo("할 일 고침", { goalId: g.json.id, space: "personal" }))
    expect([again.status, again.json.text]).toEqual([200, "할 일 고침"])
  })
  test("회사 판의 공간 없는 목표에 붙인 새 할 일도 개인(Access 모드 회사 판은 개인 공간을 받아요)", async () => {
    const company = (await local<{ id: string }>("POST", "/api/boards", { name: "회사 판", kind: "company" })).json.id
    const g = await local<ItemJ>("POST", `/api/boards/${company}/items`, goal("회사 판 목표"))
    const t = await local<ItemJ>("POST", `/api/boards/${company}/items`, todo("회사 판 목표의 할 일", { goalId: g.json.id }))
    expect([t.status, t.json.space]).toEqual([201, g.json.space])
  })
  test("REST /api/act task: 개인 목표에 붙이면 개인, 다른 공간을 보내면 ok:false", async () => {
    const mine = (await local<StateJ>("GET", "/api/state")).json.boards.find((b) => b.kind === "personal" && b.mine)!.id
    const g = (await local<ItemJ>("POST", `/api/boards/${mine}/items`, goal("액트 개인 목표"))).json
    const ws = (await local<{ space: { id: string } }>("POST", "/api/spaces", { name: "작은 회사" })).json.space.id
    const act = async (a: Record<string, unknown>) => (await local<ActJ>("POST", "/api/act", { actions: [{ do: "task", note: "## 상황\n목표에 붙일 할 일", ...a }] })).json.results[0]!
    const ok = await act({ title: "액트 개인 목표 할 일", goalId: g.id })
    expect(ok.ok).toBe(true)
    expect((await local<StateJ>("GET", "/api/state")).json.items.find((i) => i.text === "액트 개인 목표 할 일")?.space).toBe("personal")
    const bad = await act({ title: "액트 다른 공간 할 일", goalId: g.id, space: ws })
    expect(bad.ok).toBe(false)
    expect((await local<StateJ>("GET", "/api/state")).json.items.map((i) => i.text)).not.toContain("액트 다른 공간 할 일")
  })
})
