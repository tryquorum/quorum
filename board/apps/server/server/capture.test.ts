import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
process.env.ASIDE_ACCOUNT = "u_capture_test_no_account"
const { initRuns, runsApi } = await import("./runs.ts")
const { initSignals, ingest } = await import("./signals.ts")
const { initWorks } = await import("./works.ts")
const { initDocs, stopDocsRefresh } = await import("./docs/storage.ts")
const { createDocsOps } = await import("./docs/ops.ts")
const { actionsApi, runActions } = await import("./actions.ts")
const { putNote } = await import("./docs/document.ts")
const { reindexRef } = await import("./docs/index.ts")

type Row = Record<string, unknown>
let db: Database
const timers: ReturnType<typeof setInterval>[] = []
const realInterval = globalThis.setInterval
const launches: unknown[][] = []
const events: Row[] = []
const launch = (...args: unknown[]) => { launches.push(args) }
const person = { email: "a", agent: false }
const AREAS = [{ id: "ar1", name: "업무", color: "#000000" }]

function logEvent(bid: string, iid: string, op: string, actor: string) {
  return Number(db.query("INSERT INTO events(board_id,item_id,op,actor,at) VALUES (?,?,?,?,?)").run(bid, iid, op, actor, Date.now()).lastInsertRowid)
}
function readItem(bid: string, iid: string) {
  const r = db.query("SELECT data FROM items WHERE board_id=? AND id=? AND deleted=0").get(bid, iid) as { data: string } | null
  return r ? { data: JSON.parse(r.data) as Record<string, unknown> } : null
}
function putItem(bid: string, iid: string, data: Record<string, unknown>, actor: string) {
  const seq = logEvent(bid, iid, "item.upsert", actor)
  db.query("INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq) VALUES (?,?,?,?,?,0,?) ON CONFLICT(board_id,id) DO UPDATE SET data=excluded.data, by=excluded.by, updated_at=excluded.updated_at, deleted=0, seq=excluded.seq")
    .run(bid, iid, JSON.stringify(data), actor, Date.now(), seq)
}
const deps = {
  personalBoard: (o: string) => (o === "a" ? { id: "pb", areas: AREAS } : null),
  readItem, putItem,
  ingest: (o: string, raw: Record<string, unknown>) => ingest(db, o, raw, true),
}
const captureDeps = {
  archiveItem: (bid: string, iid: string, actor: string) => {
    const seq = logEvent(bid, iid, "item.delete", actor)
    db.query("UPDATE items SET deleted=1, updated_at=?, by=?, seq=? WHERE board_id=? AND id=?").run(Date.now(), actor, seq, bid, iid)
  },
}
async function runs(path: string, method = "GET", body?: unknown, who = person, macOwner = true) {
  const url = new URL(`http://localhost${path}`)
  const res = await runsApi(db, new Request(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), url, who, url.pathname.split("/").filter(Boolean), macOwner, (e: Row) => { events.push(e) }, launch, "http://127.0.0.1:45678", captureDeps)
  return res!
}
async function act(actions: unknown[], run: string, who = person, local = true) {
  const res = await actionsApi(db, new Request(`http://127.0.0.1:45678/api/act?run=${run}`, { method: "POST", body: JSON.stringify({ actions }) }), ["api", "act"], who, local, deps)
  return { status: res!.status, body: (await res!.json()) as { results: Row[]; error?: string } }
}
async function start(prompt = "겜스고 연장 어떻게 할지 처리", extra: Row = {}) {
  const res = await runs("/api/runs", "POST", { kind: "capture", prompt, clientKey: crypto.randomUUID(), ...extra })
  return { status: res.status, run: (await res.json()) as Row }
}
const effects = async (id: string) => (await (await runs(`/api/runs/${id}/effects`)).json()) as { effects: Row[]; runs: string[]; run: Row }

