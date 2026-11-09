// 웹 빠른 추가 복구 기록(PR #39 리뷰 16). iOS 의 범위별 기기 저장(features/board/quick/pendingSlot.ts)과 같은 모양·같은 규칙(계약 quick-recovery.ts)을 localStorage 에 둬요.
// - 범위 = 서버 주소(origin) + 로그인 주체, 자리(한 줄·시트·목표 할 일 × 대상)마다 키 하나(PR #43 리뷰 — 한 자리의 깨짐·버리기가 다른 자리에 닿지 않게).
//   예전의 범위별 묶음 키({ 자리: 기록 })는 그 자리 키가 없을 때만 읽어 넘겨요(계약 slot-store.ts, iOS 와 같은 판정).
// - 보내기 전에 먼저 기록(writeAhead), 닫기·뒤로·화면 내리기·새로고침에도 그대로, 다시 열면 복원.
// - 지우는 길은 done(끝난 결과)과 discard(사람의 버리기 — 화면은 확인창 안에서만)뿐.
// - 읽기 실패·깨짐은 "기록 없음"이 아니라서 새 제출을 막고 다시 읽기·버리고 새로(확인창)를 보여요(iOS storeGate 와 같은 원칙).
import { useCallback, useEffect, useRef, useState } from "react"
import { createWork, type CreateDeps, type Draft } from "@direction-board/contracts/quick-add"
import { checkWith, editEmpty, editMeaning, isEdit, isPending, migrateEdits, migrateSlots, slotGate, storeProblemText, submitWithRecord, type Done, type Pending, type QuickEdit, type SlotNotice, type Submitted } from "@direction-board/contracts/quick-recovery"
import { planDraftClear, planRecordDiscard, planSlotDiscard, rawOfSeen, sameSeen, slotName, slotView, type PlanResult, type Raw, type Seen, type SlotView } from "@direction-board/contracts/slot-store"
import { compareAndWrite, seeKey, type WebPlan, type WebTarget } from "@/lib/store-plan"
import type { Item } from "@direction-board/contracts"
import { api, uid } from "@/lib/api"

type StorageLike = Pick<Storage, "getItem" | "setItem">

/** 예전의 범위별 기록 묶음 키(읽어 넘기기만 해요). 자리 키는 recordKey */
export const slotKey = (scope: string) => `direction.quickPending:${scope}`
export const recordKey = (scope: string, slot: string) => slotName(slotKey(scope), slot)

/** 저장소 키 하나를 읽은 결과(못 읽음·JSON 아님·없음·값) */
function rawOf(storage: StorageLike, key: string): Raw {
  let text: string | null
  try {
    text = storage.getItem(key)
  } catch {
    return { s: "read" }
  }
  if (text === null) return { s: "absent" }
  try {
    return { s: "value", v: JSON.parse(text) as unknown }
  } catch {
    return { s: "corrupt" }
  }
}
/** 자리별 저장 한 가지(기록·쓰던 초안): 예전 묶음 키, 값 검사, 옛 자리 이름 옮기기 */
type SlotKind<T> = { bundle: (scope: string) => string; own: (scope: string, slot: string) => string; isOne: (v: unknown) => v is T; migrate: (m: Record<string, T>) => Record<string, T> }
const RECORDS: SlotKind<Pending> = { bundle: slotKey, own: recordKey, isOne: isPending, migrate: migrateSlots }
const readOne = <T,>(storage: StorageLike, scope: string, slot: string, k: SlotKind<T>): SlotView<T> => slotView(rawOf(storage, k.own(scope, slot)), rawOf(storage, k.bundle(scope)), slot, k.isOne, k.migrate)
/** 그 자리 키에 써요(null = 비움). 그 자리를 잘 읽지 못했으면 덮지 않고 false, 쓰기 실패도 false */
function writeOne<T>(storage: StorageLike, scope: string, slot: string, v: T | null, k: SlotKind<T>): boolean {
  if (readOne(storage, scope, slot, k).s !== "ok") return false
  try {
    storage.setItem(k.own(scope, slot), JSON.stringify(v))
    return true
  } catch {
    return false
  }
}
/**
 * 깨졌거나 못 읽은 자리의 버리고 새로 계획(규칙 F — 확인창을 띄울 때 지금 읽은 것으로). 그 자리 문제면 그 자리 키만 비우고(다른 자리 그대로),
 * 예전 묶음 자체의 문제면 묶음을 비워요 — 확인창 글(plan.message)이 그 범위를 밝혀요. 지금 읽어 문제가 없으면 null
 */
const planOne = <T,>(storage: StorageLike, scope: string, slot: string, k: SlotKind<T>, what: string): WebPlan | null =>
  planSlotDiscard({ key: k.own(scope, slot), seen: seeKey(storage, k.own(scope, slot)) }, { key: k.bundle(scope), seen: seeKey(storage, k.bundle(scope)) }, slot, k.isOne, k.migrate, what)
const problemOf = <T,>(v: SlotView<T> | null): "read" | "corrupt" | null => (v && (v.s === "read" || v.s === "corrupt") ? v.s : null)

