// 보안 리뷰 1회차(135c478)·2회차(eb7f957) 재현: 격리 서버를 AUTH_MODE=google 로 띄우고 세션 행을 시험 DB 에 넣어 사람을 흉내 내요.
// 마지막 묶음은 파일럿이 아닐 때(개인 방향판, Access 모드) 지금 동작이 그대로인지 봐요.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { mcpCall, startIsolated, type Isolated } from "./test/isolated.ts"

const sha = (v: string) => new Bun.CryptoHasher("sha256").update(v).digest("hex")
let s: Isolated
const cookies: Record<string, string> = {}
const PEOPLE = ["jun@lidgeai.com", "jun@lidge.ai", "bran@neuralarcade.ai", "kim@neuralarcade.ai", "lee@neuralarcade.ai", "park@neuralarcade.ai", "choi@neuralarcade.ai"]
const db = () => new Database(join(s.dir, "board.db"))
beforeAll(async () => {
  s = await startIsolated({ AUTH_MODE: "google", GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret", ACCESS_SEED_DOMAINS: "neuralarcade.ai", ACCESS_SEED_EMAILS: "jun@lidgeai.com,jun@lidge.ai", ADMIN_EMAILS: "jun@lidgeai.com,jun@lidge.ai", WORKSPACE_NAME: "뉴럴아케이드", PILOT_BODY_TIMEOUT_MS: "1200", PILOT_MEMBER_WRITES: "30", PILOT_MEMBER_BYTES: "40000" })
  const d = db()
  for (const email of PEOPLE) {
    const secret = crypto.randomUUID().replace(/-/g, "") + "sessionx"
    d.query("INSERT INTO auth_sessions(hash,email,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?)").run(sha(secret), email, Date.now(), Date.now() + 864e5, Date.now())
    cookies[email] = `nb_session=${secret}`
  }
  d.close()
}, 20000)
afterAll(async () => { await s?.stop() })
type Res = { status: number; json: any; text: string }
async function call(who: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const res = await fetch(s.pub + path, { method, redirect: "manual", headers: { ...(who ? { cookie: cookies[who] } : {}), ...(body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: res.status, json, text }
}
const ADMIN = "jun@lidgeai.com", ADMIN2 = "jun@lidge.ai", BRAN = "bran@neuralarcade.ai", KIM = "kim@neuralarcade.ai"
let company = "", ws = ""
const boardsOf = async (who: string) => (await call(who, "GET", "/api/state")).json

describe("P1-1 회사 판의 개인 공간 항목", () => {
  test("멤버는 회사 판의 개인 공간 항목을 읽지도 고치지도 못해요(상태·변경·일·쓰기·기록)", async () => {
    const st = await boardsOf(ADMIN)
    company = st.boards.find((b: any) => b.kind === "company").id
    ws = st.spaces.find((x: any) => x.kind === "workspace").id
    // 개인 공간 항목을 회사 판에 직접 넣어요(옛 데이터·Access 모드에서 만들 수 있던 모양)
    const d = db()
    d.query("INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq,space) VALUES (?,?,?,?,?,0,?,?)").run(company, "privx00001", JSON.stringify({ type: "todo", text: "관리자 개인 메모 PRIVQ", x: 0, y: 0, w: 1, h: 1 }), ADMIN, Date.now(), 999999, "personal")
    d.close()
    const member = await call(BRAN, "GET", "/api/state")
    expect(member.text).not.toContain("PRIVQ")
    expect((await call(BRAN, "GET", "/api/changes?since=0")).text).not.toContain("PRIVQ")
    expect((await call(BRAN, "GET", `/api/work/${encodeURIComponent(`item:${company}:privx00001`)}`)).text).not.toContain("PRIVQ")
    expect((await call(BRAN, "GET", "/api/work/search?q=PRIVQ")).text).not.toContain("PRIVQ")
    expect((await call(BRAN, "PUT", `/api/boards/${company}/items/privx00001`, { type: "todo", text: "멤버가 덮음", x: 0, y: 0, w: 1, h: 1, space: ws })).status).toBe(404)
    expect((await call(BRAN, "POST", `/api/boards/${company}/items/privx00001/log`, { text: "멤버 기록" })).status).toBe(404)
    // 관리자에게는 그대로 보여요
    expect((await call(ADMIN, "GET", "/api/state")).text).toContain("PRIVQ")
  })
  test("회사 판의 공간 없는(NULL) 항목은 계약대로 개인이라 멤버에게 안 보이고, 관리자가 회사로 옮겨야 보여요", async () => {
    const d = db()
    d.query("INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq) VALUES (?,?,?,?,?,0,?)").run(company, "legacy0001", JSON.stringify({ type: "todo", text: "옛 회사 판 항목 LEGQ", x: 0, y: 0, w: 1, h: 1 }), ADMIN, Date.now(), 999998)
    d.close()
    for (const who of [ADMIN, BRAN]) await call(who, "GET", "/api/state") // 상태 읽기로는 공간이 바뀌지 않아요
    const d2 = db()
    expect((d2.query("SELECT space FROM items WHERE id='legacy0001'").get() as { space: string | null }).space).toBeNull()
    d2.close()
    expect((await call(BRAN, "GET", "/api/state")).text).not.toContain("LEGQ")
    expect((await call(BRAN, "GET", "/api/changes?since=0")).text).not.toContain("LEGQ")
    expect((await call(BRAN, "GET", "/api/work/search?q=LEGQ")).text).not.toContain("LEGQ")
    expect((await call(ADMIN, "GET", "/api/state")).json.items.find((i: any) => i.id === "legacy0001")?.space).toBe("personal")
    // 관리자가 명시적으로 회사 공간으로 옮기면 그때부터 보여요
    expect((await call(ADMIN, "PUT", `/api/boards/${company}/items/legacy0001`, { type: "todo", text: "옛 회사 판 항목 LEGQ", x: 0, y: 0, w: 1, h: 1, space: ws })).status).toBe(200)
    expect((await call(BRAN, "GET", "/api/state")).json.items.find((i: any) => i.id === "legacy0001")?.space).toBe(ws)
  })
  test("파일럿 회사 판에는 개인 공간 항목을 새로 둘 수 없어요(관리자도)", async () => {
    expect((await call(ADMIN, "POST", `/api/boards/${company}/items`, { type: "todo", text: "개인으로", x: 0, y: 0, w: 1, h: 1, space: "personal" })).status).toBe(400)
  })
})

describe("P1-2 강등된 관리자", () => {
  test("역할이 멤버로 바뀐 직후 기존 세션으로 자기 개인 판·개인 사건을 못 봐요", async () => {
    const st = await boardsOf(ADMIN2)
    const mine = st.boards.find((b: any) => b.kind === "personal" && b.mine).id
    expect((await call(ADMIN2, "PUT", `/api/boards/${mine}/items/own000001`, { type: "todo", text: "강등 전 개인 일 OWNQ", x: 0, y: 0, w: 1, h: 1 })).status).toBe(200)
    const d = db()
    d.query("INSERT INTO signals(id,owner,ref,source,kind,title,lane,status,created_at,updated_at) VALUES ('sigown0001',?,NULL,'gmail','info','개인 사건 SIGQ','now','open',?,?)").run(ADMIN2, Date.now(), Date.now())
    d.close()
    expect((await call(ADMIN, "PATCH", "/api/access/members/jun%40lidge.ai", { role: "member" })).status).toBe(200)
    const after = await call(ADMIN2, "GET", "/api/state")
    expect(after.json.me.role).toBe("member")
    expect(after.json.boards.map((b: any) => b.kind)).toEqual(["company"])
    expect(after.text).not.toContain("OWNQ")
    expect((await call(ADMIN2, "GET", "/api/changes?since=0")).text).not.toContain("OWNQ")
    expect((await call(ADMIN2, "GET", "/api/signals")).text).not.toContain("SIGQ")
    expect((await call(ADMIN2, "PATCH", "/api/signals/sigown0001", { status: "resolved" })).status).toBe(404)
    expect((await call(ADMIN2, "GET", `/api/work/${encodeURIComponent(`item:${mine}:own000001`)}`)).text).not.toContain("OWNQ")
    expect((await call(ADMIN2, "PUT", `/api/boards/${mine}/items/own000001`, { type: "todo", text: "강등 뒤 덮기", x: 0, y: 0, w: 1, h: 1 })).status).toBe(404)
    expect((await call(ADMIN, "PATCH", "/api/access/members/jun%40lidge.ai", { role: "admin" })).status).toBe(200)
  })
})

describe("P1-3 연결 토큰·AGENT_TOKEN", () => {
  test("강등·비활성 뒤에는 그 사람의 MCP 토큰이 막히고 폐기돼요", async () => {
    const made = await call(ADMIN2, "POST", "/api/mcp-tokens", { name: "laptop" })
    expect(made.status).toBe(201)
    const bearer = { authorization: `Bearer ${made.json.secret}` }
    expect((await mcpCall(s.pub, "tools/list", bearer)).status).toBe(200)
    expect((await call(ADMIN, "PATCH", "/api/access/members/jun%40lidge.ai", { role: "member" })).status).toBe(200)
    expect((await mcpCall(s.pub, "tools/list", bearer)).status).toBe(401)
    const d = db()
    expect((d.query("SELECT revoked_at FROM mcp_tokens WHERE id=?").get(made.json.token.id) as { revoked_at: number | null }).revoked_at).not.toBeNull()
    d.close()
    expect((await call(ADMIN, "PATCH", "/api/access/members/jun%40lidge.ai", { role: "admin" })).status).toBe(200)
    expect((await mcpCall(s.pub, "tools/list", bearer)).status).toBe(401) // 다시 승격해도 폐기된 토큰은 그대로 막혀요
    const made2 = await call(ADMIN2, "POST", "/api/mcp-tokens", { name: "laptop2" })
    expect((await call(ADMIN, "PATCH", "/api/access/members/jun%40lidge.ai", { disabled: true })).status).toBe(200)
    expect((await mcpCall(s.pub, "tools/list", { authorization: `Bearer ${made2.json.secret}` })).status).toBe(401)
    expect((await call(ADMIN, "PATCH", "/api/access/members/jun%40lidge.ai", { disabled: false })).status).toBe(200)
  })
  test("파일럿에서는 AGENT_TOKEN 이 꺼져 있어요", async () => {
    expect((await fetch(`${s.pub}/api/state`, { headers: { authorization: "Bearer test-agent-token" } })).status).toBe(401)
    expect((await mcpCall(s.pub, "tools/list", { authorization: "Bearer test-agent-token" })).status).toBe(401)
  })
})

describe("P1-4 이슈 본문", () => {
  test("남의 이슈 본문은 공유 항목·일 화면에 나오지 않고, 보낸 사람·관리자만 봐요", async () => {
    const f = new FormData()
    f.set("title", "급여 명세 오류"); f.set("body", "제 급여가 SECRETBODY 만큼 잘못 들어왔어요"); f.set("urgency", "normal")
    const sent = await call(BRAN, "POST", "/api/issues", f)
    expect(sent.status).toBe(201)
    const ref = sent.json.issue.itemRef
    expect((await call(KIM, "GET", "/api/state")).text).not.toContain("SECRETBODY")
    expect((await call(KIM, "GET", "/api/changes?since=0")).text).not.toContain("SECRETBODY")
    expect((await call(KIM, "GET", `/api/work/${encodeURIComponent(ref)}`)).text).not.toContain("SECRETBODY")
    expect((await call(BRAN, "GET", "/api/issues")).text).toContain("SECRETBODY")
    expect((await call(ADMIN, "GET", "/api/signals")).text).toContain("SECRETBODY")
  })
  test("사람이 '이슈(' 로 시작하게 쓴 회사 판 기록은 그대로예요(자동 정리 없음)", async () => {
    const d = db()
    d.query("INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq,space) VALUES (?,?,?,?,?,0,?,?)").run(company, "humanlog01", JSON.stringify({ type: "todo", text: "사람 기록 보존", x: 0, y: 0, w: 1, h: 1, log: [{ by: ADMIN, at: 1, text: "이슈(메모) · 회의에서 나온 것\n둘째 줄 HUMANQ" }] }), ADMIN, Date.now(), 999990, ws)
    d.close()
    expect((await call(BRAN, "GET", "/api/state")).text).toContain("HUMANQ")
  })
})

describe("P2-5 회사 공간 AI 할 일", () => {
  test("MCP board_act 의 회사 공간 할 일은 회사 판에 생겨 멤버에게 보이고, 같은 제목은 합쳐요", async () => {
    const tok = await call(ADMIN, "POST", "/api/mcp-tokens", { name: "agent" })
    const bearer = { authorization: `Bearer ${tok.json.secret}` }
    const act = (title: string) => mcpCall(s.pub, "tools/call", bearer, { name: "board_act", arguments: { actions: [{ do: "task", title, note: "## 상황\n회사 일로 만든 할 일", space: ws }] } })
    const first = await act("배포 체크리스트 만들기")
    const r1 = first.body.result.structuredContent.results[0]
    expect(r1.ok).toBe(true); expect(r1.ref.startsWith(`item:${company}:`)).toBe(true)
    const again = (await act("배포 체크리스트 만들기")).body.result.structuredContent.results[0]
    expect(again.existing).toBe(true); expect(again.ref).toBe(r1.ref)
    expect((await call(BRAN, "GET", "/api/state")).json.items.some((i: any) => i.text === "배포 체크리스트 만들기")).toBe(true)
  })
  test("MCP 로 같은 제목을 개인 공간으로 보내면 회사 일과 합치지 않고 개인 판에 따로 만들어요", async () => {
    const tok = await call(ADMIN, "POST", "/api/mcp-tokens", { name: "agent-p" })
    const bearer = { authorization: `Bearer ${tok.json.secret}` }
    const mine = (await mcpCall(s.pub, "tools/call", bearer, { name: "board_act", arguments: { actions: [{ do: "task", title: "배포 체크리스트 만들기", note: "## 상황\n개인 일정 PERSQ 정리", space: "personal" }] } })).body.result.structuredContent.results[0]
    expect(mine.ok).toBe(true); expect(mine.existing).toBeFalsy(); expect(mine.ref.startsWith(`item:${company}:`)).toBe(false)
    expect((await call(BRAN, "GET", "/api/state")).text).not.toContain("PERSQ")
  })
  test("회사 공간 AI 할 일의 노트는 회사 범위라 멤버가 일 상세에서 읽고, 관리자는 회사 공간 검색으로 찾아요", async () => {
    const tok = await call(ADMIN, "POST", "/api/mcp-tokens", { name: "agent2" })
    const bearer = { authorization: `Bearer ${tok.json.secret}` }
    const made = (await mcpCall(s.pub, "tools/call", bearer, { name: "board_act", arguments: { actions: [{ do: "task", title: "고객 문의 정리하기", note: "## 상황\n고객 문의 NOTEQ 를 모아 정리해요", space: ws }] } })).body.result.structuredContent.results[0]
    expect(made.ok).toBe(true)
    const detail = await call(BRAN, "GET", `/api/work/${encodeURIComponent(made.ref)}`)
    expect(detail.status).toBe(200)
    expect(detail.json.note?.md ?? "").toContain("NOTEQ")
    expect((await call(ADMIN, "GET", `/api/work/${encodeURIComponent(made.ref)}`)).json.note?.md ?? "").toContain("NOTEQ")
    const found = await mcpCall(s.pub, "tools/call", bearer, { name: "board_search", arguments: { q: "NOTEQ", space: ws } })
    expect(JSON.stringify(found.body?.result?.structuredContent ?? null)).toContain(made.ref)
    const rest = await call(ADMIN, "GET", `/api/docs/search?q=NOTEQ&space=${encodeURIComponent(ws)}`)
    expect(rest.status).toBe(200); expect(rest.text).toContain(made.ref)
  })
})

/** 본문을 늦게 보내는 요청: 머리만 먼저 보내고, 돌려받은 함수를 부르면 본문을 보내 상태 코드를 받아요(경쟁 재현) */
async function slow(who: string, method: string, path: string, body: unknown): Promise<() => Promise<number>> {
  const port = Number(new URL(s.pub).port)
  const payload = Buffer.from(JSON.stringify(body))
  let buf = ""
  let done!: () => void
  const closed = new Promise<void>((r) => { done = r })
  const sock = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data(_s, d) { buf += Buffer.from(d).toString() }, close() { done() }, error() { done() } } })
  sock.write(`${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${cookies[who]}\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n`)
  await Bun.sleep(400) // 서버가 머리를 받아 처리를 시작하게
  return async () => {
    sock.write(payload)
    await Promise.race([closed, Bun.sleep(3000)])
    sock.end()
    return Number(buf.split(" ")[1])
  }
}
const activeTokens = (email: string) => { const d = db(); const n = (d.query("SELECT COUNT(*) AS n FROM mcp_tokens WHERE owner=? AND revoked_at IS NULL").get(email) as { n: number }).n; d.close(); return n }

describe("2회차 P1-3 강등 경쟁", () => {
  beforeAll(() => {
    // 앞 시험의 비활성으로 끊긴 세션을 새로 넣어요
    const secret = crypto.randomUUID().replace(/-/g, "") + "sessiony"
    const d = db()
    d.query("INSERT INTO auth_sessions(hash,email,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?)").run(sha(secret), ADMIN2, Date.now(), Date.now() + 864e5, Date.now())
    d.close()
    cookies[ADMIN2] = `nb_session=${secret}`
  })
  test("본문을 늦게 보내는 사이 강등되면 접근 관리 변경은 거절돼요", async () => {
    try {
      const finish = await slow(ADMIN2, "PATCH", "/api/access/members/kim%40neuralarcade.ai", { role: "admin" })
      expect((await call(ADMIN, "PATCH", "/api/access/members/jun%40lidge.ai", { role: "member" })).status).toBe(200)
      expect(await finish()).toBe(403)
      expect((await call(ADMIN, "GET", "/api/access")).json.members.find((m: any) => m.email === KIM)?.role ?? "member").toBe("member")
    } finally {
      await call(ADMIN, "PATCH", "/api/access/members/kim%40neuralarcade.ai", { role: "member" })
      await call(ADMIN, "PATCH", "/api/access/members/jun%40lidge.ai", { role: "admin" })
    }
  })
  test("본문을 늦게 보내는 사이 강등되면 연결 토큰은 만들어지지 않아요", async () => {
    try {
      const finish = await slow(ADMIN2, "POST", "/api/mcp-tokens", { name: "race" })
      expect((await call(ADMIN, "PATCH", "/api/access/members/jun%40lidge.ai", { role: "member" })).status).toBe(200)
      expect(await finish()).toBe(403)
      expect(activeTokens(ADMIN2)).toBe(0)
    } finally {
      await call(ADMIN, "PATCH", "/api/access/members/jun%40lidge.ai", { role: "admin" })
    }
  })
})

describe("2회차 P1-4 파일럿의 로컬 리스너", () => {
  test("DEV_LOCAL_USER 가 env 에 있어도 파일럿 로컬 REST·MCP 는 무인증으로 열리지 않아요", async () => {
    expect((await fetch(`${s.local}/api/state`)).status).toBe(401)
    expect((await fetch(`${s.local}/api/ops/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ summary: "x", cards: [] }) })).status).toBe(401)
    expect((await mcpCall(s.local, "tools/list")).status).toBe(401)
    // Google 세션은 로컬에서도 같은 역할로만 통해요(맥 주인 권한을 얻지 않음)
    expect((await fetch(`${s.local}/api/state`, { headers: { cookie: cookies[BRAN] } })).status).toBe(200)
    expect((await fetch(`${s.local}/api/ops`, { headers: { cookie: cookies[BRAN] } })).status).toBe(403)
    expect((await fetch(`${s.local}/api/mcp-tokens`, { headers: { cookie: cookies[BRAN] } })).status).toBe(403)
  })
})

/** 본문 없이 머리만 보내고 첫 응답 상태를 기다려요(본문을 받기 전에 거절되는지). 1.5초 안에 응답이 없으면 0 */
async function headOnly(path: string, headers: Record<string, string>, port = Number(new URL(s.pub).port)): Promise<number> {
  let buf = ""
  const sock = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data(_s, d) { buf += Buffer.from(d).toString() } } })
  sock.write(`POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("")}\r\n`)
  sock.write("x".repeat(1024))
  for (let i = 0; i < 30 && !buf.includes("\r\n"); i++) await Bun.sleep(50)
  sock.end()
  return buf ? Number(buf.split(" ")[1]) : 0
}

describe("최종 리뷰 P1 인증 전 본문", () => {
  test("무인증 큰 POST 는 본문을 받기 전에 401·413 으로 거절돼요(REST·MCP·업로드)", async () => {
    for (const path of ["/api/issues", "/api/boards/x/items", "/mcp"]) {
      const st = await headOnly(path, { "Content-Type": "application/json", "Content-Length": String(50 * 1024 * 1024) })
      expect([401, 413]).toContain(st)
    }
  })
  test("로그인한 멤버도 일반 경로는 1MiB, 이슈 업로드는 그보다 큰 상한을 넘으면 본문 전에 413 이에요", async () => {
    expect(await headOnly(`/api/boards/${company}/items`, { Cookie: cookies[BRAN], "Content-Type": "application/json", "Content-Length": String(2 * 1024 * 1024) })).toBe(413)
    expect(await headOnly("/api/issues", { Cookie: cookies[BRAN], "Content-Type": "multipart/form-data; boundary=x", "Content-Length": String(40 * 1024 * 1024) })).toBe(413)
  })
  test("길이를 밝히지 않은(chunked) 본문도 상한을 넘으면 413 이에요", async () => {
    const big = new ReadableStream({ start(c) { for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(512 * 1024).fill(32)); c.close() } })
    const res = await fetch(`${s.pub}/api/boards/${company}/items`, { method: "POST", headers: { cookie: cookies[BRAN], "content-type": "application/json" }, body: big, duplex: "half" } as RequestInit)
    expect(res.status).toBe(413)
  })
})

describe("최종 리뷰 P1 공간 이동과 문서 범위", () => {
  let ref = ""
  const note = async (who: string) => (await call(who, "GET", `/api/work/${encodeURIComponent(ref)}`)).json?.note?.md ?? null
  test("노트가 있는 일의 문서 범위가 바뀌는 이동은 거절되고, 노트는 그대로예요(REST·MCP)", async () => {
    const d = db()
    d.query("INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq) VALUES (?,?,?,?,?,0,?)").run(company, "movenote01", JSON.stringify({ type: "todo", text: "노트 있는 옛 항목", x: 0, y: 0, w: 1, h: 1 }), ADMIN, Date.now(), 999995)
    d.close()
    ref = `item:${company}:movenote01`
    expect((await call(ADMIN, "PUT", `/api/work/${encodeURIComponent(ref)}/note`, { html: "<p>관리자 메모 MOVEQ</p>", text: "관리자 메모 MOVEQ", md: "관리자 메모 MOVEQ" })).status).toBe(200)
    const before = await note(ADMIN)
    expect(before).toContain("MOVEQ")
    const moved = await call(ADMIN, "PUT", `/api/boards/${company}/items/movenote01`, { type: "todo", text: "노트 있는 옛 항목", x: 0, y: 0, w: 1, h: 1, space: ws })
    expect(moved.status).toBe(409)
    expect(await note(ADMIN)).toBe(before)
    const tok = await call(ADMIN, "POST", "/api/mcp-tokens", { name: "mover" })
    const viaMcp = await mcpCall(s.pub, "tools/call", { authorization: `Bearer ${tok.json.secret}` }, { name: "board_act", arguments: { actions: [{ do: "update", ref, space: ws }] } })
    expect(viaMcp.body.result.structuredContent.results[0].ok).toBe(false)
    expect((await call(ADMIN, "GET", "/api/state")).json.items.find((i: any) => i.id === "movenote01")?.space).toBe("personal")
    expect(await note(ADMIN)).toBe(before)
  })
  test("회사 판의 회사 일을 개인으로 옮기는 것은 MCP 로도 거절돼요", async () => {
    const tok = await call(ADMIN, "POST", "/api/mcp-tokens", { name: "mover2" })
    const bearer = { authorization: `Bearer ${tok.json.secret}` }
    const made = (await mcpCall(s.pub, "tools/call", bearer, { name: "board_act", arguments: { actions: [{ do: "task", title: "공간 이동 시험하기", note: "## 상황\n회사 노트 SHAREQ", space: ws }] } })).body.result.structuredContent.results[0]
    const back = await mcpCall(s.pub, "tools/call", bearer, { name: "board_act", arguments: { actions: [{ do: "update", ref: made.ref, space: "personal" }] } })
    expect(back.body.result.structuredContent.results[0].ok).toBe(false)
    expect((await call(BRAN, "GET", `/api/work/${encodeURIComponent(made.ref)}`)).json.note?.md).toContain("SHAREQ")
  })
  test("멤버는 이미 있는 항목의 공간을 옮길 수 없어요(다른 회사 공간으로도)", async () => {
    const ws2 = (await call(ADMIN, "POST", "/api/spaces", { name: "둘째 회사" })).json?.space?.id ?? (await call(ADMIN, "GET", "/api/spaces")).json.spaces.find((x: any) => x.name === "둘째 회사")?.id
    expect(ws2).toBeTruthy()
    const item = (await call(BRAN, "GET", "/api/state")).json.items.find((i: any) => i.text === "배포 체크리스트 만들기")
    const res = await call(BRAN, "PUT", `/api/boards/${company}/items/${item.id}`, { type: "todo", text: item.text, x: 0, y: 0, w: 1, h: 1, space: ws2 })
    expect(res.status).toBe(403)
    expect((await call(BRAN, "GET", "/api/state")).json.items.find((i: any) => i.id === item.id)?.space).toBe(ws)
  })
})

describe("최종 리뷰 P2 파일럿 운영 순회", () => {
  test("파일럿에서는 관리자에게도 운영 순회 API 가 403 과 안내예요", async () => {
    const get = await call(ADMIN, "GET", "/api/ops")
    expect(get.status).toBe(403); expect(get.json.reason).toBe("pilot")
    expect((await call(ADMIN, "POST", "/api/ops/run")).status).toBe(403)
  })
})

describe("최종 리뷰 2 P2 회사 판의 기존 개인 항목·문서 메타·파일", () => {
  test("회사 판의 기존 개인 항목은 공간을 바꾸지 않는 저장이면 관리자 웹 편집이 돼요(새 개인·개인으로 이동만 거절)", async () => {
    const res = await call(ADMIN, "PUT", `/api/boards/${company}/items/privx00001`, { type: "todo", text: "관리자 개인 메모 PRIVQ 고침", x: 0, y: 0, w: 1, h: 1, space: "personal" })
    expect(res.status).toBe(200)
    expect((await call(BRAN, "GET", "/api/state")).text).not.toContain("PRIVQ")
    expect((await call(ADMIN, "POST", `/api/boards/${company}/items`, { type: "todo", text: "새 개인", x: 0, y: 0, w: 1, h: 1, space: "personal" })).status).toBe(400)
  })
  test("관리자는 회사 공간 일의 문서 메타(제목·상태)를 REST 로 바꿀 수 있어요", async () => {
    const tok = await call(ADMIN, "POST", "/api/mcp-tokens", { name: "meta" })
    const made = (await mcpCall(s.pub, "tools/call", { authorization: `Bearer ${tok.json.secret}` }, { name: "board_act", arguments: { actions: [{ do: "task", title: "메타 바꿀 회사 일", note: "## 상황\n회사 문서 메타 시험", space: ws }] } })).body.result.structuredContent.results[0]
    const res = await call(ADMIN, "PATCH", `/api/docs/${encodeURIComponent(made.ref)}/meta`, { title: "메타 바꾼 회사 일 METAQ", status: "done" })
    expect(res.status).toBe(200)
    const it = (await call(BRAN, "GET", "/api/state")).json.items.find((i: any) => `item:${company}:${i.id}` === made.ref)
    expect(it?.text).toContain("METAQ"); expect(it?.done).toBe(true)
  })
  test("노트 이미지: 멤버는 볼 수 있는 회사 노트에 든 파일만, 남의 개인 노트·연결 안 된 파일은 403", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const up = async () => (await fetch(`${s.pub}/api/files`, { method: "POST", headers: { cookie: cookies[ADMIN], "content-type": "image/png" }, body: png })).json() as Promise<{ url: string }>
    const shared = (await up()).url, privateOne = (await up()).url, loose = (await up()).url
    const tok = await call(ADMIN, "POST", "/api/mcp-tokens", { name: "img" })
    const made = (await mcpCall(s.pub, "tools/call", { authorization: `Bearer ${tok.json.secret}` }, { name: "board_act", arguments: { actions: [{ do: "task", title: "이미지 붙은 회사 일", note: `## 상황\n![화면](${shared})`, space: ws }] } })).body.result.structuredContent.results[0]
    expect(made.ok).toBe(true)
    const mine = (await call(ADMIN, "GET", "/api/state")).json.boards.find((b: any) => b.kind === "personal" && b.mine).id
    expect((await call(ADMIN, "PUT", `/api/boards/${mine}/items/imgpriv01`, { type: "todo", text: "개인 이미지 일", x: 0, y: 0, w: 1, h: 1 })).status).toBe(200)
    expect((await call(ADMIN, "PUT", `/api/work/${encodeURIComponent(`item:${mine}:imgpriv01`)}/note`, { html: `<p><img src="${privateOne}"></p>`, text: "개인", md: `![개인](${privateOne})` })).status).toBe(200)
    const get = async (who: string, u: string) => (await fetch(s.pub + u, { headers: { cookie: cookies[who] } })).status
    expect(await get(BRAN, shared)).toBe(200)
    expect(await get(BRAN, privateOne)).toBe(403)
    expect(await get(BRAN, loose)).toBe(403)
    expect(await get(ADMIN2, privateOne)).toBe(403)
    expect(await get(ADMIN2, shared)).toBe(200)
    expect(await get(ADMIN, privateOne)).toBe(200)
    expect(await get(ADMIN, loose)).toBe(200) // 올린 사람은 아직 노트에 안 넣은 파일도 봐요
  })
})

describe("최종 리뷰 3 사람 기록·/auth 본문", () => {
  test("사람 기록 80개가 있는 할 일에 같은 제목 이슈·AI 덧붙이기를 반복해도 사람 기록은 하나도 지워지지 않아요", async () => {
    const human = Array.from({ length: 80 }, (_, i) => ({ by: ADMIN, at: 1000 + i, text: `사람 기록 HUMLOG${i}` }))
    const d = db()
    d.query("INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq,space) VALUES (?,?,?,?,?,0,?,?)").run(company, "humanlog80", JSON.stringify({ type: "todo", text: "사람 기록 많은 일 정리하기", done: false, x: 0, y: 0, w: 1, h: 1, log: human }), ADMIN, Date.now(), 999980, ws)
    d.close()
    for (let i = 0; i < 3; i++) {
      const f = new FormData(); f.set("title", "사람 기록 많은 일 정리하기"); f.set("body", `반복 ${i}`); f.set("urgency", "normal")
      expect((await call(BRAN, "POST", "/api/issues", f)).status).toBe(201)
    }
    const tok = await call(ADMIN, "POST", "/api/mcp-tokens", { name: "logger" })
    const res = (await mcpCall(s.pub, "tools/call", { authorization: `Bearer ${tok.json.secret}` }, { name: "board_act", arguments: { actions: [{ do: "task", title: "사람 기록 많은 일 정리하기", note: "## 상황\nAI 덧붙임", space: ws }] } })).body.result.structuredContent.results[0]
    expect(res.existing).toBe(true)
    const it = (await call(ADMIN, "GET", "/api/state")).json.items.find((i: any) => i.id === "humanlog80")
    const texts = it.log.map((e: any) => e.text)
    for (let i = 0; i < 80; i++) expect(texts).toContain(`사람 기록 HUMLOG${i}`)
    expect((await call(BRAN, "GET", "/api/issues")).json.issues.filter((x: any) => x.itemRef === `item:${company}:humanlog80`)).toHaveLength(3)
  })
  test("본문이 필요 없는 /auth 경로는 본문을 기다리지 않고 바로 답해요", async () => {
    expect([303, 403, 404, 405]).toContain(await headOnly("/auth/logout", { "Content-Type": "text/plain", "Content-Length": "60000" }))
    expect([404, 405]).toContain(await headOnly("/auth/google/start", { "Content-Type": "text/plain", "Content-Length": "60000" }))
  })
  test("로그인한 사람도 본문을 너무 느리게 보내면 시간 제한으로 끊겨요", async () => {
    let buf = ""
    const port = Number(new URL(s.pub).port)
    const sock = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data(_s, d) { buf += Buffer.from(d).toString() } } })
    sock.write(`POST /api/boards/${company}/items HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${cookies[BRAN]}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`)
    for (let i = 0; i < 60 && !buf.includes("\r\n"); i++) await Bun.sleep(50)
    sock.end()
    expect(Number(buf.split(" ")[1])).toBe(408)
  })
})

describe("리뷰 4 사람 기록 1000개 한도", () => {
  test("사람 기록 1000개인 할 일에 새 사람 기록을 넣는 PUT 은 409 이고 제목 등 다른 변경도 적용하지 않아요. 기록 없는 PUT 은 그대로 돼요", async () => {
    const human = Array.from({ length: 1000 }, (_, i) => ({ by: ADMIN, at: 1000 + i, text: `사람 ${i}` }))
    const d = db()
    d.query("INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq,space) VALUES (?,?,?,?,?,0,?,?)").run(company, "human1000x", JSON.stringify({ type: "todo", text: "기록 가득한 일", done: false, x: 0, y: 0, w: 1, h: 1, log: human }), ADMIN, Date.now(), 999970, ws)
    d.close()
    const res = await call(ADMIN, "PUT", `/api/boards/${company}/items/human1000x`, { type: "todo", text: "바뀐 제목 TITLEQ", x: 0, y: 0, w: 1, h: 1, log: [...human, { by: ADMIN, at: 5000, text: "넘치는 새 기록" }] })
    expect(res.status).toBe(409)
    const it = (await call(ADMIN, "GET", "/api/state")).json.items.find((i: any) => i.id === "human1000x")
    expect(it.text).toBe("기록 가득한 일"); expect(it.log).toHaveLength(1000)
    expect((await call(ADMIN, "PUT", `/api/boards/${company}/items/human1000x`, { type: "todo", text: "기록 없이 제목만", x: 0, y: 0, w: 1, h: 1 })).status).toBe(200)
    expect((await call(ADMIN, "GET", "/api/state")).json.items.find((i: any) => i.id === "human1000x").log).toHaveLength(1000)
  })
})

describe("리뷰 5 멤버 기록 위조·항목 저장량", () => {
  const LEE = "lee@neuralarcade.ai", PARK = "park@neuralarcade.ai"
  test("멤버가 보낸 새 기록의 이름·시각·id 는 서버가 정하고(관리자 이름 위조 불가), 한 번에 6개 이상은 거절해요", async () => {
    const made = await call(BRAN, "POST", `/api/boards/${company}/items`, { type: "todo", text: "위조 시험 일", x: 0, y: 0, w: 1, h: 1 })
    expect(made.status).toBe(201)
    const forged = Array.from({ length: 3 }, (_, i) => ({ by: ADMIN, at: 1, id: "forgedid" + i, text: `위조 FORGEQ${i}` }))
    expect((await call(BRAN, "PUT", `/api/boards/${company}/items/${made.json.id}`, { type: "todo", text: "위조 시험 일", x: 0, y: 0, w: 1, h: 1, log: forged })).status).toBe(200)
    const log = (await call(ADMIN, "GET", "/api/state")).json.items.find((i: any) => i.id === made.json.id).log
    const mine = log.filter((e: any) => String(e.text).startsWith("위조 FORGEQ"))
    expect(mine).toHaveLength(3)
    for (const e of mine) { expect(e.by).toBe(BRAN); expect(Math.abs(e.at - Date.now())).toBeLessThan(60e3); expect(e.id).not.toMatch(/^forgedid/) }
    const many = Array.from({ length: 1000 }, (_, i) => ({ by: ADMIN, at: 1, text: `대량 위조 MANYQ${i}` }))
    expect((await call(BRAN, "PUT", `/api/boards/${company}/items/${made.json.id}`, { type: "todo", text: "위조 시험 일 바꿈", x: 0, y: 0, w: 1, h: 1, log: [...log, ...many] })).status).toBe(409)
    const after = (await call(ADMIN, "GET", "/api/state")).json.items.find((i: any) => i.id === made.json.id)
    expect(after.text).toBe("위조 시험 일"); expect(JSON.stringify(after.log)).not.toContain("MANYQ")
    // 기존 기록을 그대로 다시 보내는 옛 클라이언트식 전체 PUT 은 그대로 돼요
    expect((await call(BRAN, "PUT", `/api/boards/${company}/items/${made.json.id}`, { type: "todo", text: "위조 시험 일", x: 0, y: 0, w: 1, h: 1, log: after.log })).status).toBe(200)
  })
  test("한 사람이 짧은 시간에 기록을 너무 많이 더하면 429 예요", async () => {
    const made = await call(PARK, "POST", `/api/boards/${company}/items`, { type: "todo", text: "기록 빈도 시험", x: 0, y: 0, w: 1, h: 1 })
    let last = 0
    for (let n = 0; n < 15 && last !== 429; n++) {
      const cur = (await call(ADMIN, "GET", "/api/state")).json.items.find((i: any) => i.id === made.json.id).log ?? []
      last = (await call(PARK, "PUT", `/api/boards/${company}/items/${made.json.id}`, { type: "todo", text: "기록 빈도 시험", x: 0, y: 0, w: 1, h: 1, log: [...cur, ...Array.from({ length: 5 }, (_, i) => ({ by: PARK, at: Date.now(), text: `빈도 ${n}-${i}` }))] })).status
    }
    expect(last).toBe(429)
  })
  test("멤버 항목 하나의 크기(기록 빼고 64KB)·누적 저장량·쓰기 빈도에 한도가 있어요", async () => {
    const threads = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, title: "t", at: i, status: "done", reply: "r".repeat(2000), note: "n".repeat(1000) }))
    expect((await call(LEE, "POST", `/api/boards/${company}/items`, { type: "todo", text: "가".repeat(5000), x: 0, y: 0, w: 1, h: 1, threads })).status).toBe(413)
    // 누적: 시험 서버는 멤버당 40000 바이트
    let st = 0
    for (let i = 0; i < 12 && st !== 413 && st !== 507; i++) st = (await call(LEE, "POST", `/api/boards/${company}/items`, { type: "todo", text: "가".repeat(1600) + i, x: 0, y: 0, w: 1, h: 1 })).status
    expect(st).toBe(413)
    // 빈도: 시험 서버는 멤버당 10분에 30번
    let rate = 0
    for (let i = 0; i < 40 && rate !== 429; i++) rate = (await call(KIM, "POST", `/api/boards/${company}/items`, { type: "todo", text: `빈도 ${i}`, x: 0, y: 0, w: 1, h: 1 })).status
    expect(rate).toBe(429)
  })
  test("문서 메타 변경도 같은 기록 한도를 따라요(사람 기록 1000개면 409, 제목 그대로)", async () => {
    const ref = `item:${company}:human1000x`
    expect((await call(ADMIN, "PUT", `/api/work/${encodeURIComponent(ref)}/note`, { html: "<p>메모</p>", text: "메모", md: "메모" })).status).toBe(200)
    const before = (await call(ADMIN, "GET", "/api/state")).json.items.find((i: any) => i.id === "human1000x")
    const res = await call(ADMIN, "PATCH", `/api/docs/${encodeURIComponent(ref)}/meta`, { title: "메타로 바꾼 제목 MQ" })
    expect(res.status).toBe(409)
    const after = (await call(ADMIN, "GET", "/api/state")).json.items.find((i: any) => i.id === "human1000x")
    expect(after.text).toBe(before.text); expect(after.log).toHaveLength(before.log.length)
  })
})