beforeEach(() => {
  db = new Database(":memory:")
  db.exec(`CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT, board_id TEXT, item_id TEXT, op TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT);
    CREATE TABLE boards(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, owner TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL, meta TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE items(board_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, by TEXT, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL, PRIMARY KEY(board_id, id));`)
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const t = realInterval(...args); timers.push(t); return t }) as typeof setInterval
  initSignals(db); initRuns(db); initWorks(db); initDocs(db)
  db.query("INSERT INTO boards(id,name,kind,owner,created_at,updated_at,deleted,seq,meta) VALUES ('pb','개인','personal','a',1,1,0,1,?)").run(JSON.stringify({ areas: AREAS }))
  launches.length = 0; events.length = 0
})
afterEach(() => { globalThis.setInterval = realInterval; for (const t of timers.splice(0)) clearInterval(t); stopDocsRefresh(db); db.close() })

describe("capture start", () => {
  test("starts a capture run with guide, hints, page and a run-bound act address", async () => {
    const { status, run } = await start("겜스고 연장 어떻게 할지 처리", { hints: { area: "업무", at: "2026-11-10", tags: ["구독"], type: "todo", props: [{ key: "금액", type: "number", value: "9900" }] }, page: { view: "home" } })
    expect(status).toBe(201)
    expect([run.kind, run.status, run.prompt, run.parent]).toEqual(["capture", "running", "겜스고 연장 어떻게 할지 처리", null])
    const args = launches[0][2] as string[]
    expect(args[0]).toBe("exec")
    const prompt = args.at(-1)!
    for (const want of [`http://127.0.0.1:45678/api/act?run=${run.id}`, "/api/work/search", "/api/docs/search", "겜스고 연장 어떻게 할지 처리", "업무", "2026-11-10", "구독", "금액", "decide", "확인 필요"]) expect(prompt).toContain(want)
    expect(events.some((e) => e.kind === "start" && e.ref === `run:${run.id}`)).toBe(true)
  })
  test("same client key returns the same run; same key with other text is refused", async () => {
    const first = await runs("/api/runs", "POST", { kind: "capture", prompt: "같은 글 다시 보내기", clientKey: "k1" })
    expect(first.status).toBe(201)
    const id = ((await first.json()) as Row).id
    const again = await runs("/api/runs", "POST", { kind: "capture", prompt: "같은 글 다시 보내기", clientKey: "k1" })
    expect(again.status).toBe(200)
    expect(((await again.json()) as Row).id).toBe(id)
    expect((await runs("/api/runs", "POST", { kind: "capture", prompt: "전혀 다른 글이에요", clientKey: "k1" })).status).toBe(409)
    expect(launches).toHaveLength(1)
  })
  test("same text while running or just done is refused with the run; failed text can be sent again", async () => {
    const { run } = await start("겜스고 연장 어떻게 할지 처리")
    const dup = await start("  겜스고 연장, 어떻게 할지 처리!  ")
    expect(dup.status).toBe(409)
    expect((dup.run.run as Row).id).toBe(run.id)
    db.query("UPDATE runs SET status='done' WHERE id=?").run(run.id as string)
    expect((await start("겜스고 연장 어떻게 할지 처리")).status).toBe(409)
    db.query("UPDATE runs SET status='error' WHERE id=?").run(run.id as string)
    expect((await start("겜스고 연장 어떻게 할지 처리")).status).toBe(201)
  })
  test("two simultaneous submissions of the same text start one run", async () => {
    const both = await Promise.all([start("동시에 두 번 누른 글"), start("동시에 두 번 누른 글")])
    expect(both.map((x) => x.status).sort()).toEqual([201, 409])
    expect(launches).toHaveLength(1)
  })
  test("only a person on the Mac owner path can start; no parent; text required", async () => {
    expect((await runs("/api/runs", "POST", { kind: "capture", prompt: "x 글 하나", clientKey: "a" }, { email: "a", agent: true })).status).toBe(403)
    expect((await runs("/api/runs", "POST", { kind: "capture", prompt: "x 글 하나", clientKey: "b" }, person, false)).status).toBe(403)
    expect((await runs("/api/runs", "POST", { kind: "capture", prompt: "x 글 하나", clientKey: "c", parent: "p" })).status).toBe(400)
    expect((await runs("/api/runs", "POST", { kind: "capture", prompt: "  ", clientKey: "d" })).status).toBe(400)
    expect(launches).toHaveLength(0)
  })
})

