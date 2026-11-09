import { describe, expect, test } from "bun:test"
import { decide, type CritiqueIn } from "./rules"
import { dedupProposals, pickReuse, similarity } from "./dedup"

const c = (role: CritiqueIn["role"], stance: CritiqueIn["stance"], reason = "r"): CritiqueIn => ({ role, stance, reason })
const p = { title: "행사 공지에서 내 할 일 정리", executor: "aside" }

describe("decide", () => {
  test("keep majority passes, cut majority rejects, tie holds", () => {
    expect(decide(p, [c("ceo", "keep"), c("reviewer", "keep"), c("qa", "cut"), c("cso", "keep")]).decision).toBe("pass")
    const r = decide(p, [c("ceo", "cut", "범위 밖"), c("reviewer", "cut"), c("qa", "keep")])
    expect(r.decision).toBe("reject")
    expect(r.reason).toContain("ceo: 범위 밖")
    expect(decide(p, [c("ceo", "keep"), c("reviewer", "cut"), c("qa", "keep"), c("cso", "cut")]).decision).toBe("hold")
  })
  test("cso escalate holds even when everyone else keeps", () => {
    const r = decide(p, [c("ceo", "keep"), c("reviewer", "keep"), c("qa", "keep"), c("cso", "escalate", "비밀값")])
    expect(r).toEqual({ decision: "hold", reason: "CSO가 사람 확인을 요청했어요: 비밀값" })
  })
  test("fewer than 3 roles is no quorum", () => {
    expect(decide(p, [c("ceo", "keep"), c("qa", "keep")]).reason).toContain("정족수 미달: 2/4")
    // 같은 역할이 두 번 말해도 한 표
    expect(decide(p, [c("ceo", "keep"), c("ceo", "keep"), c("ceo", "keep")]).decision).toBe("hold")
  })
  test("declared risks and outbound titles hold before votes are counted", () => {
    const all = [c("ceo", "keep"), c("reviewer", "keep"), c("qa", "keep"), c("cso", "keep")]
    expect(decide({ ...p, risk: ["money"] }, all)).toEqual({ decision: "hold", reason: "돈이 걸려 있어 사람이 정해요" })
    expect(decide({ title: "참가 신청서 제출하기", executor: "aside" }, all).decision).toBe("hold")
    expect(decide({ title: "Send the recap email", executor: "aside" }, all).decision).toBe("hold")
    // 방향판 메모는 밖으로 나가는 일이 아니에요
    expect(decide({ title: "할 일 게시판에 메모 남기기", executor: "board" }, all).decision).toBe("pass")
    // 모르는 위험 표시는 무시해요
    expect(decide({ ...p, risk: ["weather"] }, all).decision).toBe("pass")
  })
})

describe("reuse threshold", () => {
  test("similarity is 1 for the same request ignoring spaces and punctuation", () => {
    expect(similarity("오늘 c0mpiled 행사 공지에서 내가 할 일 정리", "오늘 c0mpiled 행사 공지에서, 내가 할 일 정리!")).toBe(1)
    expect(similarity("abc", "")).toBe(0)
  })
  test("close request reuses, different request does not", () => {
    const cands = [
      { id: "a", request: "오늘 c0mpiled 행사 공지에서 내가 할 일 정리해줘" },
      { id: "b", request: "깃허브 이슈 중에서 급한 것 세 개 골라줘" },
    ]
    const close = pickReuse("오늘 c0mpiled 행사 공지에서 내가 할 일 정리", cands, 0.82)
    expect(close.best?.id).toBe("a")
    expect(close.hits[0].score).toBeGreaterThanOrEqual(0.82)
    const far = pickReuse("내일 도쿄 비행기 좌석 확인", cands, 0.82)
    expect(far.best).toBeNull()
    expect(far.hits.length).toBe(2)
  })
  test("threshold is inclusive and configurable", () => {
    const cands = [{ request: "abcd" }]
    const s = similarity("abce", "abcd")
    expect(pickReuse("abce", cands, s).best).not.toBeNull()
    expect(pickReuse("abce", cands, s + 0.001).best).toBeNull()
  })
})

describe("dedupProposals (board dedup.ts rule)", () => {
  test("same normalized title merges and records who else proposed it; short titles never merge", () => {
    const out = dedupProposals([
      { title: "공지 정리하기", actor: "bot:scout" },
      { title: "공지 정리 하기!", actor: "bot:keeper" },
      { title: "할일", actor: "bot:scout" },
      { title: "할 일", actor: "bot:builder" },
    ])
    expect(out.map((x) => x.title)).toEqual(["공지 정리하기", "할일", "할 일"])
    expect(out[0].alsoBy).toEqual(["bot:keeper"])
  })
})
