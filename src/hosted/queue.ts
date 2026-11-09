// 사람별 작업 대기열(그 사람 workspace.db 안). 서버는 비소유자 대신 아무것도 실행하지 않고, 일을 여기에 넣어 두면
// 그 사람의 Aside(또는 다른 에이전트)가 MCP 로 가져가요: quorum_next_task 가 리스를 주고, quorum_report_result 가 결과를 남겨요.
// - opinion: 의회 봇 의견(JSON 한 덩어리). 의회가 기다리고 있어서 먼저 나가요. 서버가 다시 시작되면 의회가 끊기므로 남은 의견 일은 만료해요.
// - browser / code: 통과·승인된 일. 결과는 그 사람 Workspace 의 Review 로 가요(onReport).
// 리스가 끝나면 다른 가져가기에 다시 나가고, 옛 리스로 온 보고는 거절해요. 같은 리스의 보고가 다시 오면 같은 답을 돌려줘요(멱등).
import type { Database } from "bun:sqlite"

export type TaskKind = "opinion" | "browser" | "code"
export type TaskStatus = "queued" | "leased" | "done" | "failed" | "expired"
export type Task = {
  id: string; kind: TaskKind; ref: string; runId: string | null; proposalId: string | null; actor: string | null; executor: string | null
  title: string; prompt: string; request: string | null; status: TaskStatus; leaseUntil: number | null; attempts: number
  result: string | null; createdAt: number; updatedAt: number
}
export type EnqueueInput = { kind: TaskKind; ref: string; title: string; prompt: string; runId?: string; proposalId?: string; actor?: string; executor?: string; request?: string }
export type ReportResult = { status: 200; recorded: "new" | "duplicate"; task: Task } | { status: 404 | 409; error: string }

type Row = {
  id: string; kind: TaskKind; ref: string; run_id: string | null; proposal_id: string | null; actor: string | null; executor: string | null
  title: string; prompt: string; request: string | null; status: TaskStatus; lease_id: string | null; lease_until: number | null; attempts: number
  result: string | null; reported_lease: string | null; created_at: number; updated_at: number
}
const pub = (r: Row): Task => ({ id: r.id, kind: r.kind, ref: r.ref, runId: r.run_id, proposalId: r.proposal_id, actor: r.actor, executor: r.executor, title: r.title, prompt: r.prompt, request: r.request, status: r.status, leaseUntil: r.lease_until, attempts: r.attempts, result: r.result, createdAt: r.created_at, updatedAt: r.updated_at })
export const RESULT_MAX = 20_000
const KIND_ORDER = "CASE kind WHEN 'opinion' THEN 0 WHEN 'browser' THEN 1 ELSE 2 END"

