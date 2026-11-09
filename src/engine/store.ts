import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { QuorumEvent, RunSummary } from "../contract";

type CreateRunInput = {
  runId: string;
  request: string;
  mode: "live" | "replay";
  startedAt: string;
  replayOf?: string;
  /** 누가 연 실행인지(서버가 정해요): council = 의회, custom = 레시피·Workspace 승인 실행, replay = 다시 틀기. 요청 글로 짐작하지 않아요 */
  kind?: RunKind;
};

export type RunKind = "council" | "custom" | "replay";
export type StoredRun = RunSummary & { kind?: RunKind };

type RunRow = {
  run_id: string;
  request: string;
  mode: "live" | "replay";
  started_at: string;
  status: "running" | "done" | "error";
  replay_of: string | null;
  kind: RunKind | null;
};

type EventRow = {
  run_id: string;
  seq: number;
  at: string;
  mode: "live" | "replay";
  type: QuorumEvent["type"];
  actor: string;
  text: string;
  data: string | null;
};

function toSummary(row: RunRow): StoredRun {
  return {
    runId: row.run_id,
    request: row.request,
    mode: row.mode,
    startedAt: row.started_at,
    status: row.status,
    ...(row.kind ? { kind: row.kind } : {}),
  };
}

export class Store {
  private db: Database;
  private insertRunStmt;
  private insertEventStmt;
  private updateRunStatusStmt;
  private getRunStmt;
  private listRunsStmt;
  private getEventsStmt;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new Database(path, { create: true });
    if (path !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        request TEXT,
        mode TEXT,
        started_at TEXT,
        status TEXT,
        replay_of TEXT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        run_id TEXT,
        seq INTEGER,
        at TEXT,
        mode TEXT,
        type TEXT,
        actor TEXT,
        text TEXT,
        data TEXT NULL,
        PRIMARY KEY (run_id, seq)
      );
    `);
    // 옛 DB 에는 kind 열이 없어요(그 행은 null: 소유자 저장소의 옛 실행이에요)
    const cols = this.db.query("PRAGMA table_info(runs)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "kind")) this.db.exec("ALTER TABLE runs ADD COLUMN kind TEXT NULL");
    this.insertRunStmt = this.db.prepare(
      "INSERT INTO runs (run_id, request, mode, started_at, status, replay_of, kind) VALUES (?, ?, ?, ?, 'running', ?, ?)"
    );
    this.insertEventStmt = this.db.prepare(
      "INSERT INTO events (run_id, seq, at, mode, type, actor, text, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    this.updateRunStatusStmt = this.db.prepare(
      "UPDATE runs SET status = ? WHERE run_id = ?"
    );
    this.getRunStmt = this.db.prepare(
      "SELECT run_id, request, mode, started_at, status, replay_of, kind FROM runs WHERE run_id = ?"
    );
    this.listRunsStmt = this.db.prepare(
      "SELECT run_id, request, mode, started_at, status, replay_of, kind FROM runs ORDER BY started_at DESC LIMIT ?"
    );
    this.getEventsStmt = this.db.prepare(
      "SELECT run_id, seq, at, mode, type, actor, text, data FROM events WHERE run_id = ? AND seq > ? ORDER BY seq ASC"
    );
  }

  createRun(r: CreateRunInput): void {
    this.insertRunStmt.run(r.runId, r.request, r.mode, r.startedAt, r.replayOf ?? null, r.kind ?? null);
  }

  appendEvent(e: QuorumEvent): void {
    this.insertEventStmt.run(
      e.runId,
      e.seq,
      e.at,
      e.mode,
      e.type,
      e.actor,
      e.text,
      e.data === undefined ? null : JSON.stringify(e.data)
    );
  }

  finishRun(runId: string, status: "done" | "error"): void {
    this.updateRunStatusStmt.run(status, runId);
  }

  getRun(runId: string): (StoredRun & { replayOf?: string }) | null {
    const row = this.getRunStmt.get(runId) as RunRow | null;
    if (!row) return null;
    const summary = toSummary(row);
    if (row.replay_of !== null) return { ...summary, replayOf: row.replay_of };
    return summary;
  }

  listRuns(limit = 50): StoredRun[] {
    const rows = this.listRunsStmt.all(limit) as RunRow[];
    return rows.map(toSummary);
  }

  /** since(ISO) 이후 연 의회 수(서버가 kind = council 로 적은 것). 호스팅 사용자별 시간당 제한에 써요. 사용자가 쓴 요청 글로 거르지 않아요 */
  countLiveRunsSince(since: string): number {
    const r = this.db.query("SELECT COUNT(*) AS n FROM runs WHERE kind = 'council' AND started_at >= ?").get(since) as { n: number };
    return r.n;
  }

  getEvents(runId: string, afterSeq = -1): QuorumEvent[] {
    const rows = this.getEventsStmt.all(runId, afterSeq) as EventRow[];
    return rows.map((row) => {
      const event: QuorumEvent = {
        runId: row.run_id,
        seq: row.seq,
        at: row.at,
        mode: row.mode,
        type: row.type,
        actor: row.actor,
        text: row.text,
      };
      if (row.data !== null) {
        event.data = JSON.parse(row.data) as Record<string, unknown>;
      }
      return event;
    });
  }

  close(): void {
    this.db.close();
  }

  /**
   * 서버가 다시 시작됐을 때 "running" 으로 남은 실행을 끊긴 것으로 닫아요.
   * 출처: board/apps/server/server/runs.ts initRuns 의 "서버가 다시 시작돼서 끊겼어요" 처리. 바꾼 점: 이벤트 흐름도 닫히도록 error·run.end 이벤트를 붙여요.
   */
  interruptRunning(at: string): string[] {
    const rows = this.db.query("SELECT run_id FROM runs WHERE status = 'running'").all() as { run_id: string }[];
    const next = this.db.query("SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM events WHERE run_id = ?");
    const tx = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        const n = (next.get(id) as { n: number }).n;
        const mode = (this.getRunStmt.get(id) as RunRow).mode;
        this.appendEvent({ runId: id, seq: n, at, mode, type: "error", actor: "council", text: "서버가 다시 시작돼서 끊겼어요", data: { errorKind: "interrupted" } });
        this.appendEvent({ runId: id, seq: n + 1, at, mode, type: "run.end", actor: "council", text: "끊겨서 끝났어요", data: { status: "error" } });
        this.updateRunStatusStmt.run("error", id);
      }
    });
    const ids = rows.map((r) => r.run_id);
    tx(ids);
    return ids;
  }
}
