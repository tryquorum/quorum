// Codex 실행기: 봇 의견(QUORUM_BOT_RUNNER=codex)과 코딩 일. 코딩 일은 .quorum/sandbox/<runId>/ 의 작은 git 저장소에서만 돌아요.
// 프로세스 실행·오류 분류는 board runs.ts 에서 가져온 ./proc 를 써요.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ExecError } from "./run-errors"
import { runProcess } from "./proc"

export const CODEX_BIN = process.env.CODEX_BIN || "codex"

async function lastMessage(file: string) {
  try { return (await Bun.file(file).text()).trim() } catch { return "" }
}

export async function askCodex(prompt: string, timeoutMs = 180_000): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "quorum-bot-"))
  try {
    const out = join(dir, "last.txt")
    const r = await runProcess([CODEX_BIN, "exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-C", dir, "-o", out, prompt], { timeoutMs })
    if (r.code !== 0 || r.timedOut) throw new ExecError(r.errorKind || "unknown", r.diagnostic || "")
    const text = (await lastMessage(out)) || r.stdout.trim()
    if (!text) throw new ExecError("unknown", "codex 가 빈 답을 돌려줬어요")
    return text
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export type CodeResult = { summary: string; dir: string; diffStat: string; diff: string; files: string[] }

const git = (dir: string, ...args: string[]) =>
  runProcess(["git", "-c", "user.name=quorum", "-c", "user.email=quorum@localhost", "-c", "commit.gpgsign=false", ...args], { cwd: dir, timeoutMs: 20_000 })

export async function codeTask(sandboxRoot: string, runId: string, task: string, timeoutMs = Number(process.env.QUORUM_CODEX_TIMEOUT_MS || 600_000)): Promise<CodeResult> {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new ExecError("unknown", "runId 형식이 잘못됐어요")
  const dir = join(sandboxRoot, runId)
  mkdirSync(dir, { recursive: true })
  await Bun.write(join(dir, "README.md"), "# Quorum sandbox " + runId + "\n\n" + task + "\n")
  for (const step of [["init", "-q"], ["add", "-A"], ["commit", "-qm", "quorum: task"]]) {
    const g = await git(dir, ...step)
    if (g.code !== 0) throw new ExecError("launch", "git " + step[0] + ": " + (g.diagnostic || ""))
  }
  const out = join(sandboxRoot, runId + ".last.txt")
  const prompt = task + "\n\n[Quorum 규칙] 이 폴더 안에서만 파일을 만들고 고쳐요. 네트워크 설치·푸시는 하지 마요. 끝나면 무엇을 바꿨는지 세 줄로 요약해요."
  const r = await runProcess([CODEX_BIN, "exec", "--skip-git-repo-check", "-s", "workspace-write", "-C", dir, "-o", out, prompt], { timeoutMs })
  await git(dir, "add", "-A")
  const stat = await git(dir, "diff", "--cached", "--stat")
  const names = await git(dir, "diff", "--cached", "--name-only")
  const diff = await git(dir, "diff", "--cached")
  const summary = (await lastMessage(out)) || r.stdout.trim().slice(-2000)
  const files = names.stdout.split("\n").map((s) => s.trim()).filter(Boolean)
  if (r.code !== 0 || r.timedOut) throw new ExecError(r.errorKind || "unknown", (r.diagnostic || "") + (files.length ? "\n(바뀐 파일: " + files.join(", ") + ")" : ""))
  return { summary, dir, diffStat: stat.stdout.trim(), diff: diff.stdout.slice(0, 6000), files }
}
