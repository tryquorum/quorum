// 판 화면의 작은 기기 상태(오늘 메인 키·목록 필터·지금 판·AI 정리 칩). 웹은 localStorage, iOS 는 이 저장소예요.
// 순수 TS(입출력을 받아요)라 bun 으로 시험해요. 화면 훅은 features/board/stored.ts.
import { premiseHolds, sameSeen, type CasTarget, type DiscardPlan, type PlanResult, type Seen } from '@direction-board/contracts/slot-store'

export type StoreIO = { read: (name: string) => Promise<string | null>; write: (name: string, text: string) => Promise<void> }
/** 입출력 하나의 시간 상한(PR #43 리뷰 2 P2): 넘으면 그 작업은 실패예요 */
export const IO_TIMEOUT_MS = 10_000
/** 이 저장소의 버리기·초기화 계획(규칙 F): 전제는 저장 이름마다 본 것, 쓸 곳은 이름 하나 */
export type StorePlan = DiscardPlan<string>

/**
 * 범위(서버 주소 + 로그인 주체) 하나의 값들. 처음 한 번 읽어 메모리에 올리고(ready 전에는 init 을 돌려줘요),
 * 쓰기는 이름마다 한 줄로 순서대로 보내되 밀린 값은 마지막 것만 남겨요. 쓰기가 실패하면 onError 로 알려요.
 * 읽기 실패(read)·깨진 값(corrupt)은 "없음"과 나눠 problem 으로, 쓰기 실패는 writeFailed 로 남겨요(빠른 추가 복구 기록이 이것으로
 * 새 제출을 막거나 확인을 요청해요). 새 값을 쓰면 읽기 문제는 풀리고, 다음 쓰기가 성공하면 쓰기 실패도 풀려요.
 *
 * 한 줄 대기열(PR #43 리뷰): 이름마다 읽기·쓰기·초기화가 같은 줄에서 시작한 순서대로 기기에 닿아요. 초기화는 세대를 올려
 * 그 전에 시작한 읽기의 늦은 결과를 버리고, 끝나기 전에는 다시 읽기·새 쓰기를 닫아요(status 가 ok 가 아니에요) —
 * 늦게 끝난 초기화가 그 뒤의 새 기록을 덮을 길이 없어요. 다시 읽기를 시작하면 바로 알려요(화면이 "다시 읽는 중"으로).
 *
 * 규칙 F(PR #43 리뷰 2): 버리기·초기화는 무조건 쓰지 않아요. 화면이 확인창을 띄울 때 지금 본 것(see)으로 계획을 만들고, 실행(apply)은 그 계획만 받아
 * 같은 줄에서 전제를 다시 읽어 같을 때만 그 한 곳에 써요. 다르거나 다시 읽기가 실패하면 아무것도 쓰지 않고 "changed" 예요.
 * 시간 상한(P2): 입출력마다 IO_TIMEOUT_MS 를 넘으면 그 작업은 실패(읽기 실패·쓰기 실패)로 줄이 넘어가요. 늦게 온 읽기 결과는 버리고,
 * 끝나지 않은 쓰기가 있으면 그 이름의 다음 쓰기는 보내지 않고 실패해요(늦은 쓰기가 새 값을 덮는 순서가 생기지 않게).
 */
