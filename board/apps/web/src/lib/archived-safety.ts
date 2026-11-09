import type { ArchivedDocState } from './docs-api'

type StorageLike = Pick<Storage,'getItem'|'setItem'|'removeItem'>
export class ArchivedDraftStore {
  private drafts = new Map<string, ArchivedDocState>()
  private volatile = new Set<string>()
  constructor(privateStorage:StorageLike) { this.storage = privateStorage }
  private storage:StorageLike
  private key(ref:string) { return `db:archived-draft:${ref}` }
  restore(ref:string) {
    if (this.drafts.has(ref)) return this.drafts.get(ref)
    try {const value = this.storage.getItem(this.key(ref)); if (!value) return undefined; const state = JSON.parse(value) as ArchivedDocState; this.drafts.set(ref,state); return state} catch {return undefined}
  }
  persist(ref:string,state:ArchivedDocState) {
    const empty = state.status === 'clean' && !state.backups.length
    this.drafts.set(ref,state)
    try {
      if (empty) this.storage.removeItem(this.key(ref)); else this.storage.setItem(this.key(ref),JSON.stringify(state))
      if (empty) this.drafts.delete(ref)
      this.volatile.delete(ref); return true
    } catch { this.volatile.add(ref); return false }
  }
  hasPending() {return this.volatile.size > 0 || [...this.drafts.values()].some((state) => state.status !== 'clean' || state.backups.length > 0)}
  /** 사용자가 복사를 확인하고 지우는 경우. 저장소에서 지운 뒤에만 메모리에서도 지운다. 실패하면 원래 초안을 그대로 두어 다시 열었을 때도 보이고 다시 지울 수 있다 */
  discard(ref:string) {
    try { this.storage.removeItem(this.key(ref)); this.drafts.delete(ref); this.volatile.delete(ref); return true }
    catch { this.volatile.add(ref); return false }
  }
  hasVolatile() {return this.volatile.size > 0}
  isVolatile(ref:string) {return this.volatile.has(ref)}
  scan() {
    const storage = this.storage as StorageLike & {length?:number; key?:(index:number)=>string|null}
    try {
      for (let i=0; i<(storage.length || 0); i++) {
        const key = storage.key?.(i)
        if (!key?.startsWith('db:archived-draft:')) continue
        const ref = key.slice('db:archived-draft:'.length)
        if (!this.drafts.has(ref) && !this.restore(ref)) this.volatile.add(ref)
      }
    } catch {this.volatile.add('__unreadable_storage__')}
  }
}
export const archivedDrafts = new ArchivedDraftStore({getItem:(key) => sessionStorage.getItem(key), setItem:(key,value) => sessionStorage.setItem(key,value), removeItem:(key) => sessionStorage.removeItem(key), get length(){return sessionStorage.length}, key:(index:number) => sessionStorage.key(index)} as StorageLike)
/** 노트 편집기는 내용이 깨끗해지면 저장 항목을 지운다. 그래서 남아 있는 항목은 아직 다시 열지 않은 미저장 초안·백업이다 (새로고침 뒤에도) */
export function hasStoredNoteDraft(storage:{length:number; key:(index:number)=>string|null} = sessionStorage) {
  try {
    for (let i=0; i<storage.length; i++) if (storage.key(i)?.startsWith('db:note-draft:')) return true
    return false
  } catch {return true}
}
if (typeof window !== 'undefined') {
  archivedDrafts.scan()
  window.addEventListener('beforeunload',(event) => {if (archivedDrafts.hasPending() || hasStoredNoteDraft()) {event.preventDefault();event.returnValue = ''}})
}
export class RequestGeneration {
  private generation = 0
  start() {const id = ++this.generation; return () => id === this.generation}
  cancel() {this.generation++}
}
