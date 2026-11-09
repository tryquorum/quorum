import { describe, expect, test } from "bun:test"
import type { EventType } from "../contract"
import { runCouncil, type CouncilDeps } from "./council"
import type { MemoryRecord, Recalled } from "../executors/gbrain"

type Ev = { type: EventType; actor: string; text: string; data?: Record<string, unknown> }
const collect = () => {
  const events: Ev[] = []
  return { events, emit: (type: EventType, actor: string, text: string, data?: Record<string, unknown>) => { events.push({ type, actor, text, data }) } }
}

const proposalsJson = (items: object[]) => "여기요\n" + "{" + JSON.stringify({ proposals: items }).slice(1)
const critiques = (stances: Record<string, string>) => JSON.stringify({ critiques: Object.entries(stances).map(([proposalId, stance]) => ({ proposalId, stance, reason: "근거" })) })

function fakeDeps(over: Partial<CouncilDeps> = {}, answers: Record<string, string | Error> = {}) {
  const calls: string[] = []
  const saved: MemoryRecord[] = []
  const executed: string[] = []
  const deps: CouncilDeps = {
    ask: async (actor) => {
      calls.push(actor)
      const a = answers[actor]
      if (a instanceof Error) throw a
      if (a !== undefined) return a
      if (actor === "bot:scout") return proposalsJson([{ title: "공지 읽고 할 일 정리", executor: "aside", why: "요청 그대로", task: "luma 공지를 읽어 정리" }])
      if (actor === "bot:builder") return proposalsJson([{ title: "체크리스트 스크립트", executor: "codex", why: "자동화", task: "checklist.ts 작성" }])
      if (actor === "bot:keeper") return proposalsJson([{ title: "공지 읽고 할 일 정리!", executor: "aside", why: "중복", task: "같은 일" }, { title: "참가비 결제하기", executor: "aside", why: "필요", task: "결제" }])
      if (actor === "bot:cso") return critiques({ p1: "keep", p2: "keep", p3: "keep" })
      if (actor === "bot:ceo") return critiques({ p1: "keep", p2: "cut", p3: "keep" })
      return critiques({ p1: "keep", p2: "cut", p3: "keep" })
    },
    recall: async () => [],
    remember: async (rec) => { saved.push(rec); return "quorum/verdicts/" + rec.runId },
    executors: {
      aside: async (p) => { executed.push("aside:" + p.proposalId); return { summary: "할 일 3개\n- a" } },
      codex: async (p) => { executed.push("codex:" + p.proposalId); return { summary: "made", data: { diffStat: "1 file" } } },
    },
    now: () => 1000,
    ...over,
  }
  return { deps, calls, saved, executed }
}

