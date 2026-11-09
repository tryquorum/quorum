import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
process.env.ASIDE_ACCOUNT = "u_wp2_test_no_account"
const { initRuns, runsApi, updateTranscript } = await import("./runs.ts")
let db: Database
const timers: ReturnType<typeof setInterval>[] = []
const realInterval = globalThis.setInterval
const user = { email: "a", agent: false }
const events: any[] = []
const launches: any[] = []
const launch = (...args: any[]) => { launches.push(args) }
const post = (e: any) => { events.push(e) }
async function api(path: string, method = "GET", who = user, fn: any = launch, local = true, body?: unknown) {
  const url = new URL(`http://localhost${path}`)
  return (await runsApi(db, new Request(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), url, who, url.pathname.split("/").filter(Boolean), local, post, fn))!
}
function add(id: string, values: Record<string, any> = {}) {
  const row = { id, owner: "a", target: null, prompt: "question", provider: "aside", model: "gpt-6.1-sol", model_name: "Sol", effort: "high", status: "error", session_id: null, parent: null, thread: id, kind: "chat", created_at: 1, updated_at: 1, ...values }
  const keys = Object.keys(row)
  db.query(`INSERT INTO runs (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row))
}
beforeEach(() => {
  db = new Database(":memory:")
  db.exec("CREATE TABLE signals(id TEXT, owner TEXT, ref TEXT, task TEXT, lane TEXT, status TEXT, reason TEXT, title TEXT, body TEXT, agent TEXT, updated_at INTEGER, resolved_at INTEGER)")
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const t = realInterval(...args); timers.push(t); return t }) as typeof setInterval
  initRuns(db)
  events.length = 0; launches.length = 0
})
afterEach(() => { globalThis.setInterval = realInterval; for (const t of timers.splice(0)) clearInterval(t); db.close() })

describe("runs", () => {
  test("migration interrupts only running and creates nullable columns and unique retry index", () => {
    add("r", {status:"running"}); add("old", {status:"done"})
    initRuns(db)
    const r = db.query("SELECT * FROM runs WHERE id='r'").get() as any
    expect([r.status, r.error_kind]).toEqual(["error", "interrupted"])
    expect(r.finished_at).toBe(r.last_activity_at)
    expect((db.query("SELECT last_activity_at FROM runs WHERE id='old'").get() as any).last_activity_at).toBeNull()
    add("child", {retry_of:"r"})
    expect(() => add("child2", {retry_of:"r"})).toThrow()
  })
  test("transcript activity changes only when answer or steps change and never after stop", () => {
    add("r", {status:"running", last_activity_at:1})
    updateTranscript(db, "r", "answer", [{tool:"search",arg:"a"}])
    const first = (db.query("SELECT last_activity_at FROM runs WHERE id='r'").get() as any).last_activity_at
    expect(first).toBeGreaterThan(1)
    db.query("UPDATE runs SET last_activity_at=2 WHERE id='r'").run()
    updateTranscript(db, "r", "answer", [{tool:"search",arg:"a"}])
    expect((db.query("SELECT last_activity_at FROM runs WHERE id='r'").get() as any).last_activity_at).toBe(2)
    updateTranscript(db, "r", "answer", [{tool:"search",arg:"b"}])
    expect((db.query("SELECT last_activity_at FROM runs WHERE id='r'").get() as any).last_activity_at).toBeGreaterThan(2)
    db.query("UPDATE runs SET status='stopped', last_activity_at=3 WHERE id='r'").run()
    updateTranscript(db, "r", "new", [])
    expect((db.query("SELECT last_activity_at FROM runs WHERE id='r'").get() as any).last_activity_at).toBe(3)
  })
  test("retry creates a new session; duplicates return existing run", async () => {
    add("root", {status:"stopped", parent:"older", session_id:"old-session", prompt:"last question"})
    const res = await api("/api/runs/root/retry", "POST")
    expect(res.status).toBe(201)
    const row = await res.json() as any
    expect([row.retry_of,row.parent,row.session_id,row.thread,row.prompt]).toEqual(["root",null,null,row.id,"last question"])
    expect(row.last_activity_at).toBe(row.created_at)
    expect(launches[0][2][0]).toBe("exec")
    expect(launches[0][2].at(-1)).toContain("last question")
    const duplicate = await api("/api/runs/root/retry", "POST")
    expect(duplicate.status).toBe(409)
    expect((await duplicate.json() as any).run.id).toBe(row.id)
  })
  test("new chat and retry prompts always use the configured local origin", async () => {
    const invoke = async (path: string, body?: unknown) => {
      const url = new URL(`https://attacker.example${path}`)
      return (await runsApi(db, new Request(url, {method: "POST", body: JSON.stringify(body || {})}), url, user,
        url.pathname.split("/").filter(Boolean), true, post, launch, "http://127.0.0.1:45678"))!
    }
    expect((await invoke("/api/runs", {prompt: "hello"})).status).toBe(201)
    add("original")
    expect((await invoke("/api/runs/original/retry")).status).toBe(201)
    for (const entry of launches) {
      const prompt = entry[2].at(-1)
      expect(prompt).toContain("http://127.0.0.1:45678/api/act")
      expect(prompt).not.toContain("attacker.example")
    }
  })
  // PR #39 리뷰 7 규칙 B: 앱이 먼저 기록한 clientKey 로 결과를 모른 채 다시 보내도 대화·초안 실행은 하나만
  test("chat and draft runs with the same clientKey start once; a different request with that key is 409", async () => {
    const first = await api("/api/runs", "POST", user, launch, true, { prompt: "초안 써 줘", kind: "draft", clientKey: "k-draft-1" })
    expect(first.status).toBe(201)
    const run = (await first.json()) as { id: string }
    const again = await api("/api/runs", "POST", user, launch, true, { prompt: "초안 써 줘", kind: "draft", clientKey: "k-draft-1" })
    expect(again.status).toBe(200)
    expect(((await again.json()) as { id: string }).id).toBe(run.id)
    expect(launches.length).toBe(1)
    expect((await api("/api/runs", "POST", user, launch, true, { prompt: "다른 질문", clientKey: "k-draft-1" })).status).toBe(409)
    const plain = await api("/api/runs", "POST", user, launch, true, { prompt: "키 없는 질문" })
    expect(plain.status).toBe(201)
    expect(launches.length).toBe(2)
  })
  // PR #39 리뷰 8: 같은 키 다시 확인은 모델·로그인 검사보다 먼저(모델이 빠졌어도 그 실행), 키로 실행이 있는지 읽을 수 있어요
  test("a clientKey retry returns the existing run even when its model is gone; GET ?clientKey finds it", async () => {
    const first = await api("/api/runs", "POST", user, launch, true, { prompt: "모델 바뀐 뒤", kind: "draft", clientKey: "k-model-1" })
    expect(first.status).toBe(201)
    const run = (await first.json()) as { id: string }
    const again = await api("/api/runs", "POST", user, launch, true, { prompt: "모델 바뀐 뒤", kind: "draft", clientKey: "k-model-1", provider: "aside", model: "removed-model" })
    expect(again.status).toBe(200)
    expect(((await again.json()) as { id: string }).id).toBe(run.id)
    const found = (await (await api("/api/runs?clientKey=k-model-1")).json()) as { runs: { id: string }[] }
    expect(found.runs.map((r) => r.id)).toEqual([run.id])
    expect(((await (await api("/api/runs?clientKey=none")).json()) as { runs: unknown[] }).runs).toEqual([])
  })
  // PR #39 리뷰 9: AI 정리도 같은 키 조회가 모델 검사보다 먼저(사람이 누른 "다시 보내기"가 모델이 바뀐 뒤 와도 그 실행)
  test("a capture clientKey resend returns the existing run even when its model is gone", async () => {
    db.exec("CREATE TABLE IF NOT EXISTS boards(meta TEXT, kind TEXT, owner TEXT, deleted INTEGER)")
    const first = await api("/api/runs", "POST", user, launch, true, { kind: "capture", prompt: "정리해 줘", clientKey: "k-cap-1" })
    expect(first.status).toBe(201)
    const run = (await first.json()) as { id: string }
    const again = await api("/api/runs", "POST", user, launch, true, { kind: "capture", prompt: "정리해 줘", clientKey: "k-cap-1", provider: "aside", model: "removed-model" })
    expect(again.status).toBe(200)
    expect(((await again.json()) as { id: string }).id).toBe(run.id)
    expect((await api("/api/runs", "POST", user, launch, true, { kind: "capture", prompt: "다른 글", clientKey: "k-cap-1", model: "removed-model" })).status).toBe(409)
  })
  test("simultaneous retries have one child", async () => {
    add("root")
    const results = await Promise.all([api("/api/runs/root/retry","POST"),api("/api/runs/root/retry","POST")])
    expect(results.map(r => r.status).sort()).toEqual([201,409])
    expect(launches).toHaveLength(1)
  })
  test("synchronous spawn failure creates an error child and safe signal", async () => {
    add("root")
    const res = await api("/api/runs/root/retry","POST",user,() => { throw new Error("spawn ENOENT secret") })
    const row = await res.json() as any
    expect(res.status).toBe(201); expect(row.status).toBe("error"); expect(row.error_kind).toBe("launch")
    expect(events.at(-1).body).not.toContain("secret")
    expect((await api(`/api/runs/${row.id}/retry`,"POST")).status).toBe(201)
  })
  test("retry checks access, status, kind and model", async () => {
    add("r",{status:"running"}); add("s",{kind:"sweep"}); add("bad",{model:"removed-model"}); add("other",{owner:"b"})
    expect((await api("/api/runs/r/retry","POST")).status).toBe(409)
    expect((await api("/api/runs/s/retry","POST")).status).toBe(400)
    expect((await api("/api/runs/bad/retry","POST")).status).toBe(400)
    expect((await api("/api/runs/other/retry","POST")).status).toBe(404)
    expect((await api("/api/runs/r/retry","POST",{...user,agent:true})).status).toBe(403)
    expect((await api("/api/runs/r/retry","POST",user,launch,false)).status).toBe(403)
  })
  test("draft retry is quiet", async () => {
    add("r", {kind:"draft"})
    expect((await api("/api/runs/r/retry","POST")).status).toBe(201)
    expect(launches[0][6]).toBe(true); expect(events).toHaveLength(0)
  })
  test("thread listing sorts ties, uses first metadata and limits", async () => {
    add("a",{thread:"a",prompt:"first\nsecond",created_at:1,target:"t"}); add("b",{thread:"a",created_at:2,status:"done"}); add("c",{thread:null,created_at:2}); add("z",{owner:"b",created_at:9})
    const all = await (await api("/api/runs/threads?limit=1")).json() as any
    expect(all.threads.map((x:any) => x.id)).toEqual(["c"])
    const list = await (await api("/api/runs/threads?limit=no")).json() as any
    expect(list.threads.map((x:any) => x.id)).toEqual(["c","a"])
    expect(list.threads[1]).toMatchObject({first:"first",count:2,last_status:"done",target:"t"})
  })
  test("thread retrieves newest 500 in stable order and isolates owners", async () => {
    for (let i=0;i<501;i++) add(`x${String(i).padStart(3,"0")}`,{thread:"root",created_at:1,target:"t"})
    add("foreign",{owner:"b",thread:"secret"})
    const result = await (await api("/api/runs?thread=root&target=unused")).json() as any
    expect(result.runs).toHaveLength(500); expect(result.truncated).toBe(true)
    expect(result.runs[0].id).toBe("x001"); expect(result.runs.at(-1).id).toBe("x500")
    expect((await api("/api/runs?thread=secret")).status).toBe(404)
    expect((await api("/api/runs?thread=none")).status).toBe(404)
    const target = await (await api("/api/runs?target=t")).json() as any
    expect(target.runs).toHaveLength(300); expect(target.runs[0].id).toBe("x201")
  })
  test("root with null thread is retrievable and stop rejects finished rows", async () => {
    add("root",{thread:null})
    expect((await api("/api/runs?thread=root")).status).toBe(200)
    expect((await api("/api/runs/root/stop","POST")).status).toBe(409)
    expect(events).toHaveLength(0)
  })
})
