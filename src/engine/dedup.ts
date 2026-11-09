// 제안 중복 판정과 판정 재사용 거리.
// 출처: board/packages/contracts/src/text.ts 의 normTitle·SAME_TITLE_MIN, board/apps/server/server/dedup.ts 의 규칙
// ("비교는 보수적으로: 공백·문장부호·대소문자만 무시한 제목이 완전히 같을 때만 같은 일로 본다. 4자 미만이면 찾지 않는다").
// 바꾼 점: DB 의 할 일 대신 봇 제안 목록에 적용하고, 합친 제안에 누가 같은 걸 냈는지(alsoBy) 남겨요.
// 재사용 거리는 새로 더했어요: 정규화한 글자의 2-gram Dice 계수라 한국어 띄어쓰기·조사가 조금 달라도 견뎌요.
export const normTitle = (s: string) => s.normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")
export const SAME_TITLE_MIN = 4

export function dedupProposals<T extends { title: string; actor: string }>(list: T[]): (T & { alsoBy: string[] })[] {
  const out: (T & { alsoBy: string[] })[] = []
  const byKey = new Map<string, T & { alsoBy: string[] }>()
  for (const p of list) {
    const key = normTitle(p.title)
    const same = key.length >= SAME_TITLE_MIN ? byKey.get(key) : undefined
    if (same) {
      if (same.actor !== p.actor && !same.alsoBy.includes(p.actor)) same.alsoBy.push(p.actor)
      continue
    }
    const kept = { ...p, alsoBy: [] as string[] }
    if (key.length >= SAME_TITLE_MIN) byKey.set(key, kept)
    out.push(kept)
  }
  return out
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) || 0) + 1)
  }
  return m
}

/** 0~1. 같은 요청이면 1 */
export function similarity(a: string, b: string): number {
  const x = normTitle(a)
  const y = normTitle(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return 0
  const ga = bigrams(x)
  const gb = bigrams(y)
  let both = 0
  for (const [g, n] of ga) both += Math.min(n, gb.get(g) || 0)
  return (2 * both) / (x.length - 1 + (y.length - 1))
}

export const DEFAULT_REUSE_THRESHOLD = 0.82

export function pickReuse<T extends { request: string }>(request: string, candidates: T[], threshold = DEFAULT_REUSE_THRESHOLD) {
  const hits = candidates.map((c) => ({ ...c, score: similarity(request, c.request) })).sort((a, b) => b.score - a.score)
  const best = hits[0] && hits[0].score >= threshold ? hits[0] : null
  return { best, hits }
}
