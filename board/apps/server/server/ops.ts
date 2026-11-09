// 운영 순회(ops): "내가 해야 할 모든 것" 프롬프트 하나를 저장해 두고, 정해진 주기마다 `aside exec` 에 통째로 맡긴다.
// 에이전트는 돌아본 결과를 POST /api/ops/report 로 보내고, 서버가 사건(signals)과 미리알림 카드(todo)로 바꿔 넣는다.
// 프로토타입 기간에는 따로 수집기를 만들지 않는다. Aside가 수집기다.
import type { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { join } from "node:path"
import type { OpsReport, OpsReportCounts, OpsReportItem, OpsResponse, OpsRun, OpsSettings } from "@direction-board/contracts/api"
import { writeAgentNote } from "./notes.ts"
import { DONE_RECENT_MS, findSameTodo } from "./dedup.ts"
import { trimLog } from "./item-log.ts"
import { itemSpace, listSpaces, PERSONAL, resolveSpace } from "./spaces.ts"
import { everyWhileOpen, laterWhileOpen } from "./db-timers.ts"

type U = { email: string; agent: boolean }
type BoardRef = { id: string; areas: { id: string; name: string }[] }
type Deps = {
  ingest: (owner: string, raw: any) => any
  personalBoard: (owner: string) => BoardRef | null
  /** 회사 판(파일럿). 있으면 회사 공간 카드를 여기에 둬요 */
  companyBoard?: () => BoardRef | null
  readItem: (bid: string, iid: string) => { data: any } | null
  /** space 를 주지 않으면 항목의 기존 공간을 지켜요 */
  putItem: (bid: string, iid: string, data: any, actor: string, space?: string) => void
  startRun: (owner: string, opts: { prompt: string; label: string; provider?: string | null; model?: string | null; effort?: string | null; kind: string }) => Promise<any>
  port: number
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })
const err = (status: number, message: string) => json({ error: message }, status)
const now = () => Date.now()
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "")
const DEFAULT_FILE = join(import.meta.dir, "ops-prompt.md")

/* 기본 주기: 2시간마다, 08:00~24:00(한국 시간). 밤에는 돌지 않는다 */
const DEFAULTS = { every_min: 120, active_from: 8, active_to: 24, enabled: 1, effort: "medium" }

export function initOps(db: Database) {
  db.exec(`
CREATE TABLE IF NOT EXISTS ops_prompt(
  owner TEXT PRIMARY KEY, text TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, every_min INTEGER NOT NULL DEFAULT 120,
  active_from INTEGER NOT NULL DEFAULT 8, active_to INTEGER NOT NULL DEFAULT 24, provider TEXT, model TEXT, effort TEXT,
  updated_at INTEGER NOT NULL, last_run_at INTEGER, last_run_id TEXT);
-- 순회 한 번에 토큰 하나. 프롬프트의 보고 주소에 토큰을 실어 보내서, 늦게 온 보고도 제 순회에 붙는다
CREATE TABLE IF NOT EXISTS ops_reports(
  token TEXT PRIMARY KEY, owner TEXT NOT NULL, run_id TEXT, summary TEXT, result TEXT, created_at INTEGER NOT NULL, reported_at INTEGER);
CREATE INDEX IF NOT EXISTS ops_reports_run ON ops_reports(owner, run_id);
`)
  if (!(db.query("PRAGMA table_info(ops_prompt)").all() as { name: string }[]).some((c) => c.name === "rev")) db.exec("ALTER TABLE ops_prompt ADD COLUMN rev INTEGER NOT NULL DEFAULT 0")
}

async function defaultText() {
  try {
    return await Bun.file(DEFAULT_FILE).text()
  } catch {
    return "# 내가 해야 할 모든 것\n\n(여기에 영역별 할 일, 확인할 곳, 나를 불러야 하는 조건을 적어 주세요)\n"
  }
}