/** 그 자리의 기록(SlotView: 잘 읽음이면 value, 문제면 level — 그 자리만·예전 묶음 전체) */
export const readSlot = (storage: StorageLike, scope: string, slot: string): SlotView<Pending> => readOne(storage, scope, slot, RECORDS)
/** 그 자리 키에 기록을 써요. 그 자리를 읽지 못했거나 깨졌으면 덮지 않고 false, 쓰기 실패도 false */
export const writeSlot = (storage: StorageLike, scope: string, slot: string, p: Pending | null): boolean => writeOne(storage, scope, slot, p, RECORDS)
/** 깨졌거나 못 읽은 그 자리(또는 예전 묶음)의 버리고 새로 계획(확인창 글 포함). 실행은 store-plan compareAndWrite(계획만) */
export const planSlotReset = (storage: StorageLike, scope: string, slot: string): WebPlan | null => planOne(storage, scope, slot, RECORDS, "빠른 추가 기록")

const CHANGED = "quick-slots:changed"
const browserStorage = (): StorageLike | null => (typeof window === "undefined" ? null : window.localStorage)

export type QuickSlot = {
  pending: Pending | null
  /** 그 범위의 기록 묶음을 잘 읽었는지(규칙 C — 읽기 전·못 읽음·깨짐이면 입력을 막아요) */
  loaded: boolean
  /** 새로 제출해도 되는지(범위를 모르거나 읽기 실패·깨짐이면 false) */
  ready: boolean
  notice: SlotNotice | null
  reread: () => void
  /** 버리고 새로 계획(규칙 F): 누를 때 지금 읽어 지울 곳 하나 + 확인창 글. 버릴 것이 없으면 null */
  plan: () => WebPlan | null
  /** 확인창 뒤 그 계획만 실행(전제가 바뀌었으면 0건 "changed") */
  apply: (plan: WebPlan) => PlanResult
  writeAhead: (p: Pending) => Promise<boolean>
  /** 끝나지 않은 결과의 기록(지우는 길이 아니에요). 남기지 못하면 false */
  keep: (p: Pending) => boolean
  /** 끝(done)난 그 기록만 지워요. 지우지 못하면 false — 남은 기록은 먼저 기록(결과 불명)이라 다음에 열면 "확인"(읽기만)으로 끝이 정리돼요 */
  done: (r: Done) => boolean
  /**
   * 사람의 버리기 계획(규칙 F, PR #43 리뷰 3): 그 화면에 보인 기록을 비우는 대상 — 지금 읽은 그 자리 기록이 본 것과 같을 때만, 아니면 null(그사이 바뀜).
   * 화면은 lib/quick-discard.ts 로 쓰던 초안 대상과 함께 계획해 확인창에 둘 다 밝히고, 확인 뒤 run(대상)
   */
  planDiscard: () => WebTarget | null
  /** 대상 하나 실행(비교-후-쓰기) */
  run: (t: WebTarget) => PlanResult
}

