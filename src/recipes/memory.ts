// gbrain(지식 베이스 CLI)에 레시피 수리 기록을 넣고 다시 찾는다. 외부 의존성 없이 Bun.spawn 만 쓴다.
export type MemoryHit = { slug: string; score: number; snippet: string }

export interface Memory {
  put(slug: string, markdown: string, reason?: string): Promise<void>
  search(query: string, limit?: number): Promise<MemoryHit[]>
  /** 페이지 읽기. 없으면 null (같은 슬러그 충돌 때 같은 수리인지 보려고 써요) */
  get?(slug: string): Promise<string | null>
}

/** gbrain 호출 실패. code 는 프로세스 종료 코드(스폰 실패·타임아웃이면 null) */
export class MemoryError extends Error {
  constructor(message: string, public readonly code: number | null, public readonly stderr: string) {
    super(message)
    this.name = "MemoryError"
  }
  /** 같은 슬러그 페이지가 이미 있어 쓰기가 거절됨 (gbrain put: revision_required) */
  get conflict(): boolean { return /revision_required|expected_revision|conflict/i.test(this.stderr) }
  get notFound(): boolean { return /page_not_found/i.test(this.stderr) }
}

const TAIL = 300
const tail = (s: string) => (s.length > TAIL ? `…${s.slice(-TAIL)}` : s)
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** stdout/stderr 를 끝까지 읽는다(파이프가 차서 자식이 막히지 않게 종료를 기다리기 전에 시작) */
async function readStream(stream: ReadableStream<Uint8Array> | undefined): Promise<string> {
  if (!stream) return ""
  const dec = new TextDecoder()
  let text = ""
  for await (const chunk of stream) text += dec.decode(chunk, { stream: true })
  return text + dec.decode()
}

/** 안내 문구가 섞여도 JSON 처럼 시작하는 줄들의 위치를 차례로 돌려준다 */
function jsonStartOffsets(text: string): number[] {
  const offsets: number[] = []
  let offset = 0
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart()
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) offsets.push(offset + line.length - trimmed.length)
    offset += line.length + 1
  }
  return offsets
}

/** 뒤에 잡문이 붙어 있어도 균형이 맞는 첫 JSON 값만 잘라 낸다 */
function balancedJson(text: string, start: number): string | null {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === "\\") escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === "{" || c === "[") stack.push(c)
    else if (c === "}" || c === "]") {
      if (stack.pop() !== (c === "}" ? "{" : "[")) return null
      if (!stack.length) return text.slice(start, i + 1)
    }
  }
  return null
}

function parseHits(stdout: string, stderr: string): MemoryHit[] {
  let value: unknown
  let lastError = "no JSON value"
  for (const start of jsonStartOffsets(stdout)) {
    const raw = stdout.slice(start)
    try {
      value = JSON.parse(raw)
      break
    } catch (e) {
      const body = balancedJson(raw, 0)
      try {
        if (body === null) throw new Error("no balanced JSON value")
        value = JSON.parse(body)
        break
      } catch (inner) {
        lastError = errText(inner) || errText(e)
      }
    }
  }
  if (value === undefined) {
    const why = jsonStartOffsets(stdout).length ? lastError : "no JSON line"
    throw new MemoryError(`gbrain search returned unparsable JSON (${why}); stderr: ${tail(stderr) || "(empty)"}`, 0, stderr)
  }
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { results?: unknown }).results)
      ? (value as { results: unknown[] }).results
      : null
  if (!rows) throw new MemoryError(`gbrain search returned unexpected JSON; stderr: ${tail(stderr) || "(empty)"}`, 0, stderr)
  return rows.map((row): MemoryHit => {
    if (!row || typeof row !== "object") throw new MemoryError(`gbrain search returned a malformed hit; stderr: ${tail(stderr) || "(empty)"}`, 0, stderr)
    const h = row as Record<string, unknown>
    const slug = typeof h.slug === "string" ? h.slug : ""
    if (!slug) throw new MemoryError(`gbrain search hit has no slug; stderr: ${tail(stderr) || "(empty)"}`, 0, stderr)
    const score = typeof h.score === "number" ? h.score : Number(h.score ?? 0) || 0
    const snippet = typeof h.snippet === "string" ? h.snippet
      : typeof h.chunk_text === "string" ? h.chunk_text
        : typeof h.text === "string" ? h.text
          : ""
    return { slug, score, snippet }
  })
}

export class GbrainMemory implements Memory {
  private readonly bin: string
  private readonly env: Record<string, string | undefined>
  private readonly timeoutMs: number

