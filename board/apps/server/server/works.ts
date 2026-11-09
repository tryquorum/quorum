// 일(work) 상세: 사건 하나를 중심으로 AI 대화 기록, 다른 일과의 연결, 같은 흐름의 일, 타임라인을 모아 준다.
// 일 주소(ref): "signal:<id>" 또는 "item:<boardId>:<itemId>" (보드의 할 일·목표)
import type { Database } from "bun:sqlite"
import { compareWorkOrder, computeGoalProgress, whenOfItem, type GoalProgress, type Item } from "@direction-board/contracts"
import { DocsError } from "@direction-board/contracts/docs"
import { putNote } from "./docs/document.ts"
import { markDocsChanged } from "./docs/index.ts"
import { scopeOf } from "./docs/scope.ts"
import { GOAL_SPACE_MISMATCH, goalSpaceOf } from "./goal-space.ts"
import { itemSpace } from "./spaces.ts"

type U = { email: string; agent: boolean }
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })
const err = (status: number, message: string) => json({ error: message }, status)
const now = () => Date.now()
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "")

export function initWorks(db: Database) {
  db.exec(`
CREATE TABLE IF NOT EXISTS work_links(id TEXT PRIMARY KEY, owner TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL, label TEXT, by TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS work_links_a ON work_links(owner, a);
CREATE INDEX IF NOT EXISTS work_links_b ON work_links(owner, b);
CREATE TABLE IF NOT EXISTS work_notes(owner TEXT NOT NULL, ref TEXT NOT NULL, html TEXT NOT NULL, text TEXT NOT NULL, by TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(owner, ref));
`)
}

function parseGoalTodoPair(db: Database, a: string, b: string): { bid: string; todoId: string; goalId: string; todoData: Record<string, unknown> } | null {
  const pa = a.split(":"), pb = b.split(":")
  if (pa[0] !== "item" || pb[0] !== "item" || pa.length !== 3 || pb.length !== 3 || pa[1] !== pb[1]) return null
  const bid = pa[1]
  const ra = db.query("SELECT data FROM items WHERE board_id=? AND id=? AND deleted=0").get(bid, pa[2]) as { data: string } | null
  const rb = db.query("SELECT data FROM items WHERE board_id=? AND id=? AND deleted=0").get(bid, pb[2]) as { data: string } | null
  if (!ra || !rb) return null
  const da = JSON.parse(ra.data) as Record<string, unknown>
  const dbData = JSON.parse(rb.data) as Record<string, unknown>
  if (da.type === "todo" && dbData.type === "goal") return { bid, todoId: pa[2], goalId: pb[2], todoData: da }
  if (dbData.type === "todo" && da.type === "goal") return { bid, todoId: pb[2], goalId: pa[2], todoData: dbData }
  return null
}

