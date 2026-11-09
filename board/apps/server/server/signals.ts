// 사건(signal) 입구 + 규칙 분류. 어떤 봇이든 "시작했어 / 에러 났어 / 끝났어"를 POST 하면
// 규칙으로 4칸(지금 / 결정 대기 / 하는 중 / AI가 처리함) 중 하나에 꽂힌다. 애매한 건 needs_ai 로 표시.
import type { Database } from "bun:sqlite";
import { resolveSpace, spaceOfRef, spacesReady, spaceValue } from "./spaces.ts";

type U = { email: string; agent: boolean };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const err = (status: number, message: string) => json({ error: message }, status);
const now = () => Date.now();
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export const KINDS = ["start", "progress", "done", "error", "question", "approval", "deadline", "auth", "info"] as const;
export const LANES = ["now", "decide", "review", "running", "auto", "main", "info"] as const;
const RISKS = new Set(["money", "external", "security", "prod", "legal", "private"]);

export function initSignals(db: Database) {
  db.exec(`
CREATE TABLE IF NOT EXISTS signals(
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, ref TEXT, source TEXT NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT, url TEXT, area TEXT, task TEXT, agent TEXT,
  lane TEXT NOT NULL, reason TEXT, needs_ai INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open', private INTEGER NOT NULL DEFAULT 0, sample INTEGER NOT NULL DEFAULT 0,
  due INTEGER, meta TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resolved_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS signals_ref ON signals(owner, ref);
CREATE INDEX IF NOT EXISTS signals_open ON signals(owner, status, updated_at);
CREATE TABLE IF NOT EXISTS triage_rules(id TEXT PRIMARY KEY, owner TEXT NOT NULL, source TEXT, kind TEXT, contains TEXT, lane TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS collectors(owner TEXT NOT NULL, name TEXT NOT NULL, ok INTEGER NOT NULL, note TEXT, last_seen INTEGER NOT NULL, last_ok INTEGER, every_min INTEGER, sample INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner, name));
`);
}

type Sig = Record<string, any>;

/** 규칙 분류. 순서: 내가 준 피드백 규칙 → 위험 표시 → 종류별 기본 규칙 → 애매하면 결정 대기 + AI 판단 필요 */
export function triage(s: Sig, rules: any[]): { lane: string; reason: string; needs_ai: boolean } {
  const hay = `${s.title} ${s.body || ""}`.toLowerCase();
  for (const r of rules) {
    if (r.source && r.source !== s.source) continue;
    if (r.kind && r.kind !== s.kind) continue;
    if (r.contains && !hay.includes(String(r.contains).toLowerCase())) continue;
    return { lane: r.lane, reason: `내 규칙: ${r.note || (r.lane === "info" ? "이런 건 안 알려줘도 됨" : "이런 건 바로 알려줘")}`, needs_ai: false };
  }
  const risks: string[] = (s.risk || []).filter((x: string) => RISKS.has(x));
  const riskKo: Record<string, string> = { money: "돈", external: "외부로 나가는 것", security: "보안", prod: "실서비스", legal: "계약·법", private: "개인" };
  const done = s.kind === "done" || (s.kind === "error" && s.fixed);
  if (!done && (s.blocking || (risks.length && ["error", "approval", "question"].includes(s.kind)))) {
    return { lane: "now", reason: s.blocking ? "메인 일을 막고 있어요" : `${risks.map((r) => riskKo[r]).join(", ")}이 걸려 있어요`, needs_ai: false };
  }
  switch (s.kind) {
    case "start":
    case "progress":
      return { lane: "running", reason: `${s.agent || "에이전트"}가 하는 중`, needs_ai: false };
    case "done":
      return s.review
        ? { lane: "review", reason: "끝났지만 한 번 봐주면 좋아요", needs_ai: false }
        : { lane: "auto", reason: `${s.agent || "에이전트"}가 끝냈어요`, needs_ai: false };
    case "error":
      if (s.fixed) return { lane: s.review ? "review" : "auto", reason: s.review ? "AI가 고쳤어요 · 확인 필요" : "AI가 알아서 고쳤어요", needs_ai: false };
      if (s.ai_fixable === true) return { lane: "running", reason: "AI가 고칠 수 있는 오류라 맡겼어요", needs_ai: false };
      if (s.ai_fixable === false) return { lane: "decide", reason: "AI가 못 고치는 오류예요", needs_ai: false };
      return { lane: "decide", reason: "고칠 수 있는지 애매해요 · AI 판단 대기", needs_ai: true };
    case "auth":
      return s.human_step
        ? { lane: "decide", reason: "휴대폰 승인·인증번호가 필요해요", needs_ai: false }
        : { lane: "auto", reason: "에이전트가 다시 로그인했어요", needs_ai: false };
    case "question":
    case "approval":
      return { lane: "decide", reason: s.kind === "approval" ? "승인이 필요해요" : "답이 필요해요", needs_ai: false };
    case "deadline": {
      const left = s.due ? s.due - now() : Infinity;
      if (left < 48 * 3600e3) return { lane: "main", reason: left < 0 ? "마감이 지났어요" : "48시간 안에 마감", needs_ai: false };
      return { lane: "info", reason: "다가오는 마감", needs_ai: false };
    }
    case "info":
      return { lane: "info", reason: "기록만", needs_ai: false };
  }
  return { lane: "decide", reason: "분류가 애매해요 · AI 판단 대기", needs_ai: true };
}