describe("run-bound act", () => {
  test("records created, merged and decision effects with provenance, tag and link", async () => {
    putItem("pb", "h1", { type: "todo", text: "겜스고 연장 방법 알아보기", done: false }, "a")
    db.query("INSERT INTO triage_rules(id,owner,source,kind,contains,lane,note,created_at) VALUES ('r1','a','aside',NULL,NULL,'info','조용히',1)").run()
    const { run } = await start()
    const { status, body } = await act([
      { do: "task", title: "겜스고 구독 만료일 확인하기", note: "## 상황\n메일에서 만료일 확인", area: "업무", tags: ["구독"], remindAt: "2026-11-10T09:00" },
      { do: "task", title: "겜스고 연장 방법 알아보기", note: "## 근거\n결제 페이지 링크" },
      { do: "decide", title: "겜스고 연장할지 정하기", body: "1년 / 해지", link: "item:pb:h1" },
    ], run.id as string)
    expect(status).toBe(200)
    expect(body.results.map((r) => r.ok)).toEqual([true, true, true])
    const created = body.results[0].ref as string
    const item = readItem("pb", created.split(":")[2])!.data
    expect([item.capture, item.agent, item.area, item.remindAt]).toEqual([run.id, true, "ar1", "2026-11-10T09:00"])
    const tags = (db.query("SELECT tag FROM doc_tag_sources WHERE owner='a' AND ref=? AND by='agent' ORDER BY tag").all(created) as { tag: string }[]).map((t) => t.tag)
    expect(tags).toEqual(["ai-추가", "구독"])
    expect(db.query("SELECT 1 FROM work_links WHERE owner='a' AND ((a=? AND b=?) OR (a=? AND b=?))").get(created, `run:${run.id}`, `run:${run.id}`, created)).toBeTruthy()
    const sig = db.query("SELECT lane, status, title FROM signals WHERE ref LIKE 'decide:%'").get() as Row
    expect([sig.lane, sig.status, sig.title]).toEqual(["decide", "open", "겜스고 연장할지 정하기"])
    const e = await effects(run.id as string)
    const ops = Object.fromEntries(e.effects.map((x) => [x.ref, [x.op, x.undoable]]))
    expect(ops[created]).toEqual(["created", true])
    expect(ops["item:pb:h1"]).toEqual(["merged", false])
    expect(Object.values(ops)).toContainEqual(["decision", true])
  })
  test("refuses agent tokens, remote listeners, other owners and finished runs without writing", async () => {
    const { run } = await start()
    const task = [{ do: "task", title: "쓰면 안 되는 할 일", note: "열 글자 넘는 노트예요" }]
    expect((await act(task, run.id as string, { email: "a", agent: true })).status).toBe(403)
    expect((await act(task, run.id as string, person, false)).status).toBe(403)
    expect((await act(task, run.id as string, { email: "b", agent: false })).status).toBe(404)
    expect((await act(task, "nope")).status).toBe(404)
    db.query("UPDATE runs SET status='stopped' WHERE id=?").run(run.id as string)
    expect((await act(task, run.id as string)).status).toBe(409)
    const other = await start("서버가 다시 시작된 경우")
    initRuns(db)
    expect((db.query("SELECT error_kind FROM runs WHERE id=?").get(other.run.id as string) as Row).error_kind).toBe("interrupted")
    expect((await act(task, other.run.id as string)).status).toBe(409)
    expect(db.query("SELECT count(*) AS n FROM items WHERE data LIKE '%쓰면 안 되는%'").get()).toEqual({ n: 0 })
  })
  test("an action whose effect cannot be recorded is rolled back", async () => {
    const { run } = await start()
    db.exec("DROP TABLE run_effects")
    const { body } = await act([{ do: "task", title: "기록 못 하는 할 일", note: "열 글자 넘는 노트예요" }], run.id as string)
    expect(body.results[0].ok).toBe(false)
    expect(db.query("SELECT count(*) AS n FROM items WHERE data LIKE '%기록 못 하는%'").get()).toEqual({ n: 0 })
    expect(db.query("SELECT count(*) AS n FROM work_notes WHERE text LIKE '%열 글자%'").get()).toEqual({ n: 0 })
  })
  test("decide reuses the same open question and refuses one already decided", () => {
    const one = runActions(db, "a", [{ do: "decide", title: "겜스고 연장할지 정하기" }], deps).results[0]
    const two = runActions(db, "a", [{ do: "decide", title: "겜스고 연장할지 정하기!", body: "새 근거" }], deps).results[0]
    expect([one.ok, two.ok, two.ref, two.existing]).toEqual([true, true, one.ref, true])
    db.query("UPDATE signals SET status='resolved' WHERE id=?").run((one.ref as string).slice(7))
    expect(runActions(db, "a", [{ do: "decide", title: "겜스고 연장할지 정하기" }], deps).results[0].ok).toBe(false)
    expect(runActions(db, "a", [{ do: "decide", title: "결정" }], { ...deps, ingest: undefined }).results[0].ok).toBe(false)
  })
  test("MCP board_act path can raise a decision", () => {
    const ops = createDocsOps(db, { act: (o, a) => runActions(db, o, a, deps), items: { readItem, putItem } })
    const r = ops.act("a", [{ do: "decide", title: "MCP 로 올린 결정 질문" }]).results[0]
    expect(r.ok).toBe(true)
    expect((db.query("SELECT lane FROM signals WHERE id=?").get((r.ref as string).slice(7)) as Row).lane).toBe("decide")
  })
})

