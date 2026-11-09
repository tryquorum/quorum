// 레시피 감시: DB 가 열려 있는 동안 주기적으로 레시피를 불러 깨짐을 먼저 찾고 고쳐요.
// 타이머는 board 의 db-timers(everyWhileOpen)를 그대로 써서 DB 를 닫으면 같이 멈춰요.
import { everyWhileOpen } from "./db-timers"
import { runRecipe } from "./runner"
import type { Emit, RecipeCtx } from "./types"
import type { RecipeStore } from "./store"

export function watchRecipes(store: RecipeStore, jobs: { id: string; vars: Record<string, string> }[], ms: number, base: Omit<RecipeCtx, "vars" | "runId" | "store">, emit: Emit): () => void {
  let busy = false
  return everyWhileOpen(store.db, ms, async () => {
    if (busy) return
    busy = true
    try {
      for (const job of jobs) await runRecipe(job.id, { ...base, store, vars: job.vars, runId: `watch-${job.id}-${Date.now()}` }, emit)
    } finally { busy = false }
  }, "recipes-watch")
}
