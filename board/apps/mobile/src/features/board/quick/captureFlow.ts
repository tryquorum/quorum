// ✦ AI로 정리해서 올리기의 칩 상태(웹 hooks/use-captures.ts 와 같은 흐름). 요청은 주입받아 bun 으로 시험해요.
// 저장: 칩 전부(끝났다고 확인된 칩만 10건 넘게 쌓이면 정리, contracts trimCaptures). 화면 훅은 useCaptures.ts.
// 리뷰 9: 결과가 불명인 시작은 앱이 스스로 다시 보내지 않아요. 칩으로 남기고 "확인"은 읽기만(GET /api/runs?clientKey),
// 서버에 없다고 확인된 뒤 사람이 "다시 보내기"를 눌렀을 때만 같은 키로 보내요. 보냈는지 모르는 칩은 사람이 "버리기" 전까지 지우지 않아요.
import type { CaptureEffect, CaptureHints, CaptureResponse, Run } from '@direction-board/contracts'
import { CAPTURE_STORE, isCaptureEntry, phaseOf, splitCaptures, trimCaptures, UNSENT, visibleEntries, type CaptureEntry, type Phase, type StorageLike } from '@direction-board/contracts/capture'
import type { Draft } from '@direction-board/contracts/quick-add'
import { ApiError, ConflictError, ScopeChangedError, UnknownWriteError } from '../../../api/client'

export type CaptureApi = {
  start: (body: { kind: 'capture'; prompt: string; clientKey: string; hints?: CaptureHints }) => Promise<Run>
  effects: (id: string) => Promise<CaptureResponse>
  undo: (id: string, ref: string) => Promise<unknown>
  retry: (id: string) => Promise<Run>
  stop: (id: string) => Promise<unknown>
  /** 서버가 밝힌 멱등 약속(GET /api/settings capabilities). runClientKey 가 있어야 키로 실행을 찾을 수 있어요 */
  caps: () => Promise<string[]>
  /** 그 clientKey 로 만든 실행(GET /api/runs?clientKey). 없으면 null — 읽기만 */
  lookup: (clientKey: string) => Promise<Run | null>
  /** 이 요청 묶음이 고정한 범위(서버·로그인). 보냈는지 모르는 칩에 같이 저장하고, 확인·다시 보내기는 그 범위에서만 */
  scope: string
}
export type StartResult = { ok: true; existing?: boolean; unsent?: boolean } | { ok: false; error: string }
/** 보냈는지 모르는 칩을 확인한 결과: 서버에 없음(사람이 다시 보낼 수 있음) · 이 서버는 확인할 수 없음(사람이 확인 뒤 버리기) */
export type CheckState = 'absent' | 'unsupported'
/** 칩 저장 파일 검사: JSON 배열이고 **모든** 항목이 칩 모양이어야 해요. 하나라도 깨지면 깨짐(조용히 거르지 않고 storeGate 가 막아요) */
const loadAll = (storage: StorageLike): CaptureEntry[] => {
  try {
    const raw: unknown = JSON.parse(storage.getItem(CAPTURE_STORE) || '[]')
    return Array.isArray(raw) ? raw.filter(isCaptureEntry) : []
  } catch {
    return []
  }
}
export const validCaptureStore = (v: unknown): v is string => {
  if (typeof v !== 'string') return false
  try {
    const raw: unknown = JSON.parse(v)
    return Array.isArray(raw) && raw.every(isCaptureEntry)
  } catch {
    return false
  }
}
/** 깨진 칩 파일을 버릴 때 나누기(PR #43 리뷰, 계약 splitCaptures): iOS 는 칩 목록을 JSON 글로 한 번 더 감싸 둬요 */
export function splitCaptureStore(raw: unknown): { keep: string; dropped: number; kept: number } | null {
  if (typeof raw !== 'string') return null
  let list: unknown
  try {
    list = JSON.parse(raw)
  } catch {
    return null
  }
  const parts = splitCaptures(list)
  return parts && { ...parts, keep: JSON.stringify(parts.keep) }
}
/** 칩 저장소. durable 은 지금까지의 쓰기가 기기에 닿았는지(먼저 기록, 규칙 B) — 없으면(시험의 메모리 저장소) 닿은 것으로 봐요 */
export type CaptureStorage = StorageLike & { durable?: () => Promise<boolean> }
const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)
/** 409 본문의 run(같은 글이 이미 정리 중·이미 다시 시도함). 없으면 undefined */
const conflictRun = (e: unknown): Run | undefined => {
  if (!(e instanceof ConflictError)) return undefined
  const b = e.body as { run?: Run } | null
  return b && typeof b === 'object' && b.run && typeof b.run.id === 'string' ? b.run : undefined
}
/** 서버가 받지 않았다고 확실한 거절(4xx·범위 바뀜으로 보내지 않음). 그 밖(네트워크·5xx·뜻밖의 오류)은 결과 불명 */
const certain = (e: unknown) => (e instanceof ApiError && !(e instanceof UnknownWriteError)) || e instanceof ScopeChangedError
/** 되돌리기 단추를 보일지: 서버가 이 실행이 만들었고 그 뒤 바뀌지 않았다고 판정한 것만(되돌린 것·사라진 것은 아님) */
export const canUndo = (e: CaptureEffect) => e.undoable && !e.undone && !!e.now

