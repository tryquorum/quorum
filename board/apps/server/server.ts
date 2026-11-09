// 방향판 backend — Bun + SQLite, single file, no dependencies.
// Humans arrive through Cloudflare Access (JWT verified here); agents use a Bearer token over Tailscale.
import { Database } from "bun:sqlite";
import { bearerValue, createAuth, scopeChanged, scopeChangedEarly, isLoopbackHost, localRequestAllowed, loopbackAuthority, publicCsrfAllowed, safeEq, type Listener, type User } from "./server/auth.ts";
import { dirname, join } from "node:path";
import { initSignals, signalsApi, SIGNAL_GUIDE, ingest } from "./server/signals.ts";
import { initRuns, runsApi, startRun } from "./server/runs.ts";
import { initOps, opsApi, startOpsScheduler } from "./server/ops.ts";
import { initWorks, syncTodoGoalLink, worksApi } from "./server/works.ts";
import { initDocs, setHtmlToMarkdown, setStrictHtmlToMarkdown } from "./server/docs/storage.ts";
import { setVaultSink } from "./server/docs/sink.ts";
import { createVaultSink, htmlToMarkdown, noteHtmlToMarkdown } from "./server/vault/index.ts";
import { backfillNoteMarkdown } from "./server/vault/backfill.ts";
import { mcpHandler, type McpPrincipal } from "./server/mcp/handler.ts";
import { filesApi } from "./server/files.ts";
import { actionsApi, runActions } from "./server/actions.ts";
import { createDocsOps } from "./server/docs/ops.ts";
import { docsApi } from "./server/docs/api.ts";
import { serverPaths } from "./server/paths.ts";
import { mobileAuthResponse } from "./server/mobile-auth.ts";
import { settingsApi } from "./server/settings.ts";
import { createMcpTokens, initMcpTokens } from "./server/mcp-tokens.ts";
import { ensureWorkspace, initSpaces, listSpaces, resolveSpace, spacesApi } from "./server/spaces.ts";
import { admitBody, BODY_MAX, boardDefaultSpace, createPilot } from "./server/pilot.ts";
import { appendLog, mergeLog, trimLog, validLogId, type LogPolicy } from "./server/item-log.ts";
import { goalBlocked, goalSpace } from "./server/goal-space.ts";
// 영역 기본 색은 iOS 판 영역 편집과 같은 목록이에요
import { AREA_COLORS } from "@direction-board/contracts/board-text";