/** 그 자리의 기록. localStorage 는 바로 읽혀서 첫 그림부터 기록이 보여요(다시 연 시트·새로고침 뒤 복원) */
export function useQuickSlot(slot: string, scope: string | null, injected?: StorageLike | null): QuickSlot {
  // 저장소는 쓸 때마다 지금 것을 봐요(다시 읽기는 그때의 저장소로 — 실패한 그림의 저장소에 묶이지 않게)
  const storageNow = useCallback(() => (injected !== undefined ? injected : browserStorage()), [injected])
  const read = useCallback((): SlotView<Pending> | null => { const storage = storageNow(); return scope && storage ? readSlot(storage, scope, slot) : null }, [scope, storageNow, slot])
  const [state, setState] = useState<SlotView<Pending> | null>(read)
  const [writeFailed, setWriteFailed] = useState(false)
  // 보내는 중인 기록은 "결과 불명"으로 보이지 않게 숨겨요(끝나면 바로 고쳐 써요, iOS 와 같음)
  const [sending, setSending] = useState<string | null>(null)
  const reread = useCallback(() => setState(read()), [read])
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    reread()
    const on = () => reread()
    window.addEventListener(CHANGED, on)
    window.addEventListener("storage", on)
    return () => {
      window.removeEventListener(CHANGED, on)
      window.removeEventListener("storage", on)
    }
  }, [reread])
  const put = useCallback(
    (p: Pending | null) => {
      // 읽지 못했거나 깨진 기록 묶음에는 쓰지 않아요(규칙 E) — 다시 읽기·버리고 새로(확인창) 뒤에만
      const storage = storageNow()
      if (!scope || !storage || stateRef.current?.s !== "ok") return false
      const ok = writeSlot(storage, scope, slot, p)
      setWriteFailed(!ok)
      window.dispatchEvent(new Event(CHANGED))
      return ok
    },
    [scope, storageNow, slot],
  )
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const writeAhead = useCallback(
    async (p: Pending) => {
      if (scopeRef.current !== p.scope) return false
      setSending(p.id)
      const ok = put(p)
      if (!ok) setSending(null)
      return ok
    },
    [put],
  )
  const keep = useCallback((p: Pending) => { setSending(null); return put(p) }, [put])
  const done = useCallback(
    (r: Done) => {
      setSending(null)
      const storage = storageNow()
      const cur = scope && storage ? readSlot(storage, scope, slot) : null
      const was = cur?.s === "ok" ? cur.value : undefined
      return !was || was.id !== r.id ? true : put(null)
    },
    [scope, storageNow, slot, put],
  )
  const mine = state?.s === "ok" ? state.value : null
  // 화면에 보인 기록(이 그림의 mine)만 버려요 — 지금 다시 읽어 그 자리 기록이 본 것과 같을 때만(규칙 F)
  const planDiscard = useCallback((): WebTarget | null => {
    const storage = storageNow()
    if (!scope || !storage || !mine) return null
    return planRecordDiscard({ key: recordKey(scope, slot), seen: seeKey(storage, recordKey(scope, slot)) }, { key: slotKey(scope), seen: seeKey(storage, slotKey(scope)) }, slot, isPending, migrateSlots, mine, "")
  }, [scope, storageNow, slot, mine])
  const run = useCallback((t: WebTarget): PlanResult => {
    setSending(null)
    const storage = storageNow()
    const r: PlanResult = storage ? compareAndWrite(storage, t) : "changed"
    setWriteFailed(r === "failed")
    window.dispatchEvent(new Event(CHANGED))
    return r
  }, [storageNow])
  const plan = useCallback((): WebPlan | null => { const storage = storageNow(); return scope && storage ? planOne(storage, scope, slot, RECORDS, "빠른 추가 기록") : null }, [scope, storageNow, slot])
  const apply = useCallback((p: WebPlan): PlanResult => {
    const storage = storageNow()
    const r: PlanResult = storage ? compareAndWrite(storage, p) : "changed"
    window.dispatchEvent(new Event(CHANGED))
    return r
  }, [storageNow])
  const gate = slotGate({ ready: !!state, problem: problemOf(state), writeFailed }, "빠른 추가")
  return { pending: mine && mine.id !== sending ? mine : null, loaded: state?.s === "ok", ready: gate.canSubmit, notice: gate.notice, reread, plan, apply, writeAhead, keep, done, planDiscard, run }
}

/**
 * 항목 저장의 결과를 셋으로: 저장됨(true)·확실한 거절(false — 서버가 4xx 로 답함)·결과 불명("unknown" — 네트워크·5xx·시간 초과).
 * 웹 useBoard.saveKnown 이 이 판정을 써요
 */
export function saveOutcome(e: unknown): false | "unknown" | "scope" {
  if (isScopeChanged(e)) return "scope"
  const status = e && typeof e === "object" && "status" in e ? Number((e as { status: unknown }).status) : 0
  return status >= 400 && status < 500 ? false : "unknown"
}

/** 서버의 마지막 관문(리뷰 17): 쓰기에 시작 범위의 주체를 밝히면 서버가 지금 주체와 다를 때 쓰기 0건·409 scope-changed */
export const EXPECT_USER = "X-Direction-Expect-User"
/** 범위 이름(서버 주소|주체)의 주체 */
export const scopeUser = (scope: string) => scope.slice(scope.lastIndexOf("|") + 1)
/** 서버가 시작 범위의 주체와 지금 주체가 달라 거절했는지(409 scope-changed) */
export function isScopeChanged(e: unknown): boolean {
  if (!e || typeof e !== "object") return false
  if ((e as { scopeChanged?: unknown }).scopeChanged === true) return true
  const body = (e as { body?: unknown }).body
  return Number((e as { status?: unknown }).status) === 409 && !!body && typeof body === "object" && (body as { error?: unknown }).error === "scope-changed"
}
/** 계약 createWork 가 알아보는 "범위가 바뀌어 보내지 않음" 표시(기록 유지, 다른 계정에서 시작한 작업) */
const scopeError = () => Object.assign(new Error("다른 계정에서 시작한 작업이에요 · 그 계정으로 돌아가면 이어서 해요"), { scopeChanged: true })

/**
 * 웹 빠른 추가 한 번: 계약 submitWithRecord 에 같은 출처 api 를 붙여요. 결과 불명 확인은 checkCreate(읽기만), 보내기는 createWork.
 * scope 는 화면을 그린 범위, same 은 지금도 그 범위인지
 */
/**
 * 쓰기(GET 밖)가 4xx 가 아닌 이유로 실패하면(네트워크·5xx·시간 초과) 계약이 알아보는 결과 불명 표시(unknownWrite)를 붙여요 —
 * createWork 가 그 단계를 확실한 실패가 아니라 결과 불명으로 남기고, 다음 누름은 읽어서 확인만 해요(iOS UnknownWriteError 와 같은 뜻)
 */
