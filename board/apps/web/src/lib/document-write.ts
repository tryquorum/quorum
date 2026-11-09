import { ApiError } from './api'

/** Serializes versioned writes; only confirmed local transitions may advance a base. */
export class DocumentWriteCoordinator {
  private tail:Promise<void> = Promise.resolve()
  private transitions = new Map<number,number>()
  private blocked = false
  private failure:unknown
  private changed?: (from:number,to:number)=>void
  /** changed(from,to): 이 화면이 version from 을 기준으로 보낸 쓰기가 to 로 끝났다. 받는 쪽은 자기 기준이 from 일 때만 to 로 옮긴다 */
  constructor(changed?:(from:number,to:number)=>void) {this.changed=changed}
  reset() {this.blocked=false;this.failure=undefined;this.transitions.clear()}
  run<T extends {version?:number}>(expected:number, write:(version:number)=>Promise<T>):Promise<T> {
    const task = this.tail.then(async()=>{
      if (this.blocked) throw this.failure || new Error('다른 저장의 결과를 먼저 확인해 주세요.')
      let version=expected
      const seen=new Set<number>()
      while (this.transitions.has(version) && !seen.has(version)) {seen.add(version);version=this.transitions.get(version)!}
      try {
        const result=await write(version)
        if (!Number.isSafeInteger(result.version) || result.version! < version) {this.blocked=true;throw new Error('저장 버전을 확인할 수 없어요.')}
        if (result.version! > version) this.transitions.set(version,result.version!)
        this.changed?.(version,result.version!)
        return result
      } catch(e) {if (!(e instanceof ApiError && (e.status===400 || e.status===413))) {this.blocked=true;this.failure=e}throw e}
    })
    this.tail=task.then(()=>{},()=>{})
    return task
  }
}
