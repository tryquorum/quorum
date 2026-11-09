// 이슈 보내기(파일럿): 뉴럴아케이드 사람이 제목·내용·긴급도·이미지를 보내면 회사 공간 할 일로 들어가고,
// 관리자에게는 결정/지금 칸 사건으로 떠요. 보낸 사람은 "내 이슈"에서 접수·진행·끝을 봐요. 설계: docs/internals/pilot.md
import type { Database } from "bun:sqlite"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { Issue, IssueStatus, IssueUrgency } from "@direction-board/contracts/api"
import { findSameTodo } from "./dedup.ts"
import { defaultWorkspaceId } from "./spaces.ts"

type U = { email: string; agent: boolean }
export type IssueDeps = {
  /** 회사 판 id(없으면 만들어요) */
  companyBoard: () => string
  readItem: (bid: string, iid: string) => { data: Record<string, unknown> } | null
  putItem: (bid: string, iid: string, data: Record<string, unknown>, actor: string, space?: string) => void
  ingest: (owner: string, raw: Record<string, unknown>) => unknown
  admins: string[]
  isAdmin: (email: string) => boolean
  uploadsDir: string
  /** 지금도 들어올 수 있는 사람인지(허용 목록·비활성). 받기 시작할 때와 쓰기 직전에 다시 봐요 */
  active: (email: string) => boolean
  /** 보내기 빈도·첨부 저장량 한도(시험에서 줄여요). 없으면 LIMITS */
  limits?: Partial<IssueLimits>
}
export type IssueLimits = { perWindow: number; windowMs: number; userBytes: number; totalBytes: number }
/** 한 사람 10분에 10건, 첨부는 한 사람 200MB·전체 2GB 까지 */
export const LIMITS: IssueLimits = { perWindow: 10, windowMs: 10 * 60e3, userBytes: 200 * 1024 * 1024, totalBytes: 2 * 1024 * 1024 * 1024 }
/** 첨부 크기 합(issues.files 의 size). reporter 를 주면 그 사람 것만 */
function storedBytes(db: Database, reporter?: string): number {
  const rows = (reporter ? db.query("SELECT files FROM issues WHERE reporter=? AND files<>'[]'").all(reporter) : db.query("SELECT files FROM issues WHERE files<>'[]'").all()) as { files: string }[]
  return rows.reduce((n, r) => n + (JSON.parse(r.files || "[]") as FileMeta[]).reduce((m, f) => m + (Number(f.size) || 0), 0), 0)
}
/** 커밋 직전 다시 본 한도에 걸림(트랜잭션을 되돌려요) */
class Refused extends Error { constructor(readonly status: number, message: string) { super(message) } }

const ISSUE_DONE = "이슈가 끝났어요"
/**
 * 관리자 이슈 사건(ref issue:<할 일 id>)을 그 할 일의 상태에 맞춰요: 할 일이 끝났거나 지워졌으면 닫고(결정·지금 칸에서 빠짐),
 * 이 규칙으로 닫았던 사건은 할 일을 다시 열면 다시 열어요. 이슈 상태 바꾸기·화면에서 할 일 끝내기·MCP 어느 길이든 같은 결과예요
 */