  constructor(opts: { bin?: string; env?: Record<string, string>; timeoutMs?: number } = {}) {
    this.bin = opts.bin ?? process.env.QUORUM_GBRAIN_BIN ?? "gbrain"
    this.env = { ...process.env, ...opts.env, NO_COLOR: "1" }
    this.timeoutMs = opts.timeoutMs ?? 20_000
  }

  async put(slug: string, markdown: string, reason?: string): Promise<void> {
    const args = ["put", slug, "--content-origin", "tool_output"]
    if (typeof reason === "string" && reason.length > 0) args.push("--reason", reason.slice(0, 500))
    await this.run("put", args, markdown)
  }

  async search(query: string, limit = 10): Promise<MemoryHit[]> {
    const n = Number.isFinite(limit) ? Math.trunc(limit) : 10
    const { stdout, stderr } = await this.run("search", ["search", query, "--limit", String(n), "--json"])
    return parseHits(stdout, stderr)
  }

  async get(slug: string): Promise<string | null> {
    try { return (await this.run("get", ["get", slug])).stdout }
    catch (e) { if (e instanceof MemoryError && e.notFound) return null; throw e }
  }

  private async run(label: string, args: string[], input?: string): Promise<{ stdout: string; stderr: string }> {
    let proc: ReturnType<typeof Bun.spawn>
    try {
      proc = Bun.spawn([this.bin, ...args], {
        stdin: input === undefined ? "ignore" : new Blob([input]),
        stdout: "pipe",
        stderr: "pipe",
        env: this.env,
      })
    } catch (e) {
      const why = errText(e)
      throw new MemoryError(`gbrain ${label} could not start (${this.bin}): ${why}`, null, why)
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        proc.kill("SIGKILL")
      } catch {
        // 이미 끝난 프로세스면 그만
      }
    }, this.timeoutMs)
    try {
      const out = readStream(proc.stdout as ReadableStream<Uint8Array>)
      const err = proc.stderr ? readStream(proc.stderr as ReadableStream<Uint8Array>) : Promise.resolve("")
      const code = await proc.exited
      const [stdout, stderr] = await Promise.all([out, err])
      if (timedOut) {
        throw new MemoryError(`gbrain ${label} timed out after ${this.timeoutMs}ms; stderr: ${tail(stderr) || "(empty)"}`, null, stderr)
      }
      if (code !== 0) {
        throw new MemoryError(`gbrain ${label} exited ${code}; stderr: ${tail(stderr) || "(empty)"}`, code, stderr)
      }
      return { stdout, stderr }
    } catch (e) {
      if (e instanceof MemoryError) throw e
      throw new MemoryError(`gbrain ${label} failed: ${errText(e)}`, null, errText(e))
    } finally {
      clearTimeout(timer)
    }
  }
}

/** copied from board/packages/contracts/src/text.ts (Direction Board): same-title rule */
export const normTitle = (s: string) => s.normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")

export function noteSlug(recipeId: string, version: number): string {
  return `recipes/${recipeId}-v${version}`
}

const oneLine = (s: string) => s.replace(/\s+/gu, " ").trim()

/** 레시피가 깨져서 고친 기록을 gbrain 페이지(markdown)로 만든다 */
export function repairNote(input: {
  recipeId: string
  site: string
  intent: string
  fromVersion: number
  toVersion: number
  previousEndpoint: string
  endpoint: string
  reason: string
  at: string
}): string {
  return [
    `# ${input.recipeId} v${input.toVersion}`,
    "",
    `- site: ${oneLine(input.site)}`,
    `- intent: ${oneLine(input.intent)}`,
    `- previous endpoint: ${oneLine(input.previousEndpoint)}`,
    `- new endpoint: ${oneLine(input.endpoint)}`,
    `- broken reason: ${oneLine(input.reason)}`,
    `- at: ${oneLine(input.at)}`,
    "",
  ].join("\n")
}

/** repairNote 가 쓴 "- new endpoint: GET <url>" 줄에서 경로를 다시 읽어요 */
export function endpointsFromNote(text: string): { method: "GET" | "POST"; url: string }[] {
  const out: { method: "GET" | "POST"; url: string }[] = []
  for (const m of text.matchAll(/new endpoint:\s*(GET|POST)\s+(\S+)/g)) out.push({ method: m[1] as "GET" | "POST", url: m[2] })
  return out
}

/** 두 수리 기록이 같은 수리인지: 이전·새 경로 줄을 board dedup 의 같은 제목 규칙(normTitle)으로 비교해요 */
export function sameRepair(a: string, b: string): boolean {
  const key = (s: string) => normTitle(s.split("\n").filter((l) => /^- (previous|new) endpoint:/.test(l.trim())).join("\n"))
  const ka = key(a)
  return ka.length > 0 && ka === key(b)
}