export function unknownWrites(call: CreateDeps["call"], expectUser?: string): CreateDeps["call"] {
  return (async (path: string, init: { method: string; body?: string; headers?: Record<string, string> }) => {
    const write = init.method !== "GET"
    try {
      return await call(path, write && expectUser ? { ...init, headers: { ...init.headers, [EXPECT_USER]: expectUser } } : init)
    } catch (e) {
      if (!write) throw e
      const outcome = saveOutcome(e)
      if (outcome === "scope") throw scopeError()
      if (outcome === false) throw e
      throw Object.assign(new Error(e instanceof Error ? e.message : "결과를 알 수 없어요"), { unknownWrite: true, cause: e })
    }
  }) as CreateDeps["call"]
}

export function submitQuick(a: {
  text: string
  makeDraft: () => Draft
  pending: Pending | null
  writeAhead: (p: Pending) => Promise<boolean>
  scope: string
  same: () => boolean
  /** 항목 저장(웹 useBoard.saveKnown). expectUser 를 쓰기 머리에 붙여요 */
  save: (it: Item, opts?: { expectUser?: string }) => Promise<boolean | "unknown" | "scope">
  call?: CreateDeps["call"]
  id?: () => string
}): Promise<Submitted> {
  // 모든 쓰기(항목·노트·태그·속성)에 이 제출의 범위 주체를 밝혀요 — 재개면 기록의 시작 범위 주체(다르면 retryPlan 이 보내지 않아요)
  const expectUser = scopeUser(a.pending?.scope ?? a.scope)
  const call = unknownWrites(a.call ?? (api as CreateDeps["call"]), expectUser)
  const save = async (it: Item) => {
    const r = await a.save(it, { expectUser })
    if (r === "scope") throw scopeError()
    return r
  }
  return submitWithRecord({
    text: a.text,
    makeDraft: a.makeDraft,
    pending: a.pending,
    writeAhead: a.writeAhead,
    scope: a.scope,
    same: a.same,
    check: checkWith(call),
    create: (draft, id, resume) => createWork(draft, { save, call, id: () => id, now: Date.now }, resume ? { id: resume.id, from: resume.from } : undefined).then((r) => ({ ...r, scope: a.scope })),
    id: a.id ?? uid,
  })
}

/** 사람의 버리기 확인(웹). 버리기만이 기록을 지워요 */
export const confirmDiscard = (what = "이 기록", message?: string) => window.confirm(message ? `${what}을 버릴까요? ${message}` : `${what}을 버릴까요? 앞에서 보낸 것이 이미 저장됐을 수 있어요. 버린 뒤에는 목록에서 직접 확인해 주세요.`)

/** 예전의 범위별 편집 초안 묶음 키(읽어 넘기기만 해요). 자리 키는 draftKey */
export const editKey = (scope: string) => "direction.quickEdit:" + scope
export const draftKey = (scope: string, slot: string) => slotName(editKey(scope), slot)
const EDIT_DRAFTS: SlotKind<QuickEdit> = { bundle: editKey, own: draftKey, isOne: isEdit, migrate: migrateEdits }
/** 그 자리의 편집 초안 읽기(규칙 E, 리뷰 22): 못 읽음(read)·깨짐(corrupt)을 "초안 없음"과 나눠요 */
export const readEditState = (storage: StorageLike, scope: string, slot: string): SlotView<QuickEdit> => readOne(storage, scope, slot, EDIT_DRAFTS)
/** 그 자리의 편집 초안. 못 읽거나 깨졌거나 없으면 null(복원하지 않고 덮지도 않아요) */
export function readEdit(storage: StorageLike, scope: string, slot: string): QuickEdit | null {
  const r = readEditState(storage, scope, slot)
  return r.s === "ok" ? r.value : null
}
/** 그 자리 키에 편집 초안을 써요(빈 초안 = 비움). 그 자리를 잘 읽지 못했으면 덮지 않고 false */
export const writeEdit = (storage: StorageLike, scope: string, slot: string, e: QuickEdit | null): boolean => writeOne(storage, scope, slot, e && !editEmpty(e) ? e : null, EDIT_DRAFTS)

