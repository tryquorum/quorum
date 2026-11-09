// AI에게 맡길 때 "지금 보고 있는 화면"을 같이 보낸다.
// 화면에서는 어떤 화면인지(view)와 판·열어 둔 일의 id 만 받고, 그 화면에 보이는 내용은 서버가 DB에서 다시 만든다.
// 그래서 "이거", "여기 있는 것"처럼 말해도 AI가 무엇을 가리키는지 알 수 있다.
import type { Database } from "bun:sqlite"
import { compareWorkOrder } from "@direction-board/contracts"
import { scopeOf } from "./docs/scope.ts"

export type PageView = "home" | "board" | "road" | "list" | "ops" | "docs"
export type Page = { view: PageView; board?: string; work?: string }

export const PAGE_NAME: Record<PageView, string> = { home: "홈", board: "보드", road: "로드맵", list: "전체 목록", ops: "운영", docs: "문서" }
const MAX = 3500

type BoardRow = { id: string; name: string; kind: string; owner: string | null }
type ItemRow = { id: string; data: string }
type ItemData = { type?: string; text?: string; done?: boolean; remindAt?: string; due?: string; z?: number; opsKey?: string }
type SignalRow = { id: string; title: string; lane: string; kind: string; due: number | null; source: string; meta: string | null }

/** 화면이 보낸 page 를 믿을 수 있는 모양으로. 모르는 화면이면 null */
export function normPage(raw: unknown): Page | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const view = typeof r.view === "string" && r.view in PAGE_NAME ? (r.view as PageView) : null
  if (!view) return null
  const board = typeof r.board === "string" && /^[\w-]{1,40}$/.test(r.board) ? r.board : undefined
  const work = typeof r.work === "string" && /^(item|signal|run|doc):[\w:-]{1,110}$/.test(r.work) ? r.work : undefined
  return { view, ...(board ? { board } : {}), ...(work ? { work } : {}) }
}

/** runs.page 에 저장해 둔 화면 (다시 시도할 때 같은 화면으로) */
export function storedPage(s: unknown): Page | null {
  if (typeof s !== "string" || !s) return null
  try { return normPage(JSON.parse(s)) } catch { return null }
}

const kst = (ms: number) => {
  const d = new Date(ms + 9 * 3600e3)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}
const one = (s: unknown, n = 90) => String(s || "").split("\n")[0].trim().slice(0, n)

function boardOf(db: Database, owner: string, id: string | undefined): BoardRow | null {
  const visible = (b: BoardRow | null) => (b && (b.kind === "company" || b.owner === owner) ? b : null)
  const asked = id ? visible(db.query("SELECT id, name, kind, owner FROM boards WHERE id=? AND deleted=0").get(id) as BoardRow | null) : null
  return asked || (db.query("SELECT id, name, kind, owner FROM boards WHERE kind='personal' AND owner=? AND deleted=0").get(owner) as BoardRow | null)
}

function boardItems(db: Database, boardId: string) {
  const out: { id: string; d: ItemData }[] = []
  for (const r of db.query("SELECT id, data FROM items WHERE board_id=? AND deleted=0").all(boardId) as ItemRow[]) {
    try { out.push({ id: r.id, d: JSON.parse(r.data) }) } catch { /* 깨진 항목은 건너뛴다 */ }
  }
  return out
}

function itemLines(b: BoardRow, items: { id: string; d: ItemData }[], types: string[], limit: number) {
  const open = items.filter((x) => types.includes(String(x.d.type)) && !x.d.done && one(x.d.text))
  open.sort((a, c) => compareWorkOrder({ id: a.id, ...a.d }, { id: c.id, ...c.d }))
  const lines = open.slice(0, limit).map((x) => {
    const kind = x.d.type === "goal" ? "목표" : "할 일"
    const at = x.d.due ? ` (마감 ${x.d.due})` : x.d.remindAt ? ` (알림 ${x.d.remindAt})` : ""
    return `- ${kind}: ${one(x.d.text)}${at} ref=item:${b.id}:${x.id}`
  })
  if (open.length > limit) lines.push(`- …그 밖에 ${open.length - limit}개 더`)
  return lines
}

