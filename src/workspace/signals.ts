// 사건(signal) 분류. 출처: board/apps/server/server/signals.ts (방향판 2ee6e8a) 의 triage() 와 ingest() 의 "같은 ref 면 갱신" 흐름.
// 바꾼 점: 공간(space)·사용자(owner)·수집기(collector)는 빼고 이 맥 한 사람용으로, 칸 이름은 그대로(now/decide/review/running/auto/main/info).
// Workspace 화면은 decide·now 를 "Needs you", review 를 "Review" 로 보여 줘요. 사람이 이미 처리한 사건은 자동 갱신이 덮지 않아요.
import type { Database } from "bun:sqlite"

export const KINDS = ["start", "progress", "done", "error", "question", "approval", "deadline", "auth", "info"] as const
export const LANES = ["now", "decide", "review", "running", "auto", "main", "info"] as const
const RISKS = new Set(["money", "external", "security", "prod", "legal", "private"])
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "")

export type SignalRow = {
  id: string; ref: string | null; source: string; kind: string; title: string; body: string | null
  lane: string; reason: string | null; status: "open" | "running" | "resolved"; meta: string | null
  created_at: number; updated_at: number; resolved_at: number | null
}
export type Signal = Omit<SignalRow, "meta"> & { meta: Record<string, any> }

export function initSignals(db: Database) {
  db.exec(`
CREATE TABLE IF NOT EXISTS signals(
  id TEXT PRIMARY KEY, ref TEXT, source TEXT NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT, lane TEXT NOT NULL, reason TEXT,
  status TEXT NOT NULL DEFAULT 'open', meta TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resolved_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS signals_ref ON signals(ref);
CREATE INDEX IF NOT EXISTS signals_open ON signals(status, updated_at);`)
}

type Sig = Record<string, any>

/** 규칙 분류(board signals.ts triage 에서 피드백 규칙만 뺀 그대로). 순서: 위험 표시 → 종류별 기본 규칙 → 애매하면 결정 대기 */
export function triage(s: Sig, now = Date.now()): { lane: string; reason: string } {
  const risks: string[] = (s.risk || []).filter((x: string) => RISKS.has(x))
  const riskKo: Record<string, string> = { money: "돈", external: "외부로 나가는 것", security: "보안", prod: "실서비스", legal: "계약·법", private: "개인" }
  const done = s.kind === "done" || (s.kind === "error" && s.fixed)
  if (!done && (s.blocking || (risks.length && ["error", "approval", "question"].includes(s.kind)))) {
    return { lane: "now", reason: s.blocking ? "메인 일을 막고 있어요" : risks.map((r) => riskKo[r]).join(", ") + "이 걸려 있어요" }
  }
  switch (s.kind) {
    case "start":
    case "progress":
      return { lane: "running", reason: (s.agent || "에이전트") + "가 하는 중" }
    case "done":
      return s.review ? { lane: "review", reason: "끝났지만 한 번 봐주면 좋아요" } : { lane: "auto", reason: (s.agent || "에이전트") + "가 끝냈어요" }
    case "error":
      if (s.fixed) return { lane: s.review ? "review" : "auto", reason: s.review ? "AI가 고쳤어요 · 확인 필요" : "AI가 알아서 고쳤어요" }
      if (s.ai_fixable === true) return { lane: "running", reason: "AI가 고칠 수 있는 오류라 맡겼어요" }
      return { lane: "decide", reason: s.ai_fixable === false ? "AI가 못 고치는 오류예요" : "고칠 수 있는지 애매해요" }
    case "auth":
      return s.human_step ? { lane: "decide", reason: "휴대폰 승인·인증번호가 필요해요" } : { lane: "auto", reason: "에이전트가 다시 로그인했어요" }
    case "question":
    case "approval":
      return { lane: "decide", reason: s.kind === "approval" ? "승인이 필요해요" : "답이 필요해요" }
    case "deadline": {
      const left = s.due ? s.due - now : Infinity
      if (left < 48 * 3600e3) return { lane: "main", reason: left < 0 ? "마감이 지났어요" : "48시간 안에 마감" }
      return { lane: "info", reason: "다가오는 마감" }
    }
    case "info":
      return { lane: "info", reason: "기록만" }
  }
  return { lane: "decide", reason: "분류가 애매해요" }
}

export const pubSignal = (r: SignalRow): Signal => {
  let meta: Record<string, any> = {}
  try { meta = r.meta ? JSON.parse(r.meta) : {} } catch { meta = {} }
  return { ...r, meta }
}

/**
 * 사건 하나를 분류해서 넣어요(같은 ref 면 갱신). 문자열을 돌려주면 오류.
 * 사람이 처리한 사건(meta.decidedBy 가 있거나 이미 resolved)은 자동 갱신이 덮지 않고 그대로 돌려줘요.
 */