export class CaptureCenter {
  entries: CaptureEntry[]
  views: Record<string, CaptureResponse | undefined> = {}
  expanded = false
  /** 바뀔 때마다 올라요(화면 구독의 스냅숏). 결과 하나의 되돌림처럼 개수가 같은 변화도 다시 그리게 */
  version = 0
  private listeners = new Set<() => void>()
  /** 실행마다 쓰기(되돌리기·멈추기) 세대. 쓰기 전에 시작한 조회의 응답은 되돌리기 전 상태라 버려요 */
  private epoch: Record<string, number> = {}
  /** 실행마다 도는 조회 하나. 응답이 2초보다 늘 느려도 다음 조회가 앞 조회를 무효로 만들지 않고, 그 응답을 그대로 받아요 */
  private inflight: Record<string, Promise<void> | undefined> = {}
  /** 지금 보내는 중인 시작(먼저 기록한 칩). 보내는 동안에는 "보냈는지 모르는 칩"으로 보이지 않게 숨겨요 */
  private sending = new Set<string>()
  /** 보냈는지 모르는 칩의 확인 결과(이 세션). 다시 열면 다시 확인해요 */
  private checks: Record<string, CheckState | undefined> = {}
  constructor(private api: CaptureApi, private storage: CaptureStorage, private newKey: () => string, private warn: (text: string) => void) {
    // 모든 항목을 읽어요(개수로 자르지 않음 — 보냈는지 모르는 칩을 잃지 않게). 깨진 파일은 useCaptures 의 storeGate 가 먼저 막아요
    this.entries = loadAll(storage)
  }
  subscribe(l: () => void) {
    this.listeners.add(l)
    return () => void this.listeners.delete(l)
  }
  phase(id: string): Phase {
    return phaseOf(this.views[id]?.run)
  }
  get phases(): Record<string, Phase> {
    return Object.fromEntries(this.entries.map((e) => [e.id, this.phase(e.id)]))
  }
  /** 트레이에 보일 칩(닫지 않은 것). 보냈는지 모르는 칩은 닫혀 있어도 보여요 — 닫기로 숨길 수 없고 버리기만 지워요 */
  live() {
    return this.entries.filter((e) => !this.sending.has(e.id) && (!e.dismissed || this.isUnsent(e)))
  }
  visible() {
    return visibleEntries(this.live().map((e) => (e.dismissed ? { ...e, dismissed: false } : e)), this.expanded)
  }
  setExpanded(v: boolean) {
    this.expanded = v
    this.emit()
  }
  check(id: string): CheckState | undefined {
    return this.checks[id]
  }
  async start(text: string, draft: Draft | null, hints: CaptureHints | undefined): Promise<StartResult> {
    const clientKey = this.newKey()
    const body = { kind: 'capture' as const, prompt: text, clientKey, ...(hints ? { hints } : {}) }
    // 먼저 기록(규칙 B): 보내기 전에 원래 clientKey·글·초안·힌트·시작 범위를 "보냈는지 모르는 칩"으로 남기고 기기에 닿은 뒤에만 보내요.
    // 성공·확실한 거절이면 지우고, 결과를 모르면(앱이 꺼진 경우 포함) 칩으로 남아 "확인"이 같은 키로 읽어 봐요
    const unsent = UNSENT + clientKey
    const drop = () => {
      this.sending.delete(unsent)
      this.entries = this.entries.filter((x) => x.id !== unsent)
      this.save()
    }
    this.sending.add(unsent)
    this.add({ id: unsent, clientKey, text, draft, startedAt: Date.now(), ...(hints ? { hints } : {}), scope: this.api.scope })
    if (this.storage.durable && !(await this.storage.durable())) {
      drop()
      return { ok: false, error: '이어서 확인할 기록을 기기에 남기지 못해 AI에게 보내지 않았어요' }
    }
    try {
      const run = await this.api.start(body)
      this.sending.delete(unsent)
      this.entries = this.entries.filter((x) => x.id !== unsent)
      this.add({ id: run.id, clientKey, text, draft, startedAt: run.created_at || Date.now(), ...(hints ? { hints } : {}) })
      void this.refresh(run.id)
      return { ok: true }
    } catch (e) {
      const existing = conflictRun(e)
      if (existing) {
        drop()
        // 같은 글이 이미 정리 중: 칩이 있으면 그대로(남겨 둔 초안 유지), 없으면 지금 초안으로 붙여요
        if (!this.entries.some((x) => x.id === existing.id)) this.add({ id: existing.id, clientKey: '', text: existing.prompt, draft, startedAt: existing.created_at })
        else this.patch(existing.id, (x) => ({ ...x, dismissed: false }))
        void this.refresh(existing.id)
        return { ok: true, existing: true }
      }
      if (certain(e)) {
        drop()
        return { ok: false, error: message(e, 'AI에게 맡기지 못했어요') }
      }
      // 결과를 모름: 바로 다시 보내지 않아요(리뷰 9 P1-5). 이 키·글·초안·힌트·범위를 칩으로 남기고 "확인"이 읽어 봐요
      this.sending.delete(unsent)
      this.emit()
      return { ok: true, unsent: true }
    }
  }
  private bump(id: string) {
    this.epoch[id] = (this.epoch[id] ?? 0) + 1
  }
  /** 결과 다시 읽기. 같은 실행의 조회가 돌고 있으면 그것을 기다려요. force 는 쓰기 뒤 새 세대로 바로 읽을 때 */
  refresh(id: string, force = false): Promise<void> {
    const running = this.inflight[id]
    if (running && !force) return running
    const at = this.epoch[id] ?? 0
    const p: Promise<void> = (async () => {
      try {
        const v = await this.api.effects(id)
        if ((this.epoch[id] ?? 0) !== at) return
        this.views = { ...this.views, [id]: v }
        // 끝났다고 확인한 칩만 개수 제한의 정리 대상이에요(닫기는 숨기기일 뿐, 리뷰 9)
        if (phaseOf(v.run) !== 'running' && !this.entries.find((x) => x.id === id)?.ended) this.patch(id, (x) => ({ ...x, ended: true }))
        else this.emit()
      } catch (e) {
        if ((this.epoch[id] ?? 0) !== at) return
        // 실행이 없거나 이 화면에서 볼 수 없으면 칩을 접고 끝난 것으로 봐요. 그 밖의 오류는 다음 번에 다시 물어요
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) this.patch(id, (x) => ({ ...x, dismissed: true, ended: true }))
      }
    })().finally(() => {
      if (this.inflight[id] === p) this.inflight[id] = undefined
    })
    this.inflight[id] = p
    return p
  }
  /** 시작 응답을 잃어 보냈는지 모르는 칩 */
  isUnsent(e: CaptureEntry) {
    return e.id.startsWith(UNSENT)
  }
  private mine(e: CaptureEntry) {
    if (!e.scope || e.scope === this.api.scope) return true
    this.warn('다른 계정에서 시작한 AI 정리예요 · 그 계정으로 돌아가면 확인해요')
    return false
  }
  /**
   * 보냈는지 모르는 칩 확인 — 읽기만(리뷰 9). 서버가 키 조회를 지원한다고 밝혔으면(runClientKey) 같은 clientKey 의 실행을 찾아
   * 있으면 칩을 그 실행으로 옮기고, 없으면 "서버가 받지 않은 것 같아요 · 다시 보내기"를 보여요. 지원하지 않거나 못 읽으면 칩은 그대로
   */
  async confirm(id: string) {
    const e = this.entries.find((x) => x.id === id)
    if (!e || !this.isUnsent(e) || !this.mine(e)) return
    let caps: string[]
    try {
      caps = await this.api.caps()
    } catch {
      return this.warn('서버 정보를 읽지 못했어요 · 잠시 뒤 다시 확인해 주세요')
    }
    if (!caps.includes('runClientKey')) {
      this.checks = { ...this.checks, [id]: 'unsupported' }
      this.emit()
      return this.warn('이 서버는 보낸 요청을 확인할 수 없어요 · 들어갔는지 대화 목록에서 확인한 뒤 버려 주세요')
    }
    let run: Run | null
    try {
      run = await this.api.lookup(e.clientKey)
    } catch {
      return this.warn('아직 확인하지 못했어요 · 잠시 뒤 다시 확인해 주세요')
    }
    if (!run) {
      this.checks = { ...this.checks, [id]: 'absent' }
      return this.emit()
    }
    await this.attach(id, run)
  }
  /**
   * 사람이 누른 "다시 보내기": 서버에 없다고 확인된 칩만, 같은 clientKey·같은 글·같은 힌트로. 누르는 순간 한 번 더 읽어서(리뷰 10)
   * 그사이 실행이 생겼으면 보내지 않고 그 실행으로 옮기고, 읽지 못하면 보내지 않아요. 실패해도 칩은 남아요
   */
  async resend(id: string) {
    const e = this.entries.find((x) => x.id === id)
    if (!e || !this.isUnsent(e) || !this.mine(e)) return
    if (this.checks[id] !== 'absent') return this.warn('먼저 확인해 주세요')
    let late: Run | null
    try {
      late = await this.api.lookup(e.clientKey)
    } catch {
      return this.warn('서버를 다시 확인하지 못해 보내지 않았어요 · 잠시 뒤 다시 눌러 주세요')
    }
    if (late) return this.attach(id, late)
    const body = { kind: 'capture' as const, prompt: e.text, clientKey: e.clientKey, ...(e.hints ? { hints: e.hints } : {}) }
    let run: Run | undefined
    try {
      run = await this.api.start(body)
    } catch (err) {
      run = conflictRun(err)
      if (!run) {
        if (!certain(err)) {
          // 또 결과를 모름: 확인 전 상태로 돌아가 다음에 다시 읽어 봐요
          this.checks = { ...this.checks, [id]: undefined }
          this.emit()
          return this.warn('보냈는지 아직 확인하지 못했어요 · 잠시 뒤 다시 확인해 주세요')
        }
        return this.warn(message(err, 'AI에게 맡기지 못했어요'))
      }
    }
    await this.attach(id, run)
  }
  /** 사람이 버리기(확인창 뒤): 보냈는지 모르는 칩을 지우는 유일한 길 */
  discard(id: string) {
    this.checks = { ...this.checks, [id]: undefined }
    this.entries = this.entries.filter((x) => x.id !== id)
    this.save()
  }
  private async attach(id: string, run: Run) {
    this.checks = { ...this.checks, [id]: undefined }
    this.patch(id, (x) => ({ ...x, id: run.id, dismissed: false, startedAt: run.created_at || x.startedAt }))
    await this.refresh(run.id)
  }
  /** 도는 칩(2초마다, 앱이 앞에 있을 때)과 아직 한 번도 읽지 못한 칩(닫힌 것 포함 — 끝났는지 알아야 정리할 수 있어요)을 읽어요 */
  tick() {
    for (const e of this.entries) {
      if (this.isUnsent(e)) continue
      // 끝난 칩도 앱을 다시 연 뒤 한 번은 읽어요(결과를 보여 줘야 해요). 그 뒤로는 도는 칩만
      if (!this.views[e.id] || (!e.dismissed && !e.ended && this.phase(e.id) === 'running')) void this.refresh(e.id)
    }
  }
  get running() {
    return this.entries.some((e) => !e.dismissed && !this.isUnsent(e) && this.phase(e.id) === 'running')
  }
  async undo(id: string, ref: string) {
    this.bump(id) // 그 전에 시작한 조회는 되돌리기 전 상태라 버려요
    try {
      await this.api.undo(id, ref)
    } catch (e) {
      this.warn(message(e, '되돌리지 못했어요'))
    }
    await this.refresh(id, true)
  }
  /** 다시 시도: 새 실행으로 칩을 옮겨요. 409 에 run 이 있으면(이미 다시 시도함) 그 실행으로, 없으면(다시 시도할 수 없는 실행) 칩은 그대로 */
  async retry(id: string) {
    let next: Run | undefined
    try {
      next = await this.api.retry(id)
    } catch (e) {
      next = conflictRun(e)
      if (!next) return this.warn(message(e, '다시 시도하지 못했어요'))
    }
    const run = next
    this.patch(id, (x) => ({ ...x, id: run.id, ended: false, startedAt: run.created_at || Date.now() }))
    await this.refresh(run.id)
  }
  async stop(id: string) {
    this.bump(id)
    try {
      await this.api.stop(id)
    } catch (e) {
      this.warn(message(e, '멈추지 못했어요'))
    }
    await this.refresh(id, true)
  }
  /** 닫기 = 숨기기. 보냈는지 모르는 칩은 닫을 수 없어요(버리기만) */
  dismiss(id: string) {
    const e = this.entries.find((x) => x.id === id)
    if (!e || this.isUnsent(e)) return
    this.patch(id, (x) => ({ ...x, dismissed: true }))
  }
  private add(e: CaptureEntry) {
    this.entries = [...this.entries.filter((x) => x.id !== e.id), e]
    this.save()
  }
  private patch(id: string, f: (e: CaptureEntry) => CaptureEntry) {
    this.entries = this.entries.map((e) => (e.id === id ? f(e) : e))
    this.save()
  }
  /** 개수 제한은 끝났다고 확인된 칩(ended)만 오래된 것부터 정리해요. 닫기는 숨기기일 뿐이고, 보냈는지 모르는 칩·보내는 중 칩은 남겨요(리뷰 8·9) */
  private save() {
    this.entries = trimCaptures(this.entries, (e) => !!e.ended && !this.isUnsent(e) && !this.sending.has(e.id))
    try {
      this.storage.setItem(CAPTURE_STORE, JSON.stringify(this.entries))
    } catch {
      /* 이번 세션에서는 계속 보여요(기기 저장 실패는 storeGate 가 알려요) */
    }
    this.emit()
  }
  private emit() {
    this.version++
    for (const l of this.listeners) l()
  }
}