async function getOps(db: Database, owner: string) {
  let row = db.query("SELECT * FROM ops_prompt WHERE owner=?").get(owner) as any
  if (!row) {
    db.query("INSERT INTO ops_prompt(owner,text,enabled,every_min,active_from,active_to,effort,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(owner, await defaultText(), DEFAULTS.enabled, DEFAULTS.every_min, DEFAULTS.active_from, DEFAULTS.active_to, DEFAULTS.effort, now())
    row = db.query("SELECT * FROM ops_prompt WHERE owner=?").get(owner)
  }
  return row
}

const kstHour = (ts = now()) => new Date(ts + 9 * 3600e3).getUTCHours()
const kstStamp = (ts = now()) => {
  const d = new Date(ts + 9 * 3600e3)
  const p = (n: number) => String(n).padStart(2, "0")
  const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getUTCDay()]
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}(${wd}) ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} KST`
}
const inWindow = (o: any, ts = now()) => {
  const h = kstHour(ts)
  return o.active_from <= o.active_to ? h >= o.active_from && h < o.active_to : h >= o.active_from || h < o.active_to
}
type Schedule = { enabled: number | boolean; every_min: number; last_run_at: number | null; active_from: number; active_to: number }
/** 다음 자동 순회가 시작될 수 있는 시각. 주기가 지난 시각이 활동 시간 밖이면 다음 활동 시작 시각(정시)으로. 꺼졌거나 활동 시간이 없으면 null */
export function nextSweepAt(o: Schedule, ts = now()): number | null {
  if (!o.enabled) return null
  let t = Math.max(ts, (o.last_run_at || 0) + o.every_min * 60e3)
  // 한국 시간은 UTC 와 정시가 같아서 UTC 정시로 넘겨도 된다
  for (let i = 0; i < 25 && !inWindow(o, t); i++) t = (Math.floor(t / 3600e3) + 1) * 3600e3
  return inWindow(o, t) ? t : null
}
const cardId = (key: string) => "ops-" + createHash("sha1").update(key).digest("hex").slice(0, 16)
const WHEN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/
type ItemRow = { id: string; data: string; updated_at: number; space: string | null }
type TodoData = { type?: string; text?: string; done?: boolean; remindAt?: string; area?: string; log?: unknown }

/** 순회에 보여 줄 내 판의 할 일·목표: 열린 것(운영 카드 제외)과 최근 끝낸 것 */
function boardTodos(db: Database, boardId: string, ts = now()) {
  const rows: { id: string; at: number; d: TodoData; space: string | null }[] = []
  for (const r of db.query("SELECT id, data, updated_at, space FROM items WHERE board_id=? AND deleted=0 ORDER BY updated_at DESC").all(boardId) as ItemRow[]) {
    let d: TodoData
    try { d = JSON.parse(r.data) } catch { continue }
    if ((d?.type === "todo" || d?.type === "goal") && String(d.text || "").trim()) rows.push({ id: r.id, at: r.updated_at, d, space: r.space })
  }
  const line = (r: { id: string; d: TodoData; space: string | null }) => `- ref="item:${boardId}:${r.id}" ${String(r.d.text).slice(0, 120)}${r.d.remindAt ? ` (알림 ${r.d.remindAt})` : ""}${r.space && r.space !== PERSONAL ? ` [space ${r.space}]` : ""}`
  return {
    open: rows.filter((r) => !r.d.done && !r.id.startsWith("ops-")).slice(0, 40).map(line),
    done: rows.filter((r) => r.d.done && ts - r.at <= DONE_RECENT_MS).slice(0, 20).map(line),
  }
}

/** 순회 한 번에 넘길 전체 프롬프트: 고정 규약(어디로 어떻게 보고할지) + 사람이 쓴 "내가 해야 할 모든 것" */
function sweepPrompt(db: Database, deps: Deps, owner: string, o: any, token: string) {
  const pb = deps.personalBoard(owner)
  // 회사 판(파일럿)의 카드·할 일도 같이 보여 줘요(회사 공간 카드는 거기에 생겨요)
  const boardIds = [pb?.id, deps.companyBoard?.()?.id].filter((x): x is string => !!x)
  const areas = pb?.areas.map((a) => a.name).join(", ") || "(없음)"
  const openCards = boardIds.flatMap((bid) => (db.query("SELECT id, data FROM items WHERE board_id=? AND deleted=0 AND id LIKE 'ops-%'").all(bid) as { id: string; data: string }[]))
    .map((r) => ({ id: r.id, d: JSON.parse(r.data) }))
    .filter((r) => !r.d.done)
    .map((r) => `- key="${r.d.opsKey || r.id}" ${r.d.text}${r.d.remindAt ? ` (알림 ${r.d.remindAt})` : ""}`)
  const openSignals = (db.query("SELECT ref, title, lane FROM signals WHERE owner=? AND status='open' AND ref LIKE 'ops:%' ORDER BY updated_at DESC LIMIT 60").all(owner) as any[])
    .map((s) => `- key="${String(s.ref).slice(4)}" [${s.lane}] ${s.title}`)
  const lists = boardIds.map((bid) => boardTodos(db, bid))
  const mine = { open: lists.flatMap((l) => l.open), done: lists.flatMap((l) => l.done) }
  const last = o.last_run_at ? kstStamp(o.last_run_at) : "없음 (첫 순회)"
  const url = `http://127.0.0.1:${deps.port}/api/ops/report?sweep=${token}`
  return `[방향판 운영 순회]
지금: ${kstStamp()}
지난 순회: ${last}
너는 이번 한 번의 순회를 끝까지 혼자 해. 나한테 질문하지 말고, 막히면 막혔다고 보고에 적어.

할 일: 아래 "내가 해야 할 모든 것"의 영역을 돌면서 지난 순회 이후 바뀐 것을 찾고, 결과를 방향판에 보고해.
보고는 끝에 딱 한 번, 이렇게 보내 (bash 의 curl 로. 인증은 필요 없음, 이 맥 안에서만 열려 있음):

curl -s -X POST '${url}' -H 'content-type: application/json' --data-binary @report.json

report.json 형식:
{
  "summary": "이번 순회 한두 줄 요약 (한국어)",
  "checked": [ { "source": "github|gmail|lms|onchain|x|slack|discord|kakao|luma|calendar|kimi|qwen ...", "ok": true, "note": "본 범위나 못 본 이유" } ],
  "signals": [ {
    "key": "같은 일이면 매번 같은 값 (예: github:opencodex:pr:8152, onchain:trc20:<txid>, gmail:<thread id>)",
    "kind": "start|progress|done|error|question|approval|deadline|auth|info",
    "title": "한 줄", "body": "근거와 다음 행동 (선택)", "url": "근거 링크 (선택)",
    "source": "github|gmail|...", "area": "${areas} 중 하나 (선택)",
    "due": "YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM+09:00 (마감이 있으면)",
    "risk": ["money|external|security|prod|legal|private"], "blocking": false,
    "human_step": false, "ai_fixable": null, "fixed": false, "review": false,
    "note": "짧은 노트 초안 마크다운 (선택, 아래 규칙 참고)"
  } ],
  "cards": [ { "key": "signals 의 key 와 같게", "ref": "이미 있는 내 할 일을 갱신할 때만: item:... (그때는 key 대신)", "title": "내가 해야 할 행동 한 줄 (동사로 끝나게)", "body": "왜, 무엇을 (선택)",
               "remindAt": "YYYY-MM-DDTHH:MM (알려줄 시각, 한국 시간, 선택)", "area": "영역 이름 (선택)", "done": false,
               "note": "노트 초안 마크다운 (새 카드는 필수)" } ]
}

규칙:
- 문서 찾기·읽기: 먼저 GET http://127.0.0.1:${deps.port}/api/docs/search?q=핵심어 로 찾고, 읽을 때는 GET http://127.0.0.1:${deps.port}/api/docs/<ref>?view=outline 다음 &view=section&section=제목 으로 필요한 부분만 읽어.
- signals 는 이번에 확인한 사실만. 확인 못 한 건 checked 에 ok:false 로.
- 나를 불러야 하는 건 kind 를 approval/question/deadline 으로 하고 risk 를 붙여. 에이전트가 처리했거나 기록용이면 done/info.
- cards 는 "내가 직접 해야 하는 일"만 만들어. 같은 key 로 다시 보내면 새로 생기지 않고 갱신돼.
- 새 카드를 만들기 전에 아래 "이미 열린 카드", "내가 이미 가진 할 일", "최근에 끝낸 일"을 먼저 봐. 같은 일이 있으면 새 카드를 만들지 마.
  · 이미 열린 카드와 같은 일이면 그 key 로 보내.
  · 내가 이미 가진 할 일과 같은 일이면 key 대신 "ref":"item:..." 로 보내. 제목은 바뀌지 않고 알림 시각과 노트만 더해져. ref 로는 닫을 수 없어 (내 일은 내가 닫아).
  · 최근에 끝낸 일과 같은 일이면 다시 만들지 말고, 정말 다시 해야 하면 signals 에 question 으로 올려.
  · 제목이 같은 할 일이 이미 있으면 서버가 새로 만들지 않고 합쳐 (응답의 merged/skipped).
- 아래 "이미 열린 카드" 중 이제 끝난 건 같은 key 로 done:true 를 보내서 닫아.
- 노트 초안: 내가 봐야 하는 사건(approval/question/deadline/error)에는 note 를 붙이고, 새 카드에는 반드시 붙여 (note 없는 새 카드는 거절돼). 형식은 "## 상황" 1~2줄, "## 다음 할 일" 에 "- [ ] " 체크리스트 1~3개. 이번에 본 사실만 쓰고, 모르는 건 "확인 필요". 길게 쓰지 마. 내가 이미 고친 노트는 덮지 않으니 매번 보내도 돼.
- 비밀번호, 토큰, 주민번호, 여권번호는 절대 보고에 넣지 마.
- 공간: 회사 일이면 signals·cards 에 "space" 를 붙여 (값은 아래 공간 id). 빼면 개인이야. 이미 있는 카드·할 일(ref)·사건과 다른 공간을 보내면 서버가 거절해 (공간은 내가 옮겨).
  공간: ${listSpaces(db).map((s) => `${s.id}(${s.name})`).join(", ")}
- 보고를 보낸 뒤 마지막 답에는 무엇을 봤고 무엇을 올렸는지 3~6줄로 요약해.

이미 열린 카드:
${openCards.join("\n") || "- 없음"}

내가 이미 가진 할 일 (운영 카드 말고, 내가 만들었거나 AI 대화가 만든 것):
${mine.open.join("\n") || "- 없음"}

최근에 끝낸 일 (14일 안):
${mine.done.join("\n") || "- 없음"}

이미 열린 사건:
${openSignals.join("\n") || "- 없음"}

----- 내가 해야 할 모든 것 (사람이 쓴 부분) -----
${o.text}`
}