export class SmallStore {
  private values = new Map<string, unknown>()
  private loaded = new Set<string>()
  private loading = new Map<string, Promise<void>>()
  private writing = new Map<string, Promise<void>>()
  private pending = new Map<string, string>()
  private listeners = new Map<string, Set<() => void>>()
  private problems = new Map<string, 'read' | 'corrupt'>()
  private writeFails = new Set<string>()
  // 다시 읽는 동안 기억하는 직전 문제(리뷰 25 P2 — 화면이 다시 그려져도 안내를 "다시 읽는 중"으로 남겨요), 마지막 초기화 쓰기가 실패한 이름
  private retryFrom = new Map<string, 'read' | 'corrupt'>()
  private resetFails = new Set<string>()
  // 이름마다 입출력 한 줄(읽기·쓰기·초기화가 시작한 순서대로), 세대(초기화가 올려요), 진행 중인 초기화와 그 직전 문제
  private lines = new Map<string, Promise<void>>()
  private gens = new Map<string, number>()
  private resets = new Map<string, Promise<PlanResult>>()
  private resetFrom = new Map<string, 'read' | 'corrupt'>()
  // 이름마다 바뀐 횟수(알릴 때마다 올라요) — 화면이 여러 이름을 한 번에 구독할 때 같은 그림인지 견줘요
  private versions = new Map<string, number>()
  // 시간 상한을 넘겨 아직 끝나지 않은 쓰기(그 이름의 다음 쓰기는 이것이 끝날 때까지 보내지 않아요), 이름마다 마지막 검사(바뀜 뒤 다시 읽기에 써요)
  private hung = new Map<string, Promise<void>>()
  private checks = new Map<string, (value: unknown) => boolean>()
  private timeoutMs: number
  constructor(private io: StoreIO, private onError: (name: string) => void = () => {}, opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? IO_TIMEOUT_MS
  }
  /** 시간 상한을 넘으면 실패하는 약속 */
  private timed<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('io timeout')), this.timeoutMs)
      p.then(
        (v) => {
          clearTimeout(t)
          resolve(v)
        },
        (e: unknown) => {
          clearTimeout(t)
          reject(e instanceof Error ? e : new Error(String(e)))
        },
      )
    })
  }
  private readIO(name: string): Promise<string | null> {
    return this.timed(this.io.read(name))
  }
  /** 쓰기 하나. 앞의 쓰기가 상한을 넘겨 아직 안 끝났으면 그것을 상한까지만 기다리고, 그래도 안 끝났으면 보내지 않고 실패해요 */
  private async writeIO(name: string, text: string): Promise<void> {
    const before = this.hung.get(name)
    if (before) await this.timed(before)
    const p = this.io.write(name, text)
    try {
      await this.timed(p)
    } catch (e) {
      const settled = p.then(
        () => undefined,
        () => undefined,
      )
      this.hung.set(name, settled)
      void settled.then(() => {
        if (this.hung.get(name) === settled) this.hung.delete(name)
      })
      throw e
    }
  }

  /** 그 이름이 바뀐 횟수(값·상태가 바뀌어 알릴 때마다 올라요) */
  version(name: string) {
    return this.versions.get(name) ?? 0
  }
  ready(name: string) {
    return this.loaded.has(name) && !this.resets.has(name)
  }
  /** 읽지 못했으면 'read', 값이 깨졌거나 검사를 못 지났으면 'corrupt', 없거나 잘 읽었으면 null */
  problem(name: string): 'read' | 'corrupt' | null {
    return this.problems.get(name) ?? null
  }
  /** 마지막 쓰기가 실패했는지(다음 쓰기가 성공하면 false) */
  writeFailed(name: string) {
    return this.writeFails.has(name)
  }
  get<T>(name: string, init: T): T {
    return this.values.has(name) ? (this.values.get(name) as T) : init
  }
  /** 지금 그 이름에서 진행 중인 일: 다시 읽기 · 초기화 · 없음 */
  busy(name: string): 'reload' | 'reset' | null {
    if (this.resets.has(name)) return 'reset'
    return !this.loaded.has(name) && this.retryFrom.has(name) ? 'reload' : null
  }
  private gen(name: string) {
    return this.gens.get(name) ?? 0
  }
  /** 그 이름의 입출력 줄 끝에 붙여요(앞 작업이 실패해도 순서대로 이어가요) */
  private line<T>(name: string, op: () => Promise<T>): Promise<T> {
    const run = (this.lines.get(name) ?? Promise.resolve()).then(op)
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    this.lines.set(name, tail)
    void tail.then(() => {
      if (this.lines.get(name) === tail) this.lines.delete(name)
    })
    return run
  }
  /** 처음 한 번 읽어요. 읽지 못한 값(없음·깨짐)은 init 그대로, check 를 지나지 못한 값도 버려요(깨짐·읽기 실패는 problem 으로) */
  load<T>(name: string, check: (value: unknown) => value is T): Promise<void> {
    this.checks.set(name, check)
    if (this.loaded.has(name)) return Promise.resolve()
    let p = this.loading.get(name)
    if (!p) {
      const gen = this.gen(name)
      const stale = () => gen !== this.gen(name) // 그사이 초기화가 시작됐으면 이 읽기 결과는 버려요(초기화가 상태를 정해요)
      p = this.line(name, () => this.readIO(name))
        .then(
          (text) => {
            if (stale()) return
            // 다시 읽기가 닿으면 늘 디스크 값을 반영해요(PR #43 리뷰 3 P2 — 메모리의 옛 값을 남기지 않아요)
            if (text === null) return void this.values.delete(name)
            let value: unknown
            try {
              value = JSON.parse(text)
            } catch {
              this.values.delete(name)
              this.problems.set(name, 'corrupt') // 깨진 파일은 처음 값으로, 상태는 깨짐
              return
            }
            if (check(value)) this.values.set(name, value)
            else {
              this.values.delete(name)
              this.problems.set(name, 'corrupt')
            }
          },
          () => {
            if (stale()) return
            this.values.delete(name)
            this.problems.set(name, 'read')
          },
        )
        .finally(() => {
          if (this.loading.get(name) === p) this.loading.delete(name)
          if (stale()) return
          this.loaded.add(name)
          this.retryFrom.delete(name)
          this.notify(name)
        })
      this.loading.set(name, p)
    }
    return p
  }
  /** 읽기 문제를 지우고 다시 읽어요(사람이 "다시 읽기"를 눌렀을 때). 초기화 중이면 새로 읽지 않고 초기화가 끝나기를 기다려요 */
  reload<T>(name: string, check: (value: unknown) => value is T): Promise<void> {
    const reset = this.resets.get(name)
    if (reset) return reset.then(() => undefined)
    const busy = this.loading.get(name)
    if (busy) return busy
    const was = this.problems.get(name)
    if (was) this.retryFrom.set(name, was)
    this.loaded.delete(name)
    this.problems.delete(name)
    const p = this.load(name, check)
    this.notify(name) // 시작을 바로 알려요(옛 오류·단추가 다음 그림까지 남지 않게, 리뷰 P2)
    return p
  }
  /** 다시 읽는 중이면 그 직전 문제, 초기화 중이면 초기화 직전 문제(읽기 실패·깨짐), 아니면 null */
  retrying(name: string): 'read' | 'corrupt' | null {
    if (this.resets.has(name)) return this.resetFrom.get(name) ?? null
    return this.loaded.has(name) ? null : (this.retryFrom.get(name) ?? null)
  }
  /** 마지막 초기화 쓰기가 실패했는지(그동안 문제 상태는 그대로예요) */
  resetFailed(name: string) {
    return this.resetFails.has(name)
  }
  /** 이름 하나의 상태(규칙 E, 리뷰 22): 읽는 중(초기화 중 포함) · 잘 읽음 · 읽기 실패 · 깨짐. ok 가 아니면 화면은 준비 완료가 아니에요 */
  status(name: string): 'loading' | 'ok' | 'read' | 'corrupt' {
    if (!this.loaded.has(name) || this.resets.has(name)) return 'loading'
    return this.problems.get(name) ?? 'ok'
  }
  /**
   * 값을 바꿔요. 아직 읽는 중이거나 초기화 중이거나 읽지 못했거나 깨졌으면 쓰지 않고 false(규칙 E — 읽지 못한 값을 빈 값·새 값으로 덮지 않아요).
   * 읽지 못한 값을 덮는 길은 사람이 고른 "버리고 새로"(reset)뿐이에요
   */
  set<T>(name: string, value: T): boolean {
    if (this.status(name) !== 'ok') return false
    this.write(name, value)
    return true
  }
  /** 그 이름의 지금 파일을 같은 줄에서 읽어요(규칙 F 계획의 전제): 없음 · 원문 · 못 읽음 */
  see(name: string): Promise<Seen> {
    return this.line(name, () => this.seeNow(name))
  }
  private async seeNow(name: string): Promise<Seen> {
    try {
      const text = await this.readIO(name)
      return text === null ? { s: 'absent' } : { s: 'text', text }
    } catch {
      return { s: 'unreadable' }
    }
  }
  /**
   * 규칙 F: 확인한 계획만 실행해요. 전제와 쓸 곳의 이름들을 모두 같은 줄에 묶고, 그 안에서 전제를 다시 읽어 모두 같을 때만 쓸 곳 하나에 써요.
   * 다르거나 다시 읽기가 실패하면(전제가 원문·없음이었는데) 아무것도 쓰지 않고 "changed" — 그 이름들을 다시 읽어 화면이 지금 상태로 새 계획을 만들어요.
   * 쓰는 동안 그 이름은 닫혀요(쓰기·다시 읽기). 쓰기가 실패하면 직전 문제 그대로 "failed"(resetFailed). 쓸 곳이 이미 실행 중이면 그 결과를 기다려 "changed"
   */
  apply(plan: StorePlan): Promise<PlanResult> {
    return this.compareAndWrite(plan)
  }
  /**
   * 원자적 비교-후-쓰기(PR #43 리뷰 3): 대상의 전제·쓸 곳 이름들을 같은 줄에 묶은 한 임계 구역에서 ① 그 이름들의 앞선 쓰기(시간 상한을 넘겨 아직 안 끝난 것 포함)가
   * 끝나기를 상한까지 기다리고(안 끝나면 "busy" 0건) ② 전제를 다시 읽어 ③ 모두 같을 때만 쓸 곳 하나에 써요. 사이에 다른 쓰기가 끼지 못해요.
   * 모든 버리기·초기화는 이것 하나로만 실행해요(소스 규칙)
   */
  compareAndWrite(plan: CasTarget<string>, opts: { quiet?: boolean } = {}): Promise<PlanResult> {
    if (opts.quiet) return this.quietCompareAndWrite(plan)
    const target = plan.write.key
    const busy = this.resets.get(target)
    if (busy) return busy.then(() => 'changed' as const)
    const names = [...new Set([...plan.premises.map((x) => x.key), target])]
    const from = this.problems.get(target) ?? this.retryFrom.get(target) ?? null
    if (from) this.resetFrom.set(target, from)
    this.gens.set(target, this.gen(target) + 1)
    // 밀린 쓰기는 계획 뒤에 오래된 값으로 덮지 않게 빼 두고, 계획이 실행되지 않으면(바뀜·실패) 되돌려 다시 써요
    const dropped = this.pending.get(target)
    this.pending.delete(target)
    let result: PlanResult = 'failed'
    const run = this.lineMany(names, async (): Promise<PlanResult> => {
      for (const n of names) {
        const before = this.hung.get(n)
        if (!before) continue
        try {
          await this.timed(before)
        } catch {
          return 'busy'
        }
      }
      for (const [i, x] of plan.premises.entries()) if (!premiseHolds(plan, i, await this.seeNow(x.key))) return 'changed'
      await this.writeIO(target, JSON.stringify(plan.write.value))
      return 'done'
    })
    const p = run
      .then(
        (r) => r,
        () => 'failed' as const,
      )
      .then((r) => {
        result = r
        this.loaded.add(target)
        this.retryFrom.delete(target)
        if (r === 'done') {
          this.resetFails.delete(target)
          this.writeFails.delete(target)
          this.problems.delete(target)
          this.values.set(target, plan.write.value)
        } else {
          if (dropped !== undefined && !this.pending.has(target)) {
            this.pending.set(target, dropped)
            if (!this.writing.has(target)) this.writing.set(target, this.drain(target))
          }
          if (from) this.problems.set(target, from)
          if (r === 'failed') {
            this.resetFails.add(target)
            this.onError(target)
          }
        }
        return r
      })
      .finally(() => {
        this.resets.delete(target)
        this.resetFrom.delete(target)
        for (const n of names) this.notify(n)
        // 바뀌었으면 전제의 이름들을 다시 읽어 지금 상태를 보여요(화면이 새 계획을 만들어요)
        if (result === 'changed' || result === 'busy') for (const n of names) void this.reload(n, (this.checks.get(n) ?? ((v: unknown) => v !== undefined)) as (v: unknown) => v is unknown)
      })
    this.resets.set(target, p)
    this.notify(target)
    return p
  }
  /**
   * 조용한 비교-후-쓰기(편집 초안 자동 저장 — 규칙 G, PR #43 리뷰 4): 같은 한 임계 구역(앞선 쓰기 기다림 → 전제 다시 읽기 → 같으면 쓰기)이지만,
   * 그 이름을 닫지 않아요(잘 읽은 이름에 쓰는 사람 편집이라 입력이 잠기지 않게). 썼으면 메모리 값도 그 값, 바뀜·busy 면 아무것도 바꾸지 않아요
   */
  private quietCompareAndWrite(plan: CasTarget<string>): Promise<PlanResult> {
    const target = plan.write.key
    const names = [...new Set([...plan.premises.map((x) => x.key), target])]
    return this.lineMany(names, async (): Promise<PlanResult> => {
      for (const n of names) {
        const before = this.hung.get(n)
        if (!before) continue
        try {
          await this.timed(before)
        } catch {
          return 'busy'
        }
      }
      // 자동 저장의 전제는 늘 잘 읽거나 쓴 원문(known)이에요 — 못 읽음은 sameSeen 에서 언제나 다름(리뷰 6)
      for (const x of plan.premises) if (!sameSeen(await this.seeNow(x.key), x.seen)) return 'changed'
      try {
        await this.writeIO(target, JSON.stringify(plan.write.value))
      } catch {
        this.writeFails.add(target)
        this.onError(target)
        this.notify(target)
        return 'failed'
      }
      this.writeFails.delete(target)
      this.values.set(target, plan.write.value)
      this.notify(target)
      return 'done'
    })
  }
  /** 값 하나를 처음 값으로 되돌리는 계획(시험·화면 설정): 지금 본 것을 전제로 그 이름에 value 를 써요 */
  async planReset<T>(name: string, value: T, message = ''): Promise<StorePlan> {
    return { premises: [{ key: name, seen: await this.see(name) }], write: { key: name, value }, message }
  }
  /** 여러 이름을 같은 줄에 묶어요(모두 앞 작업이 끝난 뒤에 시작하고, 끝날 때까지 그 이름들의 다음 작업이 기다려요) */
  private lineMany<T>(names: string[], op: () => Promise<T>): Promise<T> {
    const run = Promise.all(names.map((n) => this.lines.get(n) ?? Promise.resolve())).then(op)
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    for (const n of names) {
      this.lines.set(n, tail)
      void tail.then(() => {
        if (this.lines.get(n) === tail) this.lines.delete(n)
      })
    }
    return run
  }
  private write<T>(name: string, value: T) {
    this.values.set(name, value)
    this.notify(name)
    this.pending.set(name, JSON.stringify(value))
    if (!this.writing.has(name)) this.writing.set(name, this.drain(name))
  }
  /**
   * 먼저 기록(write-ahead): 값을 쓰고 그 쓰기가 기기에 닿을 때까지 기다려요. 닿았으면 true, 실패했으면 false(그러면 부르는 쪽은
   * 요청을 보내지 않아요 — 014_write_inventory.md 규칙 B). 그 이름을 읽지 못했거나 깨졌으면 덮지 않고 false 예요
   */
  async setDurable<T>(name: string, value: T): Promise<boolean> {
    if (!this.set(name, value)) return false
    return this.settled(name)
  }
  /** 지금까지 그 이름에 쓴 값이 모두 기기에 닿았는지(쓰기 줄이 빌 때까지 기다려요) */
  async settled(name: string): Promise<boolean> {
    for (let w = this.writing.get(name); w; w = this.writing.get(name)) await w
    return !this.writeFails.has(name) && !this.problems.has(name)
  }
  /** 지금 밀린 쓰기·초기화가 모두 끝날 때까지(시험·앱이 뒤로 갈 때) */
  async flush() {
    while (this.writing.size || this.resets.size) await Promise.all([...this.writing.values(), ...this.resets.values()])
  }
  subscribe(name: string, listener: () => void): () => void {
    let set = this.listeners.get(name)
    if (!set) this.listeners.set(name, (set = new Set()))
    set.add(listener)
    return () => set.delete(listener)
  }
  private async drain(name: string) {
    try {
      for (let text = this.pending.get(name); text !== undefined; text = this.pending.get(name)) {
        this.pending.delete(name)
        const gen = this.gen(name)
        try {
          await this.line(name, () => this.writeIO(name, text))
          if (gen === this.gen(name) && this.writeFails.delete(name)) this.notify(name)
        } catch {
          if (gen !== this.gen(name)) continue // 그사이 초기화가 시작됐으면 초기화가 상태를 정해요
          this.writeFails.add(name)
          this.notify(name)
          this.onError(name)
        }
      }
    } finally {
      this.writing.delete(name)
    }
  }
  private notify(name: string) {
    this.versions.set(name, this.version(name) + 1)
    for (const l of this.listeners.get(name) ?? []) l()
  }
}

/**
 * 한 번 준비한 값(범위 폴더 등)을 기억해 다음 호출에 같은 값을 줘요. 같이 들어온 호출은 진행 중인 준비 하나를 나눠 써요.
 * 실패한 준비는 기억하지 않아요 — 장애가 풀리면 다음 호출("다시 읽기")이 다시 준비해요(머지 뒤 P2, 리뷰 23)
 */
export function onceOk<T>(make: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null
  return () => {
    if (p) return p
    const cur = make()
    p = cur
    cur.catch(() => {
      if (p === cur) p = null
    })
    return cur
  }
}