function clean(raw: any): Sig | string {
  if (!raw || typeof raw !== "object") return "signal must be an object";
  const kind = str(raw.kind, 20);
  if (!(KINDS as readonly string[]).includes(kind)) return `kind must be one of ${KINDS.join("|")}`;
  const title = str(raw.title, 200);
  if (!title) return "title required";
  const source = str(raw.source, 40) || "agent";
  let due: number | null = null;
  if (raw.due) {
    const d = typeof raw.due === "number" ? raw.due : Date.parse(String(raw.due).length === 10 ? `${raw.due}T23:59:00+09:00` : String(raw.due));
    if (!Number.isFinite(d)) return "due must be ISO date/time or epoch ms";
    due = d;
  }
  const lane = raw.lane && (LANES as readonly string[]).includes(raw.lane) ? raw.lane : null;
  return {
    ref: str(raw.ref, 200) || null, source, kind, title, body: str(raw.body, 4000) || null, url: str(raw.url, 1000) || null,
    area: str(raw.area, 40) || null, task: str(raw.task, 200) || null, agent: str(raw.agent, 60) || null,
    risk: Array.isArray(raw.risk) ? raw.risk.map((x: unknown) => String(x)).slice(0, 6) : [],
    blocking: !!raw.blocking, fixed: !!raw.fixed, review: !!raw.review, human_step: !!raw.human_step,
    ai_fixable: raw.ai_fixable === true ? true : raw.ai_fixable === false ? false : undefined,
    private: !!raw.private, sample: !!raw.sample, due, lane, reason: str(raw.reason, 200) || null, work: str(raw.work, 120) || null,
  };
}

const pub = (r: any) => ({ ...r, private: !!r.private, sample: !!r.sample, needs_ai: !!r.needs_ai, meta: r.meta ? JSON.parse(r.meta) : null, space: spaceValue(r.space) });


