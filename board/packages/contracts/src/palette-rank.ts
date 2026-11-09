// ⌘K 에서 검색어가 화면·명령·설정 이름과 정확히 같으면 그 묶음을 문서 검색 결과보다 먼저 보여요(GAP-10).

/** 앞뒤 공백·대소문자를 무시하고 이름이 검색어와 정확히 같은 것이 있으면 참 */
export function exactName(q: string, labels: string[]): boolean {
  const k = q.trim().toLocaleLowerCase()
  return !!k && labels.some((l) => l.trim().toLocaleLowerCase() === k)
}
