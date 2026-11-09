// AI 정리 칩의 요청 묶음. 범위 고정 클라이언트로만 만들어요(칩 목록이 그 범위의 것이라, 범위가 바뀌면 그 칩의 요청은 보내지 않아요).
import type { Run, SettingsInfo } from '@direction-board/contracts'
import type { Client, ScopedClient } from '../../../api/client'
import { workOps } from '../../../api/work'
import type { CaptureApi } from './captureFlow'

/** 그 clientKey 로 만든 실행(읽기만). 서버가 키를 모르면 걸러지지 않은 목록이 올 수 있어 키가 같은 것만 써요 */
export async function runByClientKey(c: Client, key: string): Promise<Run | null> {
  const r = await c.request<{ runs: (Run & { client_key?: string | null })[] }>(`/api/runs?clientKey=${encodeURIComponent(key)}`)
  return r.runs.find((x) => x.client_key === key) ?? null
}

export function captureApiFor(c: ScopedClient): CaptureApi {
  const w = workOps(c)
  return {
    scope: c.scope,
    start: (b) => w.startCapture(b),
    effects: (id) => w.effects(id),
    undo: (id, ref) => w.undo(id, ref),
    retry: (id) => w.retry(id),
    stop: (id) => w.stop(id),
    caps: () => c.request<SettingsInfo>('/api/settings').then((s) => s.capabilities ?? []),
    lookup: (key) => runByClientKey(c, key),
  }
}