const PORT = Number(process.env.PORT || 3060);
const HOST = process.env.HOST || "0.0.0.0";
// 빈 값(PUBLIC_PORT=)은 설정하지 않은 것으로 본다. 값이 있는데 잘못됐으면 어떤 리스너도 열지 않고 끝낸다
const PUBLIC_PORT = (process.env.PUBLIC_PORT || "").trim() === "" ? null : Number(process.env.PUBLIC_PORT);
if (PUBLIC_PORT !== null && (!Number.isInteger(PUBLIC_PORT) || PUBLIC_PORT < 1 || PUBLIC_PORT > 65535 || PUBLIC_PORT === PORT)) {
  console.error("[board] PUBLIC_PORT must be a valid port different from PORT");
  process.exit(1);
}
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || "https://direction.lidgeai.com";
const TEAM = process.env.ACCESS_TEAM || "lidgeai.cloudflareaccess.com";
const AUD = process.env.ACCESS_AUD || "";
// 파일럿(AUTH_MODE=google)에서는 AGENT_TOKEN 을 쓰지 않아요: 사람은 Google 세션, 에이전트는 사람 단위 연결 토큰(/mcp)으로만 들어와요(ADR-0012)
const AGENT_TOKEN = process.env.AUTH_MODE === "google" ? "" : process.env.AGENT_TOKEN || "";
const AGENT_OWNER = (process.env.AGENT_OWNER || "jun@lidgeai.com").toLowerCase();
const ALLOWED = (process.env.ALLOWED_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const PATHS = serverPaths(process.env, import.meta.dir);
const PUBLIC_DIR = PATHS.publicDir;
const DEV_LOCAL_USER = process.env.AUTH_MODE === "google" ? "" : (process.env.DEV_LOCAL_USER || "").toLowerCase(); // 파일럿은 로컬 무인증 없음(pilot.ts, ADR-0012)
const GOAT_BIN = process.env.GOAT_BIN || "";
const GOAT_PROJECT_DIR = PATHS.goatProjectDir;
const DB_PATH = PATHS.dbPath;

if (!AUD) console.warn("[board] ACCESS_AUD is empty: human logins will be rejected");

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;");
db.exec(`
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, board_id TEXT, item_id TEXT, op TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT);
CREATE TABLE IF NOT EXISTS boards(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('personal','company')), owner TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS items(board_id TEXT NOT NULL REFERENCES boards(id), id TEXT NOT NULL, data TEXT NOT NULL, by TEXT, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL, PRIMARY KEY(board_id, id));
CREATE INDEX IF NOT EXISTS items_seq ON items(seq);
CREATE INDEX IF NOT EXISTS boards_seq ON boards(seq);
`);
initSignals(db);
initRuns(db);
initWorks(db);
initOps(db);
if (!(db.query("PRAGMA table_info(boards)").all() as any[]).some((c) => c.name === "meta")) {
  db.exec("ALTER TABLE boards ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'");
}
initDocs(db);
initMcpTokens(db);
initSpaces(db);
const mcpTokens = createMcpTokens(db);
setHtmlToMarkdown(db, noteHtmlToMarkdown);
// iOS 마크다운 편집 가능 판정(GET /api/docs/:ref/note 의 markdownEditable)은 완화 없이 엄격 변환기로만
setStrictHtmlToMarkdown(db, htmlToMarkdown);
try {
  const backfilled = backfillNoteMarkdown(db);
  console.log("[vault] note backfill", backfilled.changed, backfilled.failed, backfilled.skipped);
} catch {
  console.warn("[vault] note backfill failed");
}
setVaultSink(db, createVaultSink(PATHS.vaultDir));

const DEFAULT_AREAS: Record<string, string[]> = { personal: ["가족", "업무", "운동", "모임"], company: ["기타"] };
const mkAreas = (names: string[]) => names.map((name, i) => ({ id: crypto.randomUUID().slice(0, 8), name, color: AREA_COLORS[i % AREA_COLORS.length] }));
function cleanAreas(raw: any): { id: string; name: string; color: string }[] | string {
  if (!Array.isArray(raw)) return "areas must be an array";
  if (raw.length > 24) return "too many areas (max 24)";
  const out = [];
  for (const a of raw) {
    const name = String(a?.name || "").trim().slice(0, 30);
    if (!name) return "area name required";
    const id = typeof a?.id === "string" && /^[A-Za-z0-9_-]{2,40}$/.test(a.id) ? a.id : crypto.randomUUID().slice(0, 8);
    const color = typeof a?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(a.color) ? a.color : AREA_COLORS[out.length % AREA_COLORS.length];
    out.push({ id, name, color });
  }
  return out;
}

type Board = { id: string; name: string; kind: "personal" | "company"; owner: string | null; deleted: number; seq: number; updated_at: number; meta: string };

const now = () => Date.now();
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const err = (status: number, message: string) => json({ error: message }, status);

function logEvent(board_id: string | null, item_id: string | null, op: string, actor: string, payload?: unknown): number {
  const r = db.query("INSERT INTO events(board_id,item_id,op,actor,at,payload) VALUES (?,?,?,?,?,?)").run(board_id, item_id, op, actor, now(), payload === undefined ? null : JSON.stringify(payload));
  return Number(r.lastInsertRowid);
}

/* ---------------- auth ---------------- */
const auth = createAuth({ team: TEAM, aud: AUD, allowed: ALLOWED, agentToken: AGENT_TOKEN, agentOwner: AGENT_OWNER, devLocalUser: DEV_LOCAL_USER, host: HOST });

/* ---------------- data helpers ---------------- */
/** 파일럿 멤버(sharedOnly)는 소유와 무관하게 회사 판(visible)의 워크스페이스 공간 항목(itemSeen)만 봐요(docs/internals/pilot.md). 개인 방향판·관리자는 지금처럼 */
const sharedOnly = (u: User) => !!pilot?.shared(u);
const visible = (b: Board, u: User) => b.kind === "company" || (!sharedOnly(u) && b.owner === u.email);
const itemSeen = (r: { space?: string | null } | null, u: User) => !sharedOnly(u) || (!!r?.space && r.space !== "personal");
function boardOf(id: string): Board | null {
  return db.query("SELECT * FROM boards WHERE id=?").get(id) as Board | null;
}
function ensurePersonal(u: User) {
  const has = db.query("SELECT id FROM boards WHERE kind='personal' AND owner=? AND deleted=0").get(u.email);
  if (has) return;
  const id = rid();
  const seq = logEvent(id, null, "board.create", u.id, { name: "나", kind: "personal" });
  db.query("INSERT INTO boards(id,name,kind,owner,created_at,updated_at,seq,meta) VALUES (?,?,?,?,?,?,?,?)").run(id, "나", "personal", u.email, now(), now(), seq, JSON.stringify({ areas: mkAreas(DEFAULT_AREAS.personal) }));
}
const metaOf = (b: Board) => { try { return JSON.parse(b.meta || "{}"); } catch { return {}; } };
const publicBoard = (b: Board, u: User) => ({ id: b.id, name: b.name, kind: b.kind, mine: b.owner === u.email, deleted: !!b.deleted, areas: metaOf(b).areas || [] });
const publicItem = (r: any) => ({ ...JSON.parse(r.data), id: r.id, boardId: r.board_id, by: r.by, updatedAt: r.updated_at, deleted: !!r.deleted, space: r.space || "personal" });
// 항목 쓰기 한 곳. space 를 주지 않으면(undefined) 기존 공간을 지켜요(옛 클라이언트 PUT, 완료·메타 갱신)
function upsertItem(bid: string, iid: string, data: unknown, actor: string, op: string, space?: string) {
  const seq = logEvent(bid, iid, op, actor, { ...(data as object), log: undefined, threads: undefined, ...(space ? { space } : {}) });
  db.query(
    `INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq,space) VALUES (?,?,?,?,?,0,?,?)
     ON CONFLICT(board_id,id) DO UPDATE SET data=excluded.data, by=excluded.by, updated_at=excluded.updated_at, deleted=0, seq=excluded.seq, space=COALESCE(excluded.space, items.space)`,
  ).run(bid, iid, JSON.stringify(data), actor, now(), seq, space ?? null);
}

const TYPES = new Set(["sticky", "text", "goal", "frame", "todo", "link"]);
const str = (v: any, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
function cleanLog(raw: any) {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((e) => e && typeof e.text === "string" && e.text.trim())
    .map((e) => ({ by: str(e.by, 80) || "unknown", at: Number.isFinite(Number(e.at)) ? Number(e.at) : now(), text: str(e.text, 2000), ...(validLogId(e.id) ? { id: e.id } : {}) }));
}
function cleanThreads(raw: any) {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((t) => t && typeof t.id === "string")
    .map((t) => ({ id: str(t.id, 160), link: str(t.link, 400), title: str(t.title, 160), at: Number(t.at) || now(), status: str(t.status, 30) || "running", reply: str(t.reply, 2000), note: str(t.note, 1000) }))
    .slice(-20);
}
const COLORS = new Set(["yellow", "pink", "blue", "green", "white"]);
function cleanItem(raw: any): Record<string, unknown> | string {
  if (!raw || typeof raw !== "object") return "item must be an object";
  if (!TYPES.has(raw.type)) return "type must be sticky | text | goal | frame";
  const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
  const text = typeof raw.text === "string" ? raw.text : "";
  if (text.length > 5000) return "text too long (max 5000)";
  const out: Record<string, unknown> = {
    type: raw.type, text,
    x: num(raw.x, 0), y: num(raw.y, 0), w: Math.max(40, num(raw.w, 200)), h: Math.max(30, num(raw.h, 160)),
    z: num(raw.z, now()),
  };
  if (raw.type === "sticky") out.color = COLORS.has(raw.color) ? raw.color : "yellow";
  if (raw.type === "text") out.big = !!raw.big;
  if (typeof raw.area === "string" && raw.area.length <= 40) out.area = raw.area;
  if (typeof raw.remindAt === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(raw.remindAt)) out.remindAt = raw.remindAt;
  if (raw.type === "todo") { out.done = !!raw.done; out.placed = !!raw.placed; if (typeof raw.goalId === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(raw.goalId)) out.goalId = raw.goalId; }
  if (raw.type === "link") {
    out.from = str(raw.from, 40);
    out.to = str(raw.to, 40);
    if (!out.from || !out.to || out.from === out.to) return "link needs two different item ids: from, to";
  }
  const log = cleanLog(raw.log); if (log) out.log = log;
  const threads = cleanThreads(raw.threads); if (threads) out.threads = threads;
  if (raw.type === "goal") {
    out.due = typeof raw.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.due) ? raw.due : null;
    out.done = !!raw.done;
  }
  return out;
}

/* ---------------- item history + GOAT handoff ---------------- */
function readItem(bid: string, iid: string): any | null {
  const r = db.query("SELECT * FROM items WHERE board_id=? AND id=? AND deleted=0").get(bid, iid) as any;
  return r ? { row: r, data: JSON.parse(r.data) } : null;
}
function writeItem(bid: string, iid: string, data: any, actor: string, op: string) {
  const seq = logEvent(bid, iid, op, actor, { log: data.log?.slice(-1), threads: data.threads?.slice(-1) });
  db.query("UPDATE items SET data=?, updated_at=?, seq=? WHERE board_id=? AND id=?").run(JSON.stringify(data), now(), seq, bid, iid);
}
function mergeHistory(existing: any, incoming: any, policy?: LogPolicy) {
  const merged = mergeLog(existing.log, incoming.log, policy); // 기존 기록은 중복까지 그대로, 들어온 것 중 없는 것만 더해요(item-log.ts)
  if ("error" in merged) return { logFail: merged }; // 한도·빈도: 요청 전체를 받지 않아요
  const log = merged.log;
  const th = new Map<string, any>();
  for (const t of incoming.threads || []) th.set(t.id, t);
  for (const t of existing.threads || []) {
    const inc = th.get(t.id);
    th.set(t.id, inc && (t.status === "running" || !t.status) ? { ...t, ...inc } : { ...(inc || {}), ...t });
  }
  const out: any = { ...incoming };
  if (log.length) out.log = log;
  if (th.size) out.threads = [...th.values()].sort((a, b) => a.at - b.at).slice(-20);
  return out;
}
async function goatRun(args: string[], stdin?: string) {
  if (!GOAT_BIN) throw new Error("GOAT_BIN not configured");
  const p = Bun.spawn([GOAT_BIN, ...args], { cwd: GOAT_PROJECT_DIR, stdin: stdin ? new Blob([stdin]) : "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, errText] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  if (p.exitCode !== 0) throw new Error((errText || out).trim().slice(0, 400));
  return JSON.parse(out.trim().split("\n").pop() || "{}");
}
const goatShow = (tid: string) => goatRun(["thread", "show", tid, "--json", "--messages", "4"]);
const linkOf = (t: any) => { const m = String(t?.thread?.link || "").match(/\((https?:[^)]+)\)/); return m ? m[1] : ""; };
const lastReply = (t: any) => [...(t?.messages || [])].reverse().find((m: any) => m.role === "assistant")?.text || "";
function goatState(t: any): string {
  const th = t?.thread || {};
  if (th.pendingRequestCount > 0) return "needs-approval";
  if (th.activeRunId) return "running";
  if (th.status === "failed" || th.status === "error") return "failed";
  if (th.status === "completed" || th.status === "idle") return "completed";
  return th.status || "running";
}
const KIND_KO: Record<string, string> = { goal: "목표", todo: "할 일", sticky: "메모", text: "글", frame: "영역" };
function handoffPrompt(b: Board, item: any, note: string) {
  const areas: any[] = metaOf(b).areas || [];
  const area = areas.find((a) => a.id === item.area)?.name || "없음";
  const siblings = (db.query("SELECT data FROM items WHERE board_id=? AND deleted=0").all(b.id) as any[])
    .map((r) => JSON.parse(r.data))
    .filter((d) => d.area && d.area === item.area && d.text && d.text !== item.text)
    .slice(0, 12)
    .map((d) => `- [${KIND_KO[d.type] || d.type}] ${String(d.text).split("\n")[0].slice(0, 80)}${d.due ? ` (~${d.due})` : ""}${d.done ? " ✓" : ""}`);
  const history = (item.log || []).slice(-6).map((e: any) => `- ${new Date(e.at).toISOString().slice(0, 16)} ${e.by}: ${String(e.text).slice(0, 200)}`);
  return [
    "[방향판에서 넘어온 일]",
    `보드: ${b.name} (${b.kind === "personal" ? "개인" : "회사"}) · 영역: ${area}`,
    `종류: ${KIND_KO[item.type] || item.type}${item.due ? ` · 언제까지: ${item.due}` : ""}${item.remindAt ? ` · 알림: ${item.remindAt}` : ""}${item.done ? " · 완료됨" : ""}`,
    "",
    "내용:",
    item.text || "(비어 있음)",
    "",
    siblings.length ? `같은 영역의 다른 항목:\n${siblings.join("\n")}\n` : "",
    history.length ? `지난 기록:\n${history.join("\n")}\n` : "",
    `사람의 요청: ${note || "이 일을 어떻게 해결할지 같이 정리해줘."}`,
    "",
    "규칙:",
    "- 먼저 해결 계획을 3~5단계로 짧게 제안해. 사람이 정해야 하는 것은 '결정 필요:'로 시작하는 줄로 따로 적어.",
    "- 파일을 고치거나 메일·메시지를 보내는 일은 실행하지 말고 제안만 해.",
    "- 답장 첫 줄은 한 문장 요약. 답장 전체가 방향판 기록에 그대로 붙는다.",
  ].filter((l) => l !== "").join("\n");
}
const pending = new Map<string, { bid: string; iid: string }>();
async function checkPending() {
  for (const [tid, ref] of pending) {
    try {
      const t = await goatShow(tid);
      const state = goatState(t);
      const cur = readItem(ref.bid, ref.iid);
      if (!cur) { pending.delete(tid); continue; }
      const data = cur.data;
      const th = (data.threads || []).find((x: any) => x.id === tid);
      if (!th) { pending.delete(tid); continue; }
      const reply = lastReply(t);
      if (th.status === state && th.reply === reply.slice(0, 2000)) continue;
      th.status = state;
      th.reply = reply.slice(0, 2000);
      th.link = th.link || linkOf(t);
      if (state === "completed" && reply) data.log = trimLog([...(data.log || []), { by: "goat", at: now(), text: reply.slice(0, 2000) }]);
      if (state === "needs-approval") data.log = trimLog([...(data.log || []), { by: "goat", at: now(), text: "GOAT에서 승인을 기다려요. GOAT에서 열어 확인해주세요." }]);
      writeItem(ref.bid, ref.iid, data, "goat", "item.goat");
      if (state === "completed" || state === "failed") pending.delete(tid);
    } catch (e) {
      console.error("[board] goat check failed", tid, String(e).slice(0, 200));
    }
  }
}
for (const r of db.query("SELECT board_id, id, data FROM items WHERE deleted=0").all() as any[]) {
  for (const t of JSON.parse(r.data).threads || []) if (t.status === "running" || t.status === "needs-approval") pending.set(t.id, { bid: r.board_id, iid: r.id });
}
if (GOAT_BIN) setInterval(() => { if (pending.size) checkPending(); }, 8000);

/* ---------------- static ---------------- */
// 새 화면(React + shadcn, apps/web/dist)은 "/", 옛 화면(apps/server/public/)은 "/legacy/" 로 서빙. 웹 빌드가 없으면 옛 화면이 "/".
const WEB_DIR = PATHS.webDir;
async function serveStatic(path: string) {
  if (path.includes("..")) return err(400, "bad path");
  const legacy = path === "/legacy" || path.startsWith("/legacy/");
  const hasWeb = await Bun.file(join(WEB_DIR, "index.html")).exists();
  if (path === "/legacy") return Response.redirect("/legacy/", 302);
  const dir = legacy || !hasWeb ? PUBLIC_DIR : WEB_DIR;
  const sub = legacy ? path.slice("/legacy".length) : path;
  const rel = sub === "/" || sub === "" ? "index.html" : sub.replace(/^\/+/, "");
  let file = Bun.file(join(dir, rel));
  if (!(await file.exists())) {
    if (dir === WEB_DIR && !rel.includes(".")) file = Bun.file(join(WEB_DIR, "index.html"));
    else return new Response("not found", { status: 404 });
  }
  const html = rel.endsWith(".html") || file.name?.endsWith("index.html");
  const hashed = dir === WEB_DIR && rel.startsWith("assets/");
  return new Response(file, { headers: { "cache-control": html ? "no-store" : hashed ? "public, max-age=31536000, immutable" : "no-cache" } });
}

const GUIDE = `방향판 agent API (direction-board/v0)
Auth: Authorization: Bearer <AGENT_TOKEN>   (reach the server over Tailscale: http://100.100.125.116:${PORT})
The agent acts for ${AGENT_OWNER}: it sees that person's personal board and every company board.

GET    /api/state                         -> { me, seq, boards[], items[] }
GET    /api/changes?since=<seq>           -> { seq, boards[], items[] }  (deleted rows have deleted:true)
POST   /api/boards                        { name, kind: "company", areas?: [{ name, color? }] }
PATCH  /api/boards/:boardId               { name?, areas? }   areas = the board's business units / life areas
POST   /api/boards/:boardId/items         { type, text, x, y, w, h, color?, due?, done?, big?, space? } -> item (id generated)
PUT    /api/boards/:boardId/items/:id     same body, upsert (no space = keep the item's space)
GET    /api/spaces                        -> { spaces: [{ id: "personal" | "ws_…", kind, name }] }  space = personal or a workspace id/name
DELETE /api/boards/:boardId/items/:id
GET    /api/boards/:boardId/export        -> direction-board/v0 JSON

Item types: sticky (color yellow|pink|blue|green|white), text (big), goal (due YYYY-MM-DD, done), frame (a region; text is its title).
Every item may carry area: <area id> to belong to one of the board's areas (e.g. 가족 / 업무 / 운동 / 모임, or opencodex / cli-jaw / ima2-gen). Goals with a due date appear on the roadmap view by area.
Rules: write status and evidence; do not rewrite text a human wrote in a goal or frame unless asked. Every write is logged with actor "agent".
${SIGNAL_GUIDE}`;

/* ---------------- 운영 순회 (ops) ---------------- */
const postSignal = ({ owner, ...s }: Record<string, unknown>) => {
  const r = ingest(db, String(owner), s, true);
  if (typeof r === "string") console.warn("[board] run signal rejected:", r);
};
const boardRef = (b: Board | null) => (b ? { id: b.id, areas: metaOf(b).areas || [] } : null);
const OPS_DEPS = {
  ingest: (owner: string, raw: any) => ingest(db, owner, raw, HOST === "127.0.0.1" || HOST === "localhost"),
  personalBoard: (owner: string) => boardRef(db.query("SELECT * FROM boards WHERE kind='personal' AND owner=? AND deleted=0").get(owner) as Board | null),
  // 파일럿에서만: 회사 공간 일(AI·운영 순회)은 회사 판에 둬요. 개인 방향판은 지금처럼 개인 판에 공간만 달아요
  companyBoard: () => { const id = pilot?.companyBoardId(); return id ? boardRef(boardOf(id)) : null; },
  readItem: (bid: string, iid: string) => readItem(bid, iid),
  putItem: (bid: string, iid: string, data: Record<string, unknown>, actor: string, space?: string) => upsertItem(bid, iid, data, actor, "item.upsert", space),
  startRun: (owner: string, opts: any) => startRun(db, owner, opts, postSignal),
  port: PORT,
};
export const docsOps = createDocsOps(db, {act: (owner, actions) => runActions(db, owner, actions, OPS_DEPS), items: {readItem: OPS_DEPS.readItem, putItem: OPS_DEPS.putItem}});
/** AI 정리 되돌리기: 항목 DELETE 와 같은 보관(소프트 삭제 + 기록). 확인은 capture.ts 가 같은 트랜잭션에서 한다 */
// 파일럿(AUTH_MODE=google): Google 로그인·허용 목록·역할·이슈. 아니면 null 이고 지금 동작 그대로
const pilot = createPilot(db, process.env, { readItem: OPS_DEPS.readItem, putItem: OPS_DEPS.putItem, ingest: (o, raw) => ingest(db, o, raw, true), dbPath: DB_PATH, origin: PUBLIC_ORIGIN, revokeTokens: (email) => { mcpTokens.revokeOwner(email); } });
const CAPTURE_DEPS = {
  archiveItem: (bid: string, iid: string, actor: string) => {
    const seq = logEvent(bid, iid, "item.delete", actor);
    db.query("UPDATE items SET deleted=1, updated_at=?, by=?, seq=? WHERE board_id=? AND id=?").run(now(), actor, seq, bid, iid);
  },
};
if (!pilot && isLoopbackHost(HOST)) startOpsScheduler(db, OPS_DEPS, DEV_LOCAL_USER || AGENT_OWNER);

/* ---------------- routes ---------------- */
async function api(req: Request, url: URL, u: User, listener: Listener): Promise<Response> {
  const local = !pilot && listener === "local" && isLoopbackHost(HOST); // 파일럿은 로컬 리스너라도 맥 주인으로 믿지 않아요
  const macOwner = local || (listener === "public" && !u.agent && (pilot ? pilot.role(u) === "admin" : ALLOWED.includes(u.email) && u.email === (DEV_LOCAL_USER || AGENT_OWNER)));
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const m = req.method;

  const pr = pilot && await pilot.api(req, url, parts, u);
  if (pr) return pr;
  if (parts[1] === "me") return json({ email: u.email, agent: u.agent, ...pilot?.me(u) });
  if (parts[1] === "agent-guide") return new Response(GUIDE, { headers: { "content-type": "text/plain; charset=utf-8" } });
  const st = await settingsApi(req, parts, u, { listener, macOwner, port: PORT, loopback: loopbackAuthority(HOST), publicOrigin: PUBLIC_ORIGIN, localOpen: !!DEV_LOCAL_USER && isLoopbackHost(HOST), dbPath: DB_PATH, vaultDir: PATHS.vaultDir, repoRoot: PATHS.repoRoot });
  if (st) return st;
  const tk = await mcpTokens.api(req, parts, u, { macOwner, listener, publicOrigin: PUBLIC_ORIGIN, stillAllowed: () => !pilot || pilot.tokenOwnerOk(u.email) });
  if (tk) return tk;
  const spr = await spacesApi(db, req, parts, u);
  if (spr) return spr;
  const or = await opsApi(db, req, url, u, parts, local, OPS_DEPS, macOwner);
  if (or) return or;
  const sr = await signalsApi(db, req, url, u, parts, local);
  if (sr) return sr;
  const rr = await runsApi(db, req, url, u, parts, macOwner, ({ owner, ...s }) => {
    const r = ingest(db, String(owner), s, true);
    if (typeof r === "string") console.warn("[board] run signal rejected:", r);
  }, undefined, `http://127.0.0.1:${PORT}`, CAPTURE_DEPS);
  if (rr) return rr;
  const wr = await worksApi(db, req, url, u, parts, sharedOnly(u));
  if (wr) return wr;
  const dr = await docsApi(req, url, u, parts, docsOps);
  if (dr) return dr;
  const fr = await filesApi(req, url, parts, dirname(DB_PATH), macOwner);
  if (fr) return fr;
  const ar = await actionsApi(db, req, parts, u, local, OPS_DEPS);
  if (ar) return ar;

  if (parts[1] === "state" && m === "GET") {
    if (!pilot || pilot.role(u) === "admin") ensurePersonal(u);
    if (pilot) pilot.prepare(u); else ensureWorkspace(db, u.email);
    for (const b of (db.query("SELECT * FROM boards WHERE deleted=0").all() as Board[]).filter((b) => visible(b, u))) {
      const meta = metaOf(b);
      if (Array.isArray(meta.areas) && meta.areas.length) continue;
      meta.areas = mkAreas(DEFAULT_AREAS[b.kind]);
      const seq = logEvent(b.id, null, "board.update", "system", { areas: meta.areas });
      db.query("UPDATE boards SET meta=?, updated_at=?, seq=? WHERE id=?").run(JSON.stringify(meta), now(), seq, b.id);
    }
    const boards = (db.query("SELECT * FROM boards WHERE deleted=0").all() as Board[]).filter((b) => visible(b, u));
    const ids = boards.map((b) => b.id);
    const items = ids.length
      ? (db.query(`SELECT * FROM items WHERE deleted=0 AND board_id IN (${ids.map(() => "?").join(",")})`).all(...ids) as any[]).filter((r) => itemSeen(r, u)).map(publicItem) // justified: 항목 행은 publicItem 이 읽는 기존 모양
      : [];
    const seq = (db.query("SELECT COALESCE(MAX(seq),0) AS s FROM events").get() as any).s;
    return json({ me: { email: u.email, agent: u.agent, ...pilot?.me(u) }, seq, boards: boards.map((b) => publicBoard(b, u)), items, spaces: listSpaces(db) });
  }

  if (parts[1] === "changes" && m === "GET") {
    const since = Number(url.searchParams.get("since") || 0);
    const boards = (db.query("SELECT * FROM boards WHERE seq>?").all(since) as Board[]).filter((b) => visible(b, u));
    const allowed = new Set((db.query("SELECT * FROM boards").all() as Board[]).filter((b) => visible(b, u)).map((b) => b.id));
    // 멤버가 볼 수 없는 항목(회사 판의 개인 공간)은 내용 없이 지운 것으로만 알려요(공간이 바뀌어 안 보이게 된 항목을 화면에서 빼게)
    const items = (db.query("SELECT * FROM items WHERE seq>? ORDER BY seq LIMIT 2000").all(since) as any[]).filter((r) => allowed.has(r.board_id)) // justified: 항목 행은 publicItem 이 읽는 기존 모양
      .map((r) => itemSeen(r, u) ? publicItem(r) : { id: r.id, boardId: r.board_id, updatedAt: r.updated_at, deleted: true });
    const seq = (db.query("SELECT COALESCE(MAX(seq),0) AS s FROM events").get() as any).s;
    return json({ seq, boards: boards.map((b) => publicBoard(b, u)), items, spaces: listSpaces(db) });
  }

  if (parts[1] === "boards") {
    if (parts.length === 2 && m === "POST") {
      const body = (await req.json().catch(() => null)) as any;
      const name = String(body?.name || "").trim().slice(0, 80);
      if (!name) return err(400, "name required");
      const kind = body?.kind === "personal" ? "personal" : "company";
      let areas = body?.areas !== undefined ? cleanAreas(body.areas) : mkAreas(DEFAULT_AREAS[kind]);
      if (typeof areas === "string") return err(400, areas);
      const id = rid();
      const seq = logEvent(id, null, "board.create", u.id, { name, kind, areas });
      db.query("INSERT INTO boards(id,name,kind,owner,created_at,updated_at,seq,meta) VALUES (?,?,?,?,?,?,?,?)").run(id, name, kind, kind === "personal" ? u.email : null, now(), now(), seq, JSON.stringify({ areas }));
      return json(publicBoard(boardOf(id)!, u), 201);
    }
    const b = parts[2] ? boardOf(parts[2]) : null;
    if (!b || b.deleted || !visible(b, u)) return err(404, "board not found");

    if (parts.length === 3 && m === "PATCH") {
      const body = (await req.json().catch(() => null)) as any;
      const name = body?.name !== undefined ? String(body.name).trim().slice(0, 80) : b.name;
      if (!name) return err(400, "name required");
      const meta = metaOf(b);
      if (body?.areas !== undefined) {
        const areas = cleanAreas(body.areas);
        if (typeof areas === "string") return err(400, areas);
        meta.areas = areas;
      }
      const seq = logEvent(b.id, null, "board.update", u.id, { name, areas: meta.areas });
      db.query("UPDATE boards SET name=?, meta=?, updated_at=?, seq=? WHERE id=?").run(name, JSON.stringify(meta), now(), seq, b.id);
      return json(publicBoard(boardOf(b.id)!, u));
    }
    if (parts.length === 3 && m === "DELETE") {
      if (b.kind === "personal") return err(400, "personal board cannot be deleted");
      const seq = logEvent(b.id, null, "board.delete", u.id);
      db.query("UPDATE boards SET deleted=1, updated_at=?, seq=? WHERE id=?").run(now(), seq, b.id);
      return json({ ok: true });
    }
    if (parts[3] === "export" && m === "GET") {
      const items = (db.query("SELECT * FROM items WHERE deleted=0 AND board_id=?").all(b.id) as any[]).filter((r) => itemSeen(r, u)).map(publicItem); // justified: 항목 행은 publicItem 이 읽는 기존 모양
      return json({ format: "direction-board/v0", exportedAt: new Date().toISOString(), board: { id: b.id, name: b.name, kind: b.kind }, items });
    }
    // 항목 하나를 다루는 길(기록·넘기기·고치기·지우기): 판을 볼 수 있어도 그 항목의 공간을 볼 수 없으면 없는 항목이에요
    const itemRow = parts[3] === "items" && parts[4] ? db.query("SELECT space FROM items WHERE board_id=? AND id=?").get(b.id, parts[4]) as { space: string | null } | null : null;
    if (itemRow && !itemSeen(itemRow, u)) return err(404, "item not found");
    if (parts[3] === "items" && parts.length === 6 && m === "POST" && (parts[5] === "log" || parts[5] === "handoff")) {
      if (parts[5] === "handoff" && !macOwner) return err(403, "only the Mac owner can hand work to GOAT");
      const cur = readItem(b.id, parts[4]);
      if (!cur) return err(404, "item not found");
      const body = (await req.json().catch(() => ({}))) as any;
      const data = cur.data;
      if (parts[5] === "log") {
        const text = str(body?.text, 2000).trim();
        if (!text) return err(400, "text required");
        const next = appendLog(data.log, { by: u.id, at: now(), text }, pilot?.logPolicy(u)); if (!Array.isArray(next)) return err(next.status, next.error); data.log = next; const lim = pilot?.memberWrite(u, b.id, parts[4], data); if (lim) return err(lim.status, lim.error);
        writeItem(b.id, parts[4], data, u.id, "item.log");
        return json(publicItem(db.query("SELECT * FROM items WHERE board_id=? AND id=?").get(b.id, parts[4])));
      }
      if (u.agent) return err(403, "only a person can hand work to GOAT");
      if (!GOAT_BIN) return err(501, "GOAT is not connected on this server");
      const note = str(body?.note, 1000).trim();
      const title = `방향판 · ${String(data.text || KIND_KO[data.type] || "항목").split("\n")[0].slice(0, 60)}`;
      let started: any, shown: any = null;
      try {
        started = await goatRun(["thread", "start", GOAT_PROJECT_DIR, "-", "--title", title, "--json"], handoffPrompt(b, data, note));
        shown = await goatShow(started.threadId).catch(() => null);
      } catch (e) {
        return err(502, `GOAT에 넘기지 못했어요: ${String((e as Error).message || e).slice(0, 200)}`);
      }
      const entry = { id: started.threadId, link: shown ? linkOf(shown) : "", title, at: now(), status: "running", reply: "", note };
      data.threads = [...(data.threads || []), entry].slice(-20);
      data.log = trimLog([...(data.log || []), { by: u.id, at: now(), text: `GOAT에 넘김${note ? `: ${note}` : ""}` }]);
      writeItem(b.id, parts[4], data, u.id, "item.handoff");
      pending.set(started.threadId, { bid: b.id, iid: parts[4] });
      return json({ thread: entry, item: publicItem(db.query("SELECT * FROM items WHERE board_id=? AND id=?").get(b.id, parts[4])) }, 201);
    }
    if (parts[3] === "items") {
      if (parts.length === 4 && m === "POST") {
        const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
        const item = cleanItem(body);
        if (typeof item === "string") return err(400, item);
        const asked = resolveSpace(db, body?.space); if (asked === null) return err(400, "unknown space");
        const gs = goalSpace(db, b.id, item, asked, { fresh: true, linked: false }); if ("error" in gs) return err(400, gs.error); const space = gs.space; // 목표에 붙인 새 할 일은 목표의 공간(goal-space.ts)
        const bad = pilot?.spaceWrite(u, b.id, null, space); if (bad) return err(bad.status, goalBlocked(gs, bad.error)); // 파일럿 공간 규칙(pilot.ts)
        const id = rid(), made = mergeHistory({}, item, pilot?.logPolicy(u)); if (made.logFail) return err(made.logFail.status, made.logFail.error); const lim = pilot?.memberWrite(u, b.id, id, made); if (lim) return err(lim.status, lim.error); // 멤버 한도는 최종 저장 크기로
        upsertItem(b.id, id, made, u.id, "item.create", space ?? boardDefaultSpace(db, b.kind));
        if (item.type === "todo") syncTodoGoalLink(db, b.owner || u.email, b.id, id, undefined, item.goalId, u.id);
        return json(publicItem(db.query("SELECT * FROM items WHERE board_id=? AND id=?").get(b.id, id)), 201);
      }
      const iid = parts[4];
      if (!iid || !/^[A-Za-z0-9_-]{4,40}$/.test(iid)) return err(400, "bad item id");
      if (parts.length === 5 && m === "PUT") {
        const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
        const cleaned = cleanItem(body);
        if (typeof cleaned === "string") return err(400, cleaned);
        const asked = resolveSpace(db, body?.space); if (asked === null) return err(400, "unknown space");
        const prev = readItem(b.id, iid);
        const gs = goalSpace(db, b.id, cleaned, asked, { fresh: !prev, linked: !!prev && prev.data?.goalId !== cleaned.goalId, current: prev?.row?.space }); if ("error" in gs) return err(400, gs.error); const space = gs.space;
        const bad = pilot?.spaceWrite(u, b.id, iid, space); if (bad) return err(bad.status, goalBlocked(gs, bad.error)); // 멤버 이동 403, 문서 있는 범위 이동 409
        // 화면에서 저장해도 서버·에이전트가 붙인 표시(운영 순회 카드 key, AI가 만든 카드, AI 정리 실행)는 지우지 않는다. 화면이 보낸 값은 cleanItem 이 버린다
        const keep = prev ? Object.fromEntries((["opsKey", "agent", "capture"] as const).filter((k) => prev.data[k] !== undefined).map((k) => [k, prev.data[k]])) : {};
        const item = mergeHistory(prev?.data ?? {}, cleaned, pilot?.logPolicy(u)); if (item.logFail) return err(item.logFail.status, item.logFail.error); Object.assign(item, keep); const lim = pilot?.memberWrite(u, b.id, iid, item); if (lim) return err(lim.status, lim.error);
        upsertItem(b.id, iid, item, u.id, "item.upsert", space ?? (prev ? undefined : boardDefaultSpace(db, b.kind)));
        if (item.type === "todo") syncTodoGoalLink(db, b.owner || u.email, b.id, iid, prev?.data?.goalId, item.goalId, u.id);
        return json(publicItem(db.query("SELECT * FROM items WHERE board_id=? AND id=?").get(b.id, iid)));
      }
      if (parts.length === 5 && m === "DELETE") {
        const seq = logEvent(b.id, iid, "item.delete", u.id);
        db.query("UPDATE items SET deleted=1, updated_at=?, by=?, seq=? WHERE board_id=? AND id=?").run(now(), u.id, seq, b.id, iid);
        return json({ ok: true });
      }
    }
  }
  return err(404, "unknown endpoint");
}

function serve(listener: Listener, port: number, hostname: string) {
  return Bun.serve({
    port, hostname, ...(pilot ? { maxRequestBodySize: BODY_MAX } : {}),
    async fetch(req, server) {
      const url = new URL(req.url);
      if (listener === "local" && isLoopbackHost(HOST) && !localRequestAllowed(req)) return err(403, "host or origin not allowed");
      if (listener === "public" && !publicCsrfAllowed(req, PUBLIC_ORIGIN)) return err(403, "origin not allowed");
      if (url.pathname === "/api/health") return json({ ok: true }); if (pilot && await scopeChangedEarly(req, url, () => (req.headers.has("authorization") ? auth.who(req, listener) : pilot.user(req)))) return err(409, "scope-changed"); // 파일럿: 본문 받기 전에 범위 관문(expect-user.ts)
      if (pilot && req.body && req.method !== "GET" && req.method !== "HEAD") { const got = await admitBody(req, url, url.pathname === "/mcp" ? !!bearerPrincipal(req) : url.pathname.startsWith("/auth/") || (!req.headers.has("authorization") && !!pilot.user(req))); if (got instanceof Response) return got; req = got; } // 파일럿: 인증 먼저, 본문은 상한·시간 안에서 다 받은 뒤 사람·역할(pilot.ts admitBody)
      const ar = pilot && await pilot.routes(req, url);
      if (ar) return ar;
      if (url.pathname === "/mcp") return mcpHandler(docsOps, { authenticate: (r) => listener === "public" || pilot
        ? bearerPrincipal(r)
        : mcpPrincipal(r, server.requestIP(r)?.address ?? null) })(req);
      // Authorization 이 있는데 AGENT_TOKEN Bearer 가 아니면(연결 토큰·다른 방식·대소문자 변형 포함) 사람 인증(로컬 개발자·Access 쿠키)으로
      // 넘어가지 않아요. 연결 토큰은 /mcp 전용
      if (url.pathname.startsWith("/api/") && req.headers.has("authorization") && !auth.agent(req)) return err(401, "invalid authorization");
      const u = pilot && !req.headers.has("authorization") ? pilot.user(req) : await auth.who(req, listener);
      if (url.pathname === "/api/mobile/auth") return mobileAuthResponse(req, url, u, listener, auth.verifyAccessJwt);
      if (url.pathname.startsWith("/api/")) {
        if (!u) return err(401, "login required (Cloudflare Access) or Bearer agent token"); if (scopeChanged(req, u.email)) return err(409, "scope-changed"); // 시작 범위의 주체가 지금 주체와 다르면 쓰기 0건(expect-user.ts)
        try { return await api(req, url, u, listener); }
        catch (e) { console.error("[board] api error", e); return err(500, "server error"); }
      }
      if (!u) return pilot ? pilot.loginPage(url) : new Response("login required", { status: 401 });
      return serveStatic(url.pathname);
    },
  });
}
serve("local", PORT, HOST);
console.log(`[board] listening on ${HOST}:${PORT}  db=${DB_PATH}`);
if (PUBLIC_PORT !== null) {
  if (!pilot && (!AUD.trim() || !ALLOWED.length)) console.error("[board] public listener disabled: ACCESS_AUD and ALLOWED_EMAILS are required");
  else {
    try { serve("public", PUBLIC_PORT, "127.0.0.1"); console.log(`[board] public listener on 127.0.0.1:${PUBLIC_PORT}`); }
    catch (e) { console.error("[board] public listener failed:", e); }
  }
}

/**
 * /mcp 인증: 에이전트 토큰(Bearer)이면 AGENT_OWNER, 아니면 이 맥 안에서 온 요청만(실제 접속 주소가 루프백이고
 * Host·Origin 도 로컬일 때) DEV_LOCAL_USER 로 본다. URL·Host·X-Forwarded-For 만으로는 믿지 않는다
 */
/** Bearer: AGENT_TOKEN 을 먼저 상수 시간 비교하고, 아니면 연결 토큰(해시 조회, 폐기 확인). 둘 다 아니면 null */
function bearerPrincipal(req: Request): McpPrincipal | null {
  const value = bearerValue(req);
  if (value === null) return null;
  if (AGENT_TOKEN && safeEq(value, AGENT_TOKEN)) return { owner: AGENT_OWNER, via: "bearer" };
  const token = mcpTokens.authenticate(value);
  // 파일럿: 토큰을 만든 사람이 지금도 허용된 활성 관리자일 때만(강등·비활성 뒤 남은 토큰은 막혀요. 회수 때 폐기도 해요)
  if (!token || (pilot && !pilot.tokenOwnerOk(token.owner))) return null;
  return { owner: token.owner, via: "bearer" };
}
function mcpPrincipal(req: Request, peer: string | null): McpPrincipal | null {
  // Authorization 이 있으면(어떤 방식이든) 그것만 보고 루프백 무인증으로 넘어가지 않아요
  if (req.headers.has("authorization")) return bearerPrincipal(req);
  const loopPeer = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  const localName = (h: string | null) => !!h && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(h);
  const origin = req.headers.get("origin");
  const localOrigin = !origin || (() => { try { return localName(new URL(origin).host); } catch { return false; } })();
  if (loopPeer && DEV_LOCAL_USER && localName(req.headers.get("host")) && localOrigin) return { owner: DEV_LOCAL_USER, via: "loopback" };
  return null;
}