describe("undo", () => {
  async function made(title: string) {
    const { run } = await start(`${title} 정리해 줘`)
    const { body } = await act([{ do: "task", title, note: "열 글자 넘는 노트예요" }], run.id as string)
    return { run: run.id as string, ref: body.results[0].ref as string }
  }
  const undo = (run: string, ref: string, who = person) => runs(`/api/runs/${run}/undo`, "POST", { ref }, who)
  test("archives an untouched AI item once", async () => {
    const { run, ref } = await made("되돌릴 할 일 하나")
    expect((await undo(run, ref, { email: "a", agent: true })).status).toBe(403)
    expect((await undo(run, ref)).status).toBe(200)
    expect(db.query("SELECT deleted FROM items WHERE id=?").get(ref.split(":")[2])).toEqual({ deleted: 1 })
    expect((await undo(run, ref)).status).toBe(409)
    const e = (await effects(run)).effects.find((x) => x.ref === ref)!
    expect([e.now, e.undone, e.undoable]).toEqual([null, true, false])
  })
  test("keeps items a person or another writer changed afterwards", async () => {
    const a = await made("사람이 고친 할 일")
    putItem("pb", a.ref.split(":")[2], { ...readItem("pb", a.ref.split(":")[2])!.data, text: "사람이 고친 제목" }, "a")
    putItem("pb", a.ref.split(":")[2], { ...readItem("pb", a.ref.split(":")[2])!.data }, "agent")
    expect((await undo(a.run, a.ref)).status).toBe(409)
    const b = await made("노트를 고친 할 일")
    putNote(db, "a", b.ref, { html: "<p>사람 글</p>", text: "사람 글", md: "사람 글" }, "person")
    expect((await undo(b.run, b.ref)).status).toBe(409)
    const c = await made("태그를 단 할 일")
    createDocsOps(db, { act: (o, x) => runActions(db, o, x, deps), items: { readItem, putItem } }).tag("a", c.ref, { add: ["내가-단"] }, "person")
    expect((await undo(c.run, c.ref)).status).toBe(409)
    for (const x of [a, b, c]) expect(db.query("SELECT deleted FROM items WHERE id=?").get(x.ref.split(":")[2])).toEqual({ deleted: 0 })
  })
  test("closes an untouched decision and refuses merged items", async () => {
    putItem("pb", "h2", { type: "todo", text: "이미 있던 사람 할 일", done: false }, "a")
    const { run } = await start()
    const { body } = await act([{ do: "decide", title: "되돌릴 결정 질문" }, { do: "note", ref: "item:pb:h2", md: "AI가 덧붙인 근거" }], run.id as string)
    expect((await undo(run.id as string, body.results[0].ref as string)).status).toBe(200)
    expect((db.query("SELECT status FROM signals WHERE id=?").get((body.results[0].ref as string).slice(7)) as Row).status).toBe("resolved")
    expect((await undo(run.id as string, "item:pb:h2")).status).toBe(409)
  })
})

