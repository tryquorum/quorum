// 봇 역할과 프롬프트.
// 제안 봇 규칙은 board/apps/server/server/ops-prompt.md 에서 가져왔어요("확인 안 된 걸 사실처럼 쓰지 마", "보내기·결제·제출은 초안까지만", "같은 일을 매번 새로 올리지 마").
// 반박 역할 기준은 gstack(MIT, ~/.claude/skills/gstack)의 SKILL.md 에서 핵심만 발췌해 우리말로 옮겼어요:
//   ceo ← plan-ceo-review(범위 도전, "COMPLETENESS IS COVERAGE", 최소 핵심) + office-hours(수요 증거·가장 좁은 쐐기)
//   reviewer ← review/checklist.md(LLM 출력 신뢰 경계, 셸 인젝션, 경쟁 상태, 완결성 빈틈; "Only flag real problems")
//   qa ← qa(재현·증거·심각도, 검증할 수 없는 수정은 미해결)
//   cso ← cso("Find exploitable defects. State attacker, boundary, impact"; 구체적 실패 시나리오 없는 겁주기 금지)
import type { Role } from "../contract"
import type { Stance } from "./rules"

export type Persona = { id: string; name: string; lens: string }
export const PROPOSERS: Persona[] = [
  { id: "scout", name: "정찰병", lens: "사람의 로그인된 브라우저로 읽고 정리하면 바로 풀리는 일을 찾아요(aside)." },
  { id: "builder", name: "제작자", lens: "작은 스크립트·코드로 자동화하면 다음부터 손이 안 가는 일을 찾아요(codex)." },
  { id: "keeper", name: "살림꾼", lens: "할 일을 줄이는 쪽을 봐요. 안 해도 되는 일은 none 으로, 사람이 기억해야 할 건 방향판(board)에 남겨요." },
]

export const CRITICS: { role: Role; name: string; criteria: string }[] = [
  { role: "ceo", name: "CEO", criteria: "이 일이 요청을 실제로 푸나? 요청에 없는 범위를 늘리면 cut. 같은 효과면 더 작은 일을 남겨요. 근거 없는 '있으면 좋은' 일은 cut." },
  { role: "reviewer", name: "리뷰어", criteria: "실행기 지시가 구체적이고 검증 가능한가? 모델 출력을 그대로 믿어 셸·코드·외부 쓰기로 넘기는가(신뢰 경계)? 실제 문제일 때만 cut, 지시가 모호하면 cut." },
  { role: "qa", name: "QA", criteria: "결과를 확인할 증거(출처 주소, diff, 스크린샷)가 남나? 재현할 수 있나? 확인 수단이 없으면 cut." },
  { role: "cso", name: "CSO", criteria: "공격자·경계·영향을 말할 수 있나? 돈, 밖으로 보내기, 비밀값·개인정보, 웹 페이지 글을 지시로 따르는 프롬프트 인젝션 위험이 구체적으로 있으면 escalate. 구체적 실패 시나리오 없이 겁주지 말고 keep." },
]

export type BoardHit = { ref: string; title: string; kind: string; snippet?: string }
export type ProposalDraft = { title: string; executor: "aside" | "codex" | "board" | "none"; why: string; task: string; risk: string[]; actor: string }
export type ProposalView = { proposalId: string; title: string; executor: string; why: string; task: string; risk?: string[] }
export type CritiqueDraft = { proposalId: string; role: Role; stance: Stance; reason: string }

const JSON_ONLY = "브라우저나 도구를 쓰지 말고, 설명 없이 JSON 하나만 답해요."