export function syncIssueSignals(db: Database): number {
  const t = now()
  let changed = 0
  for (const s of db.query("SELECT id, status, reason, meta FROM signals WHERE ref LIKE 'issue:%' AND (status='open' OR reason=?)").all(ISSUE_DONE) as { id: string; status: string; reason: string | null; meta: string | null }[]) {
    let work = ""
    try { work = String(JSON.parse(s.meta || "{}").work || "") } catch { continue }
    const [kind, bid, iid] = work.split(":")
    if (kind !== "item" || !bid || !iid) continue
    const row = db.query("SELECT data, deleted FROM items WHERE board_id=? AND id=?").get(bid, iid) as { data: string; deleted: number } | null
    let done = !row || !!row.deleted
    try { if (row && !done) done = !!JSON.parse(row.data).done } catch { /* 깨진 항목은 열린 것으로 */ }
    if (done && s.status === "open") db.query("UPDATE signals SET status='resolved', resolved_at=?, updated_at=?, reason=? WHERE id=?").run(t, t, ISSUE_DONE, s.id)
    else if (!done && s.status === "resolved") db.query("UPDATE signals SET status='open', resolved_at=NULL, updated_at=?, reason='이슈가 다시 열렸어요' WHERE id=?").run(t, s.id)
    else continue
    changed++
  }
  return changed
}
type Row = { id: string; workspace: string; reporter: string; title: string; body: string; urgency: IssueUrgency; status: IssueStatus; item_ref: string; merged: number; files: string; created_at: number; updated_at: number }
type FileMeta = { name: string; type: string; size: number }

const URGENCY: IssueUrgency[] = ["low", "normal", "high", "urgent"]
const URGENCY_KO: Record<IssueUrgency, string> = { low: "낮음", normal: "보통", high: "높음", urgent: "긴급" }
const STATUS: IssueStatus[] = ["received", "in_progress", "done"]
const MAX_FILES = 3
const MAX_BYTES = 5 * 1024 * 1024
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } })
const err = (status: number, error: string) => json({ error }, status)
const now = () => Date.now()
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "")

export function initIssues(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS issues(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, reporter TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    urgency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received', item_ref TEXT NOT NULL, merged INTEGER NOT NULL DEFAULT 0, files TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS issues_reporter ON issues(reporter, created_at);`)
}

/** 이미지 형식은 앞 바이트로 확인해요(이름·브라우저가 준 형식은 믿지 않음) */
export function sniffImage(b: Uint8Array): { type: string; ext: string } | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: "image/png", ext: "png" }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" }
  if (b.length >= 6 && String.fromCharCode(...b.slice(0, 4)) === "GIF8") return { type: "image/gif", ext: "gif" }
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return { type: "image/webp", ext: "webp" }
  return null
}

function view(db: Database, deps: IssueDeps, r: Row): Issue {
  const [, bid, iid] = r.item_ref.split(":")
  const item = deps.readItem(bid, iid)
  const files = JSON.parse(r.files || "[]") as FileMeta[]
  return {
    id: r.id, title: r.title, body: r.body, urgency: r.urgency, reporter: r.reporter, itemRef: r.item_ref, merged: !!r.merged,
    // 할 일을 끝내면 이슈도 끝이에요. 할 일이 사라졌으면 마지막 상태 그대로
    status: item?.data.done ? "done" : r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
    files: files.map((f) => ({ ...f, url: `/api/issues/${r.id}/files/${f.name}` })),
  }
}