export function initTasks(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS tasks(
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, run_id TEXT, proposal_id TEXT, actor TEXT, executor TEXT,
    title TEXT NOT NULL, prompt TEXT NOT NULL, request TEXT, status TEXT NOT NULL, lease_id TEXT, lease_until INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0, result TEXT, reported_lease TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS tasks_ref ON tasks(ref);
  CREATE INDEX IF NOT EXISTS tasks_pick ON tasks(status, created_at);`)
}

export function createQueue(db: Database, o: { now?: () => number; leaseMs?: number; maxLeases?: number } = {}) {
  initTasks(db)
  const now = o.now ?? Date.now
  const leaseMs = o.leaseMs ?? 10 * 60_000
  const maxLeases = o.maxLeases ?? 3
  const waiters = new Map<string, { ok: (text: string) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const reportHooks: ((task: Task, ok: boolean, text: string) => void)[] = []
  const wakers = new Set<(v: boolean) => void>()
  const get = (id: string) => { const r = db.query("SELECT * FROM tasks WHERE id=?").get(id) as Row | null; return r ? pub(r) : null }
  const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16)

  // 다시 시작: 기다리던 의회는 사라졌어요. 남은 의견 일은 누구도 답을 받지 않으니 만료해요
  db.query("UPDATE tasks SET status='expired', updated_at=? WHERE kind='opinion' AND status IN ('queued','leased')").run(now())

  function finish(row: Row, ok: boolean, text: string, leaseId: string | null) {
    const result = text.slice(0, RESULT_MAX)
    db.query("UPDATE tasks SET status=?, result=?, reported_lease=?, lease_until=NULL, updated_at=? WHERE id=?").run(ok ? "done" : "failed", result, leaseId, now(), row.id)
    const task = get(row.id)!
    const w = waiters.get(row.id)
    if (w) { clearTimeout(w.timer); waiters.delete(row.id); if (ok) w.ok(result); else w.fail(new Error("the agent reported a failure: " + result.slice(0, 300))) }
    if (row.kind !== "opinion") for (const fn of reportHooks) { try { fn(task, ok, result) } catch (e) { console.error("[queue] report hook failed:", e) } }
    return task
  }

  function enqueue(input: EnqueueInput): Task {
    const existing = db.query("SELECT * FROM tasks WHERE ref=?").get(input.ref) as Row | null
    if (existing) return pub(existing)
    const t = now()
    const id = rid()
    db.query("INSERT INTO tasks(id,kind,ref,run_id,proposal_id,actor,executor,title,prompt,request,status,attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'queued',0,?,?)")
      .run(id, input.kind, input.ref, input.runId ?? null, input.proposalId ?? null, input.actor ?? null, input.executor ?? null, input.title.slice(0, 200), input.prompt.slice(0, 20_000), input.request?.slice(0, 4000) ?? null, t, t)
    for (const wake of [...wakers]) wake(true)
    wakers.clear()
    return get(id)!
  }

  /** 가장 오래된 일 하나를 빌려 줘요(의견 먼저). 리스가 끝난 일도 다시 나가요. maxLeases 번 빌려 가고도 보고가 없으면 실패로 닫아요 */
  const leaseTx = db.transaction((kinds: TaskKind[]) => {
    const t = now()
    for (let guard = 0; guard < 50; guard++) {
      const marks = kinds.map(() => "?").join(",")
      const row = db.query(`SELECT * FROM tasks WHERE kind IN (${marks}) AND (status='queued' OR (status='leased' AND lease_until < ?)) ORDER BY ${KIND_ORDER}, created_at LIMIT 1`).get(...kinds, t) as Row | null
      if (!row) return null
      if (row.kind === "opinion" && !waiters.has(row.id)) {
        db.query("UPDATE tasks SET status='expired', updated_at=? WHERE id=?").run(t, row.id)
        continue
      }
      if (row.attempts >= maxLeases) {
        finish(row, false, "leased " + row.attempts + " times without a report; giving up", null)
        continue
      }
      const leaseId = rid()
      db.query("UPDATE tasks SET status='leased', lease_id=?, lease_until=?, attempts=attempts+1, updated_at=? WHERE id=?").run(leaseId, t + leaseMs, t, row.id)
      return { task: get(row.id)!, leaseId, leaseUntil: t + leaseMs }
    }
    return null
  })
  function lease(opts: { kinds?: TaskKind[] }): { task: Task; leaseId: string; leaseUntil: number } | null {
    const kinds = (opts.kinds?.length ? opts.kinds : ["opinion", "browser", "code"]).filter((k): k is TaskKind => ["opinion", "browser", "code"].includes(k))
    return kinds.length ? leaseTx(kinds) : null
  }

  const reportTx = db.transaction((p: { taskId: string; leaseId: string; ok: boolean; text: string }): ReportResult => {
    const row = db.query("SELECT * FROM tasks WHERE id=?").get(p.taskId) as Row | null
    if (!row) return { status: 404, error: "task not found" }
    if (row.status === "done" || row.status === "failed") {
      return row.reported_lease === p.leaseId ? { status: 200, recorded: "duplicate", task: pub(row) } : { status: 409, error: "this task already has a result" }
    }
    if (row.status !== "leased" || row.lease_id !== p.leaseId) return { status: 409, error: row.status === "expired" ? "this task expired; nobody is waiting for it" : "this lease is no longer yours; fetch the task again" }
    return { status: 200, recorded: "new", task: finish(row, p.ok, p.text, p.leaseId) }
  })
  const report = (p: { taskId: string; leaseId: string; ok: boolean; text: string }) => reportTx(p)

  /** 의견 일의 답을 기다려요. 시간 안에 답이 없으면 만료하고 의회에 오류로 알려요 */
  function waitFor(taskId: string, timeoutMs: number): Promise<string> {
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        waiters.delete(taskId)
        db.query("UPDATE tasks SET status='expired', updated_at=? WHERE id=? AND status IN ('queued','leased')").run(now(), taskId)
        fail(new Error("your agent did not answer within " + Math.round(timeoutMs / 1000) + "s (is your Aside connected and working through quorum_next_task?)"))
      }, timeoutMs)
      waiters.set(taskId, { ok, fail, timer })
    })
  }

  /** 새 일이 들어오면 true, 시간이 지나면 false (quorum_next_task 의 waitSeconds) */
  function waitForWork(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const wake = (v: boolean) => { clearTimeout(timer); wakers.delete(wake); resolve(v) }
      const timer = setTimeout(() => wake(false), ms)
      wakers.add(wake)
    })
  }

  function counts() {
    const rows = db.query("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status").all() as { status: TaskStatus; n: number }[]
    const c: Record<TaskStatus, number> = { queued: 0, leased: 0, done: 0, failed: 0, expired: 0 }
    for (const r of rows) c[r.status] = r.n
    return c
  }
  function recent(limit = 20): Task[] {
    return (db.query("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ?").all(limit) as Row[]).map(pub)
  }

  return { enqueue, lease, report, waitFor, waitForWork, onReport: (fn: (task: Task, ok: boolean, text: string) => void) => { reportHooks.push(fn) }, counts, recent, get }
}
export type TaskQueue = ReturnType<typeof createQueue>