/** 사건 하나를 분류해서 넣는다 (같은 ref 면 갱신). 문자열을 돌려주면 오류 */
export function ingest(db: Database, owner: string, raw: any, loopback: boolean): any {
  const rules = db.query("SELECT * FROM triage_rules WHERE owner=? ORDER BY created_at DESC").all(owner) as any[];
  const s = clean(raw);
  if (typeof s === "string") return s;
  if (s.private && !loopback) return "private signals stay on the local board (this server is not loopback-only)";
  // 공간: 보낸 값, 없으면 연결한 일(work)의 공간. 같은 ref 의 사건이 다른 공간에 있으면 보낸 값으로는 덮지 않고 거절해요
  const asked = resolveSpace(db, raw?.space);
  if (asked === null) return "unknown space (GET /api/spaces)";
  const space = asked ?? (s.work ? spaceOfRef(db, owner, s.work) : null) ?? undefined;
  const t = triage(s, rules);
  const lane = s.lane || t.lane;
  const reason = s.reason || t.reason;
  const meta = JSON.stringify({ risk: s.risk, blocking: s.blocking, fixed: s.fixed, review: s.review, human_step: s.human_step, ai_fixable: s.ai_fixable, work: s.work });
  const ts = now();
  const existing = s.ref ? (db.query("SELECT id FROM signals WHERE owner=? AND ref=?").get(owner, s.ref) as any) : null;
  if (existing && asked !== undefined && spacesReady(db)) {
    const was = spaceValue((db.query("SELECT space FROM signals WHERE id=?").get(existing.id) as { space: string | null }).space);
    if (was !== asked) return `다른 공간(${was})의 같은 ref 예요: ${s.ref}`;
  }
  const id = existing?.id || crypto.randomUUID().slice(0, 12);
  const resolved = ["auto", "info"].includes(lane) && s.kind !== "deadline";
  if (existing) {
    // 사람이 문서 화면에서 고친 제목은 지키고, 그 표시도 이어 간다
    const prevRow = db.query("SELECT title, meta FROM signals WHERE id=?").get(existing.id) as { title: string; meta: string | null } | null;
    let personTitle: string | null = null;
    try { if (prevRow?.meta && JSON.parse(prevRow.meta)?.titleBy === "person") personTitle = prevRow.title; } catch { /* 깨진 meta 는 무시 */ }
    const metaOut = personTitle !== null ? JSON.stringify({ ...JSON.parse(meta), titleBy: "person" }) : meta;
    db.query(`UPDATE signals SET source=?,kind=?,title=?,body=?,url=?,area=?,task=?,agent=?,lane=?,reason=?,needs_ai=?,status=?,private=?,sample=?,due=?,meta=?,updated_at=?,resolved_at=? WHERE id=?`)
      .run(s.source, s.kind, personTitle ?? s.title, s.body, s.url, s.area, s.task, s.agent, lane, reason, t.needs_ai && !s.lane ? 1 : 0, resolved ? "resolved" : "open", s.private ? 1 : 0, s.sample ? 1 : 0, s.due, metaOut, ts, resolved ? ts : null, id);
  } else {
    const sp = spacesReady(db);
    db.query(`INSERT INTO signals(id,owner,ref,source,kind,title,body,url,area,task,agent,lane,reason,needs_ai,status,private,sample,due,meta,created_at,updated_at,resolved_at${sp ? ",space" : ""}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?${sp ? ",?" : ""})`)
      .run(id, owner, s.ref, s.source, s.kind, s.title, s.body, s.url, s.area, s.task, s.agent, lane, reason, t.needs_ai && !s.lane ? 1 : 0, resolved ? "resolved" : "open", s.private ? 1 : 0, s.sample ? 1 : 0, s.due, meta, ts, ts, resolved ? ts : null, ...(sp ? [space ?? null] : []));
  }
  // 같은 일(task)의 "하는 중" 기록은 끝/고침/막힘 소식이 오면 닫는다
  if (s.task && lane !== "running") {
    db.query("UPDATE signals SET status='resolved', resolved_at=?, updated_at=? WHERE owner=? AND task=? AND lane='running' AND status='open' AND id<>?").run(ts, ts, owner, s.task, id);
  }
  return pub(db.query("SELECT * FROM signals WHERE id=?").get(id));
}

