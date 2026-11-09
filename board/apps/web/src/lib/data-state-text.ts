// 데이터 상태 줄의 글: 출처 이름을 "보드·소식을" 처럼 묶어요.

/** 받침에 맞춰 을/를 */
export const eul = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00
  return w + (c >= 0 && c <= 11171 && c % 28 !== 0 ? "을" : "를")
}

/** ["보드","소식"] → "보드·소식을", ["보드"] → "보드를" */
export const joinSources = (names: string[]) => eul(names.join("·"))
