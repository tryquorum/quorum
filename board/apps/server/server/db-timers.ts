// DB 가 열려 있는 동안만 도는 주기 작업. 그 DB 를 닫으면(db.close) 그 DB 의 타이머를 모두 지워요 — 시험이 DB 를 닫은 뒤 남은 틱이
// 닫힌 DB 를 건드려, 루트 한 프로세스 bun test 가 60초를 넘기면 그때 돌던 다른 시험을 실패시키던 문제를 막아요.
// 운영 서버(3070)는 DB 를 끝까지 열어 두므로 주기 작업은 그대로예요. 틱 안의 오류는 잡아 기록하고 다음 틱이 그대로 돌아요.
import type { Database } from "bun:sqlite"

type Entry = { clear: () => void }
const owned = new WeakMap<Database, Set<Entry>>()

/** 열려 있는지(닫힌 DB 는 inTransaction 읽기에서 던져요) */
function isOpen(db: Database): boolean {
  try {
    void db.inTransaction
    return true
  } catch {
    return false
  }
}

function track(db: Database, entry: Entry): () => void {
  let set = owned.get(db)
  if (!set) {
    const made = new Set<Entry>()
    owned.set(db, made)
    set = made
    // close 의 의미는 그대로(PR #44 리뷰): 호출 시점 this 로 원래 close 를 부르고, 성공한 뒤에 실제로 닫힌 그 인스턴스의 타이머만 지워요.
    // 원래 close 가 던지면 타이머는 그대로 두고 그 오류를 다시 던져요
    const original = db.close
    db.close = function (this: Database, ...args: Parameters<Database["close"]>) {
      const r = original.apply(this, args)
      stopDbTimers(this)
      return r
    } as Database["close"]
  }
  set.add(entry)
  return () => {
    entry.clear()
    owned.get(db)?.delete(entry)
  }
}

const guarded = (fn: () => unknown, label: string) => () => {
  try {
    const r = fn()
    if (r instanceof Promise) return r.catch((e) => console.error(`[${label}] periodic task failed; will retry`, e))
  } catch (e) {
    console.error(`[${label}] periodic task failed; will retry`, e)
  }
}
// 서버를 살려 두는 것은 Bun.serve 예요 — 주기 타이머는 프로세스를 붙잡지 않아요(시험 프로세스가 끝날 수 있게)
const loose = (t: ReturnType<typeof setTimeout>) => (t as { unref?: () => unknown })?.unref?.()

/**
 * ms 마다 fn — 그 DB 가 열려 있는 동안만. 돌려준 함수로 먼저 멈출 수도 있어요.
 * first: 지금 한 번 먼저(그 오류는 잡지 않아요 — 시작할 때 실패는 그대로 드러나요)
 */
export function everyWhileOpen(db: Database, ms: number, fn: () => unknown, label: string, opts: { first?: boolean } = {}): () => void {
  if (!isOpen(db)) return () => {} // 이미 닫힌 DB 에는 타이머를 만들지 않아요
  if (opts.first) fn()
  const t = setInterval(guarded(fn, label), ms)
  loose(t)
  return track(db, { clear: () => clearInterval(t) })
}
/** ms 뒤 한 번 fn — 그 전에 DB 를 닫으면 돌지 않아요 */
export function laterWhileOpen(db: Database, ms: number, fn: () => unknown, label: string): () => void {
  if (!isOpen(db)) return () => {}
  let stop = () => {}
  const t = setTimeout(() => {
    stop()
    return guarded(fn, label)()
  }, ms)
  loose(t)
  stop = track(db, { clear: () => clearTimeout(t) })
  return stop
}
/** 그 DB 의 주기 작업을 모두 멈춰요(db.close 가 부르고, 직접 불러도 돼요) */
export function stopDbTimers(db: Database): void {
  const set = owned.get(db)
  if (!set) return
  for (const e of set) e.clear()
  set.clear()
}
