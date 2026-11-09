// 레시피 버전 저장소(bun:sqlite). 깨져서 고친 버전을 올려 쌓고, 이전 버전과 깨진 이유를 남겨요.
// recipe_health 는 board/apps/server/server/signals.ts 의 collectors 하트비트 모양(ok, note, last_seen, last_ok)을 그대로 따라요.
import { Database } from "bun:sqlite"
import { mkdirSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { RecipeError } from "./errors"
import { endpointOf } from "./spec"
import type { RecipeDef } from "./types"

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
export const DEFS_DIR = join(import.meta.dir, "defs")

export type RecipeVersion = { version: number; endpoint: string; reason: string | null; previousEndpoint: string | null; createdAt: number }
export type RecipeHealth = { id: string; ok: boolean; note: string | null; lastSeen: number; lastOk: number | null }
export type RecipeSummary = { id: string; site: string; intent: string; version: number; endpoint: string; health: RecipeHealth | null }

export class RecipeStore {
  constructor(readonly db: Database, readonly defsDir = DEFS_DIR) {
    db.exec(`
CREATE TABLE IF NOT EXISTS recipe_versions(id TEXT NOT NULL, version INTEGER NOT NULL, def TEXT NOT NULL, reason TEXT, prev_endpoint TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(id, version));
CREATE TABLE IF NOT EXISTS recipe_health(id TEXT PRIMARY KEY, ok INTEGER NOT NULL, note TEXT, last_seen INTEGER NOT NULL, last_ok INTEGER);`)
  }

  /** defs 폴더의 레시피 id 목록 */
  ids(): string[] {
    const fromDefs = readdirSync(this.defsDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))
    const fromDb = (this.db.query("SELECT DISTINCT id FROM recipe_versions").all() as { id: string }[]).map((r) => r.id)
    return [...new Set([...fromDefs, ...fromDb])].filter((id) => ID.test(id)).sort()
  }

  /** 가장 높은 버전. 처음이면 defs/<id>.json 을 그 파일의 version 으로 넣어요 */
  current(id: string): RecipeDef {
    if (!ID.test(id)) throw new RecipeError("unknown_recipe", `레시피 id 가 이상해요: ${id}`)
    const row = this.db.query("SELECT def FROM recipe_versions WHERE id=? ORDER BY version DESC LIMIT 1").get(id) as { def: string } | null
    if (row) return JSON.parse(row.def) as RecipeDef
    let def: RecipeDef
    try { def = JSON.parse(readFileSync(join(this.defsDir, `${id}.json`), "utf8")) as RecipeDef }
    catch { throw new RecipeError("unknown_recipe", `레시피가 없어요: ${id}`) }
    if (def.id !== id) throw new RecipeError("unknown_recipe", `defs/${id}.json 의 id 가 ${def.id} 예요`)
    this.db.query("INSERT OR IGNORE INTO recipe_versions(id, version, def, reason, prev_endpoint, created_at) VALUES (?,?,?,?,?,?)").run(id, def.version, JSON.stringify(def), null, null, Date.now())
    return def
  }

  /** 고친 버전을 version+1 로 저장해요. 그사이 다른 수리가 먼저 올렸으면 그 위에 올려요 */
  saveRepair(next: Omit<RecipeDef, "version">, reason: string, previousEndpoint: string): RecipeDef {
    return this.db.transaction(() => {
      const max = (this.db.query("SELECT MAX(version) AS v FROM recipe_versions WHERE id=?").get(next.id) as { v: number | null }).v ?? 0
      const def = { ...next, version: max + 1 } as RecipeDef
      this.db.query("INSERT INTO recipe_versions(id, version, def, reason, prev_endpoint, created_at) VALUES (?,?,?,?,?,?)").run(def.id, def.version, JSON.stringify(def), reason, previousEndpoint, Date.now())
      return def
    })()
  }

  history(id: string): RecipeVersion[] {
    const rows = this.db.query("SELECT version, def, reason, prev_endpoint, created_at FROM recipe_versions WHERE id=? ORDER BY version").all(id) as { version: number; def: string; reason: string | null; prev_endpoint: string | null; created_at: number }[]
    return rows.map((r) => ({ version: r.version, endpoint: endpointOf((JSON.parse(r.def) as RecipeDef).request), reason: r.reason, previousEndpoint: r.prev_endpoint, createdAt: r.created_at }))
  }

  heartbeat(id: string, ok: boolean, note: string, at = Date.now()): void {
    this.db.query(`INSERT INTO recipe_health(id, ok, note, last_seen, last_ok) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET ok=excluded.ok, note=excluded.note, last_seen=excluded.last_seen, last_ok=COALESCE(excluded.last_ok, recipe_health.last_ok)`).run(id, ok ? 1 : 0, note.slice(0, 300), at, ok ? at : null)
  }

  health(id: string): RecipeHealth | null {
    const r = this.db.query("SELECT * FROM recipe_health WHERE id=?").get(id) as { id: string; ok: number; note: string | null; last_seen: number; last_ok: number | null } | null
    return r ? { id: r.id, ok: !!r.ok, note: r.note, lastSeen: r.last_seen, lastOk: r.last_ok } : null
  }

  /** GET /api/recipes 용 목록 */
  list(): RecipeSummary[] {
    return this.ids().map((id) => {
      const d = this.current(id)
      return { id, site: d.site, intent: d.intent, version: d.version, endpoint: endpointOf(d.request), health: this.health(id) }
    })
  }
}

let shared: RecipeStore | null = null
/** 엔진이 store 를 넘기지 않을 때 쓰는 프로세스 공용 저장소 */
export function defaultStore(): RecipeStore {
  return (shared ||= openRecipeStore())
}

/** 기본 위치 .quorum/recipes.db (env QUORUM_RECIPES_DB). ":memory:" 도 돼요 */
export function openRecipeStore(path = process.env.QUORUM_RECIPES_DB || ".quorum/recipes.db", defsDir = DEFS_DIR): RecipeStore {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000")
  return new RecipeStore(db, defsDir)
}
