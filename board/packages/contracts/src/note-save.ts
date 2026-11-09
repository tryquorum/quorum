export type NoteDraft = {html: string; text: string}
export type NoteConflict = {version: number; md: string; truncated: boolean}
export type NoteSaveState = {status: 'clean'|'dirty'|'saving'|'unknown'|'conflict'|'review'|'merging'|'error'; protected: boolean; unknownProtected?: boolean; version?: number; draft: NoteDraft | null; backup?: NoteDraft | null; additionalBackups?: NoteDraft[]; draftRuns?: string[]; recoveryDraftRuns?: string[]; recoveryRunChoices?: Record<string, 'included'|'excluded'>; current?: NoteConflict; updatedAt?: number; message?: string}
type Reply = {version?: number; updated_at: number}
type Writer = (body: NoteDraft & {expectedVersion?: number}) => Promise<Reply>
export function noteVersion(capability: boolean | undefined, note: {version?: number} | null): number | undefined | null {
  if (capability !== true) return undefined
  if (note === null) return 0
  return Number.isSafeInteger(note.version) && (note.version as number) > 0 ? note.version! : null
}

/** Owns one ref's write queue. A failed or ambiguous write never triggers a retry. */
export class NoteSaver {
  state: NoteSaveState
  private writing = false
  private write: Writer
  private changed: (state: NoteSaveState) => void
  constructor(version: number | undefined | null, write: Writer, changed: (state: NoteSaveState) => void, restored?: NoteSaveState) {
    this.write = write
    this.changed = changed
    const invalid = version === null
    this.state = restored ? {...restored, protected:version !== undefined, version:invalid || version === undefined ? undefined : restored.protected ? restored.version : undefined, unknownProtected:restored.unknownProtected ?? restored.protected, status: restored.status === 'saving' || (!!restored.draft && (invalid || (version !== undefined) !== restored.protected)) ? 'unknown' : restored.status === 'review' ? 'conflict' : restored.status, ...(restored.status === 'review' ? {message:'기존 초안을 보관하고 최신 서버 노트와 직접 합쳐 주세요.'} : invalid ? {message:'서버의 노트 버전을 확인할 수 없어 저장을 중단했어요.'} : {})} : {status:invalid ? 'error' : 'clean', protected:version !== undefined, version:version ?? undefined, draft:null, ...(invalid ? {message:'서버의 노트 버전을 확인할 수 없어 저장을 중단했어요.'} : {})}
  }
  private update(patch: Partial<NoteSaveState>) { this.state = {...this.state, ...patch}; this.changed(this.state) }
  edit(draft: NoteDraft, runId?: string) {
    const status = this.state.status === 'unknown' || this.state.status === 'conflict' || this.state.status === 'review' || this.state.status === 'merging' || this.state.status === 'error' ? this.state.status : this.writing ? 'saving' : 'dirty'
    this.update({draft, status, draftRuns: runId ? [...new Set([...(this.state.draftRuns || []), runId])] : this.state.draftRuns})
  }
  clearDraftRun(runId: string) { this.update({draftRuns:(this.state.draftRuns || []).filter((id) => id !== runId)}) }
  /** 같은 화면의 다른 쓰기(속성·메타)가 이 노트가 본 version(from)에서 to 로 올렸을 때만 따라간다. 기준이 다르면 다음 저장이 409 로 충돌을 알린다 */
  acceptExternalVersion(from:number, to:number) {if (this.state.status === 'clean' && this.state.protected && this.state.version === from && Number.isSafeInteger(to) && to > from) this.update({version:to})}
  hasDraftRun(runId: string) { return !!(this.state.draftRuns?.includes(runId) || this.state.recoveryDraftRuns?.includes(runId)) }
  chooseRecoveryRun(runId: string, choice: 'included'|'excluded') {
    if (this.state.status !== 'merging' || !this.state.recoveryDraftRuns?.includes(runId)) return
    this.update({recoveryRunChoices:{...this.state.recoveryRunChoices, [runId]:choice}})
  }
  retryError() { if (this.state.status === 'error') this.update({status:'dirty', message:undefined}) }
  private archiveDraft() {
    const {draft, backup, additionalBackups} = this.state
    return backup && draft ? {backup, additionalBackups:[...(additionalBackups || []), draft]} : {backup:backup || draft, additionalBackups}
  }
  private pendingRecovery() {
    return {recoveryDraftRuns:[...new Set([...(this.state.recoveryDraftRuns || []), ...(this.state.draftRuns || [])])], recoveryRunChoices:{}, draftRuns:[]}
  }
  loadConflictCurrent(version: number, current: NoteDraft) {
    if (this.state.status !== 'conflict' || !Number.isSafeInteger(version) || version < 0 || this.writing) return false
    this.update({status:'merging', version, protected:true, ...this.archiveDraft(), ...this.pendingRecovery(), draft:current, current:undefined, message:undefined})
    return true
  }
  adoptUnknownCurrent(version: number, current: NoteDraft) {
    if (this.state.status !== 'unknown' || !this.state.unknownProtected || !this.state.protected || this.writing || !Number.isSafeInteger(version) || version < 0 || (typeof this.state.version === 'number' && version < this.state.version)) return false
    this.update({status:'merging', version, ...this.archiveDraft(), ...this.pendingRecovery(), draft:current, current:undefined, message:undefined, unknownProtected:undefined})
    return true
  }
  async saveMerged() {
    if (this.state.status !== 'merging' || !this.state.draft) return
    if ((this.state.recoveryDraftRuns || []).some((id) => !this.state.recoveryRunChoices?.[id])) return
    this.update({status:'dirty'})
    await this.flush()
  }
  clearBackup() { this.update({backup:null}) }
  clearAdditionalBackup(index: number) { this.update({additionalBackups:(this.state.additionalBackups || []).filter((_, i) => i !== index)}) }
  async flush(): Promise<void> {
    if (this.writing || !this.state.draft || this.state.status !== 'dirty') return
    if ((this.state.recoveryDraftRuns || []).some((id) => !this.state.recoveryRunChoices?.[id])) { this.update({status:'merging'}); return }
    if (this.state.protected && typeof this.state.version !== 'number') { this.update({status:'error', message:'서버의 노트 버전을 확인할 수 없어 저장을 중단했어요.'}); return }
    const snapshot = this.state.draft
    const resolvedRuns = [...(this.state.recoveryDraftRuns || [])]
    const includedRuns = resolvedRuns.filter((id) => this.state.recoveryRunChoices?.[id] === 'included')
    if (snapshot.html.length > 200000 || snapshot.text.length > 50000) { this.update({status:'error', message:'노트가 기존 서버의 저장 크기를 넘어 원문이 잘릴 수 있어 저장을 중단했어요. 초안을 복사해 주세요.'}); return }
    this.writing = true
    const body = {...snapshot, ...(this.state.protected ? {expectedVersion:this.state.version} : {})}
    this.update({status:'saving'})
    try {
      const result = await this.write(body)
      if (this.state.protected && (!Number.isSafeInteger(result.version) || result.version! < 1)) {
        this.update({status:'unknown', unknownProtected:this.state.protected, message:'서버가 저장 버전을 돌려주지 않아 결과를 확인할 수 없어요. 초안을 보존하고 자동 저장을 중단했어요.'})
        return
      }
      const next = this.state.draft === snapshot ? null : this.state.draft
      const version = this.state.protected ? result.version : undefined
      this.update({version, draft:next, status:next ? 'dirty' : 'clean', updatedAt:result.updated_at, draftRuns:[...new Set([...(this.state.draftRuns || []), ...includedRuns])], recoveryDraftRuns:(this.state.recoveryDraftRuns || []).filter((id) => !resolvedRuns.includes(id)), recoveryRunChoices:{}})
    } catch (e) {
      const err = e as {status?: number; body?: {current?: NoteConflict}; message?: string}
      if (err.status === 409) this.update({status:'conflict', current:err.body?.current, message:'다른 곳에서 변경됐어요. 내 초안은 보존되어 있으며 자동 저장을 중단했어요.'})
      else this.update({status:'unknown', unknownProtected:this.state.protected, message:'저장 결과를 확인하지 못했어요. 내 초안은 보존되어 있으며 자동 재전송하지 않아요.'})
    } finally {this.writing = false}
    if (this.state.status === 'dirty') await this.flush()
  }
}
