// AI 실행(대화) 요청. 서버: apps/server/server/runs.ts. 쓰기는 client.write 규칙(409·거절·결과 불명)을 따라요.
import type { Run, RunThread } from '@direction-board/contracts'
import type { ModelCatalog } from '@direction-board/contracts/models'
import { ConflictError, request, type ScopedClient } from './client'

/** AI가 보는 화면(서버 page-context.ts normPage 가 받는 view 만) */
export type RunPage = { view: 'home' | 'list' | 'docs'; board?: string; work?: string }
export type NewRun = { prompt: string; page?: RunPage; target: string | null; provider: string; model: string; effort: string }
export type ContinueRun = { prompt: string; page?: RunPage; target: string | null; parent: string; provider: string; model: string; effort: string }
export type ThreadRuns = { runs: Run[]; truncated?: boolean }

const enc = encodeURIComponent
const isRun = (v: unknown): v is Run => !!v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string'

export const runsApi = {
  models: (origin: string) => request<ModelCatalog>(origin, '/api/models'),
  threads: (origin: string, limit = 40) => request<{ threads: RunThread[] }>(origin, `/api/runs/threads?limit=${limit}`),
  thread: (origin: string, id: string) => request<ThreadRuns>(origin, `/api/runs?thread=${enc(id)}`),
  forTarget: (origin: string, target: string) => request<{ runs: Run[] }>(origin, `/api/runs?target=${enc(target)}`),
  start: (s: ScopedClient, body: (NewRun | ContinueRun) & { clientKey?: string }) => s.write<Run>('/api/runs', 'POST', body),
  /** 다시 시도. 이미 다시 시도한 실행이면 서버가 409 와 그 실행(run)을 돌려줘서 그 실행으로 가요 */
  async retry(s: ScopedClient, id: string): Promise<Run> {
    try {
      return await s.write<Run>(`/api/runs/${enc(id)}/retry`, 'POST')
    } catch (error) {
      const run = error instanceof ConflictError ? (error.body as { run?: unknown } | null)?.run : null
      if (isRun(run)) return run
      throw error
    }
  },
  stop: (s: ScopedClient, id: string) => s.write<{ ok: boolean }>(`/api/runs/${enc(id)}/stop`, 'POST'),
  /** 끝난 대화를 봤어요: 그 대화의 "확인 기다림" 사건을 확인함으로 */
  seen: (s: ScopedClient, id: string) => s.write<{ changed: number }>(`/api/runs/${enc(id)}/seen`, 'POST'),
}
