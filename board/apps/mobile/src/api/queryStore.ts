// 화면 사이 공용 읽기 캐시와 낙관적 쓰기. React·RN 없이 시험할 수 있게 순수 TS 로 둬요(훅은 query.ts).
// 규칙과 이유: docs/internals/mobile-ia.md 의 "데이터".

export type QueryState<T> = {
  /** 서버가 확인한 값 위에 진행 중인 낙관적 변경을 얹은 값 */
  data: T | undefined
  /** 마지막 읽기 실패. 데이터가 있으면 화면은 데이터를 그대로 보이고 한 줄로 알려요 */
  error: unknown
  status: 'idle' | 'loading' | 'ok' | 'error'
  fetching: boolean
}

type Entry<T> = {
  base: T | undefined
  overlays: Map<number, (data: T) => T>
  state: QueryState<T>
  inflight: Promise<void> | null
  again: boolean
  /** 끝난 쓰기 수. 읽기를 보낸 뒤 이 값이 바뀌면 그 읽기는 쓰기 전 값일 수 있어요 */
  writes: number
  loader: (() => Promise<T>) | null
  listeners: Set<() => void>
}

const IDLE: QueryState<never> = { data: undefined, error: null, status: 'idle', fetching: false }

export type Mutation<T, R> = {
  /** 화면에 바로 보일 변경 */
  apply: (data: T) => T
  send: () => Promise<R>
  /** 성공했을 때 서버가 확인한 값에 반영. 없으면 apply 를 그대로 반영 */
  commit?: (data: T, result: R) => T
  /** 결과를 모르는 실패인지(그러면 되돌린 뒤 다시 읽어 실제 값을 보여요) */
  unknown?: (error: unknown) => boolean
}

export class QueryStore {
  private scope = ''
  /** 범위(서버 주소 + 로그인 주체)가 바뀔 때마다 올라가요. 그 전에 떠난 읽기·쓰기의 결과는 받지 않아요 */
  private generation = 0
  private seq = 0
  private entries = new Map<string, Entry<unknown>>()

  /** 서버 주소나 로그인 주체가 바뀌면 캐시를 비워요. 다른 계정의 데이터가 마지막 값으로 남지 않게 */
  setScope(scope: string) {
    if (scope === this.scope) return
    this.scope = scope
    this.generation++
    for (const entry of this.entries.values()) {
      entry.base = undefined
      entry.overlays.clear()
      entry.inflight = null
      entry.again = false
      entry.state = IDLE
      this.notify(entry)
    }
  }

  get(key: string): QueryState<unknown> {
    return this.entries.get(key)?.state ?? IDLE
  }

  /** 지금 범위의 세대. 비동기 작업은 시작할 때 받아 두고, 보내거나 반영하기 직전에 current(세대)로 확인해요 */
  get generationNow(): number {
    return this.generation
  }
  current(generation: number): boolean {
    return generation === this.generation
  }

  subscribe(key: string, listener: () => void): () => void {
    const entry = this.entry(key)
    entry.listeners.add(listener)
    return () => entry.listeners.delete(listener)
  }

  /** 지금 화면이 구독한 키를 모두 다시 읽어요(앱이 앞으로 돌아왔을 때) */
  refreshWatched() {
    for (const [key, entry] of this.entries) if (entry.listeners.size && entry.loader) void this.fetch(key, entry.loader)
  }

  /** 읽기. 같은 키를 이미 읽는 중이면 그 읽기가 끝난 뒤 한 번 더 읽고, 그 후속까지 끝나야 끝나요 */
  fetch<T>(key: string, loader: () => Promise<T>): Promise<void> {
    const entry = this.entry<T>(key)
    entry.loader = loader
    if (entry.inflight) {
      entry.again = true
      return entry.inflight
    }
    const generation = this.generation
    const run = async () => {
      do {
        entry.again = false
        const writes = entry.writes
        this.set(entry, { ...entry.state, fetching: true, status: entry.state.data === undefined ? 'loading' : entry.state.status })
        try {
          const value = await loader()
          if (generation !== this.generation) return
          if (entry.writes !== writes && entry.base !== undefined) {
            // 읽는 사이 끝난 쓰기가 있어요: 이 값은 쓰기 전일 수 있으니 버리고 다시 읽어요
            entry.again = true
            continue
          }
          if (entry.writes !== writes) entry.again = true // 첫 읽기는 받아 두고 곧바로 다시 읽어요
          entry.base = value
          this.set(entry, { data: this.view(entry), error: null, status: 'ok', fetching: entry.again })
        } catch (error) {
          if (generation !== this.generation) return
          this.set(entry, { data: entry.state.data, error, status: 'error', fetching: false })
        }
      } while (entry.again && generation === this.generation)
    }
    const inflight = run().finally(() => {
      if (entry.inflight === inflight) entry.inflight = null
      if (generation === this.generation && entry.state.fetching) this.set(entry, { ...entry.state, fetching: false })
    })
    entry.inflight = inflight
    return inflight
  }

