// 문서 계층(docs/internals/doc-hierarchy.md)의 화면 쪽 순수 부분: 끌어 놓을 자리, 옮기기 요청, 이동 후보, 브레드크럼 줄이기, 이어 읽기·늦은 응답.
// 웹과 iOS 가 같이 써요(웹 apps/web/src/lib/doc-tree.ts 는 다시 내보내기 + 브라우저 펼침 기억). 시험: doc-tree.test.ts
import type { MoveInput } from "./docs.ts"

export type Zone = "before" | "inside" | "after"
/** 행 위 위치(행 안 y, 행 높이) → 위 4분의 1 은 앞, 아래 4분의 1 은 뒤, 가운데는 그 아래로 */
export function dropZone(y: number, height: number): Zone {
  if (height <= 0) return "inside"
  const r = y / height
  return r < 0.25 ? "before" : r > 0.75 ? "after" : "inside"
}

export type TreeRow = { ref: string; parent: string | null }
/**
 * 끌어 놓기 → 옮기기 요청. 자기 위, 자기 조상 사슬(지금 보이는 트리에서 아는 것) 안으로는 null(놓을 수 없음).
 * targetChain 은 놓을 행의 조상 ref 들(맨 위부터)
 */
export function moveFor(dragged: string, target: TreeRow, zone: Zone, targetChain: string[] = []): MoveInput | null {
  if (dragged === target.ref) return null
  const parent = zone === "inside" ? target.ref : target.parent
  if (parent === dragged || targetChain.includes(dragged)) return null
  if (zone === "inside") return { ref: dragged, parent }
  return zone === "before" ? { ref: dragged, parent, before: target.ref } : { ref: dragged, parent, after: target.ref }
}

/** 이동 대화상자 후보: 독립 문서만, 자기와 (아는) 자손 빼기, 보관 빼기 */
export function moveCandidates<T extends { ref: string; kind: string; status: string }>(hits: T[], self: string, descendants: Set<string> = new Set()): T[] {
  return hits.filter((h) => h.kind === "doc" && h.ref !== self && !descendants.has(h.ref) && h.status !== "archived")
}

export type Crumb = { ref: string; title: string } | { gap: true }
/** 브레드크럼: 조상이 max 개보다 많으면 맨 위 하나 + … + 가까운 것들 */
export function crumbs(ancestors: { ref: string; title: string }[], max = 3): Crumb[] {
  if (ancestors.length <= max) return ancestors
  return [ancestors[0], { gap: true }, ...ancestors.slice(ancestors.length - (max - 1))]
}

/** 409 이유(서버 영어 한 줄) → 사람에게 보일 말 */
export function moveError(status: number, message: string): string {
  if (status === 409 && /under itself|cycle/i.test(message)) return "자기 아래나 하위 문서 아래로는 옮길 수 없어요"
  if (status === 409 && /deep|levels/i.test(message)) return "8단보다 깊어져서 옮길 수 없어요"
  if (status === 404) return "옮길 곳을 찾지 못했어요. 목록을 새로 읽어 주세요"
  if (status === 400 && /archiv/i.test(message)) return "보관된 문서로는 옮길 수 없어요"
  return "옮기지 못했어요: " + message
}

/** 다음 쪽 붙이기: 이미 있는 ref 는 빼요(쪽 사이에 순서가 바뀌어 겹칠 수 있어요) */
export function appendPage<T extends { ref: string }>(prev: T[], next: T[]): T[] {
  const seen = new Set(prev.map((x) => x.ref))
  return [...prev, ...next.filter((x) => !seen.has(x.ref))]
}

/**
 * 가지별 요청 세대. 새로 읽기(fresh)는 세대를 올리고, 이어 읽기는 지금 세대를 그대로 써요.
 * 응답은 그 세대가 여전히 지금 세대일 때만 반영해요 — 이동 전에 보낸 늦은 응답이 새 목록을 덮지 않게요.
 */
export function createGenerations() {
  const gens = new Map<string, number>()
  let epoch = 0
  return {
    fresh(key: string): number { const g = ++epoch; gens.set(key, g); return g },
    current(key: string): number { return gens.get(key) ?? 0 },
    isCurrent(key: string, g: number): boolean { return gens.get(key) === g },
    /** 모든 가지의 진행 중 응답을 버려요(목록을 통째로 비울 때) */
    reset(): void { gens.clear() },
  }
}

type ChildPage = { results: { ref: string; children?: number }[]; nextCursor?: string }
/**
 * root 아래 자손 ref 모으기(이동 대화상자에서 검색 결과의 자손을 빼려고). cap 개까지만 읽어요.
 * 다 모으지 못하면(cap) complete=false 예요. 그때도 서버가 순환 이동을 409 로 거절해요.
 */
export async function collectDescendants(root: string, load: (parent: string, cursor?: string) => Promise<ChildPage>, cap = 500): Promise<{ refs: Set<string>; complete: boolean }> {
  const refs = new Set<string>()
  const queue = [root]
  while (queue.length) {
    const parent = queue.shift() as string
    let cursor: string | undefined
    do {
      if (refs.size >= cap) return { refs, complete: false }
      const page = await load(parent, cursor)
      for (const h of page.results) {
        if (h.ref === root || refs.has(h.ref)) continue
        refs.add(h.ref)
        if ((h.children ?? 0) > 0) queue.push(h.ref)
      }
      cursor = page.nextCursor
    } while (cursor)
  }
  return { refs, complete: true }
}