export function ingestSignal(db: Database, raw: any, now = Date.now()): Signal | string {
  if (!raw || typeof raw !== "object") return "signal must be an object"
  const kind = str(raw.kind, 20)
  if (!(KINDS as readonly string[]).includes(kind)) return "kind must be one of " + KINDS.join("|")
  const title = str(raw.title, 200)
  if (!title) return "title required"
  const ref = str(raw.ref, 200) || null
  const s: Sig = { ...raw, kind, title, risk: Array.isArray(raw.risk) ? raw.risk.map(String).slice(0, 6) : [] }
  const t = triage(s, now)
  const lane = raw.lane && (LANES as readonly string[]).includes(raw.lane) ? raw.lane : t.lane
  const reason = str(raw.reason, 300) || t.reason
  const resolved = ["auto", "info"].includes(lane) && kind !== "deadline"
  const meta = raw.meta && typeof raw.meta === "object" ? raw.meta : {}
  const existing = ref ? (db.query("SELECT * FROM signals WHERE ref=?").get(ref) as SignalRow | null) : null
  if (existing) {
    const prev = pubSignal(existing)
    if (prev.meta.decidedBy || (existing.status === "resolved" && prev.meta.resolvedBy)) return prev
    // 결정 전 의회 사건(quorum:)의 실행 지시는 다시 들어온 meta 가 바꾸지 못해요(리뷰 지적 6: 승인 카드에 보인 일과 실행되는 일이 같아야 해요)
    const locked = existing.ref?.startsWith("quorum:") && existing.status !== "resolved" ? Object.fromEntries(["task", "executor", "proposalId", "runId"].filter((k) => prev.meta[k] !== undefined).map((k) => [k, prev.meta[k]])) : {}
    const next = { source: str(raw.source, 40) || existing.source, kind, title, body: str(raw.body, 8000) || null, lane, reason, status: resolved ? "resolved" : "open", meta: JSON.stringify({ ...prev.meta, ...meta, ...locked }) }
    // 3070 사건은 60초마다, 의회 판정은 읽을 때마다 다시 들어와요. 바뀐 게 없으면 손대지 않아요(updated_at 이 그대로라 Needs you 순서가 흔들리지 않아요)
    const same = next.source === existing.source && next.kind === existing.kind && next.title === existing.title && next.body === existing.body && next.lane === existing.lane && next.reason === existing.reason && next.status === existing.status && next.meta === (existing.meta ?? "{}")
    if (same) return prev
    db.query("UPDATE signals SET source=?,kind=?,title=?,body=?,lane=?,reason=?,status=?,meta=?,updated_at=?,resolved_at=? WHERE id=?")
      .run(next.source, next.kind, next.title, next.body, next.lane, next.reason, next.status, next.meta, now, resolved ? now : null, existing.id)
    return getSignal(db, existing.id)!
  }
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12)
  db.query("INSERT INTO signals(id,ref,source,kind,title,body,lane,reason,status,meta,created_at,updated_at,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, ref, str(raw.source, 40) || "agent", kind, title, str(raw.body, 8000) || null, lane, reason, resolved ? "resolved" : "open", JSON.stringify(meta), now, now, resolved ? now : null)
  return getSignal(db, id)!
}

export function getSignal(db: Database, id: string): Signal | null {
  const r = db.query("SELECT * FROM signals WHERE id=?").get(id) as SignalRow | null
  return r ? pubSignal(r) : null
}

export function listSignals(db: Database, opts: { open?: boolean; limit?: number } = {}): Signal[] {
  const rows = (opts.open
    ? db.query("SELECT * FROM signals WHERE status!='resolved' ORDER BY updated_at DESC LIMIT ?").all(opts.limit ?? 200)
    : db.query("SELECT * FROM signals ORDER BY updated_at DESC LIMIT ?").all(opts.limit ?? 200)) as SignalRow[]
  return rows.map(pubSignal)
}

/** 사람이 처리할 때만 쓰는 상태 바꾸기. from 상태가 아니면 null(동시에 두 번 눌러도 한 번만) */
export function moveSignal(db: Database, id: string, from: Signal["status"][], next: { status: Signal["status"]; lane: string; reason: string; kind?: string; body?: string | null; meta?: Record<string, unknown> }, now = Date.now()): Signal | null {
  return db.transaction(() => {
    const cur = getSignal(db, id)
    if (!cur || !from.includes(cur.status)) return null
    db.query("UPDATE signals SET status=?, lane=?, reason=?, kind=?, body=?, meta=?, updated_at=?, resolved_at=? WHERE id=?")
      .run(next.status, next.lane, next.reason, next.kind ?? cur.kind, next.body === undefined ? cur.body : next.body, JSON.stringify({ ...cur.meta, ...(next.meta || {}) }), now, next.status === "resolved" ? now : null, id)
    return getSignal(db, id)
  })()
}