export type QuickEditSlot = {
  /** 열 때(또는 다시 읽어 준비가 됐을 때) 읽은 그 자리 편집 초안(다시 열기·새로고침 뒤 복원) */
  initial: QuickEdit | null
  /** 범위가 있고 편집 초안 저장을 잘 읽었는지(규칙 C·E — 읽지 못했거나 깨졌으면 false, 그동안 입력·자동 저장·자동 삭제 없음) */
  ready: boolean
  /** 읽지 못했거나 깨졌을 때의 안내 — 다시 읽기(reread, 실제로 다시 읽음)·버리고 새로(plan·apply — 규칙 F, 확인창 뒤 그 계획만) */
  notice: SlotNotice | null
  reread: () => void
  /** 버리고 새로 계획·실행(규칙 F — QuickSlot 과 같아요) */
  plan: () => WebPlan | null
  apply: (plan: WebPlan) => PlanResult
  /** 마지막 저장이 실패했는지(규칙 D — 밀린 값은 버리지 않고 남겨 다시 저장해요) */
  failed: boolean
  /** 전제(known)나 지금 초안을 읽지 못해 쓰지 않았는지(PR #43 리뷰 6 — 다른 곳의 초안을 덮지 않게 멈춤). 다시 저장(flush)이 다시 읽어요 */
  readFailed: boolean
  /** 바뀔 때마다 부르면 짧은 지연(300ms) 뒤 저장, 닫기·화면 내리기·pagehide 에서는 바로 저장. 준비 전이면 무시하고, 마지막으로 맞춘 값과 같으면(빈 칸 = 초안 없음 포함) 쓰지 않아요 */
  change: (e: QuickEdit | null) => void
  /**
   * 쓰던 초안 비우기 계획(PR #43 리뷰 3·5 — 무조건 비우는 길은 없어요): 밀린 편집을 먼저 저장해 보고, 이 화면이 디스크에 있음을 확인한 값(known)을 전제로
   * 그 자리 초안을 비우는 대상(known 에 초안이 없으면 null). 그때 디스크의 다른 초안은 전제가 되지 않아요(충돌 중이면 비우기 0건)
   */
  planClear: () => WebTarget | null
  /**
   * 비우기 실행: 충돌 중(사람이 고르기 전)이면 0건 "changed"·now null — 다른 초안·안내 그대로(리뷰 5). 대상이 있으면 비교-후-쓰기(바뀌었으면 0건 + 지금 초안),
   * 없으면 디스크가 known 그대로인지만 보고(다르면 "changed" + 지금 초안) 밀린 값을 내려놓아요
   */
  applyClear: (t: WebTarget | null) => { r: PlanResult; now: QuickEdit | null }
  /** 밀린 편집을 지금 자리에 바로 저장(자리를 바꾸기·닫기·옮기기 전에). 저장했거나 밀린 것이 없으면 true, 실패·충돌이면 false(밀린 값은 그대로) */
  flush: () => boolean
  /**
   * 규칙 G(PR #43 리뷰 4): 프로그램이 칸을 바꿨을 때(제출 끝·AI 넘김·버리기 뒤·복원·바뀜 채우기·공간 옮기기) 그 값을 "디스크와 맞춘 값"으로 기록해요 —
   * 자동 저장 타이머를 취소하고 밀린 값을 내려놓아, 자동 저장이 그것을 사람 편집처럼 쓰지 않아요. 화면은 setByProgram 으로만 불러요
   */
  adopt: (e: QuickEdit | null, forSlot?: string) => void
  /** 자동 저장이 "다른 곳에서 바뀐 초안"을 만나 쓰지 않았는지(규칙 G — 전제 = 이 화면이 마지막으로 읽거나 쓴 디스크 값) */
  conflict: boolean
  /** 충돌 · 불러오기: 지금 디스크 초안을 돌려주고 그것을 새 전제로(화면은 setByProgram 으로 칸에). 읽지 못하면 undefined(아무것도 바꾸지 않아요) */
  takeTheirs: () => QuickEdit | null | undefined
  /** 충돌 · 내 것으로 덮기(확인창 뒤): 지금 디스크를 새 전제로 칸의 글을 저장 */
  keepMine: () => boolean
}
const editKeyOf = editMeaning
/**
 * 편집 중 초안(리뷰 17). 잠긴 기록 동안은 화면이 change 를 부르지 않아요(편집 불가).
 * 규칙 D(리뷰 21): 저장 함수는 모두 성공 여부를 돌려주고, 실패하면 밀린 값을 버리지 않아요 — 화면은 실패면 전환·닫기·옮기기를 하지 않아요.
 * 규칙 E(리뷰 22): 읽기 실패·깨짐은 "초안 없음"이 아니에요 — 준비 완료가 아니고, 다시 읽어 잘 읽기 전에는 쓰지도 지우지도 않아요.
 * known(자동 저장·비우기의 전제)은 잘 읽거나 쓴 원문(없음 포함)만이에요(PR #43 리뷰 6): 읽기가 실패하면 known 을 바꾸지 않고(처음이면 비워 두고)
 * 쓰기 0건 + 읽기 실패 안내 — 못 읽은 값을 전제로 삼는 길이 없어요(계약 sameSeen 은 못 읽음을 언제나 다름으로 봐요)
 */