describe("retry", () => {
  test("retry of a failed capture tells the AI what was already added and shares effects", async () => {
    const { run } = await start("반쯤 하다 실패한 정리")
    await act([{ do: "task", title: "앞 시도에서 만든 할 일", note: "열 글자 넘는 노트예요" }], run.id as string)
    db.query("UPDATE runs SET status='error', error_kind='rate_limit' WHERE id=?").run(run.id as string)
    ingest(db, "a", { ref: `run:${run.id}`, source: "aside", kind: "error", ai_fixable: false, title: "실행이 실패했어요: 반쯤 하다 실패한 정리" }, true)
    const res = await runs(`/api/runs/${run.id}/retry`, "POST")
    expect(res.status).toBe(201)
    expect(db.query("SELECT lane, status FROM signals WHERE ref=?").get(`run:${run.id}`)).toEqual({ lane: "info", status: "resolved" })
    const next = (await res.json()) as Row
    expect(next.kind).toBe("capture")
    const prompt = (launches.at(-1)![2] as string[]).at(-1)!
    expect(prompt).toContain(`/api/act?run=${next.id}`)
    expect(prompt).toContain("앞 시도에서 만든 할 일")
    const e = await effects(next.id as string)
    expect(e.runs).toEqual([next.id as string, run.id as string])
    expect(e.effects.map((x) => x.title)).toContain("앞 시도에서 만든 할 일")
  })
})


describe("final audit regressions", () => {
  const undo = (run: string, ref: string) => runs(`/api/runs/${run}/undo`, "POST", { ref })
  test("a person's edit stays protected even if the same run writes the item again", async () => {
    const { run } = await start("사람 수정 뒤 같은 실행이 또 쓰는 경우")
    const ref = (await act([{ do: "task", title: "같은 실행이 다시 덧붙일 할 일", note: "열 글자 넘는 노트예요" }], run.id as string)).body.results[0].ref as string
    const iid = ref.split(":")[2]
    putItem("pb", iid, { ...readItem("pb", iid)!.data, text: "사람이 바꾼 제목" }, "a")
    expect((await act([{ do: "note", ref, md: "같은 실행이 나중에 붙인 근거" }], run.id as string)).body.results[0].ok).toBe(true)
    expect((await undo(run.id as string, ref)).status).toBe(409)
    expect(db.query("SELECT deleted FROM items WHERE id=?").get(iid)).toEqual({ deleted: 0 })
  })
  test("reusing a decision that already existed is not undoable", async () => {
    const before = runActions(db, "a", [{ do: "decide", title: "이미 열려 있던 결정 질문" }], deps).results[0]
    const { run } = await start("기존 결정을 다시 쓰는 정리")
    const r = (await act([{ do: "decide", title: "이미 열려 있던 결정 질문", body: "새 근거" }], run.id as string)).body.results[0]
    expect(r.ref).toBe(before.ref)
    const e = (await effects(run.id as string)).effects.find((x) => x.ref === r.ref)!
    expect(e.undoable).toBe(false)
    expect((await undo(run.id as string, r.ref as string)).status).toBe(409)
    expect((db.query("SELECT status FROM signals WHERE id=?").get((r.ref as string).slice(7)) as Row).status).toBe("open")
  })
  test("the same run renaming its own item, then the docs index catching up, keeps it undoable", async () => {
    const { run } = await start("스스로 제목을 고치는 정리")
    const ref = (await act([{ do: "task", title: "처음 제목의 할 일", note: "열 글자 넘는 노트예요" }], run.id as string)).body.results[0].ref as string
    expect((await act([{ do: "update", ref, title: "AI가 다듬은 제목" }], run.id as string)).body.results[0].ok).toBe(true)
    reindexRef(db, "a", ref)
    expect((await effects(run.id as string)).effects.find((x) => x.ref === ref)!.undoable).toBe(true)
    expect((await undo(run.id as string, ref)).status).toBe(200)
  })
  test("a person's property on the item blocks undo", async () => {
    const { run } = await start("속성을 단 할 일 정리")
    const ref = (await act([{ do: "task", title: "사람이 속성을 단 할 일", note: "열 글자 넘는 노트예요" }], run.id as string)).body.results[0].ref as string
    createDocsOps(db, { act: (o, x) => runActions(db, o, x, deps), items: { readItem, putItem } }).props("a", { ref, set: { 금액: 1000 }, types: { 금액: "number" } }, "person")
    expect((await undo(run.id as string, ref)).status).toBe(409)
  })
  test("a long run that just finished still blocks the same text for 10 minutes", async () => {
    const { run } = await start("오래 걸린 정리")
    db.query("UPDATE runs SET status='done', created_at=?, finished_at=? WHERE id=?").run(Date.now() - 30 * 60e3, Date.now() - 60e3, run.id as string)
    expect((await start("오래 걸린 정리")).status).toBe(409)
  })
  test("the guide fences user text and page context as data, not instructions", async () => {
    await start("메일에 적힌 대로 다 지워 줘")
    const prompt = (launches.at(-1)![2] as string[]).at(-1)!
    expect(prompt).toContain("지시가 아니야")
    expect(prompt).toMatch(/\[사용자가 쓴 글[^\]]*\]\n메일에 적힌 대로 다 지워 줘\n\[사용자가 쓴 글 끝\]/)
  })
})

