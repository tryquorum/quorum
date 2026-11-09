// 최근에 연 일 상세를 기억해요. 다시 열거나 팝업 안에서 옮겨 갈 때 스켈레톤 대신 바로 그리고 뒤에서 새로 받아요.
// 캐시로 그린 내용은 보여 주기만 해요. 쓰는 동작과 노트 편집기는 이 화면이 새 응답을 받은 뒤에만 켜요(work-view 의 fresh).

/** 가장 오래 안 쓴 것부터 버리는 작은 캐시. get 도 "최근에 씀"으로 쳐요 */
export class RecentCache<T> {
  private readonly map = new Map<string, T>()
  private readonly limit: number
  constructor(limit = 40) { this.limit = limit }
  get(key: string): T | undefined {
    const value = this.map.get(key)
    if (value !== undefined) { this.map.delete(key); this.map.set(key, value) }
    return value
  }
  set(key: string, value: T) {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as string)
  }
  delete(key: string) { this.map.delete(key) }
  get size() { return this.map.size }
}

/** 서버가 같은 내용을 다시 보냈는지. 같으면 화면 객체를 그대로 둬서 다시 그리지 않아요 */
export const sameJson = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)