const running = new Set<string>()
async function runSweep(db: Database, deps: Deps, owner: string, why: "manual" | "schedule") {
  if (running.has(owner)) throw new Error("이미 순회가 돌고 있어요")
  const live = db.query("SELECT id FROM runs WHERE owner=? AND kind='sweep' AND status='running'").get(owner)
  if (live) throw new Error("이미 순회가 돌고 있어요")
  running.add(owner)
  const token = crypto.randomUUID()
  try {
    db.query("INSERT INTO ops_reports(token,owner,created_at) VALUES (?,?,?)").run(token, owner, now())
    const o = await getOps(db, owner)
    const row = await deps.startRun(owner, {
      prompt: sweepPrompt(db, deps, owner, o, token),
      label: `운영 순회 (${why === "manual" ? "지금 돌리기" : "자동"}) · ${kstStamp()}`,
      provider: o.provider, model: o.model, effort: o.effort, kind: "sweep",
    })
    db.query("UPDATE ops_prompt SET last_run_at=?, last_run_id=? WHERE owner=?").run(now(), row.id, owner)
    db.query("UPDATE ops_reports SET run_id=? WHERE token=?").run(row.id, token)
    return row
  } catch (e) {
    db.query("DELETE FROM ops_reports WHERE token=? AND reported_at IS NULL").run(token)
    throw e
  } finally {
    running.delete(owner)
  }
}