function setTodoGoalField(db: Database, bid: string, todoId: string, todoData: Record<string, unknown>, goalId: string | null) {
  const next = { ...todoData }
  if (goalId) next.goalId = goalId
  else delete next.goalId
  const hasEvents = (db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='events'").get() as unknown) !== null
  const seq = hasEvents
    ? Number(db.query("INSERT INTO events(board_id,item_id,op,actor,at,payload) VALUES (?,?, 'item.link','system',?,NULL)").run(bid, todoId, now()).lastInsertRowid)
    : now()
  db.query("UPDATE items SET data=?, updated_at=?, seq=? WHERE board_id=? AND id=?").run(JSON.stringify(next), now(), seq, bid, todoId)
}

/** 할 일 저장 때 goalId 변경을 work_links 테이블과 맞춘다 */
export function syncTodoGoalLink(db: Database, owner: string, bid: string, iid: string, prevGoalId: unknown, nextGoalId: unknown, actor: string) {
  const prev = typeof prevGoalId === "string" ? prevGoalId : ""
  const next = typeof nextGoalId === "string" ? nextGoalId : ""
  if (prev === next) return
  const todoRef = `item:${bid}:${iid}`
  if (prev) {
    const prevRef = `item:${bid}:${prev}`
    db.query("DELETE FROM work_links WHERE owner=? AND ((a=? AND b=?) OR (a=? AND b=?))").run(owner, todoRef, prevRef, prevRef, todoRef)
    markDocsChanged(db, owner, [todoRef, prevRef])
  }
  if (next) {
    const nextRef = `item:${bid}:${next}`
    const dup = db.query("SELECT id FROM work_links WHERE owner=? AND ((a=? AND b=?) OR (a=? AND b=?))").get(owner, todoRef, nextRef, nextRef, todoRef)
    if (!dup) {
      db.query("INSERT INTO work_links(id,owner,a,b,label,by,created_at) VALUES (?,?,?,?, '위해서',?,?)")
        .run(crypto.randomUUID().slice(0, 12), owner, todoRef, nextRef, actor === "agent" ? "agent" : "human", now())
      markDocsChanged(db, owner, [todoRef, nextRef])
    }
  }
}

/** 목표 ref(item:<bid>:<goalId>)의 진행률(done/total)을 보드 items + work_links 원본에서 계산한다 */
export function goalProgressForRef(db: Database, owner: string, ref: string): GoalProgress | undefined {
  const parts = ref.split(":")
  if (parts[0] !== "item" || parts.length !== 3) return undefined
  const [, bid, gid] = parts
  const hasItems = (db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='items'").get() as unknown) !== null
  if (!hasItems) return undefined
  const rows = db.query("SELECT id, data FROM items WHERE board_id=? AND deleted=0").all(bid) as { id: string; data: string }[]
  const items: Item[] = []
  let goal: Item | null = null
  for (const r of rows) {
    try {
      const d = JSON.parse(r.data) as Item
      const it: Item = { ...d, id: r.id, boardId: bid }
      items.push(it)
      if (r.id === gid && it.type === "goal") goal = it
    } catch { /* ignore */ }
  }
  if (!goal) return undefined
  const linkedIds: string[] = []
  const hasLinks = (db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='work_links'").get() as unknown) !== null
  if (hasLinks) {
    const prefix = `item:${bid}:`
    const edges = db.query("SELECT a,b FROM work_links WHERE owner=? AND (a=? OR b=?)").all(owner, ref, ref) as { a: string; b: string }[]
    for (const e of edges) {
      const other = e.a === ref ? e.b : e.a
      if (other.startsWith(prefix)) linkedIds.push(other.slice(prefix.length))
    }
  }
  return computeGoalProgress(goal, items, linkedIds)
}

type Brief = { ref: string; type: "signal" | "goal" | "todo" | "sticky" | "text" | "frame" | "doc" | "run"; title: string; source: string; lane?: string; status: string; area?: string | null; due?: number | null; when?: string | null; updated_at: number }

function signalBrief(s: any): Brief {
  return { ref: `signal:${s.id}`, type: "signal", title: s.title, source: s.source, lane: s.lane, status: s.status, area: s.area, due: s.due, updated_at: s.updated_at }
}
function itemBrief(r: any, areas: Record<string, string>): Brief | null {
  const d = JSON.parse(r.data)
  if (d.type === "link") return null
  const when = d.type === "goal" ? (typeof d.due === "string" ? d.due : null) : (typeof d.remindAt === "string" ? d.remindAt : null)
  const due = whenOfItem(d)
  return {
    ref: `item:${r.board_id}:${r.id}`,
    type: d.type,
    title: String(d.text || "").split("\n")[0] || "(제목 없음)",
    source: d.type === "goal" ? "목표" : d.type === "todo" ? "미리알림" : "보드",
    status: d.done ? "resolved" : "open",
    area: d.area ? areas[`${r.board_id}:${d.area}`] || null : null,
    due,
    when,
    updated_at: r.updated_at,
  }
}

type BoardRow = { id: string; kind: string; owner: string | null; meta: string | null }
type ItemRow = { board_id: string; id: string; data: string; space: string | null; updated_at: number }
/** 파일럿 멤버(shared)는 소유와 무관하게 회사 판만, 그 안에서도 워크스페이스 공간 항목만 봐요. 규칙: docs/internals/pilot.md */
function visibleBoards(db: Database, owner: string, shared = false) {
  return (db.query("SELECT id, kind, owner, meta FROM boards WHERE deleted=0").all() as BoardRow[]).filter((b) => b.kind === "company" || (!shared && b.owner === owner))
}
const sharedSpace = (space: unknown) => typeof space === "string" && space !== "" && space !== "personal"
function areaNames(boards: any[]) {
  const m: Record<string, string> = {}
  for (const b of boards) for (const a of JSON.parse(b.meta || "{}").areas || []) m[`${b.id}:${a.id}`] = a.name
  return m
}

export function resolveRef(db: Database, owner: string, ref: string, shared = false): Brief | null {
  if (shared && !ref.startsWith("item:")) return null
  if (ref.startsWith("doc:")) {
    const d = db.query("SELECT title,area,archived,updated_at FROM docs WHERE owner=? AND id=?").get(owner,ref.slice(4)) as {title:string;area:string|null;archived:number;updated_at:number}|null
    return d ? {ref,type:"doc",title:d.title,source:"문서",status:d.archived ? "archived" : "open",area:d.area,updated_at:d.updated_at} : null
  }
  if (ref.startsWith("run:")) {
    const r = db.query("SELECT prompt,status,updated_at FROM runs WHERE owner=? AND COALESCE(thread,id)=? ORDER BY updated_at DESC, id DESC LIMIT 1").get(owner,ref.slice(4)) as {prompt:string;status:string;updated_at:number}|null
    return r ? {ref,type:"run",title:String(r.prompt || "").split("\n")[0].slice(0,120),source:"대화",status:r.status,updated_at:r.updated_at} : null
  }
  if (ref.startsWith("signal:")) {
    const s = db.query("SELECT * FROM signals WHERE id=? AND owner=?").get(ref.slice(7), owner)
    return s ? signalBrief(s) : null
  }
  if (ref.startsWith("item:")) {
    const [, bid, iid] = ref.split(":")
    const boards = visibleBoards(db, owner, shared)
    if (!boards.some((b) => b.id === bid)) return null
    const r = db.query("SELECT * FROM items WHERE board_id=? AND id=? AND deleted=0").get(bid, iid) as ItemRow | null
    return r && (!shared || sharedSpace(r.space)) ? itemBrief(r, areaNames(boards)) : null
  }
  return null
}

/** shared: 파일럿 멤버 — 사건·문서·대화는 빼고 회사 공간 항목만 */
export async function worksApi(db: Database, req: Request, url: URL, u: U, parts: string[], shared = false): Promise<Response | null> {
  if (parts[1] !== "work") return null
  const m = req.method
  const owner = u.email
  const resolve = (ref: string) => resolveRef(db, owner, ref, shared)

  // 연결할 일 찾기
  if (parts[2] === "search" && m === "GET") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase()
    const exclude = url.searchParams.get("exclude") || ""
    const sigs = shared ? [] : (db.query("SELECT * FROM signals WHERE owner=? AND kind NOT IN ('start','progress') ORDER BY (status='open') DESC, updated_at DESC LIMIT 300").all(owner) as any[]).map(signalBrief) // justified: 사건 행은 signalBrief 가 읽는 기존 모양
    const boards = visibleBoards(db, owner, shared)
    const names = areaNames(boards)
    const items = boards.length
      ? ((db.query(`SELECT * FROM items WHERE deleted=0 AND board_id IN (${boards.map(() => "?").join(",")})`).all(...boards.map((b) => b.id)) as ItemRow[])
          .filter((r) => !shared || sharedSpace(r.space))
          .map((r) => itemBrief(r, names))
          .filter((x): x is Brief => !!x && (x.type === "goal" || x.type === "todo" || x.type === "sticky")))
      : []
    const docs = shared ? [] : (db.query("SELECT id,title,area,updated_at FROM docs WHERE owner=? AND archived=0 ORDER BY updated_at DESC").all(owner) as {id:string;title:string;area:string|null;updated_at:number}[]).map(d => ({ref:`doc:${d.id}`,type:"doc" as const,title:d.title,source:"문서",status:"open",area:d.area,updated_at:d.updated_at}))
    const all = [...sigs, ...items, ...docs].filter((x) => x.ref !== exclude && (!q || `${x.title} ${x.source} ${x.area || ""}`.toLowerCase().includes(q)))
    return json({ results: all.slice(0, 40) })
  }

  if (parts[2] === "links") {
    if (parts.length === 3 && m === "POST") {
      const body = (await req.json().catch(() => null)) as any
      const a = str(body?.a, 120)
      const b = str(body?.b, 120)
      if (!a || !b || a === b) return err(400, "a and b must be two different work refs")
      if (!resolve(a) || !resolve(b)) return err(404, "work not found")
      const dup = db.query("SELECT id FROM work_links WHERE owner=? AND ((a=? AND b=?) OR (a=? AND b=?))").get(owner, a, b, b, a)
      if (dup) return err(409, "이미 연결돼 있어요")
      const pair = parseGoalTodoPair(db, a, b)
      // 할 일↔목표 연결은 할 일의 goalId 를 바꿔요: 목표와 다른 공간의 할 일은 붙이지 않아요(goal-space.ts, REST 항목 쓰기와 같은 규칙)
      if (pair && itemSpace(db, pair.bid, pair.todoId) !== goalSpaceOf(db, pair.bid, pair.goalId)) return err(400, GOAL_SPACE_MISMATCH)
      const id = crypto.randomUUID().slice(0, 12)
      db.query("INSERT INTO work_links(id,owner,a,b,label,by,created_at) VALUES (?,?,?,?,?,?,?)").run(id, owner, a, b, str(body?.label, 40) || null, u.agent ? "agent" : "human", now())
      if (pair) setTodoGoalField(db, pair.bid, pair.todoId, pair.todoData, pair.goalId)
      markDocsChanged(db, owner, [a, b])
      return json({ id }, 201)
    }
    if (parts.length === 4 && m === "PATCH") {
      const body = (await req.json().catch(() => ({}))) as any
      const link = db.query("SELECT a,b FROM work_links WHERE id=? AND owner=?").get(parts[3], owner) as { a: string; b: string } | null
      db.query("UPDATE work_links SET label=? WHERE id=? AND owner=?").run(str(body?.label, 40) || null, parts[3], owner)
      if (link) markDocsChanged(db, owner, [link.a, link.b])
      return json({ ok: true })
    }
    if (parts.length === 4 && m === "DELETE") {
      const link = db.query("SELECT a,b FROM work_links WHERE id=? AND owner=?").get(parts[3], owner) as { a: string; b: string } | null
      db.query("DELETE FROM work_links WHERE id=? AND owner=?").run(parts[3], owner)
      if (link) {
        const pair = parseGoalTodoPair(db, link.a, link.b)
        if (pair && pair.todoData.goalId === pair.goalId) setTodoGoalField(db, pair.bid, pair.todoId, pair.todoData, null)
        markDocsChanged(db, owner, [link.a, link.b])
      }
      return json({ ok: true })
    }
  }

  // 요약 노트 저장
  if (parts.length === 4 && parts[3] === "note" && m === "PUT") {
    const ref = decodeURIComponent(parts[2])
    if (!resolve(ref)) return err(404, "work not found")
    const body = (await req.json().catch(() => null)) as any
    const html = typeof body?.html === "string" ? body.html.slice(0, 200000) : ""
    const text = typeof body?.text === "string" ? body.text.slice(0, 50000) : ""
    try {
      const saved = putNote(db,scopeOf(db,owner,ref),ref,{html,text,md:body?.md,expectedVersion:body?.expectedVersion},u.agent ? "agent" : "person")
      return json({ ok: true, updated_at: saved.updatedAt, version: saved.version, ...(saved.suggested ? { suggested: true } : {}) })
    } catch (e) {
      if (e instanceof DocsError) return json({error:e.message,...(e.current ? {current:e.current} : {})},e.status)
      throw e
    }
  }

  // 일 상세
  if (parts.length === 3 && m === "GET") {
    const ref = decodeURIComponent(parts[2])
    const self = resolve(ref)
    if (!self) return err(404, "work not found")
    const signal = ref.startsWith("signal:") ? (db.query("SELECT * FROM signals WHERE id=?").get(ref.slice(7)) as any) : null
    const target = ref
    const runs = target && !shared ? (db.query("SELECT * FROM runs WHERE owner=? AND target=? ORDER BY created_at ASC").all(owner, target) as any[]) : [] // justified: 실행 행은 응답에 그대로 나가는 기존 모양

    // 직접 연결
    const linkRows = db.query("SELECT * FROM work_links WHERE owner=? AND (a=? OR b=?) ORDER BY created_at DESC").all(owner, ref, ref) as any[]
    const links = linkRows
      .map((l) => {
        const out = l.a === ref
        const other = resolve(out ? l.b : l.a)
        return other ? { id: l.id, label: l.label, dir: out ? "out" : "in", by: l.by, other } : null
      })
      .filter(Boolean)
      .sort((a, b) =>
        compareWorkOrder(
          { id: a?.other.ref, type: a?.other.type, done: a?.other.status === "resolved", when: a?.other.when ?? a?.other.due ?? null, updatedAt: a?.other.updated_at },
          { id: b?.other.ref, type: b?.other.type, done: b?.other.status === "resolved", when: b?.other.when ?? b?.other.due ?? null, updatedAt: b?.other.updated_at },
        ),
      )
    const linked = new Set(links.map((l: any) => l.other.ref))

    // 같은 흐름: 같은 일(task) → 같은 영역 → 같은 출처 순서로 몇 개
    const flow: { why: string; item: Brief }[] = []
    if (signal) {
      const seen = new Set<string>([ref, ...linked])
      const push = (rows: any[], why: string, n: number) => {
        for (const r of rows) {
          const b = signalBrief(r)
          if (seen.has(b.ref) || flow.length >= n) continue
          seen.add(b.ref)
          flow.push({ why, item: b })
        }
      }
      if (signal.task) push(db.query("SELECT * FROM signals WHERE owner=? AND task=? AND id<>? ORDER BY updated_at DESC LIMIT 10").all(owner, signal.task, signal.id) as any[], "같은 일", 4)
      if (signal.area) push(db.query("SELECT * FROM signals WHERE owner=? AND area=? AND id<>? AND kind NOT IN ('start','progress') ORDER BY (status='open') DESC, updated_at DESC LIMIT 10").all(owner, signal.area, signal.id) as any[], `같은 영역 · ${signal.area}`, 7)
      push(db.query("SELECT * FROM signals WHERE owner=? AND source=? AND id<>? AND kind NOT IN ('start','progress') AND status='open' ORDER BY updated_at DESC LIMIT 6").all(owner, signal.source, signal.id) as any[], "같은 출처", 9)
    }

    // 타임라인
    const tl: { at: number; kind: string; text: string }[] = []
    if (signal) {
      tl.push({ at: signal.created_at, kind: "created", text: `${signal.agent || signal.source}이(가) 올렸어요` })
      if (signal.updated_at > signal.created_at + 1000 && signal.status !== "resolved") tl.push({ at: signal.updated_at, kind: "updated", text: "새 소식으로 갱신됐어요" })
      if (signal.resolved_at) tl.push({ at: signal.resolved_at, kind: "resolved", text: signal.reason === "AI가 처리함" ? "AI가 처리한 걸로 닫았어요" : signal.lane === "auto" || signal.lane === "info" ? "자동으로 정리됐어요" : "처리했어요" })
    }
    {
      for (const r of runs) {
        tl.push({ at: r.created_at, kind: "run", text: `${r.parent ? "이어서 물음" : "AI에게 물음"} · ${r.model_name || r.model}` })
        if (r.finished_at) tl.push({ at: r.finished_at, kind: r.status === "done" ? "answer" : "run-end", text: r.status === "done" ? "답이 왔어요" : r.status === "stopped" ? "멈췄어요" : "실패했어요" })
      }
      for (const l of linkRows) tl.push({ at: l.created_at, kind: "link", text: `연결 추가${l.label ? ` · ${l.label}` : ""}` })
    }
    // 노트는 그 일의 문서 범위에서 읽어요(파일럿 회사 공간 일은 워크스페이스 범위라 멤버도 같은 노트를 봐요)
    const note = db.query("SELECT html, text, by, updated_at, version, COALESCE(md,text) AS md FROM work_notes WHERE owner=? AND ref=?").get(scopeOf(db, owner, ref), ref) as {updated_at:number;by:string}|null
    if (note) tl.push({ at: note.updated_at, kind: "note", text: note.by === "agent" ? "에이전트가 노트를 고쳤어요" : "노트를 고쳤어요" })
    tl.sort((a, b) => b.at - a.at)

    return json({
      ref,
      self,
      signal: signal ? { ...signal, meta: signal.meta ? JSON.parse(signal.meta) : null, private: !!signal.private, sample: !!signal.sample, needs_ai: !!signal.needs_ai } : null,
      runs,
      noteVersioning: true,
      note: note || null,
      links,
      flow,
      timeline: tl,
    })
  }
  return null
}
