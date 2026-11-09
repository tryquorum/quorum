// 먼저 기록(write-ahead, 규칙 B — devlog/_plan/261107_ios_parity/work/014_write_inventory.md). 결과를 모를 수 있는 생성·AI 실행은
// 보내기 전에 범위·키·요청·단계를 기기 저장(범위별 SmallStore 'intents')에 남기고, 기기에 닿은 것을 확인한 뒤에만 보내요.
// 성공·확실한 거절이면 지우고, 결과 불명이거나 앱이 도중에 꺼졌으면 남아 홈의 "끝나지 않은 요청"에 보여요.
// 리뷰 9: 남은 기록은 앱이 스스로 다시 보내지 않아요. "확인"은 키로 읽기만(confirm.ts), 다시 보내기·이어 하기는 사람이 눌렀을 때만(replays.ts),
// 지우기는 들어가 있다고 확인됐을 때와 사람이 버렸을 때만. 키는 서버에서 멱등이라(AI 실행 clientKey, 노트 onceKey run:<id>, 문서 id, 사건 ref) 사람이 다시 보내도 하나만 생겨요.
// 순수 TS 라 bun 으로 시험해요(intents.test.ts). 화면 훅은 useIntents.ts.
import { UnknownWriteError } from '../../api/client'

export type IntentKind = 'run' | 'work' | 'note' | 'answer' | 'doc' | 'item'
export type Intent = { key: string; kind: IntentKind; scope: string; at: number; label: string; payload: unknown }
export const INTENTS = 'intents'
const KINDS: IntentKind[] = ['run', 'work', 'note', 'answer', 'doc', 'item']
const isIntent = (v: unknown): v is Intent => {
  const i = v as Intent
  return !!i && typeof i === 'object' && typeof i.key === 'string' && KINDS.includes(i.kind) && typeof i.scope === 'string' && typeof i.at === 'number' && typeof i.label === 'string'
}
export const isIntents = (v: unknown): v is Record<string, Intent> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isIntent)
/**
 * 깨진 기록 파일을 버릴 때 나누기(PR #43 리뷰): 객체로 읽히면 성한 요청 기록은 남기고 깨진 것만 버려요(기록 하나의 깨짐이 다른 기록에 닿지 않게).
 * 객체로 읽히지 않으면 null — 화면은 확인창에 기록이 모두 버려진다고 밝혀요
 */
export function splitIntents(raw: unknown): { keep: Record<string, Intent>; dropped: number; kept: number } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const all = Object.entries(raw)
  const keep = Object.fromEntries(all.filter(([k, v]) => isIntent(v) && v.key === k)) as Record<string, Intent>
  const kept = Object.keys(keep).length
  return { keep, dropped: all.length - kept, kept }
}

/** 먼저 기록을 남기지 못해 보내지 않음(기기 저장 실패, 기록 파일을 못 읽음·깨짐) */
export class WriteAheadError extends Error {
  readonly notSent = true
}
export type Journal = {
  /** 기록을 남기고 기기에 닿았는지 */
  put: (i: Intent) => Promise<boolean>
  drop: (key: string) => void
  /** 보내기가 끝남(기록이 남았으면 이제 "끝나지 않은 요청"으로 보여요) */
  release: (key: string) => void
  /** 기록 파일을 못 읽었거나 깨졌으면 그 이유(그동안은 새로 보내지 않아요) */
  blocked: () => string | null
}
/** 결과 불명이라 기록을 남길지(쓰였을 수 있음). 확실한 거절·범위 바뀜(보내지 않음)은 지워요 */
export const unknownLike = (e: unknown) => e instanceof UnknownWriteError || (!!e && typeof e === 'object' && (e as { unknownWrite?: unknown }).unknownWrite === true)

/**
 * 보내기 전에 기록 → 기기에 닿으면 보내기 → 성공·확실한 거절이면 기록 지우기, 결과 불명이면 남기기.
 * keep(결과): 던지지 않고 결과로 "결과 불명"을 알리는 흐름(새 일 만들기)을 위해요.
 */
export async function withIntent<T>(j: Journal, i: Intent, send: () => Promise<T>, keep: (r: T) => boolean = () => false): Promise<T> {
  const why = j.blocked()
  if (why) throw new WriteAheadError(why)
  try {
    if (!(await j.put(i))) throw new WriteAheadError('이어서 확인할 기록을 기기에 남기지 못해 보내지 않았어요')
    let r: T
    try {
      r = await send()
    } catch (e) {
      if (!unknownLike(e)) j.drop(i.key)
      throw e
    }
    if (!keep(r)) j.drop(i.key)
    return r
  } finally {
    j.release(i.key)
  }
}

/** 기록 목록(오래된 것부터). 지금 보내는 중인 것은 빼요 */
export const listIntents = (all: Record<string, Intent>, sending: ReadonlySet<string>) => Object.values(all).filter((i) => !sending.has(i.key)).sort((a, b) => a.at - b.at)
