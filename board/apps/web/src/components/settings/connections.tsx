import { useState } from "react"
import { CircleCheck, CircleX, Loader2, PlugZap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ago, api } from "@/lib/api"
import { AGENTS, CF_ID_ENV, CF_SECRET_ENV, TOKEN_ENV, snippetsFor, type AgentId, type Target } from "@direction-board/contracts/mcp-snippets"
import type { McpCheck, SettingsInfo } from "@direction-board/contracts/settings"
import { CodeBlock, CopyButton, Group, Segmented, SettingRow } from "./parts"
import { TokensRow } from "./tokens"

const AGENT_MARK: Record<AgentId, string> = { claude: "Cc", codex: "Cx", cursor: "Cu", goat: "Gt", aside: "As", other: "··" }

export function ConnectionsSection({ info }: { info: SettingsInfo }) {
  const [target, setTarget] = useState<Target>("local")
  const [agent, setAgent] = useState<AgentId>("claude")
  const url = target === "local" ? info.mcp.localUrl : info.mcp.publicUrl
  const snippets = snippetsFor(agent, target, url, info.mcp.localOpen)
  const needsToken = target === "remote" || !info.mcp.localOpen
  const moveAgent = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = AGENTS[(i + d + AGENTS.length) % AGENTS.length]
    setAgent(next.id)
    const grid = e.currentTarget.parentElement
    requestAnimationFrame(() => grid?.querySelector<HTMLElement>(`[data-agent="${next.id}"]`)?.focus())
  }
  return (
    <div className="space-y-4">
      <Group>
        <SettingRow id="mcp-agents" label="에이전트 연결(MCP)" stack info={<>
          <p>에이전트를 고르면 그 에이전트에 붙여 넣을 한 줄이 나와요. 붙이면 에이전트가 방향판의 일·문서를 찾고 읽고 고칠 수 있어요.</p>
          <p>GOAT·Aside 는 따로 정한 형식이 없어 URL 과 헤더를 그 앱의 MCP 추가 화면에 넣어요.</p>
        </>}>
          <div role="radiogroup" aria-label="에이전트" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {AGENTS.map((a, i) => (
              <button key={a.id} type="button" role="radio" aria-checked={agent === a.id} data-agent={a.id} tabIndex={agent === a.id ? 0 : -1}
                onClick={() => setAgent(a.id)} onKeyDown={(e) => moveAgent(e, i)}
                className={cn("flex min-w-0 items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", agent === a.id && "border-foreground/40 bg-muted")}>
                <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground/90 font-mono text-2xs font-semibold text-background">{AGENT_MARK[a.id]}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{a.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow id="mcp-url" label="어디서 붙나요" stack info={<>
          <p><b>이 Mac</b>: 같은 Mac 에서 도는 에이전트용 주소예요. {info.mcp.localOpen ? "루프백에서 인증 없이 열려 있어요." : "이 서버는 로컬 무인증이 꺼져 있어 연결 토큰이 필요해요."}</p>
          <p><b>원격</b>: 다른 기기의 에이전트용 공개 주소예요. Cloudflare Access 뒤라 Access 서비스 토큰 두 헤더(<code>CF-Access-Client-Id</code>·<code>CF-Access-Client-Secret</code>)와, Access 앱에 Service Auth 정책이 필요해요. 없으면 Access 로그인으로 돌아가요(302).</p>
        </>}>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="연결 위치" value={target} onChange={setTarget} options={[{ value: "local", label: "이 Mac" }, { value: "remote", label: "원격" }]} />
            <code className="min-w-0 truncate rounded bg-muted px-2 py-1 font-mono text-xs">{url}</code>
            <CopyButton text={url} label="MCP 주소 복사" />
          </div>
          {info.mcp.readonly && <p className="text-xs text-muted-foreground">이 서버는 읽기 전용 MCP 예요(쓰기 도구 숨김).</p>}
          <div className="space-y-2">
            {snippets.map((s) => <CodeBlock key={s.label} label={s.label} code={s.code} />)}
          </div>
          {needsToken && (
            <p className="text-xs text-muted-foreground">
              조각에는 토큰 원문 대신 환경변수 이름만 있어요(연결 토큰은 아래에서 만들어요): <code className="font-mono">{TOKEN_ENV}</code>{target === "remote" && <>, <code className="font-mono">{CF_ID_ENV}</code>, <code className="font-mono">{CF_SECRET_ENV}</code></>}.
              {agent === "claude" && " Claude Code 는 추가할 때 값을 읽어 저장하고, 일부 버전은 claude mcp get 에서 헤더를 보여줘요."}
              {agent === "cursor" && " Cursor 는 터미널에서 연 경우에만 셸 환경변수를 읽어요."}
            </p>
          )}
        </SettingRow>
      </Group>
      <Group>
        <TokensRow info={info} />
        <CheckRow info={info} />
      </Group>
    </div>
  )
}

function CheckRow({ info }: { info: SettingsInfo }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<McpCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setError(null)
    try { setResult(await api<McpCheck>("/api/mcp/check", { method: "POST", body: "{}" })) }
    catch (e) { setResult(null); setError(e instanceof Error ? e.message : "확인하지 못했어요") }
    finally { setBusy(false) }
  }
  return (
    <SettingRow id="mcp-check" label="연결 확인" info={<p>서버가 이 Mac 의 /mcp 에 실제로 initialize → tools/list 를 보내 봐요. 원격 경로(Cloudflare)까지는 확인하지 않아요.</p>}>
      <span role="status" aria-live="polite" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        {busy ? <><Loader2 className="size-4 animate-spin" />확인 중</>
          : result ? (result.ok
            ? <><CircleCheck className="size-4 text-done-foreground" />도구 {result.tools}개 · {result.ms}ms · {ago(result.checkedAt)}</>
            : <><CircleX className="size-4 text-destructive" />{result.step} 실패: {result.error}</>)
          : error ? <><CircleX className="size-4 text-destructive" />{error}</> : null}
      </span>
      <Button variant="outline" size="sm" disabled={busy || !info.macOwner || info.me.agent} onClick={() => void run()}><PlugZap />연결 확인</Button>
    </SettingRow>
  )
}
