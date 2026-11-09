// gbrain 기억: 의회 판정을 quorum/verdicts/<runId> 페이지로 저장하고, 비슷한 요청이 오면 찾아요.
// gbrain 은 외부 CLI(MIT)예요. 실패는 ExecError 로 올려서 엔진이 error 이벤트로 드러내요(조용히 건너뛰지 않음).
import { ExecError } from "./run-errors"
import { runProcess } from "./proc"

export const GBRAIN_BIN = process.env.GBRAIN_BIN || "gbrain"
export const VERDICT_PREFIX = "quorum/verdicts/"
const FENCE = "\u0060".repeat(3)

export type StoredDecision = { proposalId: string; title: string; executor: string; task: string; decision: "pass" | "hold" | "reject"; reason: string }
export type MemoryRecord = { quorumVerdict: 1; runId: string; request: string; at: string; reusedFrom?: string; verdicts: StoredDecision[] }
export type Recalled = MemoryRecord & { id: string }

export function formatRecord(rec: MemoryRecord): string {
  const lines = [
    "# Quorum 판정: " + rec.request.split("\n")[0].slice(0, 80),
    "",
    "요청: " + rec.request,
    "",
    ...rec.verdicts.map((v) => "- " + v.decision + " · " + v.title + " (" + v.executor + "): " + v.reason),
    "",
    FENCE + "json",
    JSON.stringify(rec),
    FENCE,
    "",
  ]
  return lines.join("\n")
}

export function parseRecord(markdown: string): MemoryRecord | null {
  const start = markdown.indexOf(FENCE + "json")
  if (start < 0) return null
  const from = start + FENCE.length + 4
  const end = markdown.indexOf(FENCE, from)
  if (end < 0) return null
  try {
    const o = JSON.parse(markdown.slice(from, end).trim()) as Partial<MemoryRecord> | null
    if (o?.quorumVerdict !== 1 || typeof o.request !== "string" || !Array.isArray(o.verdicts)) return null
    return o as MemoryRecord
  } catch {
    return null
  }
}

/** gbrain --json 출력에서 JSON 만 꺼내요(앞뒤 안내 줄이 섞여도) */
export function parseJsonOut(stdout: string): unknown {
  const t = stdout.trim()
  try { return JSON.parse(t) } catch { /* 안내 줄이 섞인 경우 아래에서 잘라 읽어요 */ }
  const i = t.search(/[[{]/)
  const j = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"))
  if (i < 0 || j <= i) return null
  try { return JSON.parse(t.slice(i, j + 1)) } catch { return null }
}

async function gb(args: string[], stdin?: string) {
  const r = await runProcess([GBRAIN_BIN, ...args], { timeoutMs: 30_000, stdin })
  if (r.code !== 0 || r.timedOut) throw new ExecError(r.errorKind || "unknown", "gbrain " + args[0] + ": " + (r.diagnostic || ""))
  return r.stdout
}

type RawHit = { slug?: unknown; title?: unknown; chunk_text?: unknown; score?: unknown }
export type MemoryHit = { slug: string; title: string; snippet: string; score: number; text: string }

export async function searchMemory(q: string, limit = 10): Promise<MemoryHit[]> {
  const out = parseJsonOut(await gb(["search", q, "--json", "--limit", String(limit)]))
  if (!Array.isArray(out)) return []
  return (out as RawHit[]).map((h) => {
    const text = String(h.chunk_text ?? "")
    return { slug: String(h.slug ?? ""), title: String(h.title ?? ""), snippet: text.slice(0, 400), score: Number(h.score) || 0, text }
  })
}

async function getRecord(slug: string): Promise<MemoryRecord | null> {
  return parseRecord(await gb(["get", slug, "--content-only"]))
}

/** 비슷한 판정 후보를 모아요: 키워드 검색 → 없으면 최근 판정 목록. 점수는 엔진이 다시 매겨요 */
export async function recallVerdicts(request: string, max = 12): Promise<Recalled[]> {
  const found = new Map<string, Recalled>()
  const hits = (await searchMemory(request, 20)).filter((h) => h.slug.startsWith(VERDICT_PREFIX))
  for (const h of hits) {
    const rec = parseRecord(h.text) || (await getRecord(h.slug))
    if (rec) found.set(h.slug, { ...rec, id: h.slug })
  }
  if (!found.size) {
    const list = parseJsonOut(await gb(["find", VERDICT_PREFIX, "--json", "--limit", "50"])) as { pages?: { slug?: unknown }[] } | null
    const slugs = (list?.pages || []).map((p) => String(p.slug ?? "")).filter((s) => s.startsWith(VERDICT_PREFIX))
    slugs.sort().reverse()
    const recs = await Promise.all(slugs.slice(0, max).map(async (s) => [s, await getRecord(s).catch(() => null)] as const))
    for (const [s, rec] of recs) if (rec) found.set(s, { ...rec, id: s })
  }
  return [...found.values()].slice(0, max)
}

export async function rememberVerdict(rec: MemoryRecord): Promise<string> {
  const slug = VERDICT_PREFIX + rec.runId
  await gb(["put", slug, "--content-origin", "inferred", "--reason", "quorum council verdict " + rec.runId], formatRecord(rec))
  return slug
}

export async function gbrainAvailable(): Promise<boolean> {
  const r = await runProcess([GBRAIN_BIN, "--version"], { timeoutMs: 5000 })
  return r.code === 0
}