type Known = { slot: string; own: Seen; bundle: Seen }
type Look = { ok: true; known: Known; value: QuickEdit | null } | { ok: false }
export function useQuickEdit(slot: string, scope: string | null, injected?: StorageLike | null): QuickEditSlot {
  // 저장소는 쓸 때마다 지금 것을 봐요(다시 저장·다시 읽기는 그때의 저장소로 — 실패한 그림의 저장소에 묶이지 않게)
  const storageNow = useCallback(() => (injected !== undefined ? injected : browserStorage()), [injected])
  const [read, setRead] = useState<SlotView<QuickEdit> | null>(() => { const st = storageNow(); return scope && st ? readEditState(st, scope, slot) : null })
  const ok = read?.s === "ok"
  const initial = read?.s === "ok" ? read.value : null
  const [failed, setFailed] = useState(false)
  const [readFailed, setReadFailed] = useState(false)
  const queued = useRef<{ e: QuickEdit | null } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 이 자리에서 마지막으로 저장소와 맞춘 값(처음 읽은 값부터). 같은 값은 다시 쓰지 않아요(빈 칸이 "초안 지우기"가 되지 않게)
  const last = useRef<{ slot: string; key: string } | null>(null)
  const okRef = useRef(ok)
  okRef.current = ok
  /** 자리 키·옛 묶음 키를 지금 읽어요(상태를 바꾸지 않아요). 둘 다 잘 읽혀 그 자리 초안을 알 수 있을 때만 ok(그 원문이 known 후보) */
  const lookNow = useCallback((s: string): Look => {
    const st = storageNow()
    if (!scope || !st) return { ok: false }
    const own = seeKey(st, draftKey(scope, s))
    const bundle = seeKey(st, editKey(scope))
    const v = slotView(rawOfSeen(own), rawOfSeen(bundle), s, isEdit, migrateEdits)
    return own.s === "unreadable" || bundle.s === "unreadable" || v.s !== "ok" ? { ok: false } : { ok: true, known: { slot: s, own, bundle }, value: v.value }
  }, [scope, storageNow])
  /** 지금 읽고, 읽지 못했으면 읽기 실패 안내 */
  const look = useCallback((s: string): Look => { const l = lookNow(s); setReadFailed(!l.ok); return l }, [lookNow])
  // 규칙 G: known — 이 화면이 마지막으로 잘 읽거나 쓴 디스크 값(자리 키·옛 묶음 키)
  const base = useRef<Known | null>(null)
  // 화면이 보여 주는 값의 출처(복원한 원문 — 처음 잘 읽은 그 자리 초안, 공간을 옮기면 옮긴 초안). known 을 처음 잡거나 다시 잡을 때
  // 읽은 값이 이것과 다르면(그사이 바뀜) known 은 읽은 값으로 두되 충돌로 — 사람이 고르기 전에는 쓰지도 비우지도 않아요(PR #43 리뷰 7)
  const shown = useRef<{ slot: string; key: string } | null>(null)
  if (ok && shown.current === null) shown.current = { slot, key: editKeyOf(initial) }
  const matchesShown = (s: string, v: QuickEdit | null) => !shown.current || shown.current.slot !== s || editKeyOf(v) === shown.current.key
  // 그리는 중에는 상태를 바꿀 수 없어 같을 때만 잡아요 — 다르면 비워 두고 처음 저장·비우기(ensureBase)가 충돌로 잡아요
  if (base.current === null && ok) { const l = lookNow(slot); if (l.ok && matchesShown(slot, l.value)) base.current = l.known }
  const [conflict, setConflict] = useState(false)
  const conflictRef = useRef(false)
  const markConflict = (v: boolean) => { conflictRef.current = v; setConflict(v) }
  /** 지금 known(없으면 읽어 잡아요). 읽지 못하면 null — 쓰지 않아요 */
  const ensureBase = useCallback((): Known | null => {
    if (base.current?.slot === slot) return base.current
    const l = look(slot)
    if (!l.ok) return null
    base.current = l.known
    if (!matchesShown(slot, l.value)) markConflict(true)
    return base.current
  }, [slot, look])
  const reread = useCallback(() => {
    const st = storageNow()
    last.current = null
    // known 은 여기서 바꾸지 않아요 — 처음이면 다음 그림·저장이 화면 값과 비교해 잡고, 이미 있으면 그대로(다르면 비교-후-쓰기가 충돌로)
    setRead(scope && st ? readEditState(st, scope, slot) : null)
  }, [scope, storageNow, slot])
  const plan = useCallback((): WebPlan | null => { const st = storageNow(); return scope && st ? planOne(st, scope, slot, EDIT_DRAFTS, "쓰던 초안") : null }, [scope, storageNow, slot])
  const apply = useCallback((p: WebPlan): PlanResult => {
    const st = storageNow()
    const r: PlanResult = st ? compareAndWrite(st, p) : "changed"
    reread()
    return r
  }, [storageNow, reread])
  const flush = useCallback((): boolean => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = queued.current
    if (!next) return true
    if (!okRef.current) return false // 읽지 못한 저장소에는 쓰지 않아요(규칙 E) — 밀린 값은 그대로
    if (conflictRef.current) return false // 다른 곳에서 바뀐 초안이 있으면 사람이 고를 때까지 쓰지 않아요(규칙 G)
    const st = storageNow()
    if (!scope || !st) return false
    // 자동 저장도 비교-후-쓰기(규칙 G): 전제 = known. known 을 읽지 못하면 쓰지 않아요(리뷰 6)
    const b = ensureBase()
    if (!b) { setFailed(true); return false }
    if (conflictRef.current) return false
    const value = next.e && !editEmpty(next.e) ? next.e : null
    const r = compareAndWrite(st, { premises: [{ key: draftKey(scope, slot), seen: b.own }, { key: editKey(scope), seen: b.bundle }], write: { key: draftKey(scope, slot), value } })
    if (r === "done") {
      base.current = { ...b, own: { s: "text", text: JSON.stringify(value) } }
      queued.current = null
      setFailed(false)
      setReadFailed(false)
      return true
    }
    if (r === "changed") {
      // 읽지 못해 다름이면 읽기 실패(쓰지 않음), 읽혔는데 다르면 충돌 — 어느 쪽이든 known 은 그대로
      if (look(slot).ok) markConflict(true)
      else setFailed(true)
      return false
    }
    setFailed(true) // 실패하면 밀린 값을 그대로 둬요(다음 저장·다시 저장에서 같은 값)
    return false
  }, [scope, storageNow, slot, ensureBase, look])
  useEffect(() => {
    const onHide = () => void flush()
    window.addEventListener("pagehide", onHide)
    return () => {
      window.removeEventListener("pagehide", onHide)
      flush() // 닫기·화면 내리기: 남은 편집을 바로 저장(지우지 않아요). 닫기는 화면이 먼저 flush 가 성공했을 때만 해요
    }
  }, [flush])
  const change = useCallback((e: QuickEdit | null) => {
    if (!okRef.current) return
    const key = editKeyOf(e)
    if (!last.current || last.current.slot !== slot) {
      const st = storageNow()
      last.current = { slot, key: editKeyOf(scope && st ? readEdit(st, scope, slot) : null) }
    }
    if (key === last.current.key && !queued.current) return
    last.current = { slot, key }
    queued.current = { e }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 300)
  }, [flush, slot, scope, storageNow])
  const planClear = useCallback((): WebTarget | null => {
    flush() // 밀린 편집을 먼저(못 해도 전제는 known — 그때 디스크의 다른 초안이 아니에요. 밀린 값은 비우기가 끝나면 내려놓아요)
    if (!scope) return null
    const b = ensureBase()
    return b ? planDraftClear({ key: draftKey(scope, slot), seen: b.own }, { key: editKey(scope), seen: b.bundle }, slot, isEdit, migrateEdits) : null
  }, [flush, scope, slot, ensureBase])
  const applyClear = useCallback((t: WebTarget | null): { r: PlanResult; now: QuickEdit | null } => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    // 충돌 중(사람이 고르기 전): 비우기 0건 — 다른 초안·안내·known 그대로. 제출·버린 내 밀린 값만 내려놓아요(리뷰 5 P1-1)
    if (conflictRef.current) {
      queued.current = null
      return { r: "changed", now: null }
    }
    const st = storageNow()
    let r: PlanResult
    if (t) r = st ? compareAndWrite(st, t) : "changed"
    else {
      // 대상이 없으면(known 에 비울 초안 없음) 디스크가 known 그대로인지만 봐요(쓰지 않아요). known·지금을 읽지 못하면 확인하지 못함(failed — 0건)
      const b = ensureBase()
      const l = b ? look(slot) : null
      r = !b || !l?.ok ? "failed" : sameSeen(l.known.own, b.own) && sameSeen(l.known.bundle, b.bundle) ? "done" : "changed"
    }
    if (r === "done") {
      queued.current = null
      last.current = { slot, key: editKeyOf(null) }
      // 방금 비운 값이 새 known(쓴 원문 그대로 — 다시 읽지 않아요)
      if (t && base.current?.slot === slot) base.current = { ...base.current, own: { s: "text", text: JSON.stringify(t.write.value) } }
      setFailed(false)
      return { r, now: null }
    }
    if (r === "changed") {
      // 그사이 바뀐 초안은 남기고 화면이 그 글을 보이게 — 잘 읽었을 때만 그 값이 새 known. 읽지 못하면 known 그대로·확인하지 못함
      const l = look(slot)
      if (!l.ok) return { r: "failed", now: null }
      base.current = l.known
      queued.current = null
      last.current = { slot, key: editKeyOf(l.value) }
      setFailed(false)
      return { r, now: l.value }
    }
    return { r, now: null }
  }, [scope, storageNow, slot, ensureBase, look])
  const adopt = useCallback((e: QuickEdit | null, forSlot?: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    queued.current = null
    // 자리가 바뀌는 변경(공간 옮기기)이면 새 자리 기준으로 — 새 자리의 known 은 그 자리를 처음 쓸 때 지금 디스크로 읽어요(화면이 맞춘 값과 같아야 해요)
    last.current = { slot: forSlot ?? slot, key: editKeyOf(e) }
    // 공간을 옮기면(새 자리) 화면 값의 출처는 옮긴 초안 — 같은 자리의 프로그램 변경(제출 뒤 비우기·복원·채우기)은 known 이 이미 맞춰져 있어 출처를 바꾸지 않아요
    if (forSlot && forSlot !== slot) shown.current = { slot: forSlot, key: editKeyOf(e) }
  }, [slot])
  const takeTheirs = useCallback((): QuickEdit | null | undefined => {
    // 읽지 못하면 아무것도 바꾸지 않아요(충돌·known 그대로 + 읽기 실패 안내) — undefined
    const l = look(slot)
    if (!l.ok) return undefined
    base.current = l.known
    queued.current = null
    last.current = { slot, key: editKeyOf(l.value) }
    shown.current = { slot, key: editKeyOf(l.value) }
    markConflict(false)
    return l.value
  }, [slot, look])
  const keepMine = useCallback((): boolean => {
    // 덮기의 전제도 잘 읽은 지금 원문만 — 읽지 못하면 쓰지 않고 충돌 그대로
    const l = look(slot)
    if (!l.ok) return false
    base.current = l.known
    markConflict(false)
    return flush()
  }, [slot, look, flush])
  const problem = problemOf(read)
  const notice: SlotNotice | null = problem ? { kind: problem, text: storeProblemText("쓰던 초안", problem) } : null
  return { initial, ready: !!scope && ok, notice, reread, plan, apply, failed, readFailed, change, flush, planClear, applyClear, adopt, conflict, takeTheirs, keepMine }
}

