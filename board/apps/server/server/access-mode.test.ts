// 파일럿이 아닐 때(개인 방향판, Access 모드) 지금 동작이 그대로인지: 회사 판·공간 없는 항목·AGENT_TOKEN·사건 목록·MCP
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { mcpCall, startIsolated, type Isolated } from "./test/isolated.ts"

let s: Isolated
beforeAll(async () => { s = await startIsolated() }, 20000)
afterAll(async () => { await s?.stop() })
const local = (method: string, path: string, body?: unknown) => fetch(s.local + path, { method, headers: { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })

test("Access 모드: 회사 판과 그 판의 공간 없는 항목, 개인 공간 항목이 모두 그대로 보이고 바뀌지 않아요", async () => {
  const company = await (await local("POST", "/api/boards", { name: "회사 판", kind: "company" })).json() as { id: string }
  const d = new Database(join(s.dir, "board.db"))
  d.query("INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq) VALUES (?,?,?,?,?,0,?)").run(company.id, "nullsp0001", JSON.stringify({ type: "todo", text: "공간 없는 회사 판 항목", x: 0, y: 0, w: 1, h: 1 }), "x", Date.now(), 999999)
  d.close()
  const made = await (await local("POST", `/api/boards/${company.id}/items`, { type: "todo", text: "회사 판 개인 공간", x: 0, y: 0, w: 1, h: 1, space: "personal" })).json() as { space: string }
  expect(made.space).toBe("personal")
  const st = await (await local("GET", "/api/state")).json() as { boards: { kind: string }[]; items: { text: string; space: string }[]; me: Record<string, unknown> }
  expect(st.boards.map((b) => b.kind).sort()).toEqual(["company", "personal"])
  expect(st.items.find((i) => i.text === "공간 없는 회사 판 항목")?.space).toBe("personal")
  expect(st.me.role).toBeUndefined()
  const d2 = new Database(join(s.dir, "board.db"))
  expect((d2.query("SELECT space FROM items WHERE id='nullsp0001'").get() as { space: string | null }).space).toBeNull() // 백필하지 않아요
  d2.close()
})
test("Access 모드: AGENT_TOKEN 이 REST 와 MCP 에서 그대로 통하고, 사건 목록은 걸러지지 않아요", async () => {
  const bearer = { authorization: "Bearer test-agent-token" }
  expect((await fetch(`${s.local}/api/state`, { headers: bearer })).status).toBe(200)
  expect((await mcpCall(s.local, "tools/list", bearer)).status).toBe(200)
  // 로컬 개발자(DEV_LOCAL_USER)의 무인증 로컬 REST·MCP 도 그대로예요(파일럿에서만 꺼요)
  expect((await fetch(`${s.local}/api/state`)).status).toBe(200)
  expect((await mcpCall(s.local, "tools/list")).status).toBe(200)
  expect((await fetch(`${s.local}/api/ops`)).status).toBe(200)
  await local("POST", "/api/signals", { kind: "info", title: "개인 사건 하나", source: "gmail", private: true })
  expect(await (await local("GET", "/api/signals")).text()).toContain("개인 사건 하나")
})

describe("Access 모드 할 일 기록 합치기(리뷰 4)", () => {
  let mine = ""
  const put = (iid: string, body: Record<string, unknown>) => local("PUT", `/api/boards/${mine}/items/${iid}`, { type: "todo", text: "기록 시험", x: 0, y: 0, w: 1, h: 1, ...body })
  const logOf = async (iid: string) => ((await (await local("GET", "/api/state")).json()) as { items: { id: string; log?: { by: string; at: number; text: string }[] }[] }).items.find((i) => i.id === iid)?.log ?? []
  beforeAll(async () => { mine = ((await (await local("GET", "/api/state")).json()) as { boards: { id: string; kind: string; mine: boolean }[] }).boards.find((b) => b.kind === "personal" && b.mine)!.id })
  test("구분자가 섞인 두 기록(by·text 에 |)은 서로 덮지 않고 둘 다 남아요", async () => {
    const x = { by: "a|b", at: 1, text: "c" }, y = { by: "a", at: 1, text: "b|c" }
    expect((await put("sepcollide1", { log: [x] })).status).toBe(200)
    expect((await put("sepcollide1", { log: [y] })).status).toBe(200)
    const log = await logOf("sepcollide1")
    expect(log.filter((e) => e.by === "a|b" && e.text === "c")).toHaveLength(1)
    expect(log.filter((e) => e.by === "a" && e.text === "b|c")).toHaveLength(1)
  })
  test("같은 값의 기록 두 개는 화면이 하나만 보내도 둘 다 남아요(다중집합)", async () => {
    const e = { by: "jun@lidgeai.com", at: 5, text: "같은 기록" }
    expect((await put("dupkeep001", { log: [e, e] })).status).toBe(200)
    expect((await put("dupkeep001", { log: [e] })).status).toBe(200)
    expect((await logOf("dupkeep001")).filter((x) => x.text === "같은 기록")).toHaveLength(2)
  })
  test("옛 보드처럼 최근 80개만 잘라 새 기록과 PUT 해도 서버의 기존 사람 기록은 모두 남아요", async () => {
    const old = Array.from({ length: 85 }, (_, i) => ({ by: "jun@lidgeai.com", at: 100 + i, text: `옛 기록 OLDQ${i}` }))
    expect((await put("oldboard01", { log: old })).status).toBe(200)
    const sent = [...(await logOf("oldboard01")).slice(-80), { by: "jun@lidgeai.com", at: 999, text: "새 기록 NEWQ" }]
    expect((await put("oldboard01", { log: sent })).status).toBe(200)
    const texts = (await logOf("oldboard01")).map((x) => x.text)
    for (let i = 0; i < 85; i++) expect(texts).toContain(`옛 기록 OLDQ${i}`)
    expect(texts).toContain("새 기록 NEWQ")
    // 개인 방향판은 보낸 by·at 을 그대로 두고 한 번에 넣는 기록 수에도 상한이 없어요(파일럿 정책은 켜지지 않음)
    const log = await logOf("oldboard01")
    expect(log.find((x) => x.text === "옛 기록 OLDQ0")?.at).toBe(100)
    expect(log.find((x) => x.text === "새 기록 NEWQ")?.at).toBe(999)
  })
  test("개인 방향판에는 사람 기록 1000개 한도가 없어요: 1000개 넘는 일에도 /log·새 기록 PUT·문서 메타가 200 이고 기존 기록은 그대로예요", async () => {
    const human = Array.from({ length: 1001 }, (_, i) => ({ by: "jun@lidgeai.com", at: 100 + i, text: `기록 ${i}` }))
    expect((await put("human1001p", { log: human })).status).toBe(200)
    expect((await local("POST", `/api/boards/${mine}/items/human1001p/log`, { text: "로그 추가 LOGQ" })).status).toBe(200)
    const cur = await logOf("human1001p")
    expect((await put("human1001p", { log: [...cur, { by: "jun@lidgeai.com", at: 5000, text: "PUT 추가 PUTQ" }] })).status).toBe(200)
    const ref = `item:${mine}:human1001p`
    expect((await local("PUT", `/api/work/${encodeURIComponent(ref)}/note`, { html: "<p>메모</p>", text: "메모", md: "메모" })).status).toBe(200)
    expect((await local("PATCH", `/api/docs/${encodeURIComponent(ref)}/meta`, { title: "메타 바꿈 METAP" })).status).toBe(200)
    const log = await logOf("human1001p")
    const texts = log.map((x) => x.text)
    for (let i = 0; i < 1001; i++) expect(texts[i]).toBe(`기록 ${i}`)
    expect(texts).toContain("로그 추가 LOGQ"); expect(texts).toContain("PUT 추가 PUTQ")
  })
  test("사람 기록 80개인 할 일에도 AI 의 끝냄 기록(why)은 남아요", async () => {
    const human = Array.from({ length: 80 }, (_, i) => ({ by: "jun@lidgeai.com", at: 100 + i, text: `사람 ${i}` }))
    expect((await put("human80act", { log: human })).status).toBe(200)
    const r = await (await local("POST", "/api/act", { actions: [{ do: "done", ref: `item:${mine}:human80act`, why: "AI 가 끝냄 WHYQ" }] })).json() as { results: { ok: boolean }[] }
    expect(r.results[0].ok).toBe(true)
    const log = await logOf("human80act")
    expect(log.map((x) => x.text)).toContain("AI 가 끝냄 WHYQ")
    expect(log.filter((x) => x.by !== "agent")).toHaveLength(80)
  })
})
