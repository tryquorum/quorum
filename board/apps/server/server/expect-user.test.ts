// 시작 범위 주체 확인(PR #39 리뷰 17): 쓰기 요청이 X-Direction-Expect-User 로 밝힌 주체가 지금 인증 주체와 다르면 409 scope-changed·쓰기 0건.
// 헤더가 없으면 그대로(MCP·REST /api/act·운영 순회·옛 클라이언트). 주체는 기존 인증 함수 결과 — 로컬 개발자, Access JWT, Bearer, 파일럿 Google 세션.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { accessJwt, mcpCall, startIsolated, type Isolated } from "./test/isolated.ts"

const todo = (text: string) => ({ type: "todo", text, x: 0, y: 0, w: 1, h: 1 })
const H = "X-Direction-Expect-User"
type StateJ = { me: { email: string }; boards: { id: string; kind: string; mine: boolean }[]; items: { id: string; text: string }[] }

describe("Access 모드: 로컬 개발자·Access JWT·Bearer", () => {
  let s: Isolated
  beforeAll(async () => { s = await startIsolated() }, 20000)
  afterAll(async () => { await s?.stop() })
  const state = async (base: string, headers: Record<string, string> = {}) => (await (await fetch(base + "/api/state", { headers })).json()) as StateJ
  const put = (base: string, board: string, id: string, headers: Record<string, string>) =>
    fetch(`${base}/api/boards/${board}/items/${id}`, { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(todo("범위 시험 " + id)) })

  test("로컬 개발자: 다른 주체면 409 scope-changed·쓰기 0건, 같거나 헤더가 없으면 그대로, 읽기는 보지 않아요", async () => {
    const st = await state(s.local)
    expect(st.me.email).toBe("jun@lidgeai.com")
    const board = st.boards.find((b) => b.kind === "personal" && b.mine)!.id
    const bad = await put(s.local, board, "scope0001", { [H]: "other@example.com" })
    expect([bad.status, await bad.json()]).toEqual([409, { error: "scope-changed" }])
    expect((await state(s.local)).items.some((i) => i.id === "scope0001")).toBe(false)
    expect((await put(s.local, board, "scope0002", { [H]: " JUN@lidgeai.com " })).status).toBe(200)
    expect((await put(s.local, board, "scope0003", {})).status).toBe(200)
    expect((await fetch(s.local + "/api/state", { headers: { [H]: "other@example.com" } })).status).toBe(200)
    // 노트 쓰기·태그(문서 층)도 같은 관문
    const note = await fetch(`${s.local}/api/work/${encodeURIComponent("item:" + board + ":scope0002")}/note`, { method: "PUT", headers: { "content-type": "application/json", [H]: "other@example.com" }, body: JSON.stringify({ html: "<p>x</p>", text: "x", md: "x", expectedVersion: 0 }) })
    expect(note.status).toBe(409)
    const noteOk = await fetch(`${s.local}/api/work/${encodeURIComponent("item:" + board + ":scope0002")}/note`, { method: "PUT", headers: { "content-type": "application/json", [H]: "jun@lidgeai.com" }, body: JSON.stringify({ html: "<p>x</p>", text: "x", md: "x", expectedVersion: 0 }) })
    expect(noteOk.status).toBe(200)
  })
  test("Access JWT(공개 리스너): JWT 이메일이 주체", async () => {
    const jwt = await accessJwt({ email: "other@example.com" })
    const st = await state(s.pub, { "cf-access-jwt-assertion": jwt })
    expect(st.me.email).toBe("other@example.com")
    const board = st.boards.find((b) => b.kind === "personal" && b.mine)!.id
    expect((await put(s.pub, board, "scope0101", { "cf-access-jwt-assertion": jwt, [H]: "jun@lidgeai.com" })).status).toBe(409)
    expect((await put(s.pub, board, "scope0102", { "cf-access-jwt-assertion": jwt, [H]: "other@example.com" })).status).toBe(200)
  })
  test("Bearer 에이전트 토큰: 토큰 주인이 주체, 헤더 없는 REST /api/act·MCP 는 그대로", async () => {
    const auth = { authorization: "Bearer test-agent-token" }
    const st = await state(s.local, auth)
    const board = st.boards.find((b) => b.kind === "personal" && b.mine)!.id
    expect((await put(s.local, board, "scope0201", { ...auth, [H]: "other@example.com" })).status).toBe(409)
    expect((await put(s.local, board, "scope0202", { ...auth, [H]: st.me.email })).status).toBe(200)
    const act = await fetch(s.local + "/api/act", { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify({ actions: [{ do: "task", title: "헤더 없는 act", note: "## 상황\n헤더 없는 REST" }] }) })
    expect(act.status).toBe(200)
    const mcp = await mcpCall(s.local, "tools/list", auth)
    expect(mcp.status).toBe(200)
  })
})

describe("파일럿(Google 세션): 세션 이메일이 주체", () => {
  let s: Isolated
  let cookie = ""
  beforeAll(async () => {
    s = await startIsolated({ AUTH_MODE: "google", GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret", ACCESS_SEED_DOMAINS: "neuralarcade.ai", ACCESS_SEED_EMAILS: "jun@lidgeai.com", ADMIN_EMAILS: "jun@lidgeai.com", WORKSPACE_NAME: "뉴럴아케이드" })
    const db = new Database(join(s.dir, "board.db"))
    const secret = crypto.randomUUID().replace(/-/g, "") + "abcdefgh"
    db.query("INSERT INTO auth_sessions(hash,email,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?)").run(new Bun.CryptoHasher("sha256").update(secret).digest("hex"), "bran@neuralarcade.ai", Date.now(), Date.now() + 864e5, Date.now())
    db.close()
    cookie = `nb_session=${secret}`
  }, 20000)
  afterAll(async () => { await s?.stop() })
  test("다른 계정(쿠키가 바뀐 뒤)의 시작 범위면 409, 같은 계정이면 그대로", async () => {
    const st = (await (await fetch(s.pub + "/api/state", { headers: { cookie } })).json()) as StateJ
    expect(st.me.email).toBe("bran@neuralarcade.ai")
    const board = st.boards.find((b) => b.kind === "personal" && b.mine)?.id ?? st.boards[0]!.id
    const send = (who: string) => fetch(`${s.pub}/api/boards/${board}/items/pilot0001`, { method: "PUT", headers: { cookie, "content-type": "application/json", [H]: who }, body: JSON.stringify(todo("파일럿 범위 시험")) })
    const bad = await send("jun@lidgeai.com")
    expect([bad.status, await bad.json()]).toEqual([409, { error: "scope-changed" }])
    expect((await send("bran@neuralarcade.ai")).status).not.toBe(409)
  })
  test("본문을 받기 전에 판정(리뷰 18 P2): 본문 상한을 넘는 요청도 다른 주체면 413 이 아니라 409, 같은 주체면 그대로 413", async () => {
    const big = "x".repeat(2 * 1024 * 1024)
    const st = (await (await fetch(s.pub + "/api/state", { headers: { cookie } })).json()) as StateJ
    const board = st.boards.find((b) => b.kind === "personal" && b.mine)?.id ?? st.boards[0]!.id
    const send = (who: string) => fetch(`${s.pub}/api/boards/${board}/items/pilot0002`, { method: "PUT", headers: { cookie, "content-type": "application/json", [H]: who }, body: big })
    const early = await send("jun@lidgeai.com")
    expect([early.status, await early.json()]).toEqual([409, { error: "scope-changed" }])
    expect((await send("bran@neuralarcade.ai")).status).toBe(413)
  })
})
