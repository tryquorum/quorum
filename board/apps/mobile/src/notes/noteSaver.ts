// iOS 마크다운 노트 저장 상태 기계(레인 1·2 공용, 순수 TS). 웹 NoteSaver(packages/contracts/src/note-save.ts)와 같은 뜻:
// 사람 초안은 늘 남고, 409 면 충돌, 결과를 모르면 불명으로 자동 저장을 멈추고 다시 보내지 않아요. 복구는 사람이 고르는 단계로만.
// 저장은 서버가 md 로 html 을 다시 만드는 POST /api/docs/:ref/write {mode:'replace', md, expectedVersion} 하나예요.
import { ApiError, ConflictError } from '../api/client'

export type NoteStatus = 'clean' | 'dirty' | 'saving' | 'conflict' | 'unknown' | 'merging' | 'error'
export type ServerNote = { version: number; md: string; truncated: boolean }
export type NoteState = {
  status: NoteStatus
  /** 마지막으로 확인한 서버 md 와 그 version */
  base: string
  version: number
  /** 지금 입력 */
  draft: string
  /** 보냈지만 결과를 모르는 스냅샷과 그때 기준 version */
  inflight?: { md: string; version: number }
  /** 합치기 전에 보관한 내 초안들 */
  backups: string[]
  /** 409 가 준 서버 내용 */
  current?: ServerNote
  /** 충돌·불명 뒤 새로 불러온 서버 노트(사람이 채택하기 전까지 그대로) */
  reloaded?: ServerNote & { editable: boolean }
  /** 서버가 iOS 편집을 허락한 노트인지(markdownEditable) */
  editable: boolean
  message?: string
}
export type WriteNote = (md: string, expectedVersion: number) => Promise<{ version?: number }>
/** 저장 직전 최종 초안 검사(mdPolicy). 막을 이유를 돌려주면 보내지 않아요 */
export type CheckNote = (md: string) => string | null

const LIMIT = 200000
const STOPPED: NoteStatus[] = ['conflict', 'unknown', 'merging', 'error']

