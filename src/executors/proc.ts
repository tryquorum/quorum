// 출처: board/apps/server/server/runs.ts 의 startProcess (방향판 2ee6e8a)
// 가져온 것: stdout/stderr 를 끝까지 읽는 방식, ANSI 제거, stderr 의 "session: <id>" 찾기, 읽기 오류를 실패로 올리기,
// "created new session" 줄을 진단에서 빼기, classifyRunError 로 실패 종류 정하기.
// 바꾼 점: DB 갱신 대신 결과를 돌려주는 함수로, 제한 시간(kill)·작업 폴더·stdin 을 받고, 실행 파일이 없을 때(spawn 실패)도 결과로 돌려줘요.
import { classifyRunError, type RunErrorKind } from "./run-errors"

export const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g // oxlint-disable-line no-control-regex -- 터미널 ANSI 이스케이프 제거

export type ProcResult = {
  code: number
  stdout: string
  stderr: string
  sessionId: string | null
  timedOut: boolean
  errorKind: RunErrorKind | null
  diagnostic: string | null
}

export type ProcOptions = { timeoutMs: number; cwd?: string; stdin?: string; env?: Record<string, string> }

export async function runProcess(cmd: string[], opts: ProcOptions): Promise<ProcResult> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn(cmd, {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: opts.stdin !== undefined ? new Blob([opts.stdin]) : "ignore",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...(opts.env || {}) },
    })
  } catch (e) {
    const diagnostic = String(e)
    return { code: 127, stdout: "", stderr: "", sessionId: null, timedOut: false, errorKind: classifyRunError(diagnostic, { spawnError: true }), diagnostic }
  }
  let out = ""
  let errTxt = ""
  let sessionId: string | null = null
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, opts.timeoutMs)
  const readOut = (async () => {
    const dec = new TextDecoder()
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) out += dec.decode(chunk, { stream: true })
  })()
  const readErr = (async () => {
    const dec = new TextDecoder()
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      errTxt += dec.decode(chunk, { stream: true })
      if (!sessionId) {
        const m = errTxt.replace(ANSI, "").match(/session:\s*([A-Za-z0-9_-]{6,})/)
        if (m) sessionId = m[1]
      }
    }
  })()
  let code = 1
  let readError: unknown = null
  try { code = await proc.exited } catch (e) { readError = e }
  const reads = await Promise.allSettled([readOut, readErr])
  for (const result of reads) if (result.status === "rejected") readError ||= result.reason
  if (readError) { code = 1; errTxt += "\n" + String(readError) }
  clearTimeout(timer)
  const cleanErr = errTxt.replace(ANSI, "").split("\n").filter((l) => l.trim() && !/created new session|resumed session/i.test(l)).join("\n").slice(-1500)
  const ok = code === 0 && !timedOut
  const diagnostic = ok ? null : timedOut ? "제한 시간 " + Math.round(opts.timeoutMs / 1000) + "초를 넘겼어요" + (cleanErr ? "\n" + cleanErr : "") : cleanErr || "종료 코드 " + code
  return {
    code,
    stdout: out.replace(ANSI, ""),
    stderr: cleanErr,
    sessionId,
    timedOut,
    errorKind: ok ? null : classifyRunError(diagnostic || "", { timedOut }),
    diagnostic,
  }
}