/** 1분마다 확인: 켜져 있고, 활동 시간 안이고, 주기가 지났으면 순회를 시작 */
export function startOpsScheduler(db: Database, deps: Deps, owner: string) {
  const tick = async () => {
    for (const o of db.query("SELECT * FROM ops_prompt WHERE enabled=1 AND owner=?").all(owner) as { owner: string; active_from: number; active_to: number; last_run_at: number | null; every_min: number }[]) {
      if (!inWindow(o)) continue
      if (o.last_run_at && now() - o.last_run_at < o.every_min * 60e3) continue
      try {
        await runSweep(db, deps, o.owner, "schedule")
        console.log(`[ops] sweep started for ${o.owner}`)
      } catch {
        /* 이미 도는 중이면 다음 틱에 */
      }
    }
  }
  // 이 DB 가 열려 있는 동안만(닫으면 멈춰요, db-timers.ts)
  laterWhileOpen(db, 15e3, tick, "ops")
  everyWhileOpen(db, 60e3, tick, "ops")
}

function applyReport(db: Database, deps: Deps, owner: string, body: any) {
  const out = { signals: 0, cards: 0, merged: 0, skipped: 0, closed: 0, checked: 0, notes: 0, errors: [] as string[], items: [] as OpsReportItem[] }
  const pb = deps.personalBoard(owner)
  const areaIdOf = (bd: BoardRef, name: unknown) => {
    const n = str(name, 40)
    if (!n) return undefined
    return bd.areas.find((a) => a.name.toLowerCase() === n.toLowerCase())?.id
  }
  for (const c of (Array.isArray(body?.checked) ? body.checked : []).slice(0, 40)) {
    const name = str(c?.source, 40)
    if (!name) continue
    const o = db.query("SELECT every_min FROM ops_prompt WHERE owner=?").get(owner) as any
    const ts = now()
    db.query(`INSERT INTO collectors(owner,name,ok,note,last_seen,last_ok,every_min,sample) VALUES (?,?,?,?,?,?,?,0)
      ON CONFLICT(owner,name) DO UPDATE SET ok=excluded.ok, note=excluded.note, last_seen=excluded.last_seen, last_ok=COALESCE(excluded.last_ok, collectors.last_ok), every_min=excluded.every_min, sample=0`)
      .run(owner, name, c.ok === false ? 0 : 1, str(c?.note, 200) || null, ts, c.ok === false ? null : ts, o?.every_min ?? null)
    out.checked++
  }
  for (const s of (Array.isArray(body?.signals) ? body.signals : []).slice(0, 150)) {
    const key = str(s?.key, 180)
    if (!key) { out.errors.push("signal without key"); continue }
    const area = str(s?.area, 40) || undefined
    const r = deps.ingest(owner, { ...s, ref: `ops:${key}`, task: s?.task || undefined, area, agent: "운영 순회", private: true, work: undefined })
    if (typeof r === "string") out.errors.push(`${key}: ${r}`)
    else {
      out.signals++
      out.items.push({ ref: `signal:${r.id}`, title: String(r.title || ""), kind: "signal", lane: String(r.lane || "") })
      if (draftNote(db, owner, `signal:${r.id}`, s?.note)) out.notes++
    }
  }
  if (pb) {
    const cb = deps.companyBoard?.() ?? null
    const boards: BoardRef[] = cb ? [pb, cb] : [pb]
    /** 이미 있는 할 일에 합치기: 제목과 닫힘은 그대로, 알림 시각·(비어 있으면) 영역·노트만 더한다 */
    const mergeInto = (bd: BoardRef, iid: string, prev: TodoData, c: { remindAt?: unknown; area?: unknown }, note: string, why: string) => {
      const remindAt = typeof c.remindAt === "string" && WHEN.test(c.remindAt) ? c.remindAt : undefined
      const area = prev.area ? undefined : areaIdOf(bd, c.area)
      const appended = note ? writeAgentNote(db, owner, `item:${bd.id}:${iid}`, note, "append") : false
      if (appended) out.notes++
      if (!appended && (!remindAt || remindAt === prev.remindAt) && !area) return
      deps.putItem(bd.id, iid, {
        ...prev,
        ...(remindAt ? { remindAt } : {}),
        ...(area ? { area } : {}),
        log: trimLog([...(Array.isArray(prev.log) ? prev.log : []), { by: "agent", at: now(), text: why }]),
      }, "agent")
    }
    for (const c of (Array.isArray(body?.cards) ? body.cards : []).slice(0, 60)) {
      const key = str(c?.key, 180)
      const title = str(c?.title, 200)
      const bodyTxt = str(c?.body, 1500)
      const note = str(c?.note, 4000) || (bodyTxt ? `## 상황\n${bodyTxt}` : "")
      const ref = str(c?.ref, 160)
      // 공간: 모르는 값은 거절, 이미 있는 일과 다른 공간이면 그 일에 아무것도 쓰지 않아요(공간은 사람만 옮겨요)
      const asked = resolveSpace(db, c?.space)
      if (asked === null) { out.errors.push(`${key || ref || title}: 모르는 공간이에요`); continue }
      if (ref) {
        // 이미 있는 내 할 일을 가리킨 카드: 그 일에 합친다. 이름을 바꾸거나 닫지 않는다
        const [k, bid, iid] = ref.split(":")
        const bd = boards.find((b) => b.id === bid)
        const prev: TodoData | null = k === "item" && bd && iid ? deps.readItem(bd.id, iid)?.data ?? null : null
        if (!bd || !prev || (prev.type !== "todo" && prev.type !== "goal")) { out.errors.push(`${ref}: 내 판에서 그 할 일을 찾지 못했어요`); continue }
        if (asked !== undefined && asked !== itemSpace(db, bd.id, iid)) { out.errors.push(`${ref}: 그 할 일과 공간이 달라요`); continue }
        if (c?.done) { out.errors.push(`${ref}: ref 로는 닫지 않아요. 끝난 근거는 note 로 남겨요`); continue }
        if (prev.done) { out.errors.push(`${ref}: 이미 끝낸 할 일이에요`); continue }
        mergeInto(bd, iid, prev, c, note, "운영 순회: 이 할 일에 내용을 더했어요")
        out.merged++
        out.items.push({ ref: `item:${bd.id}:${iid}`, title: String(prev.text || ""), kind: "merged" })
        continue
      }
      if (!key || (!title && !c?.done)) { out.errors.push("card needs key and title"); continue }
      const iid = cardId(key)
      // 카드가 이미 있는 판, 없으면 공간에 맞는 판(회사 공간이고 회사 판이 있으면 회사 판)
      const bd = boards.find((b) => deps.readItem(b.id, iid)) ?? (asked && asked !== PERSONAL && cb ? cb : pb)
      const prev = deps.readItem(bd.id, iid)?.data
      if (prev && asked !== undefined && asked !== itemSpace(db, bd.id, iid)) { out.errors.push(`${key}: 이미 있는 카드와 공간이 달라요`); continue }
      const space = asked ?? (prev ? itemSpace(db, bd.id, iid) ?? PERSONAL : PERSONAL)
      if (c.done) {
        if (prev && !prev.done) {
          deps.putItem(bd.id, iid, { ...prev, done: true, log: trimLog([...(prev.log || []), { by: "agent", at: now(), text: "운영 순회: 끝난 걸 확인해서 닫았어요" }]) }, "agent")
          out.closed++
          out.items.push({ ref: `item:${bd.id}:${iid}`, title: String(prev.text || ""), kind: "closed" })
        }
        continue
      }
      if (prev?.done) continue // 내가 이미 끝낸 카드는 다시 열지 않는다
      if (!prev) {
        // 새 key 지만 제목이 같은 할 일이 이미 있으면: 열린 건 합치고, 최근에 끝낸 건 다시 만들지 않는다
        const same = findSameTodo(db, bd.id, title, { doneWithinMs: DONE_RECENT_MS, excludeIid: iid, space })
        if (same && !same.done) {
          const sp: TodoData | undefined = deps.readItem(bd.id, same.iid)?.data
          if (sp) {
            mergeInto(bd, same.iid, sp, c, note, "운영 순회: 같은 할 일이라 새로 만들지 않고 더했어요")
            out.merged++
            out.items.push({ ref: `item:${bd.id}:${same.iid}`, title: String(sp.text || ""), kind: "merged" })
            continue
          }
        }
        if (same && same.done) { out.skipped++; continue }
      }
      const remindAt = typeof c.remindAt === "string" && WHEN.test(c.remindAt) ? c.remindAt : prev?.remindAt
      // 새 카드는 내용과 같이: note 가 없으면 body 로 채우고, 둘 다 없으면 만들지 않는다
      if (!prev && !note) { out.errors.push(`${key}: 새 카드는 note(내용)가 필요해요`); continue }
      const log = [...(prev?.log || [])]
      if (bodyTxt && log[log.length - 1]?.text !== bodyTxt) log.push({ by: "agent", at: now(), text: bodyTxt })
      const data: any = {
        ...(prev || { x: 0, y: 0, w: 240, h: 90, z: now(), placed: false }),
        type: "todo", text: title || prev?.text, done: false, opsKey: key, agent: true,
        ...(remindAt ? { remindAt } : {}),
        ...(areaIdOf(bd, c.area) ? { area: areaIdOf(bd, c.area) } : {}),
        log: trimLog(log),
      }
      deps.putItem(bd.id, iid, data, "agent", prev ? undefined : space)
      out.cards++
      out.items.push({ ref: `item:${bd.id}:${iid}`, title: String(data.text || ""), kind: prev ? "merged" : "card" })
      if (draftNote(db, owner, `item:${bd.id}:${iid}`, note)) out.notes++
    }
  }
  return out
}