async function create(db: Database, deps: IssueDeps, u: U, req: Request): Promise<Response> {
  if (!deps.active(u.email)) return err(403, "들어올 수 없는 계정이에요")
  const lim = { ...LIMITS, ...deps.limits }
  // 빈도·첨부 한도는 여기서 먼저 보고(빨리 거절), 커밋 직전 트랜잭션 안에서 한 번 더 봐요(동시에 보낸 요청이 함께 넘지 않게)
  const recent = () => (db.query("SELECT COUNT(*) AS n FROM issues WHERE reporter=? AND created_at>?").get(u.email, now() - lim.windowMs) as { n: number }).n
  const TOO_FAST = "이슈를 너무 자주 보냈어요. 잠시 뒤에 다시 보내 주세요", MINE_FULL = "내 첨부 저장 한도를 넘어요. 이미지를 빼고 보내 주세요", ALL_FULL = "첨부 저장 공간이 모자라요. 관리자에게 알려 주세요"
  if (recent() >= lim.perWindow) return err(429, TOO_FAST)
  const form = await req.formData().catch(() => null)
  if (!form) return err(400, "multipart form required: title, body, urgency, files")
  const title = str(form.get("title"), 160)
  const body = str(form.get("body"), 8000)
  const urgency = str(form.get("urgency"), 10) as IssueUrgency
  if (title.length < 2) return err(400, "제목을 2자 이상 적어 주세요")
  if (!URGENCY.includes(urgency)) return err(400, "urgency must be low|normal|high|urgent")
  const uploads = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0)
  if (uploads.length > MAX_FILES) return err(400, `이미지는 ${MAX_FILES}개까지예요`)
  const images: { bytes: Uint8Array; type: string; ext: string }[] = []
  for (const f of uploads) {
    if (f.size > MAX_BYTES) return err(413, "이미지 하나는 5MB 까지예요")
    const bytes = new Uint8Array(await f.arrayBuffer())
    const kind = sniffImage(bytes)
    if (!kind) return err(415, "PNG·JPEG·GIF·WEBP 이미지만 보낼 수 있어요")
    images.push({ bytes, ...kind })
  }
  const size = images.reduce((n, i) => n + i.bytes.length, 0)
  if (size && storedBytes(db, u.email) + size > lim.userBytes) return err(413, MINE_FULL)
  if (size && storedBytes(db) + size > lim.totalBytes) return err(507, ALL_FULL)
  const ws = defaultWorkspaceId(db)
  if (!ws) return err(409, "회사 공간이 없어요")
  const bid = deps.companyBoard()
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16)
  const files: FileMeta[] = []
  const dir = join(deps.uploadsDir, "issues", id)
  // 첨부 쓰기·확인·트랜잭션 가운데 하나라도 실패하면 이 이슈 폴더를 지워 고아 파일을 남기지 않아요
  const cleanup = () => (images.length ? rm(dir, { recursive: true, force: true }).catch(() => undefined) : Promise.resolve())
  try {
    if (images.length) {
      await mkdir(dir, { recursive: true })
      for (const [i, img] of images.entries()) {
        const name = `${i + 1}.${img.ext}`
        await Bun.write(join(dir, name), img.bytes)
        files.push({ name, type: img.type, size: img.bytes.length })
      }
    }
  } catch (e) { await cleanup(); throw e }
  // 공유 항목(회사 판 할 일)의 기록에는 본문을 넣지 않아요. 본문은 보낸 사람·관리자만 봐요(issues 표, 관리자 사건)
  const line = `이슈(${URGENCY_KO[urgency]}) · ${u.email} 이 보냄${files.length ? ` · 첨부 ${files.length}개` : ""}`
  const privateLine = `이슈(${URGENCY_KO[urgency]}) · ${u.email}${body ? `\n${body}` : ""}${files.length ? `\n첨부 ${files.length}개` : ""}`
  // 파일을 쓰는 사이 비활성·허용 해제됐을 수 있어요. 여기서 다시 보고, 그 뒤 쓰기는 await 없이 한 트랜잭션이에요
  if (!deps.active(u.email)) {
    await cleanup()
    return err(403, "들어올 수 없는 계정이에요")
  }
  try { db.transaction(() => {
    if (recent() >= lim.perWindow) throw new Refused(429, TOO_FAST)
    if (size && storedBytes(db, u.email) + size > lim.userBytes) throw new Refused(413, MINE_FULL)
    if (size && storedBytes(db) + size > lim.totalBytes) throw new Refused(507, ALL_FULL)
    // 같은 공간의 열린 같은 제목 할 일이 있으면 합쳐요: 할 일은 건드리지 않고(기록에 쓰지 않아 사람 기록이 밀리지 않음) 이슈 표가 그 할 일을 가리켜요
    const same = findSameTodo(db, bid, title, { space: ws })
    const merged = !!same && !same.done
    const iid = merged ? same.iid : "is-" + id.slice(0, 10)
    if (!merged) deps.putItem(bid, iid, { type: "todo", text: title, done: false, x: 0, y: 0, w: 240, h: 90, z: now(), placed: false, area: "issue", log: [{ by: u.email, at: now(), text: line }] }, u.email, ws)
    const itemRef = `item:${bid}:${iid}`
    const t = now()
    db.query("INSERT INTO issues(id,workspace,reporter,title,body,urgency,status,item_ref,merged,files,created_at,updated_at) VALUES (?,?,?,?,?,?,'received',?,?,?,?,?)")
      .run(id, ws, u.email, title, body, urgency, itemRef, merged ? 1 : 0, JSON.stringify(files), t, t)
    for (const admin of deps.admins) {
      deps.ingest(admin, {
        ref: `issue:${iid}`, source: "issue", kind: urgency === "urgent" || urgency === "high" ? "approval" : "question",
        lane: urgency === "urgent" ? "now" : "decide", reason: `${u.email} 님이 보낸 이슈 · ${URGENCY_KO[urgency]}${merged ? " · 같은 할 일에 합쳐짐" : ""}`,
        title: `이슈: ${title}`, body: privateLine.slice(0, 4000), work: itemRef, space: ws, agent: "이슈 보내기",
      })
    }
  })() } catch (e) { await cleanup(); if (e instanceof Refused) return err(e.status, e.message); throw e }
  return json({ issue: view(db, deps, db.query("SELECT * FROM issues WHERE id=?").get(id) as Row) }, 201)
}