describe("리뷰 6 멤버 기록 추가도 저장량 한도", () => {
  test("멤버의 /items/:id/log 도 최종 저장 크기로 멤버 한도를 봐요(413)", async () => {
    const LEE = "lee@neuralarcade.ai"
    const mineItem = (await call(ADMIN, "GET", "/api/state")).json.items.find((i: any) => i.by === LEE)
    expect(mineItem).toBeTruthy()
    let st = 0
    for (let i = 0; i < 5 && st !== 413; i++) st = (await call(LEE, "POST", `/api/boards/${company}/items/${mineItem.id}/log`, { text: "가".repeat(2000) })).status
    expect(st).toBe(413)
  })
})

describe("머지 뒤 고침", () => {
  test("멤버가 남의 항목 여러 개에 /log 로 기록을 더해도 멤버 누적 저장량에 잡혀요(413)", async () => {
    const CHOI = "choi@neuralarcade.ai"
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push((await call(ADMIN, "POST", `/api/boards/${company}/items`, { type: "todo", text: `관리자 항목 ${i}`, x: 0, y: 0, w: 1, h: 1, space: ws })).json.id)
    let st = 0
    for (let n = 0; n < 12 && st !== 413; n++) st = (await call(CHOI, "POST", `/api/boards/${company}/items/${ids[n % 3]}/log`, { text: "가".repeat(2000) })).status
    expect(st).toBe(413)
  })
  test("끝난 이슈는 관리자 사건(결정 칸)에서 닫혀요 — 이슈 상태로 끝내도, 할 일을 끝내도", async () => {
    type Sig = { ref: string; status: string }
    const send = async (title: string) => { const f = new FormData(); f.set("title", title); f.set("body", "본문"); f.set("urgency", "normal"); return (await call(BRAN, "POST", "/api/issues", f)).json.issue }
    const sigOf = async (itemRef: string) => ((await call(ADMIN, "GET", "/api/signals")).json.signals as Sig[]).find((x) => x.ref === `issue:${itemRef.split(":")[2]}`)
    const a = await send("끝낼 이슈 하나 ENDQ1")
    expect((await sigOf(a.itemRef))?.status).toBe("open")
    expect((await call(ADMIN, "PATCH", `/api/issues/${a.id}`, { status: "done" })).status).toBe(200)
    expect((await sigOf(a.itemRef))?.status).toBe("resolved")
    const b = await send("할 일로 끝낼 이슈 ENDQ2")
    const [, bid, iid] = b.itemRef.split(":")
    const it = ((await call(ADMIN, "GET", "/api/state")).json.items as { id: string }[]).find((i) => i.id === iid)
    expect((await call(ADMIN, "PUT", `/api/boards/${bid}/items/${iid}`, { ...it, done: true })).status).toBe(200)
    expect((await sigOf(b.itemRef))?.status).toBe("resolved")
    // 다시 열면 사건도 다시 열려요
    expect((await call(ADMIN, "PUT", `/api/boards/${bid}/items/${iid}`, { ...it, done: false })).status).toBe(200)
    expect((await sigOf(b.itemRef))?.status).toBe("open")
  })
})