export async function signalsApi(db: Database, req: Request, url: URL, u: U, parts: string[], loopback: boolean): Promise<Response | null> {
  const m = req.method;
  const owner = u.email;

  if (parts[1] === "signals") {
    if (parts.length === 2 && m === "GET") {
      // ?ref: 그 ref 의 사건만(앱의 새 일 복구가 사건을 다시 만들지 않고 찾는 읽기, PR #39 리뷰 9)
      const ref = url.searchParams.get("ref");
      if (ref) return json({ signals: db.query("SELECT * FROM signals WHERE owner=? AND ref=?").all(owner, ref).map(pub) });
      const week = now() - 7 * 86400e3;
      const rows = db.query("SELECT * FROM signals WHERE owner=? AND (status='open' OR updated_at>?) ORDER BY updated_at DESC LIMIT 500").all(owner, week) as any[];
      const rules = db.query("SELECT * FROM triage_rules WHERE owner=? ORDER BY created_at DESC").all(owner);
      const collectors = db.query("SELECT * FROM collectors WHERE owner=? ORDER BY name").all(owner);
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const interrupts = (db.query("SELECT COUNT(*) AS n FROM signals WHERE owner=? AND lane='now' AND created_at>=?").get(owner, dayStart.getTime()) as any).n;
      return json({ signals: rows.map(pub), rules, collectors, stats: { interrupts_today: interrupts } });
    }
    if (parts.length === 2 && m === "POST") {
      const body = (await req.json().catch(() => null)) as any;
      const list = Array.isArray(body?.signals) ? body.signals : [body];
      if (list.length > 200) return err(400, "max 200 signals per request");
      const out: any[] = [];
      for (const raw of list) {
        const r = ingest(db, owner, raw, loopback);
        if (typeof r === "string") return err(400, r);
        out.push(r);
      }
      return json(Array.isArray(body?.signals) ? { signals: out } : out[0], 201);
    }
    if (parts.length === 2 && m === "DELETE" && url.searchParams.get("sample") === "1") {
      const a = db.query("DELETE FROM signals WHERE owner=? AND sample=1").run(owner).changes;
      const b = db.query("DELETE FROM collectors WHERE owner=? AND sample=1").run(owner).changes;
      return json({ deleted: a, collectors: b });
    }
    if (parts.length === 3 && m === "PATCH") {
      const row = db.query("SELECT * FROM signals WHERE id=? AND owner=?").get(parts[2], owner) as any;
      if (!row) return err(404, "signal not found");
      const body = (await req.json().catch(() => ({}))) as any;
      const ts = now();
      if (body.feedback === "mute" || body.feedback === "urgent") {
        const lane = body.feedback === "mute" ? "info" : "now";
        const contains = str(body.contains, 80) || null;
        // 같은 규칙이 이미 있으면 다시 만들지 않아요(결과를 모른 채 다시 누른 앱이 규칙을 두 번 만들지 않게)
        const same = db.query("SELECT 1 FROM triage_rules WHERE owner=? AND source=? AND kind=? AND contains IS ? AND lane=?").get(owner, row.source, row.kind, contains, lane);
        if (!same) db.query("INSERT INTO triage_rules(id,owner,source,kind,contains,lane,note,created_at) VALUES (?,?,?,?,?,?,?,?)")
          .run(crypto.randomUUID().slice(0, 10), owner, row.source, row.kind, contains, lane,
            body.feedback === "mute" ? `${row.source}의 ${row.kind}는 안 알려줘도 됨` : `${row.source}의 ${row.kind}는 바로 알려줘`, ts);
        db.query("UPDATE signals SET lane=?, reason=?, status=?, updated_at=?, resolved_at=? WHERE id=?")
          .run(lane, lane === "info" ? "내 규칙: 안 알려줘도 됨" : "내 규칙: 바로 알려줘", lane === "info" ? "resolved" : "open", ts, lane === "info" ? ts : null, row.id);
      }
      if (body.status === "resolved" || body.status === "open" || body.status === "snoozed") {
        db.query("UPDATE signals SET status=?, updated_at=?, resolved_at=? WHERE id=?").run(body.status, ts, body.status === "resolved" ? ts : null, row.id);
      }
      if (body.lane && (LANES as readonly string[]).includes(body.lane)) {
        db.query("UPDATE signals SET lane=?, needs_ai=0, updated_at=? WHERE id=?").run(body.lane, ts, row.id);
      }
      if (typeof body.reason === "string") {
        db.query("UPDATE signals SET reason=?, updated_at=? WHERE id=?").run(str(body.reason, 200) || null, ts, row.id);
      }
      return json(pub(db.query("SELECT * FROM signals WHERE id=?").get(row.id)));
    }
  }

  if (parts[1] === "rules" && parts.length === 3 && m === "DELETE") {
    db.query("DELETE FROM triage_rules WHERE id=? AND owner=?").run(parts[2], owner);
    return json({ ok: true });
  }

  // 수집기 상태: 수집기가 돌 때마다 보고. ok=false 면 고장 사건도 같이 만든다.
  if (parts[1] === "collectors" && parts.length === 3 && m === "POST") {
    const name = str(parts[2], 40);
    const body = (await req.json().catch(() => ({}))) as any;
    const ok = body.ok !== false;
    const ts = now();
    const prev = db.query("SELECT * FROM collectors WHERE owner=? AND name=?").get(owner, name) as any;
    db.query(`INSERT INTO collectors(owner,name,ok,note,last_seen,last_ok,every_min,sample) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(owner,name) DO UPDATE SET ok=excluded.ok, note=excluded.note, last_seen=excluded.last_seen, last_ok=COALESCE(excluded.last_ok, collectors.last_ok), every_min=COALESCE(excluded.every_min, collectors.every_min), sample=excluded.sample`)
      .run(owner, name, ok ? 1 : 0, str(body.note, 200) || null, ts, ok ? ts : prev?.last_ok ?? null, Number(body.every_min) || null, body.sample ? 1 : 0);
    return json(db.query("SELECT * FROM collectors WHERE owner=? AND name=?").get(owner, name));
  }
  return null;
}