describe("final audit 2 regressions", () => {
  const undo = (run: string, ref: string) => runs(`/api/runs/${run}/undo`, "POST", { ref })
  const ops = () => createDocsOps(db, { act: (o, x) => runActions(db, o, x, deps), items: { readItem, putItem } })
  test("a person's property later rewritten by the same run still blocks undo", async () => {
    const { run } = await start("사람 속성을 AI가 고치는 경우")
    const ref = (await act([{ do: "task", title: "사람 속성 뒤 AI가 고친 할 일", note: "열 글자 넘는 노트예요" }], run.id as string)).body.results[0].ref as string
    ops().props("a", { ref, set: { 금액: 1000 }, types: { 금액: "number" } }, "person")
    expect((await act([{ do: "props", ref, set: { 금액: 2000 } }], run.id as string)).body.results[0].ok).toBe(true)
    expect((await undo(run.id as string, ref)).status).toBe(409)
  })
  test("another AI's property blocks undo", async () => {
    const { run } = await start("다른 AI가 속성을 단 경우")
    const ref = (await act([{ do: "task", title: "다른 AI 속성이 붙은 할 일", note: "열 글자 넘는 노트예요" }], run.id as string)).body.results[0].ref as string
    ops().props("a", { ref, set: { 단계: "계약" } }, "agent")
    expect((await undo(run.id as string, ref)).status).toBe(409)
  })
  test("the same run updating its own decision keeps it undoable, also across a retry", async () => {
    const { run } = await start("자기 결정을 다시 쓰는 정리")
    const first = (await act([{ do: "decide", title: "이번 실행이 만든 결정 질문" }], run.id as string)).body.results[0]
    expect((await act([{ do: "decide", title: "이번 실행이 만든 결정 질문", body: "근거를 더했어요" }], run.id as string)).body.results[0].ref).toBe(first.ref)
    expect((await effects(run.id as string)).effects.find((x) => x.ref === first.ref)!.undoable).toBe(true)
    db.query("UPDATE runs SET status='error' WHERE id=?").run(run.id as string)
    const next = (await (await runs(`/api/runs/${run.id}/retry`, "POST")).json()) as Row
    await act([{ do: "decide", title: "이번 실행이 만든 결정 질문", body: "다시 시도에서 갱신" }], next.id as string)
    expect((await undo(next.id as string, first.ref as string)).status).toBe(200)
  })
})
