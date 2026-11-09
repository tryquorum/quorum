// 한 문서의 버전 쓰기(제목·영역·상태·날짜·속성·노트)를 한 줄로 세워요. 웹 DocumentWriteCoordinator(apps/web/src/lib/document-write.ts)와 같은 규칙:
// 이 화면이 확인한 version 이동(from→to)만 다음 쓰기의 기준으로 따라가고, 결과를 모르거나 버전이 이상하면 줄을 막아요.
// 서버가 확실히 거절한 쓰기(쓰이지 않음)는 막지 않아요. 그래서 제목을 바꾼 직후 노트를 저장해도 거짓 409 가 나지 않고, 다른 기기의 변경은 409 로 드러나요.
import { ApiError, ConflictError } from '../../api/client'
import { ScopeChangedError } from '../../api/queryStore'

export class WriteQueue {
  private tail: Promise<void> = Promise.resolve()
  private transitions = new Map<number, number>()
  private blocked = false
  private failure: unknown
  /** changed(from,to): 이 화면이 version from 을 기준으로 보낸 쓰기가 to 로 끝났어요. 받는 쪽은 자기 기준이 from 일 때만 to 로 옮겨요 */
  /** guard: 보내기 직전에 확인해요(화면을 연 서버·계정이 그대로인지). false 면 보내지 않고 ScopeChangedError(쓰이지 않음, 줄은 막지 않음) */
  constructor(
    private changed?: (from: number, to: number) => void,
    private guard: () => boolean = () => true,
  ) {}
  get isBlocked() {
    return this.blocked
  }
  /** 사람이 최신 서버 상태를 다시 받아 전환한 뒤에만 불러요 */
  reset() {
    this.blocked = false
    this.failure = undefined
    this.transitions.clear()
  }
  run<T extends { version?: number }>(expected: number, send: (version: number) => Promise<T>): Promise<T> {
    const task = this.tail.then(async () => {
      if (this.blocked) throw this.failure ?? new Error('다른 저장의 결과를 먼저 확인해 주세요')
      let version = expected
      const seen = new Set<number>()
      while (this.transitions.has(version) && !seen.has(version)) {
        seen.add(version)
        version = this.transitions.get(version) as number
      }
      if (!this.guard()) throw new ScopeChangedError()
      try {
        const result = await send(version)
        if (!Number.isSafeInteger(result.version) || (result.version as number) < version) {
          this.blocked = true
          this.failure = new Error('저장 버전을 확인할 수 없어요')
          throw this.failure
        }
        if ((result.version as number) > version) this.transitions.set(version, result.version as number)
        this.changed?.(version, result.version as number)
        return result
      } catch (error) {
        const notWritten = error instanceof ApiError && !(error instanceof ConflictError) && error.rejected && !error.loginRequired
        if (!notWritten && !this.blocked) {
          this.blocked = true
          this.failure = error
        }
        throw error
      }
    })
    this.tail = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }
}
