// 에이전트별 MCP 연결 조각. 토큰 원문은 넣지 않고 환경변수 이름만 써요(AGENT_TOKEN 은 어디에도 나오지 않아요).
// 형식 근거: devlog/_plan/261107_settings_panel/000_plan.md §리서치 근거(Claude Code·Codex·Cursor 공식 안내, Linear MCP 안내).

export type AgentId = "claude" | "codex" | "cursor" | "goat" | "aside" | "other"
export type Target = "local" | "remote"
export type Snippet = { label: string; lang: "sh" | "toml" | "json" | "text"; code: string }

export const AGENTS: readonly { id: AgentId; name: string; hint: string }[] = [
  { id: "claude", name: "Claude Code", hint: "명령 한 줄" },
  { id: "codex", name: "Codex", hint: "config.toml" },
  { id: "cursor", name: "Cursor", hint: "mcp.json" },
  { id: "goat", name: "GOAT", hint: "URL + 헤더" },
  { id: "aside", name: "Aside", hint: "URL + 헤더" },
  { id: "other", name: "기타", hint: "URL + 헤더" },
]

export const SERVER_NAME = "direction"
export const TOKEN_ENV = "DIRECTION_TOKEN"
export const CF_ID_ENV = "CF_ACCESS_CLIENT_ID"
export const CF_SECRET_ENV = "CF_ACCESS_CLIENT_SECRET"

type Header = { name: string; env: string; bearer?: boolean }

/** 이 맥에서 로컬 /mcp 가 무인증으로 열려 있으면 헤더가 없어요. 원격은 Bearer + Access 서비스 토큰 두 헤더 */
export function headersFor(target: Target, localOpen: boolean): Header[] {
  if (target === "local") return localOpen ? [] : [{ name: "Authorization", env: TOKEN_ENV, bearer: true }]
  return [
    { name: "Authorization", env: TOKEN_ENV, bearer: true },
    { name: "CF-Access-Client-Id", env: CF_ID_ENV },
    { name: "CF-Access-Client-Secret", env: CF_SECRET_ENV },
  ]
}

const shValue = (h: Header) => `${h.bearer ? "Bearer " : ""}$${h.env}`

export function snippetsFor(agent: AgentId, target: Target, url: string, localOpen: boolean): Snippet[] {
  const headers = headersFor(target, localOpen)
  switch (agent) {
    case "claude": {
      const lines = [`claude mcp add --transport http --scope user ${SERVER_NAME} ${url}`, ...headers.map((h) => `  --header "${h.name}: ${shValue(h)}"`)]
      return [{ label: "터미널", lang: "sh", code: lines.join(" \\\n") }]
    }
    case "codex": {
      const bearer = headers.find((h) => h.bearer)
      const extra = headers.filter((h) => !h.bearer)
      const toml = [
        `[mcp_servers.${SERVER_NAME}]`,
        `url = "${url}"`,
        ...(bearer ? [`bearer_token_env_var = "${bearer.env}"`] : []),
        ...(extra.length ? [`env_http_headers = { ${extra.map((h) => `"${h.name}" = "${h.env}"`).join(", ")} }`] : []),
      ].join("\n")
      const cmd = [`codex mcp add ${SERVER_NAME} --url ${url}`, ...(bearer ? [`--bearer-token-env-var ${bearer.env}`] : [])].join(" ")
      return extra.length
        ? [{ label: "~/.codex/config.toml", lang: "toml", code: toml }]
        : [{ label: "터미널", lang: "sh", code: cmd }, { label: "또는 ~/.codex/config.toml", lang: "toml", code: toml }]
    }
    case "cursor": {
      const server: Record<string, unknown> = { url }
      if (headers.length) server.headers = Object.fromEntries(headers.map((h) => [h.name, `${h.bearer ? "Bearer " : ""}\${env:${h.env}}`]))
      return [{ label: "~/.cursor/mcp.json", lang: "json", code: JSON.stringify({ mcpServers: { [SERVER_NAME]: server } }, null, 2) }]
    }
    default: {
      const lines = [`이름     ${SERVER_NAME}`, `전송     Streamable HTTP`, `URL      ${url}`, ...(headers.length ? headers.map((h) => `헤더     ${h.name}: ${shValue(h)}`) : ["헤더     없음"])]
      return [{ label: "연결 정보", lang: "text", code: lines.join("\n") }]
    }
  }
}
