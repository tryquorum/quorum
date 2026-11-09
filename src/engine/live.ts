// 실제 데모 경로의 deps: Aside·codex·gbrain·방향판을 엮어요. 시험은 이 파일을 쓰지 않아요(aside exec 는 유료).
// 심사위원의 맥처럼 gbrain·codex·방향판이 없을 수 있어요: 없는 것은 빼고(의회는 정상), 기억은 "memory off" 정보 이벤트로 남겨요.
import { join } from "node:path"
import type { CouncilDeps } from "./council"
import { DEFAULT_REUSE_THRESHOLD } from "./dedup"
import { askAside, browserTask } from "../executors/aside"
import { askCodex, codeTask, CODEX_BIN } from "../executors/codex"
import { GBRAIN_BIN, recallVerdicts, rememberVerdict } from "../executors/gbrain"
import type { BoardClient } from "../executors/board"

export const INSTALL_HINTS = {
  gbrain: "gbrain is not installed, so past verdicts are not remembered. To turn it on: bun install -g github:garrytan/gbrain#stable (https://github.com/garrytan/gbrain)",
  codex: "Codex CLI is not installed, so the bots do not propose code tasks. To turn it on: npm i -g @openai/codex && codex login. QUORUM_BOT_RUNNER=codex then runs the opinions on Codex instead of Aside",
  board: "Direction Board is not reachable. The council runs without it. To use it: QUORUM_BOARD_URL (read), QUORUM_BOARD_WRITE=1 (write), QUORUM_BOARD_IMPORT_URL (Workspace import)",
} as const

export type LiveProbe = { which: (name: string) => string | null; boardUp?: () => Promise<boolean> }

export function liveDeps(stateDir: string, board: BoardClient, probe: LiveProbe = { which: (n) => Bun.which(n) }): (runId: string) => CouncilDeps {
  const sandbox = join(stateDir, "sandbox")
  const runner = process.env.QUORUM_BOT_RUNNER === "codex" ? "codex" : "aside"
  const threshold = Number(process.env.QUORUM_REUSE_THRESHOLD)
  const boardUp = probe.boardUp ?? (() => board.available().catch(() => false))
  return () => {
    const gbrain = probe.which(GBRAIN_BIN) !== null
    const codex = probe.which(CODEX_BIN) !== null
    return {
      ask: runner === "codex"
        ? (_actor, prompt) => askCodex(prompt)
        : (_actor, prompt) => askAside(prompt, { effort: process.env.QUORUM_BOT_EFFORT || "low", timeout: process.env.QUORUM_BOT_TIMEOUT || "150s" }).then((a) => a.answer),
      ...(gbrain ? { recall: (request: string) => recallVerdicts(request), remember: rememberVerdict } : { memoryOff: INSTALL_HINTS.gbrain }),
      // 방향판이 없는 맥에서 의회마다 "방향판을 읽지 못했어요" 오류가 나지 않게, 닿을 때만 읽어요
      boardContext: async (request) => ((await boardUp()) ? board.search(request.slice(0, 80), 5) : []),
      ...(board.writeEnabled
        ? { boardPost: (input) => board.postRunResult(input), boardDecide: (input) => board.postDecision(input) }
        : {}),
      executors: {
        aside: async (p) => {
          const r = await browserTask(p.task)
          return { summary: r.summary, data: { sessionId: r.sessionId } }
        },
        ...(codex
          ? {
              codex: async (p, ctx) => {
                const r = await codeTask(sandbox, ctx.runId, p.task)
                return { summary: r.summary || r.diffStat, data: { dir: r.dir, diffStat: r.diffStat, files: r.files, diff: r.diff } }
              },
            }
          : {}),
        // 방향판 쓰기가 꺼져 있으면 board 실행기는 늘 실패하므로 봇에게 알리지 않아요
        ...(board.writeEnabled
          ? {
              board: async (p) => {
                const r = await board.postRunResult({ title: p.title, body: p.task, tags: ["quorum"] })
                if (!r.posted) throw new Error(r.reason)
                return { summary: "방향판에 남겼어요: " + r.ref, data: { ref: r.ref } }
              },
            }
          : {}),
      },
      proposers: Number(process.env.QUORUM_PROPOSERS || 3),
      reuseThreshold: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_REUSE_THRESHOLD,
    }
  }
}
