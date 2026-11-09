// 파일럿 서버 실측: 격리 서버(임시 DB·거울·빈 포트)를 AUTH_MODE=google 로 띄워 공개 리스너에서 확인해요.
// Google 왕복은 google-auth.test.ts 가 맡고, 여기서는 세션 행을 시험 DB 에 직접 넣어 로그인한 사람으로 불러요.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { startIsolated, type Isolated } from "./test/isolated.ts"

let s: Isolated
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const sessions: Record<string, string> = {}
beforeAll(async () => {
  s = await startIsolated({ AUTH_MODE: "google", GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret", ACCESS_SEED_DOMAINS: "neuralarcade.ai", ACCESS_SEED_EMAILS: "jun@lidgeai.com,jun@lidge.ai,b@devfiance.ai", ADMIN_EMAILS: "jun@lidgeai.com,jun@lidge.ai", WORKSPACE_NAME: "뉴럴아케이드" })
  const db = new Database(join(s.dir, "board.db"))
  for (const email of ["jun@lidgeai.com", "bran@neuralarcade.ai", "kim@neuralarcade.ai", "b@devfiance.ai", "x@gmail.com"]) {
    const secret = crypto.randomUUID().replace(/-/g, "") + "abcdefgh"
    db.query("INSERT INTO auth_sessions(hash,email,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?)").run(new Bun.CryptoHasher("sha256").update(secret).digest("hex"), email, Date.now(), Date.now() + 864e5, Date.now())
    sessions[email] = `nb_session=${secret}`
  }
  db.close()
}, 20000)
afterAll(async () => { await s?.stop() })
const call = async (who: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(s.pub + path, { method, redirect: "manual", headers: { ...(who ? { cookie: sessions[who] } : {}), ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}), ...headers }, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers }
}
const issueForm = (title: string, extra: Record<string, string> = {}, files: Uint8Array[] = []) => {
  const f = new FormData()
  f.set("title", title); f.set("body", "회의실 예약 화면이 안 열려요"); f.set("urgency", "high")
  for (const [k, v] of Object.entries(extra)) f.set(k, v)
  for (const b of files) f.append("files", new File([new Uint8Array(b)], "shot.png", { type: "image/png" }))
  return f
}

describe("파일럿 로그인과 분리", () => {
  test("로그인 전에는 Google 로그인 화면, 시작하면 Google 로 PKCE 리다이렉트", async () => {
    const page = await call(null, "GET", "/w/abc")
    expect(page.status).toBe(401); expect(page.text).toContain("/auth/google/start?return=%2Fw%2Fabc")
    expect((await call(null, "GET", "/api/state")).status).toBe(401)
    const start = await call(null, "GET", "/auth/google/start")
    const loc = new URL(start.headers.get("location") || "")
    expect(start.status).toBe(302); expect(loc.host).toBe("accounts.google.com")
    expect(loc.searchParams.get("client_id")).toBe("cid.apps.googleusercontent.com")
    expect(loc.searchParams.get("redirect_uri")).toBe("https://board.example/auth/google/callback")
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256")
  })
  test("허용 밖 이메일의 세션은 들어오지 못해요", async () => {
    expect((await call("x@gmail.com", "GET", "/api/state")).status).toBe(401)
  })
  test("관리자는 개인·회사 판을, 멤버는 회사 판만 봐요(개인 일은 멤버 응답 어디에도 없음)", async () => {
    const admin = await call("jun@lidgeai.com", "GET", "/api/state")
    expect(admin.json.me.role).toBe("admin"); expect(admin.json.me.auth).toBe("google")
    const personal = admin.json.boards.find((b: any) => b.kind === "personal")
    const company = admin.json.boards.find((b: any) => b.kind === "company")
    expect(company.name).toBe("뉴럴아케이드")
    const ws = admin.json.spaces.find((x: any) => x.kind === "workspace")
    expect(ws.name).toBe("뉴럴아케이드")
    expect((await call("jun@lidgeai.com", "PUT", `/api/boards/${personal.id}/items/secret0001`, { type: "todo", text: "개인 비밀 할 일 ZZQ", x: 0, y: 0, w: 1, h: 1 })).status).toBe(200)
    const made = await call("jun@lidgeai.com", "POST", `/api/boards/${company.id}/items`, { type: "todo", text: "회사 할 일 하나", x: 0, y: 0, w: 1, h: 1 })
    expect(made.json.space).toBe(ws.id)
    const member = await call("bran@neuralarcade.ai", "GET", "/api/state")
    expect(member.json.me.role).toBe("member")
    expect(member.json.boards.map((b: any) => b.kind)).toEqual(["company"])
    expect(member.text).not.toContain("ZZQ")
    expect(member.json.items.map((i: any) => i.text)).toContain("회사 할 일 하나")
    const changes = await call("bran@neuralarcade.ai", "GET", "/api/changes?since=0")
    expect(changes.text).not.toContain("ZZQ")
    expect((await call("bran@neuralarcade.ai", "PUT", `/api/boards/${personal.id}/items/secret0001`, { type: "todo", text: "덮기", x: 0, y: 0, w: 1, h: 1 })).status).toBe(404)
    expect((await call("bran@neuralarcade.ai", "POST", `/api/boards/${company.id}/items`, { type: "todo", text: "개인으로", x: 0, y: 0, w: 1, h: 1, space: "personal" })).status).toBe(403)
    expect((await call("bran@neuralarcade.ai", "POST", `/api/boards/${company.id}/items`, { type: "todo", text: "멤버가 만든 회사 일", x: 0, y: 0, w: 1, h: 1 })).json.space).toBe(ws.id)
  })
  test("멤버는 관리자 기능을 못 써요", async () => {
    for (const [m, p] of [["GET", "/api/runs"], ["GET", "/api/ops"], ["GET", "/api/docs/search?q=x"], ["GET", "/api/access"], ["GET", "/api/mcp-tokens"], ["POST", "/api/act"], ["POST", "/api/spaces"], ["GET", "/api/boards/x/export"]] as const)
      expect((await call("bran@neuralarcade.ai", m, p, m === "POST" ? {} : undefined)).status).toBe(403)
    expect((await call("jun@lidgeai.com", "GET", "/api/access")).status).toBe(200)
    expect((await call("b@devfiance.ai", "GET", "/api/state")).json.me.role).toBe("member")
  })
})

describe("이슈 보내기", () => {
  test("멤버가 보내면 회사 공간 할 일 + 관리자 결정 칸 사건, 내 이슈에서 상태를 봐요", async () => {
    const sent = await call("bran@neuralarcade.ai", "POST", "/api/issues", issueForm("회의실 예약이 안 돼요", {}, [PNG]))
    expect(sent.status).toBe(201)
    const issue = sent.json.issue
    expect(issue.status).toBe("received"); expect(issue.files).toHaveLength(1); expect(issue.merged).toBe(false)
    const sig = (await call("jun@lidgeai.com", "GET", "/api/signals")).json.signals.find((x: any) => x.title === "이슈: 회의실 예약이 안 돼요")
    expect(sig.lane).toBe("decide"); expect(sig.space).toMatch(/^ws_/); expect(sig.body).toContain("bran@neuralarcade.ai")
    const state = await call("kim@neuralarcade.ai", "GET", "/api/state")
    expect(state.json.items.some((i: any) => i.text === "회의실 예약이 안 돼요" && i.space === sig.space)).toBe(true)
    // 같은 제목은 같은 할 일에 합쳐요
    const again = await call("kim@neuralarcade.ai", "POST", "/api/issues", issueForm("회의실 예약이 안 돼요!"))
    expect(again.json.issue.merged).toBe(true); expect(again.json.issue.itemRef).toBe(issue.itemRef)
    // 첨부: 보낸 사람·관리자만
    expect((await call("bran@neuralarcade.ai", "GET", issue.files[0].url)).headers.get("content-type")).toBe("image/png")
    expect((await call("jun@lidgeai.com", "GET", issue.files[0].url)).status).toBe(200)
    expect((await call("kim@neuralarcade.ai", "GET", issue.files[0].url)).status).toBe(404)
    // 상태: 멤버는 못 바꾸고, 관리자가 진행·끝으로
    expect((await call("bran@neuralarcade.ai", "PATCH", `/api/issues/${issue.id}`, { status: "done" })).status).toBe(403)
    expect((await call("jun@lidgeai.com", "PATCH", `/api/issues/${issue.id}`, { status: "in_progress" })).json.issue.status).toBe("in_progress")
    expect((await call("jun@lidgeai.com", "PATCH", `/api/issues/${issue.id}`, { status: "done" })).json.issue.status).toBe("done")
    const mine = await call("bran@neuralarcade.ai", "GET", "/api/issues")
    expect(mine.json.issues.map((i: any) => [i.title, i.status])).toEqual([["회의실 예약이 안 돼요", "done"]])
    expect((await call("kim@neuralarcade.ai", "GET", "/api/issues")).json.issues[0].status).toBe("done") // 합쳐진 이슈도 같은 할 일로 끝
    expect((await call("jun@lidgeai.com", "GET", "/api/issues?scope=all")).json.issues).toHaveLength(2)
  })
  test("거절: 이미지가 아닌 파일, 짧은 제목, 다른 사이트의 요청", async () => {
    expect((await call("bran@neuralarcade.ai", "POST", "/api/issues", issueForm("가짜 이미지", {}, [new TextEncoder().encode("<svg onload=alert(1)>")]))).status).toBe(415)
    expect((await call("bran@neuralarcade.ai", "POST", "/api/issues", issueForm("x"))).status).toBe(400)
    expect((await call("bran@neuralarcade.ai", "POST", "/api/issues", issueForm("다른 사이트에서"), { origin: "https://evil.example" })).status).toBe(403)
  })
  test("데이터는 이 인스턴스 폴더에만 생겨요", () => {
    expect(existsSync(join(s.dir, "board.db"))).toBe(true)
    expect(existsSync(join(s.dir, "uploads", "issues"))).toBe(true)
  })
})
