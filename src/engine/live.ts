// 실제 데모 경로의 deps: Aside·codex·gbrain·방향판을 엮어요. 시험은 이 파일을 쓰지 않아요(aside exec 는 유료).
import { join } from "node:path"
import type { CouncilDeps } from "./council"
import { DEFAULT_REUSE_THRESHOLD } from "./dedup"
import { askAside, browserTask } from "../executors/aside"
import { askCodex, codeTask } from "../executors/codex"
import { recallVerdicts, rememberVerdict } from "../executors/gbrain"
import type { BoardClient } from "../executors/board"

export function liveDeps(stateDir: string, board: BoardClient): (runId: string) => CouncilDeps {
  const sandbox = join(stateDir, "sandbox")
  const runner = process.env.QUORUM_BOT_RUNNER === "codex" ? "codex" : "aside"
  const threshold = Number(process.env.QUORUM_REUSE_THRESHOLD)
  return () => ({
    ask: runner === "codex"
      ? (_actor, prompt) => askCodex(prompt)
      : (_actor, prompt) => askAside(prompt, { effort: process.env.QUORUM_BOT_EFFORT || "low", timeout: process.env.QUORUM_BOT_TIMEOUT || "150s" }).then((a) => a.answer),
    recall: (request) => recallVerdicts(request),
    remember: (rec) => rememberVerdict(rec),
    boardContext: (request) => board.search(request.slice(0, 80), 5),
    ...(board.writeEnabled
      ? { boardPost: (input) => board.postRunResult(input), boardDecide: (input) => board.postDecision(input) }
      : {}),
    executors: {
      aside: async (p) => {
        const r = await browserTask(p.task)
        return { summary: r.summary, data: { sessionId: r.sessionId } }
      },
      codex: async (p, ctx) => {
        const r = await codeTask(sandbox, ctx.runId, p.task)
        return { summary: r.summary || r.diffStat, data: { dir: r.dir, diffStat: r.diffStat, files: r.files, diff: r.diff } }
      },
      board: async (p) => {
        const r = await board.postRunResult({ title: p.title, body: p.task, tags: ["quorum"] })
        if (!r.posted) throw new Error(r.reason)
        return { summary: "방향판에 남겼어요: " + r.ref, data: { ref: r.ref } }
      },
    },
    proposers: Number(process.env.QUORUM_PROPOSERS || 3),
    reuseThreshold: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_REUSE_THRESHOLD,
  })
}
