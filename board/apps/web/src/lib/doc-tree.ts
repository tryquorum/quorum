// 문서 계층의 순수 부분은 웹·iOS 공용(packages/contracts/src/doc-tree.ts). 여기는 다시 내보내기와 이 브라우저의 펼침 기억만이에요.
export * from "@direction-board/contracts/doc-tree"

/** 펼친 노드 기억(이 브라우저) */
export const OPEN_KEY = "db:doc-tree-open"
export function readOpen(storage: Pick<Storage, "getItem"> | null): Set<string> {
  try { const v = JSON.parse(storage?.getItem(OPEN_KEY) || "[]"); return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []) } catch { return new Set() }
}
export function toggleOpen(open: Set<string>, ref: string, on?: boolean): Set<string> {
  const next = new Set(open)
  if (on ?? !next.has(ref)) next.add(ref); else next.delete(ref)
  return next
}