/**
 * 그 자리의 기록·편집 초안을 바로 읽어요(시트를 열 때 복원, 공간을 바꿀 때 새 자리가 비었는지 — 리뷰 20).
 * problem: 그 자리의 기록이나 초안을 읽지 못했거나 깨짐(PR #43 리뷰 — "비어 있음"으로 보고 옮겨 가지 않게)
 */
export function peekSlot(scope: string | null, slot: string, storage: StorageLike | null = browserStorage()): { record: Pending | null; edit: QuickEdit | null; problem: boolean } {
  if (!scope || !storage) return { record: null, edit: null, problem: false }
  const r = readSlot(storage, scope, slot)
  const e = readEditState(storage, scope, slot)
  return { record: r.s === "ok" ? r.value : null, edit: e.s === "ok" ? e.value : null, problem: r.s !== "ok" || e.s !== "ok" }
}
/**
 * 편집 초안을 그 자리에 바로(공간을 바꿀 때 새 자리로 옮기기). 닿았으면 되돌리기 대상(전제 = 방금 쓴 원문 — 그사이 바뀌면 되돌리지 않아요), 못 닿으면 null
 */
export function placeEditNow(scope: string | null, slot: string, e: QuickEdit, storage: StorageLike | null = browserStorage()): WebTarget | null {
  if (!scope || !storage || !writeEdit(storage, scope, slot, e)) return null
  // 전제 = 방금 쓴 원문(쓴 그대로 — 다시 읽지 않아요. 못 읽은 값이 전제가 되지 않게, 리뷰 6)
  return { premises: [{ key: draftKey(scope, slot), seen: { s: "text", text: JSON.stringify(editEmpty(e) ? null : e) } }], write: { key: draftKey(scope, slot), value: null } }
}
/** 되돌리기 대상 실행(비교-후-쓰기) */
export const undoPlace = (t: WebTarget, storage: StorageLike | null = browserStorage()): PlanResult => (storage ? compareAndWrite(storage, t) : "changed")

