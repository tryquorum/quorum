import raw from "../../public/fixtures/live-seoul.json"
import type { QuorumEvent, Role, Stance, Decision } from "@/lib/contract"

// The first live council run, recorded at c0mpiled-17 Seoul (2026-11-09 11:31 KST, personal details redacted).
// Engine text is Korean; EN holds short English captions (translations of the same lines, keyed by seq).
type Raw = { runId: string; request: string; recordedAt: string; note?: string; events: Partial<QuorumEvent>[] }
const r = raw as unknown as Raw

export const SEOUL_EVENTS: QuorumEvent[] = r.events
  .filter((e): e is QuorumEvent => typeof e.type === "string" && typeof e.seq === "number")
  .map((e) => ({ ...e, mode: "replay" as const }))
export const SEOUL_RUN_ID = r.runId
export const SEOUL_REQUEST = r.request
export const SEOUL_REQUEST_EN = "Sort out only what I need to do right now from today's c0mpiled-17 Seoul Luma announcements"
export const SEOUL_RECORDED_AT = r.recordedAt

export const EN: Record<number, string> = {
  0: "Request: only what I need to do now, from today's c0mpiled-17 Seoul Luma announcements",
  1: "2 similar verdicts, closest 61%: below the 82% reuse bar, so the council debates",
  2: "Pull only what to do now from the Luma announcements, as a checklist",
  3: "If something must be submitted during the event, prepare a draft only",
  4: "Leave a memo of today's must-remembers on Direction Board",
  5: "This is the request itself. Read-only, nothing gets submitted",
  6: "You asked to sort out tasks, not to draft submissions. Out of scope",
  7: "Nobody asked for a board memo or reminders. It duplicates p1",
  8: "Concrete endpoints and fields, read-only, matches 'only what to do now'",
  9: "Beyond the request, and which form to open is ambiguous",
  10: "Writes outside without being asked, and trusts p1's output blindly",
  11: "Read-only and every item cites a source. Announcements come from get-blasts",
  12: "Only copies form questions and submits nothing, so it is easy to check",
  13: "No new evidence, and no way to confirm the memo was saved",
  14: "Reads only; sign-ups and sends are blocked. No path for leaks or spend",
  15: "Opening external form links invites prompt injection. A person checks first",
  16: "Internal memo only, with secrets and personal data left out",
  17: "pass · keep 4, cut 0",
  18: "hold · it reaches outside, so a person decides (draft only)",
  19: "reject · keep 1, cut 3",
  20: "Aside opens the signed-in Luma tab and reads the announcements",
  21: "Done as of 11:31 KST. Nothing was applied for, submitted or sent.",
  22: "Verdict remembered in gbrain",
  23: "pass 1 · hold 1 · reject 1 · 2 min 32 s",
}

export type SeoulProposal = { id: string; actor: string; title: string; titleEn: string; critiques: { seq: number; role: Role; stance: Stance; reason: string; reasonEn: string }[]; decision?: Decision; decisionEn?: string }

export const SEOUL_PROPOSALS: SeoulProposal[] = (() => {
  const out: SeoulProposal[] = []
  for (const e of SEOUL_EVENTS) {
    const d = (e.data ?? {}) as Record<string, string>
    if (e.type === "proposal") out.push({ id: d.proposalId, actor: e.actor, title: d.title, titleEn: EN[e.seq] ?? d.title, critiques: [] })
    const p = out.find((x) => x.id === d.proposalId)
    if (!p) continue
    if (e.type === "critique") p.critiques.push({ seq: e.seq, role: d.role as Role, stance: d.stance as Stance, reason: d.reason, reasonEn: EN[e.seq] ?? "" })
    if (e.type === "verdict") { p.decision = d.decision as Decision; p.decisionEn = EN[e.seq] }
  }
  return out
})()

const end = SEOUL_EVENTS.find((e) => e.type === "run.end")
const result = SEOUL_EVENTS.find((e) => e.type === "execute.result")
export const SEOUL_SUMMARY = typeof result?.data?.summary === "string" ? result.data.summary : ""
export const SEOUL_STATS = {
  proposals: SEOUL_PROPOSALS.length,
  critiques: SEOUL_PROPOSALS.reduce((n, p) => n + p.critiques.length, 0),
  pass: SEOUL_PROPOSALS.filter((p) => p.decision === "pass").length,
  hold: SEOUL_PROPOSALS.filter((p) => p.decision === "hold").length,
  reject: SEOUL_PROPOSALS.filter((p) => p.decision === "reject").length,
  durationMs: typeof end?.data?.durationMs === "number" ? end.data.durationMs : 0,
  recallScore: 0.613,
  recallThreshold: 0.82,
}