describe("runCouncil", () => {
  test("full flow emits events in contract order and executes only passed proposals", async () => {
    const { deps, saved, executed } = fakeDeps()
    const { events, emit } = collect()
    const r = await runCouncil("r1", "오늘 c0mpiled 행사 공지에서 내가 할 일 정리", deps, emit)
    expect(r.status).toBe("done")
    const order = events.map((e) => e.type)
    const firstIdx = (t: EventType) => order.indexOf(t)
    const lastIdx = (t: EventType) => order.lastIndexOf(t)
    expect(order[0]).toBe("run.start")
    expect(order[1]).toBe("recall")
    expect(lastIdx("proposal")).toBeLessThan(firstIdx("critique"))
    expect(lastIdx("critique")).toBeLessThan(firstIdx("verdict"))
    expect(lastIdx("verdict")).toBeLessThan(firstIdx("execute.start"))
    expect(lastIdx("execute.result")).toBeLessThan(firstIdx("memory.saved"))
    expect(order[order.length - 1]).toBe("run.end")
    // 같은 제목 제안은 하나로 합쳐져요(p1 에 keeper 가 alsoBy)
    const props = events.filter((e) => e.type === "proposal")
    expect(props.map((e) => e.data?.proposalId)).toEqual(["p1", "p2", "p3"])
    expect(props[0].data?.alsoBy).toEqual(["bot:keeper"])
    const verdicts = Object.fromEntries(events.filter((e) => e.type === "verdict").map((e) => [e.data?.proposalId, e.data?.decision]))
    // p1 keep 4 → pass, p2 cut 3 → reject, p3 결제 → hold
    expect(verdicts).toEqual({ p1: "pass", p2: "reject", p3: "hold" })
    expect(executed).toEqual(["aside:p1"])
    expect(saved[0].verdicts.map((v) => v.decision)).toEqual(["pass", "reject", "hold"])
    const end = events[events.length - 1]
    expect(end.data).toMatchObject({ status: "done", pass: 1, hold: 1, reject: 1, board: "skipped: QUORUM_BOARD_WRITE is not 1" })
    expect(events.some((e) => e.type === "board.posted")).toBe(false)
  })

  test("a close remembered verdict is reused and the council is skipped", async () => {
    const prior: Recalled = {
      id: "quorum/verdicts/r0", quorumVerdict: 1, runId: "r0", request: "오늘 c0mpiled 행사 공지에서 내가 할 일 정리해줘", at: "x",
      verdicts: [{ proposalId: "p1", title: "공지 읽고 할 일 정리", executor: "aside", task: "정리", decision: "pass", reason: "keep 4 · cut 0" }],
    }
    const { deps, calls, executed, saved } = fakeDeps({ recall: async () => [prior] })
    const { events, emit } = collect()
    const r = await runCouncil("r2", "오늘 c0mpiled 행사 공지에서 내가 할 일 정리", deps, emit)
    expect(calls).toEqual([])
    expect(r.reusedFrom).toBe("quorum/verdicts/r0")
    expect(events.some((e) => e.type === "critique")).toBe(false)
    const v = events.find((e) => e.type === "verdict")
    expect(v?.data).toMatchObject({ proposalId: "p1", decision: "pass", reusedFrom: "quorum/verdicts/r0" })
    expect(executed).toEqual(["aside:p1"])
    expect(saved[0].reusedFrom).toBe("quorum/verdicts/r0")
    expect(events.find((e) => e.type === "recall")?.data?.hits).toHaveLength(1)
  })

  test("a far remembered verdict is shown in recall but the council still runs", async () => {
    const prior: Recalled = { id: "quorum/verdicts/r9", quorumVerdict: 1, runId: "r9", request: "깃허브 이슈 정리", at: "x", verdicts: [] }
    const { deps, calls } = fakeDeps({ recall: async () => [prior], reuseThreshold: 0.82 })
    const { events, emit } = collect()
    await runCouncil("r3", "오늘 c0mpiled 행사 공지에서 내가 할 일 정리", deps, emit)
    expect(calls.length).toBe(7)
    expect(events.some((e) => e.type === "verdict" && e.data?.reusedFrom)).toBe(false)
  })

  test("bot, memory and executor failures surface as error events instead of being skipped", async () => {
    const { deps } = fakeDeps(
      {
        recall: async () => { throw new Error("gbrain down") },
        remember: async () => { throw new Error("disk full") },
        executors: { aside: async () => { throw Object.assign(new Error("Aside 브라우저가 꺼져 있어요"), { kind: "aside_offline" }) } },
      },
      { "bot:builder": new Error("timeout"), "bot:qa": "JSON 아님" },
    )
    const { events, emit } = collect()
    await runCouncil("r4", "공지 정리", deps, emit)
    const errs = events.filter((e) => e.type === "error")
    expect(errs.map((e) => e.actor)).toEqual(["gbrain", "bot:builder", "bot:qa", "aside", "gbrain"])
    const res = events.find((e) => e.type === "execute.result")
    expect(res?.data).toMatchObject({ ok: false, errorKind: "aside_offline" })
    // qa 가 빠져도 3/4 라 정족수는 채워요
    expect(events.find((e) => e.type === "verdict" && e.data?.proposalId === "p1")?.data?.decision).toBe("pass")
    expect(events.some((e) => e.type === "memory.saved")).toBe(false)
  })

  test("no proposals ends the run with status error", async () => {
    const bad = new Error("down")
    const { deps } = fakeDeps({}, { "bot:scout": bad, "bot:builder": bad, "bot:keeper": "{}" })
    const { events, emit } = collect()
    const r = await runCouncil("r5", "x", deps, emit)
    expect(r.status).toBe("error")
    expect(events[events.length - 1]).toMatchObject({ type: "run.end", data: { status: "error" } })
  })

  test("board writes happen only when the deps include them; holds go to the decide lane", async () => {
    const posted: string[] = []
    const { deps } = fakeDeps({
      boardPost: async (i) => { posted.push("doc:" + i.title); return { posted: true, ref: "doc:1" } },
      boardDecide: async (i) => { posted.push("decide:" + i.title); return { posted: true, ref: "signal:1" } },
    })
    const { events, emit } = collect()
    await runCouncil("r6", "공지 정리", deps, emit)
    expect(posted).toEqual(["doc:Quorum: 공지 정리", "decide:Quorum 승인 대기: 참가비 결제하기"])
    expect(events.filter((e) => e.type === "board.posted").map((e) => e.data?.kind)).toEqual(["doc", "decide"])
  })
})