export const SIGNAL_GUIDE = `
--- 사건 입구 (signals) ---
POST   /api/signals          one signal, or { signals: [...] } (max 200)
  { kind: start|progress|done|error|question|approval|deadline|auth|info,
    title, source ("github" | "lms" | "gmail" | "kakao" | "calendar" | your bot name ...),
    ref?   stable id for upsert (e.g. "github:goat-si/goat:run:123"); same ref = update, not a duplicate
    task?  groups one job's start/progress/done; a done/fixed/blocked signal closes that task's "running" rows
    agent?, area?, url?, body?, due? (ISO date/time),
    risk?: [money|external|security|prod|legal|private]  -> interrupts the human now (only for error/approval/question)
    blocking?: true      -> blocks the human's main task, interrupts now
    ai_fixable?: bool    -> error the agent will fix itself (running) vs cannot (human decides)
    fixed?: true         -> error already fixed by the agent; review?: true -> human should glance at it later
    human_step?: true    -> auth needs a phone approval / OTP only the human can do
    private?: true       -> personal; accepted only by a loopback (local) server }
  space?: "personal" | workspace id or name (GET /api/spaces). Default: the space of "work" (a linked item), else personal.
    The same ref already in another space is rejected.
  The server classifies it into a lane: now | decide | review | running | auto | main | info, with a one-line reason.
  Logins are the agent's job: re-login yourself (password manager, passkeys) and send kind:"auth" without human_step;
  send human_step:true only when a phone approval or OTP is truly needed.
PATCH  /api/signals/:id     { status: resolved|open|snoozed } | { feedback: mute|urgent } (creates a rule) | { lane }
GET    /api/signals         open + last 7 days, rules, collectors, stats
POST   /api/collectors/:name { ok, note?, every_min? }   heartbeat from each collector run
GET    /api/work/:ref        one work (ref = signal:<id> | item:<boardId>:<itemId>): note, runs, links, flow, timeline
PUT    /api/work/:ref/note   { html, text }   the work's summary note (keep a human's note; append, don't rewrite)`;