/**
 * 시트를 열기 전 그 자리(연 대상의 시트 자리)의 기기 저장 두 가지(기록·쓰던 초안)의 상태(규칙 E, 리뷰 22). 둘 다 잘 읽어야 시트 본문을 그려요 —
 * 시트는 열 때 한 번 읽어 복원하니, 읽지 못한 채 그리면 다시 읽어도 복원할 길이 없어요. 다시 읽기·버리고 새로(확인창 뒤)를 줘요.
 * 자리마다 따로라(PR #43 리뷰) 다른 자리의 깨짐은 이 시트를 막지 않아요
 */
export function useStoreHealth(scope: string | null, slot: string, injected?: StorageLike | null) {
  const storageNow = useCallback(() => (injected !== undefined ? injected : browserStorage()), [injected])
  const readBoth = useCallback(() => {
    const st = storageNow()
    return scope && st ? { records: readSlot(st, scope, slot), edits: readEditState(st, scope, slot) } : null
  }, [scope, storageNow, slot])
  const [both, setBoth] = useState(readBoth)
  const reread = useCallback(() => setBoth(readBoth()), [readBoth])
  // 버리고 새로(규칙 F): 누를 때 지금 읽어 계획, 확인창 뒤 그 계획만
  const planFor = useCallback((which: "records" | "edits"): WebPlan | null => {
    const st = storageNow()
    if (!scope || !st) return null
    return which === "records" ? planOne(st, scope, slot, RECORDS, "빠른 추가 기록") : planOne(st, scope, slot, EDIT_DRAFTS, "쓰던 초안")
  }, [scope, storageNow, slot])
  const apply = useCallback((p: WebPlan): PlanResult => {
    const st = storageNow()
    const r: PlanResult = st ? compareAndWrite(st, p) : "changed"
    window.dispatchEvent(new Event(CHANGED))
    reread()
    return r
  }, [storageNow, reread])
  const notice = <T,>(r: SlotView<T> | undefined, what: string): SlotNotice | null => { const p = problemOf(r ?? null); return p ? { kind: p, text: storeProblemText(what, p) } : null }
  return {
    ok: !!both && both.records.s === "ok" && both.edits.s === "ok",
    records: { notice: notice(both?.records, "빠른 추가 복구 기록"), reread, plan: () => planFor("records"), apply },
    edits: { notice: notice(both?.edits, "쓰던 초안"), reread, plan: () => planFor("edits"), apply },
  }
}