  /**
   * 낙관적 쓰기. 진행 중인 변경은 어떤 읽기 결과 위에도 다시 얹혀요. 실패하면 이 변경만 빠지고(뒤이은 변경은 남음)
   * 서버가 확인한 값으로 돌아가요. 결과를 모르는 실패면 다시 읽어요. 자동으로 다시 보내지 않아요.
   */
  async mutate<T, R>(key: string, mutation: Mutation<T, R>): Promise<R> {
    const entry = this.entry<T>(key)
    const generation = this.generation
    const id = ++this.seq
    entry.overlays.set(id, mutation.apply)
    this.set(entry, { ...entry.state, data: this.view(entry) })
    try {
      const result = await mutation.send()
      if (generation === this.generation) {
        entry.overlays.delete(id)
        entry.writes++
        const base = entry.base
        if (base !== undefined) entry.base = mutation.commit ? mutation.commit(base as T, result) : mutation.apply(base as T)
        this.set(entry, { ...entry.state, data: this.view(entry) })
      }
      return result
    } catch (error) {
      if (generation === this.generation) {
        entry.overlays.delete(id)
        this.set(entry, { ...entry.state, data: this.view(entry) })
        if (mutation.unknown?.(error) && entry.loader) void this.fetch(key, entry.loader)
      }
      throw error
    }
  }

  private view<T>(entry: Entry<T>): T | undefined {
    if (entry.base === undefined) return undefined
    let data: T = entry.base as T
    for (const apply of entry.overlays.values()) data = apply(data)
    return data
  }

  private entry<T>(key: string): Entry<T> {
    let entry = this.entries.get(key) as Entry<T> | undefined
    if (!entry) {
      entry = { base: undefined, overlays: new Map(), state: IDLE, inflight: null, again: false, writes: 0, loader: null, listeners: new Set() }
      this.entries.set(key, entry as Entry<unknown>)
    }
    return entry
  }

  private set<T>(entry: Entry<T>, state: QueryState<T>) {
    entry.state = state
    this.notify(entry)
  }

  private notify<T>(entry: Entry<T>) {
    for (const listener of entry.listeners) listener()
  }
}

/** 서버나 로그인이 바뀌어 보내지 않은 쓰기 */
export class ScopeChangedError extends Error {
  /** 계약 쪽 순수 규칙(quick-add createWork)이 클래스 없이 알아보는 표시 */
  readonly scopeChanged = true
  constructor(message = '서버나 로그인이 바뀌어 저장하지 않았어요') {
    super(message)
  }
}

/**
 * 같은 키(항목)의 쓰기를 순서대로 하나씩 보내요(웹 useBoard 의 putChain). 범위는 **부르는 쪽이 화면·시트·확인창을 연 시점에 잡은 것**
 * (scope = useWriteScope())이고, 줄에서 차례가 와 보내기 직전에 그 범위와 지금을 비교해 다르면 보내지 않고 ScopeChangedError 예요.
 * 콜백이 실행되는 때의 범위를 새로 잡지 않아요(늦게 온 기한 입력·삭제 확인이 바뀐 계정으로 가지 않게, 014_write_inventory.md 규칙 A)
 */
export function queueWrite<R>(store: QueryStore, chains: Map<string, Promise<unknown>>, key: string, send: () => Promise<R>, scope: { same(): boolean }): Promise<R> {
  // 캐시 세대는 화면이 다시 그려질 때 바뀌어서, 연 시점의 범위(scope)도 보내기 직전에 같은 틱에서 함께 봐요
  const generation = store.generationNow
  const prev = chains.get(key) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(() => {
    if (!store.current(generation) || !scope.same()) throw new ScopeChangedError()
    return send()
  })
  chains.set(key, next)
  void next.catch(() => undefined).finally(() => {
    if (chains.get(key) === next) chains.delete(key)
  })
  return next
}