/** POST/GET /api/issues, PATCH /api/issues/:id(관리자), GET /api/issues/:id/files/:name(보낸 사람·관리자) */
export async function issuesApi(db: Database, req: Request, url: URL, parts: string[], u: U, deps: IssueDeps): Promise<Response | null> {
  if (parts[1] !== "issues") return null
  if (u.agent) return err(403, "issues are for people")
  const m = req.method
  const admin = deps.isAdmin(u.email)
  if (parts.length === 2 && m === "POST") return create(db, deps, u, req)
  if (parts.length === 2 && m === "GET") {
    const all = admin && url.searchParams.get("scope") === "all"
    const rows = (all ? db.query("SELECT * FROM issues ORDER BY created_at DESC LIMIT 200").all() : db.query("SELECT * FROM issues WHERE reporter=? ORDER BY created_at DESC LIMIT 200").all(u.email)) as Row[]
    return json({ issues: rows.map((r) => view(db, deps, r)) })
  }
  const row = parts[2] ? (db.query("SELECT * FROM issues WHERE id=?").get(parts[2]) as Row | null) : null
  if (!row || (!admin && row.reporter !== u.email)) return err(404, "issue not found")
  if (parts.length === 3 && m === "PATCH") {
    if (!admin) return err(403, "only an admin changes issue status")
    const body = (await req.json().catch(() => null)) as { status?: unknown } | null
    const status = str(body?.status, 20) as IssueStatus
    if (!STATUS.includes(status)) return err(400, "status must be received|in_progress|done")
    db.query("UPDATE issues SET status=?, updated_at=? WHERE id=?").run(status, now(), row.id)
    const [, bid, iid] = row.item_ref.split(":")
    const prev = deps.readItem(bid, iid)?.data
    // 끝·다시 열기는 할 일과 같이 움직여요(같은 할 일에 합쳐진 다른 이슈도 함께)
    if (prev && !!prev.done !== (status === "done")) deps.putItem(bid, iid, { ...prev, done: status === "done" }, u.email)
    syncIssueSignals(db)
    return json({ issue: view(db, deps, db.query("SELECT * FROM issues WHERE id=?").get(row.id) as Row) })
  }
  if (parts.length === 5 && parts[3] === "files" && m === "GET") {
    const meta = (JSON.parse(row.files || "[]") as FileMeta[]).find((f) => f.name === parts[4])
    if (!meta) return err(404, "file not found")
    const file = Bun.file(join(deps.uploadsDir, "issues", row.id, meta.name))
    if (!(await file.exists())) return err(404, "file not found")
    return new Response(file, { headers: { "content-type": meta.type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-disposition": "inline" } })
  }
  return err(405, "method not allowed")
}