export function proposalPrompt(p: Persona, request: string, board: BoardHit[]): string {
  return [
    "너는 Quorum 의회의 제안 봇 '" + p.name + "'이야. " + p.lens,
    "사람의 요청: " + JSON.stringify(request),
    board.length ? "[방향판에 이미 있는 관련 항목 — 같은 일을 또 만들지 마]\n" + board.map((b) => "- " + b.kind + " " + b.title).join("\n") : "",
    "실행기: aside = 사람의 로그인된 브라우저로 읽고 정리, codex = 새 빈 샌드박스 저장소에서 작은 코드 작성, board = 방향판에 메모로 남기기, none = 실행 없이 답만.",
    "규칙: 보내기·결제·제출·신청·머지·공개 게시는 하지 말고 초안까지만. 확인 안 된 걸 사실처럼 쓰지 마.",
    "risk 는 실행이 실제로 그 일을 할 때만 적어: money(돈을 씀) | external(메일·메시지·글을 밖으로 보냄) | prod(실서비스를 바꿈) | legal(계약·서명) | private(개인정보를 밖에 남김) | security(비밀값을 다룸). 읽고 정리만 하면 빈 배열이야.",
    "할 일을 1~2개 제안해. task 는 실행기가 그대로 따를 구체적 지시(어디서 무엇을 읽고 어떤 형식으로 정리할지)로 써.",
    JSON_ONLY,
    '{"proposals":[{"title":"한 줄 제목","executor":"aside|codex|board|none","why":"왜 필요한지 한 줄","task":"구체적 지시","risk":[]}]}',
  ].filter(Boolean).join("\n\n")
}

export function critiquePrompt(c: (typeof CRITICS)[number], request: string, proposals: ProposalView[]): string {
  return [
    "너는 Quorum 의회의 " + c.name + " 역할 반박 봇이야. 기준: " + c.criteria,
    "사람의 요청: " + JSON.stringify(request),
    "[제안 목록]\n" + proposals.map((p) => p.proposalId + ". " + p.title + " (실행기 " + p.executor + (p.risk?.length ? ", 제안자가 적은 위험 " + p.risk.join("·") : "") + ")\n   이유: " + p.why + "\n   지시: " + p.task).join("\n"),
    "제안마다 하나씩 stance 를 정해: keep(통과 찬성) | cut(빼자) | escalate(사람이 직접 봐야 함). reason 은 한 줄, 근거를 구체적으로.",
    JSON_ONLY,
    '{"critiques":[{"proposalId":"p1","stance":"keep|cut|escalate","reason":"한 줄"}]}',
  ].join("\n\n")
}

/** 봇 답에서 JSON 객체를 꺼내요. 코드 울타리나 앞뒤 말이 섞여도 첫 { 부터 마지막 } 까지 읽어요 */
export function parseBotJson(text: string): Record<string, unknown> {
  const t = text.trim()
  const i = t.indexOf("{")
  const j = t.lastIndexOf("}")
  if (i < 0 || j <= i) throw new Error("봇 답에 JSON 이 없어요: " + t.slice(0, 120))
  const o = JSON.parse(t.slice(i, j + 1)) as unknown
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("봇 답이 JSON 객체가 아니에요")
  return o as Record<string, unknown>
}

const EXECUTORS = new Set(["aside", "codex", "board", "none"])
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "")

export function readProposals(o: Record<string, unknown>, actor: string): ProposalDraft[] {
  const list = Array.isArray(o.proposals) ? o.proposals : []
  const out: ProposalDraft[] = []
  for (const raw of list.slice(0, 3)) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const title = str(r.title, 160)
    if (!title) continue
    const ex = str(r.executor, 10)
    out.push({
      title,
      executor: (EXECUTORS.has(ex) ? ex : "none") as ProposalDraft["executor"],
      why: str(r.why, 400),
      task: str(r.task, 2000) || title,
      risk: Array.isArray(r.risk) ? r.risk.map((x) => String(x)).slice(0, 6) : [],
      actor,
    })
  }
  return out
}

const STANCES = new Set(["keep", "cut", "escalate"])
export function readCritiques(o: Record<string, unknown>, role: Role, ids: Set<string>): CritiqueDraft[] {
  const list = Array.isArray(o.critiques) ? o.critiques : []
  const out: CritiqueDraft[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const id = str(r.proposalId, 20)
    const stance = str(r.stance, 10)
    if (!ids.has(id) || !STANCES.has(stance) || seen.has(id)) continue
    seen.add(id)
    out.push({ proposalId: id, role, stance: stance as Stance, reason: str(r.reason, 400) })
  }
  return out
}