function signalLines(db: Database, owner: string, lanes: string[], limit: number) {
  const rows = db.query(`SELECT id, title, lane, kind, due, source, meta FROM signals WHERE owner=? AND status='open' AND lane IN (${lanes.map(() => "?").join(",")}) ORDER BY updated_at DESC LIMIT ?`)
    .all(owner, ...lanes, limit) as SignalRow[]
  return rows.map((s) => {
    let work = ""
    try { work = String((JSON.parse(s.meta || "{}") as { work?: unknown }).work || "") } catch { /* meta 가 깨졌으면 사건 ref 로 */ }
    return `- [${s.lane}] ${one(s.title)}${s.due ? ` (마감 ${kst(s.due)})` : ""} ref=${work || "signal:" + s.id}`
  })
}

function workLines(db: Database, owner: string, ref: string, target: string | null) {
  if (ref === target) return [`열어 둔 일: 위 "방향판 맥락"의 그 일 (ref=${ref})`]
  const [kind, a, b] = ref.split(":")
  let title = ""
  if (kind === "signal") title = one((db.query("SELECT title FROM signals WHERE id=? AND owner=?").get(a, owner) as { title: string } | null)?.title)
  else if (kind === "item") {
    const bd = boardOf(db, owner, a)
    const row = bd && bd.id === a ? (db.query("SELECT data FROM items WHERE board_id=? AND id=? AND deleted=0").get(a, b) as { data: string } | null) : null
    try { title = row ? one((JSON.parse(row.data) as ItemData).text) : "" } catch { title = "" }
  } else if (kind === "run") title = one((db.query("SELECT prompt FROM runs WHERE owner=? AND COALESCE(thread,id)=? ORDER BY updated_at DESC LIMIT 1").get(owner, a) as { prompt: string } | null)?.prompt)
  else if (kind === "doc") title = one((db.query("SELECT title FROM docs WHERE id=? AND owner=?").get(a, owner) as {title:string} | null)?.title)
  if (!title) return []
  const note = (db.query("SELECT text FROM work_notes WHERE owner=? AND ref=?").get(scopeOf(db, owner, ref), ref) as { text: string } | null)?.text?.trim() || ""
  return [`열어 둔 일: ${title} (ref=${ref})`, ...(note ? [`그 일의 노트 앞부분:\n${note.slice(0, 600)}`] : [])]
}