export class NoteSaver {
  state: NoteState
  private writing = false
  constructor(
    initial: { md: string; version: number; editable: boolean },
    private write: WriteNote,
    private changed: (state: NoteState) => void,
    private check: CheckNote = () => null,
    restored?: NoteState | null,
  ) {
    this.state = restored ? NoteSaver.restore(restored, initial) : { status: 'clean', base: initial.md, version: initial.version, draft: initial.md, backups: [], editable: initial.editable }
  }
  /**
   * 보관한 초안을 지금 서버 노트에 맞춰 되살려요. 편집 허락은 늘 지금 서버 판정을 따르고(옛 초안의 true 를 믿지 않음),
   * 저장 중이던 것은 불명, 서버 version 이 그사이 바뀌었으면 충돌로 시작해요. 어느 경우에도 초안은 그대로예요.
   */
  private static restore(saved: NoteState, now: { md: string; version: number; editable: boolean }): NoteState {
    const state: NoteState = { ...saved, editable: now.editable }
    if (saved.status === 'saving') return { ...state, status: 'unknown', message: '이전 저장의 결과를 확인하지 못했어요. 초안을 보관하고 다시 보내지 않아요.' }
    if (!now.editable && saved.draft !== now.md) return { ...state, status: 'error', message: '이 노트는 지금 iOS 에서 고칠 수 없어요. 보관한 초안을 내보내 웹에서 합쳐 주세요.' }
    if (saved.version !== now.version && (saved.status === 'dirty' || saved.status === 'merging'))
      return { ...state, status: 'conflict', current: { version: now.version, md: now.md, truncated: false }, message: '초안을 보관한 뒤 서버 노트가 바뀌었어요. 내 초안은 보존되어 있어요.' }
    return state
  }
  private update(patch: Partial<NoteState>) {
    this.state = { ...this.state, ...patch }
    this.changed(this.state)
  }
  edit(draft: string) {
    if (!this.state.editable) return
    const s = this.state.status
    if (s === 'error') this.update({ draft, status: 'dirty', message: undefined })
    else if (STOPPED.includes(s)) this.update({ draft })
    else this.update({ draft, status: this.writing ? 'saving' : draft === this.state.base ? 'clean' : 'dirty' })
  }
  async flush(): Promise<void> {
    if (this.writing || this.state.status !== 'dirty' || !this.state.editable) return
    const snapshot = this.state.draft
    if (snapshot.length > LIMIT) return this.update({ status: 'error', message: '노트가 200,000자를 넘어 저장하지 않았어요. 줄여 주세요.' })
    const blocked = this.check(snapshot)
    if (blocked) return this.update({ status: 'error', message: blocked })
    const version = this.state.version
    this.writing = true
    this.update({ status: 'saving', inflight: { md: snapshot, version } })
    try {
      const result = await this.write(snapshot, version)
      if (!Number.isSafeInteger(result.version) || (result.version as number) < 1) {
        this.update({ status: 'unknown', message: '서버가 저장 버전을 돌려주지 않아 결과를 확인할 수 없어요. 초안을 보관했어요.' })
        return
      }
      const draft = this.state.draft
      this.update({ base: snapshot, version: result.version as number, inflight: undefined, status: draft === snapshot ? 'clean' : 'dirty', message: undefined })
    } catch (error) {
      if (error instanceof ConflictError) {
        const current = (error.body as { current?: ServerNote } | null)?.current
        this.update({ status: 'conflict', current, message: '다른 곳에서 변경됐어요. 내 초안은 보존되어 있으며 자동 저장을 중단했어요.' })
      } else if (error instanceof ApiError && error.rejected && !error.loginRequired) {
        this.update({ status: 'error', inflight: undefined, message: `서버가 저장을 거절했어요: ${error.message}` })
      } else {
        this.update({ status: 'unknown', message: '저장 결과를 확인하지 못했어요. 초안을 보관하고 다시 보내지 않아요.' })
      }
    } finally {
      this.writing = false
    }
    if (this.state.status === 'dirty') await this.flush()
  }
  /** 충돌·불명 뒤 사람이 "현재 노트 새로 불러오기"를 눌렀을 때. 자동으로 clean 이 되지 않아요 */
  reload(note: ServerNote, editable: boolean) {
    if (this.state.status !== 'conflict' && this.state.status !== 'unknown') return false
    this.update({ reloaded: { ...note, editable } })
    return true
  }
  /** 내 초안을 내보낸(복사한) 뒤에만 서버 노트를 채택해요. 편집 가능하면 직접 합치기(merging), 아니면 읽기로 */
  adopt(copied: boolean) {
    const r = this.state.reloaded
    if (!copied || !r || this.writing) return false
    const backups = [...this.state.backups, this.state.draft]
    if (!r.editable) {
      this.update({ status: 'clean', editable: false, base: r.md, version: r.version, draft: r.md, backups, inflight: undefined, current: undefined, reloaded: undefined, message: undefined })
      return true
    }
    this.update({ status: 'merging', base: r.md, version: r.version, draft: r.md, backups, inflight: undefined, current: undefined, reloaded: undefined, message: undefined })
    return true
  }
  /** 합친 노트 저장(merging 에서만, 사람이 누를 때) */
  async saveMerged() {
    if (this.state.status !== 'merging') return
    this.update({ status: 'dirty' })
    await this.flush()
  }
  /** 같은 화면의 다른 쓰기(제목·속성)가 이 노트가 본 version(from)을 to 로 올렸을 때만 따라가요 */
  acceptExternalVersion(from: number, to: number) {
    if (this.state.status === 'clean' && this.state.version === from && Number.isSafeInteger(to) && to > from) this.update({ version: to })
  }
  removeBackup(index: number) {
    this.update({ backups: this.state.backups.filter((_, i) => i !== index) })
  }
}
