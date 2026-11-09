// 비소유자 기억: gbrain(소유자 맥의 기억)을 쓰지 않고, 그 사람 workspace.db 의 판정 표만 써요. 다른 사람 판정이 섞일 길이 없어요.
// 엔진이 재사용 거리를 다시 매기므로(engine/dedup.ts pickReuse) recall 은 최근 판정을 넘기기만 해요.
import type { Database } from "bun:sqlite"
import { similarity } from "../engine/dedup"
import type { MemoryRecord, Recalled } from "../executors/gbrain"

export function createGuestMemory(db: Database, now: () => number = Date.now) {
  db.exec("CREATE TABLE IF NOT EXISTS verdicts(run_id TEXT PRIMARY KEY, request TEXT NOT NULL, record TEXT NOT NULL, at INTEGER NOT NULL)")
  const all = (limit: number) => (db.query("SELECT run_id, record FROM verdicts ORDER BY at DESC LIMIT ?").all(limit) as { run_id: string; record: string }[])
    .flatMap((r) => { try { return [{ ...(JSON.parse(r.record) as MemoryRecord), id: "local/" + r.run_id } as Recalled] } catch { return [] } })
  return {
    recall: async (_request: string): Promise<Recalled[]> => all(50),
    remember: async (rec: MemoryRecord): Promise<string> => {
      db.query("INSERT INTO verdicts(run_id,request,record,at) VALUES (?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET record=excluded.record, at=excluded.at").run(rec.runId, rec.request.slice(0, 4000), JSON.stringify(rec), now())
      return "local/" + rec.runId
    },
    search: async (q: string) => all(200).map((r) => ({ slug: r.id, title: r.request.split("\n")[0].slice(0, 120), snippet: r.verdicts.map((v) => v.decision + " · " + v.title).join("\n").slice(0, 400), score: similarity(q, r.request) }))
      .filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, 10),
  }
}