function viewLines(db: Database, owner: string, page: Page): string[] {
  if (page.view === "docs") {
    const docs = db.query("SELECT title,kind,ref FROM doc_index WHERE owner=? AND status<>'archived' ORDER BY updated_at DESC LIMIT 10").all(owner) as {title:string;kind:string;ref:string}[]
    return ["최근 문서:", ...(docs.length ? docs.map(d => `- ${one(d.title)} (${d.kind}) ref=${d.ref}`) : ["- 없음"])]
  }
  const b = boardOf(db, owner, page.board)
  if (page.view === "home") {
    const decide = signalLines(db, owner, ["now", "decide"], 10)
    const main = signalLines(db, owner, ["main"], 8)
    const review = signalLines(db, owner, ["review"], 8)
    const running = signalLines(db, owner, ["running"], 8)
    return [
      "홈에는 오늘 결정할 것, 메인 일, AI가 하는 중인 일, 확인 기다림이 보여요.",
      "내 결정 대기:", ...(decide.length ? decide : ["- 없음"]),
      ...(main.length ? ["메인 일:", ...main] : []),
      ...(running.length ? ["AI가 하는 중:", ...running] : []),
      ...(review.length ? ["확인 기다림:", ...review] : []),
      ...(b ? ["열린 할 일:", ...itemLines(b, boardItems(db, b.id), ["todo"], 10)] : []),
    ]
  }
  if (!b) return []
  const items = boardItems(db, b.id)
  if (page.view === "list") {
    const sig = b.kind === "personal" ? signalLines(db, owner, ["now", "decide", "main"], 15) : []
    const todos = itemLines(b, items, ["todo", "goal"], 30)
    return [`판: ${b.name}`, "열린 할 일·목표:", ...(todos.length ? todos : ["- 없음"]), ...(sig.length ? ["내가 처리할 사건:", ...sig] : [])]
  }
  if (page.view === "road") {
    const goals = itemLines(b, items, ["goal"], 20)
    return [`판: ${b.name}`, "목표:", ...(goals.length ? goals : ["- 없음"]), "날짜가 있는 할 일:", ...itemLines(b, items.filter((x) => x.d.remindAt || x.d.due), ["todo"], 15)]
  }
  if (page.view === "board") {
    const notes = items.filter((x) => x.d.type === "sticky" && one(x.d.text)).slice(0, 10).map((x) => `- 메모: ${one(x.d.text)} ref=item:${b.id}:${x.id}`)
    return [`판: ${b.name} (화이트보드)`, "보드 위 할 일·목표:", ...itemLines(b, items, ["todo", "goal"], 20), ...(notes.length ? ["메모:", ...notes] : [])]
  }
  // ops: 운영 순회 설정과 최근 순회, 순회가 만든 열린 카드
  const o = db.query("SELECT enabled, every_min, active_from, active_to, last_run_at FROM ops_prompt WHERE owner=?").get(owner) as { enabled: number; every_min: number; active_from: number; active_to: number; last_run_at: number | null } | null
  const runs = db.query("SELECT status, created_at, error FROM runs WHERE owner=? AND kind='sweep' ORDER BY created_at DESC LIMIT 3").all(owner) as { status: string; created_at: number; error: string | null }[]
  const cards = items.filter((x) => x.id.startsWith("ops-") && !x.d.done && one(x.d.text)).slice(0, 15)
    .map((x) => `- 카드: ${one(x.d.text)}${x.d.remindAt ? ` (알림 ${x.d.remindAt})` : ""} ref=item:${b.id}:${x.id}`)
  return [
    "운영 화면에는 운영 순회(정해진 주기로 aside exec 가 영역을 돌아보는 것) 설정과 기록이 보여요.",
    o ? `순회: ${o.enabled ? "켜짐" : "꺼짐"} · ${o.every_min}분마다 · ${o.active_from}시~${o.active_to}시 · 지난 순회 ${o.last_run_at ? kst(o.last_run_at) : "없음"}` : "순회: 아직 설정 없음",
    ...(runs.length ? ["최근 순회:", ...runs.map((r) => `- ${kst(r.created_at)} ${r.status}${r.error ? ` (${one(r.error, 60)})` : ""}`)] : []),
    "순회가 만든 열린 카드:", ...(cards.length ? cards : ["- 없음"]),
  ]
}

/** AI 프롬프트 앞에 붙일 "지금 보고 있는 화면" 블록. page 가 없으면 빈 문자열 */
export function pageBlock(db: Database, owner: string, page: Page | null, target: string | null): string {
  if (!page) return ""
  try {
    return buildBlock(db, owner, page, target)
  } catch (e) {
    // 화면 요약은 덧붙이는 맥락이라, 만들다 실패해도 요청 자체는 보낸다
    console.warn("[runs] page context failed:", (e as Error).message)
    return `[지금 보고 있는 화면]\n사용자는 방향판의 "${PAGE_NAME[page.view]}" 화면에서 이 요청을 보냈어요. (화면 내용을 읽지 못했어요)\n\n`
  }
}

function buildBlock(db: Database, owner: string, page: Page, target: string | null): string {
  const lines = [
    "[지금 보고 있는 화면]",
    `사용자는 방향판의 "${PAGE_NAME[page.view]}" 화면${page.work ? "에서 일 하나를 열어 둔 채로" : "에서"} 이 요청을 보냈어요. "이거", "여기", "위에 있는 것"처럼 말하면 이 화면에 보이는 것을 가리켜요. 아래는 지금 이 화면에 보이는 것의 요약이에요.`,
    ...(page.work ? workLines(db, owner, page.work, target) : []),
    ...viewLines(db, owner, page),
  ]
  let text = lines.join("\n")
  if (text.length > MAX) text = text.slice(0, MAX) + "\n- …(길어서 줄였어요)"
  return text + "\n\n"
}
