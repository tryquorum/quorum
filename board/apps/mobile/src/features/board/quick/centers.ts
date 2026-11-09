// 범위(서버·로그인 = SmallStore 하나)마다 칩 목록 하나. 순수 TS 라 bun 으로 시험해요.
import type { SmallStore } from '../smallStore'

/**
 * 그 범위의 저장 파일을 다 읽은 뒤에만 만들어요. 읽기 전에 만들면 빈 목록으로 굳어서(만들 때 한 번 읽음)
 * 파일의 칩이 사라지고, 그때 새 칩을 저장하면 파일 값도 덮여요. 다른 범위의 준비 상태를 빌려 쓰지 않게 store 에 물어요
 */
export function centerFor<C extends object>(cache: WeakMap<SmallStore, C>, store: SmallStore, name: string, make: (store: SmallStore) => C): C | null {
  if (!store.ready(name)) return null
  let c = cache.get(store)
  if (!c) cache.set(store, (c = make(store)))
  return c
}
