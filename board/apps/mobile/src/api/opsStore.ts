// 운영 순회 상태 하나를 설정 › 운영 순회와 순회 칩이 함께 읽어요(웹 hooks/use-ops.ts 와 같은 규칙). RN 없이 시험해요.
// 폴러 하나: 구독자가 없으면 멈추고, 전체(full) 구독이 있으면 전체, 칩만 있으면 가벼운 모양(?lite=1).
// 도는 중이면 4초, 아니면 30초. 앱이 뒤로 가면 멈추고 앞으로 오면 바로 읽어요. 403(맥 주인 아님)이면 멈춰요.
import type { OpsResponse, OpsSettings } from '@direction-board/contracts'

export type OpsStatus = 'loading' | 'ok' | 'error' | 'forbidden'
export type OpsSnapshot = { data: OpsResponse | null; status: OpsStatus; full: boolean; error: unknown }
type Sub = { full: boolean; cb: () => void }
export type OpsDeps = {
  read: (full: boolean) => Promise<OpsResponse>
  forbidden: (error: unknown) => boolean
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (t: unknown) => void
}

export const OPS_FAST = 4000
export const OPS_SLOW = 30000
const START: OpsSnapshot = { data: null, status: 'loading', full: false, error: null }

export class OpsStore {
  private subs = new Set<Sub>()
  private snap: OpsSnapshot = START
  private timer: unknown = null
  private inflight: Promise<void> | null = null
  private again = false
  private active = true
  /** 쓰기가 시작·끝날 때 올려요. 그 사이 시작한 읽기는 버려요(늦게 온 옛 값이 방금 쓴 값을 덮지 않게) */
  private writeEpoch = 0
  private writing = 0
  /** 범위(서버·계정)가 바뀔 때 올려요. 그 전 읽기 결과는 받지 않아요 */
  private scope = 0

  constructor(private deps: OpsDeps) {}

  get snapshot(): OpsSnapshot {
    return this.snap
  }
  setDeps(deps: Partial<OpsDeps>) {
    this.deps = { ...this.deps, ...deps }
  }

  private emit(next: Partial<OpsSnapshot>) {
    this.snap = { ...this.snap, ...next }
    for (const s of this.subs) s.cb()
  }
  private wantFull() {
    return [...this.subs].some((s) => s.full)
  }
  private schedule() {
    if (this.timer !== null) this.deps.clearTimer(this.timer)
    this.timer = null
    if (!this.subs.size || !this.active || this.snap.status === 'forbidden') return
    const running = this.snap.data?.runs.some((r) => r.status === 'running')
    this.timer = this.deps.setTimer(() => void this.refresh(), running ? OPS_FAST : OPS_SLOW)
  }

  private async once() {
    const full = this.wantFull()
    const epoch = this.writeEpoch
    const scope = this.scope
    try {
      const data = await this.deps.read(full)
      if (scope !== this.scope) return
      if (this.writing) return
      if (epoch !== this.writeEpoch) {
        this.again = true
        return
      }
      // 전체를 읽은 뒤 칩의 가벼운 응답이 지시문 기본값을 지우지 않게
      const prev = this.snap.data
      this.emit({ data: full || !prev ? data : { ...prev, ...data, default_text: prev.default_text ?? data.default_text }, status: 'ok', full, error: null })
    } catch (error) {
      if (scope !== this.scope) return
      if (this.deps.forbidden(error)) this.emit({ status: 'forbidden', error })
      else if (epoch === this.writeEpoch && !this.writing) this.emit({ status: 'error', error })
    }
  }

  /** 지금 읽기. 읽는 중이면 끝난 뒤 한 번 더 */
  refresh(): Promise<void> {
    if (this.inflight) {
      this.again = true
      return this.inflight
    }
    if (this.timer !== null) this.deps.clearTimer(this.timer)
    this.timer = null
    const run = (async () => {
      try {
        do {
          this.again = false
          await this.once()
        } while (this.again && this.subs.size)
      } finally {
        this.inflight = null
        this.schedule()
      }
    })()
    this.inflight = run
    return run
  }

  subscribe(full: boolean, cb: () => void): () => void {
    const sub = { full, cb }
    this.subs.add(sub)
    // 처음 구독이거나, 전체가 필요한데 가벼운 것만 있으면 바로 읽어요. 설정을 열면 403 이어도 한 번 더(다시 로그인했을 수 있어요)
    if (full && this.snap.status === 'forbidden') this.emit({ status: 'loading' })
    if (this.subs.size === 1 || (full && !this.snap.full)) void this.refresh()
    return () => {
      this.subs.delete(sub)
      if (!this.subs.size && this.timer !== null) {
        this.deps.clearTimer(this.timer)
        this.timer = null
      }
    }
  }

  /** 앱이 앞(active)·뒤로 갈 때 */
  setActive(active: boolean) {
    this.active = active
    if (active && this.subs.size && this.snap.status !== 'forbidden') void this.refresh()
    else this.schedule()
  }

  private scopeKey: string | null = null
  /**
   * 화면이 그릴 때 지금 범위(서버 주소 + 로그인 주체)를 알려요. 바뀌면 그 자리에서 비워서(이번 그리기부터 빈 값) 앞 계정 값을 보이지 않고,
   * 알림과 다시 읽기는 다음 틱에 해요(그리는 중에 다른 화면 상태를 바꾸지 않게)
   */
  setScope(key: string) {
    if (key === this.scopeKey) return
    const first = this.scopeKey === null
    this.scopeKey = key
    if (first) return
    this.scope++
    this.inflight = null
    this.again = false
    this.snap = START
    queueMicrotask(() => {
      for (const s of this.subs) s.cb()
      if (this.subs.size) void this.refresh()
    })
  }

  /** 서버 주소·로그인 계정이 바뀌면 비우고 다시 읽어요(다른 계정의 순회가 남지 않게) */
  resetScope() {
    this.scope++
    this.inflight = null
    this.again = false
    this.snap = START
    for (const s of this.subs) s.cb()
    if (this.subs.size) void this.refresh()
  }

  /** 쓰기 하나. 성공하면 받은 설정을 바로 반영하고 다시 읽어요. 실패는 그대로 던져요(409 면 ConflictError 의 본문에 ops) */
  async put(send: () => Promise<{ ops: OpsSettings }>): Promise<OpsSettings> {
    this.writeEpoch++
    this.writing++
    const scope = this.scope
    try {
      const r = await send()
      const ops = { ...r.ops, enabled: !!r.ops.enabled }
      if (scope === this.scope && this.snap.data) this.emit({ data: { ...this.snap.data, ops } })
      return ops
    } finally {
      this.writeEpoch++
      this.writing--
      void this.refresh()
    }
  }
}
