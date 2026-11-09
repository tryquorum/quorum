// 판정 규칙(순수 함수). 같은 입력이면 같은 판정이에요.
// 출처: board/apps/server/server/signals.ts 의 triage() — 순서(위험 표시 먼저 → 종류별 기본 규칙 → 애매하면 결정 대기)와
// RISKS 목록·한국어 이름(돈, 외부로 나가는 것, 보안, 실서비스, 계약·법, 개인)을 가져왔어요.
// 그리고 board/apps/server/server/ops-prompt.md "나를 불러야 하는 조건"(돈, 밖으로 나가는 것, 계약·법)을 제목 검사로 옮겼어요.
// 바꾼 점: 사건 칸(lane) 대신 pass/hold/reject 를 내고, gstack 역할 반박(keep/cut/escalate)과 정족수를 셉니다.
import type { Decision, Role } from "../contract"

export const RISKS = new Set(["money", "external", "security", "prod", "legal", "private"])
export const RISK_KO: Record<string, string> = { money: "돈", external: "외부로 나가는 것", security: "보안", prod: "실서비스", legal: "계약·법", private: "개인" }
/** 밖으로 나가거나 되돌릴 수 없는 동작. 제목에 있으면 사람이 정해요(초안까지만) */
export const OUTBOUND = /(보내|전송|발송|결제|구매|송금|제출|신청|게시|발행|머지|배포|삭제|\b(send|e-?mail|dm|pay|purchase|buy|submit|apply|publish|merge|deploy|delete|transfer)\b)/i
export const ROLES: Role[] = ["ceo", "reviewer", "qa", "cso"]
/** 네 역할 중 이만큼은 의견을 내야 의결해요 */
export const QUORUM_MIN = 3

export type Stance = "keep" | "cut" | "escalate"
export type CritiqueIn = { role: Role; stance: Stance; reason: string }
export type ProposalIn = { title: string; executor: string; risk?: string[] }
export type Ruling = { decision: Decision; reason: string }

export function decide(p: ProposalIn, critiques: CritiqueIn[]): Ruling {
  const risks = (p.risk || []).filter((r) => RISKS.has(r))
  if (risks.length) return { decision: "hold", reason: risks.map((r) => RISK_KO[r]).join(", ") + "이 걸려 있어 사람이 정해요" }
  if (p.executor !== "board" && OUTBOUND.test(p.title)) return { decision: "hold", reason: "밖으로 나가는 일이라 사람이 정해요(초안까지만)" }
  // 역할마다 마지막 의견 하나만 세요
  const byRole = new Map<Role, CritiqueIn>()
  for (const c of critiques) if (ROLES.includes(c.role)) byRole.set(c.role, c)
  if (byRole.size < QUORUM_MIN) return { decision: "hold", reason: "정족수 미달: " + byRole.size + "/" + ROLES.length + " 역할만 의견을 냈어요" }
  const cso = byRole.get("cso")
  if (cso?.stance === "escalate") return { decision: "hold", reason: "CSO가 사람 확인을 요청했어요: " + cso.reason }
  const esc = [...byRole.values()].find((c) => c.stance === "escalate")
  if (esc) return { decision: "hold", reason: esc.role.toUpperCase() + "가 사람 확인을 요청했어요: " + esc.reason }
  const keeps = [...byRole.values()].filter((c) => c.stance === "keep").length
  const cuts = [...byRole.values()].filter((c) => c.stance === "cut")
  const tally = "keep " + keeps + " · cut " + cuts.length
  if (keeps > cuts.length) return { decision: "pass", reason: tally }
  if (cuts.length > keeps) return { decision: "reject", reason: tally + " · " + cuts[0].role + ": " + cuts[0].reason }
  return { decision: "hold", reason: tally + " · 찬반이 같아 사람이 정해요" }
}