/** 순회가 쓴 짧은 노트 초안을 넣는다. 비었거나 에이전트가 쓴 노트만 덮고, 내가 고친 노트는 건드리지 않는다 */
function draftNote(db: Database, owner: string, ref: string, md: unknown) {
  return writeAgentNote(db, owner, ref, str(md, 4000), "draft")
}

export async function opsApi(db: Database, req: Request, url: URL, u: U, parts: string[], loopback: boolean, deps: Deps, macOwner = loopback): Promise<Response | null> {
  if (parts[1] !== "ops") return null
  if (!macOwner) return err(403, "ops is restricted to the Mac owner")
  const m = req.method
  const owner = u.email

  if (parts.length === 2 && m === "GET") {
    const o = await getOps(db, owner)
    // lite: 사이드바 칩이 자주 읽는 가벼운 모양(최근 3개, 프롬프트·출력·초안 없이)
    const lite = url.searchParams.get("lite") === "1"
    const rows = db.query(`SELECT id,status,${lite ? "" : "prompt,output,"}model_name,effort,session_id,error,created_at,finished_at FROM runs WHERE owner=? AND kind='sweep' ORDER BY created_at DESC LIMIT ?`).all(owner, lite ? 3 : 10) as Omit<OpsRun, "report">[]
    const reports = new Map<string, OpsReport>()
    if (rows.length) {
      const found = db.query(`SELECT run_id, summary, result, reported_at FROM ops_reports WHERE owner=? AND reported_at IS NOT NULL AND run_id IN (${rows.map(() => "?").join(",")})`).all(owner, ...rows.map((r) => r.id)) as { run_id: string; summary: string | null; result: string | null; reported_at: number }[]
      for (const f of found) reports.set(f.run_id, reportOf(f.summary, f.result, f.reported_at))
    }
    const res: OpsResponse = {
      ops: { ...(o as OpsSettings), enabled: !!o.enabled },
      runs: rows.map((r) => ({ ...r, report: reports.get(r.id) ?? null })),
      next_at: nextSweepAt(o),
      in_window: inWindow(o),
      ...(lite ? {} : { default_text: await defaultText() }),
    }
    return json(res)
  }

  if (parts.length === 2 && m === "PUT") {
    if (u.agent) return err(403, "only a person edits the ops prompt")
    // 본문을 다 받은 뒤 읽고 쓰기를 한 번에(그 사이 다른 쓰기가 끼지 않게)
    const b = (await req.json().catch(() => ({}))) as OpsPut
    await getOps(db, owner) // 줄이 없으면 기본값으로 만들어요
    // 보낸 칸만 써요. 읽어 둔 값으로 다른 칸을 다시 쓰면 같은 때 저장한 지시문을 되돌릴 수 있어요
    const set: [string, string | number | null][] = []
    if (typeof b.text === "string") set.push(["text", b.text.slice(0, 40000)])
    if (b.enabled !== undefined) set.push(["enabled", b.enabled ? 1 : 0])
    if ([30, 60, 120, 180, 240, 360, 720, 1440].includes(Number(b.every_min))) set.push(["every_min", Number(b.every_min)])
    const hour = (v: unknown) => v !== undefined && v !== null && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 24
    if (hour(b.active_from)) set.push(["active_from", Number(b.active_from)])
    if (hour(b.active_to)) set.push(["active_to", Number(b.active_to)])
    if (b.provider !== undefined) set.push(["provider", str(b.provider, 40) || null])
    if (b.model !== undefined) set.push(["model", str(b.model, 120) || null])
    if (b.effort !== undefined) set.push(["effort", str(b.effort, 20) || null])
    // rev 는 지시문(text)의 판이에요. base_rev 가 다르면 다른 곳(다른 탭·기기)에서 먼저 저장한 것이라 덮지 않는다. 없으면(옛 클라이언트) 그대로 쓴다
    const base = typeof b.text === "string" && typeof b.base_rev === "number" && Number.isInteger(b.base_rev) ? b.base_rev : null
    const cols = [...set.map(([k]) => `${k}=?`), "updated_at=?", ...(typeof b.text === "string" ? ["rev=rev+1"] : [])]
    const changed = db.query(`UPDATE ops_prompt SET ${cols.join(", ")} WHERE owner=?${base === null ? "" : " AND rev=?"}`).run(
      ...set.map(([, v]) => v), now(), owner, ...(base === null ? [] : [base]),
    ).changes
    const after = db.query("SELECT * FROM ops_prompt WHERE owner=?").get(owner) as OpsSettings
    if (!changed) return json({ error: "다른 곳에서 먼저 저장했어요", ops: { ...after, enabled: !!after.enabled } }, 409)
    return json({ ops: after })
  }

  if (parts[2] === "run" && m === "POST") {
    if (u.agent) return err(403, "agents cannot start sweeps")
    try {
      return json(await runSweep(db, deps, owner, "manual"), 201)
    } catch (e) {
      return err(409, String((e as Error).message || e))
    }
  }

  if (parts[2] === "report" && m === "POST") {
    if (!loopback) return err(403, "reports are accepted only by the local server")
    const body = (await req.json().catch(() => null)) as any
    if (!body || typeof body !== "object") return err(400, "report must be a JSON object")
    // 이 순회의 토큰. 없으면(옛 프롬프트·손으로 보낸 보고) 어떤 순회에도 붙이지 않는다
    const token = url.searchParams.get("sweep")
    const slot = token ? (db.query("SELECT token, run_id FROM ops_reports WHERE token=? AND owner=?").get(token, owner) as { token: string; run_id: string | null } | null) : null
    if (token && !slot) return err(400, "모르는 순회 토큰이에요")
    const res = applyReport(db, deps, owner, body)
    const summary = str(body.summary, 600)
    if (slot) {
      const counts: OpsReportCounts = { signals: res.signals, cards: res.cards, merged: res.merged, skipped: res.skipped, closed: res.closed, checked: res.checked, notes: res.notes, errors: res.errors.length }
      db.query("UPDATE ops_reports SET summary=?, result=?, reported_at=? WHERE token=?").run(summary, JSON.stringify({ counts, items: res.items.slice(0, 60) }), now(), slot.token)
    }
    if (summary) {
      const sweepRef = slot ? slot.run_id || slot.token : `report-${now()}`
      deps.ingest(owner, { ref: `ops:sweep:${sweepRef}`, kind: "info", source: "aside", agent: "운영 순회", title: `운영 순회 보고: ${summary.split("\n")[0].slice(0, 140)}`, body: `${summary}\n\n사건 ${res.signals}개 · 카드 ${res.cards}개 · 기존 할 일에 합침 ${res.merged}개 · 이미 끝낸 일이라 건너뜀 ${res.skipped}개 · 닫은 카드 ${res.closed}개 · 노트 초안 ${res.notes}개 · 확인한 곳 ${res.checked}곳`, private: true })
    }
    return json(res, res.errors.length && !res.signals && !res.cards && !res.merged ? 400 : 200)
  }
  return null
}

type OpsPut = { text?: unknown; enabled?: unknown; every_min?: unknown; active_from?: unknown; active_to?: unknown; provider?: unknown; model?: unknown; effort?: unknown; base_rev?: unknown }

function reportOf(summary: string | null, result: string | null, at: number): OpsReport {
  const zero: OpsReportCounts = { signals: 0, cards: 0, merged: 0, skipped: 0, closed: 0, checked: 0, notes: 0, errors: 0 }
  let parsed: { counts?: Partial<OpsReportCounts>; items?: OpsReportItem[] } = {}
  try { parsed = JSON.parse(result || "{}") } catch { /* 깨진 기록은 빈 결과로 */ }
  return { summary: summary || "", counts: { ...zero, ...parsed.counts }, items: Array.isArray(parsed.items) ? parsed.items : [], at }
}
