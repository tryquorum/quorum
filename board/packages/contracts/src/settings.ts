// 설정창 계약. 서버 GET /api/settings, POST /api/mcp/check 와 연결별 토큰(/api/mcp-tokens)이 이 타입을 돌려줘요.
// 웹(apps/web/src/components/settings)과 모바일(apps/mobile/src/SettingsScreen.tsx)이 같은 타입을 읽어요.

/** 지금 요청이 들어온 리스너. local 은 이 맥 전용(PORT), public 은 Cloudflare 터널이 붙는 리스너예요 */
export type SettingsListener = 'local' | 'public'

export type SettingsInfo = {
  me: { email: string; agent: boolean }
  /**
   * 이 서버가 지키는 멱등 약속(앱의 복구가 자동으로 다시 보내도 되는지의 명시 증거). 옛 서버는 없어요 → 앱은 자동 재전송하지 않아요.
   * runClientKey: POST /api/runs 의 clientKey(같은 키는 한 실행), noteOnceKey: docs write 의 onceKey(같은 키는 한 번)
   */
  capabilities?: string[]
  listener: SettingsListener
  /** 맥 주인(로컬 리스너 또는 공개의 맥 주인 계정). 경로와 토큰 관리는 맥 주인에게만 열려요 */
  macOwner: boolean
  version: string
  commit: string | null
  mcp: {
    /** 이 맥의 에이전트가 붙는 주소: http://127.0.0.1:<PORT>/mcp */
    localUrl: string
    /** 원격 에이전트가 붙는 주소: <PUBLIC_ORIGIN>/mcp (Cloudflare Access 뒤) */
    publicUrl: string
    /** 로컬 /mcp 가 루프백에서 인증 없이 열려 있는지(DEV_LOCAL_USER 와 루프백 HOST) */
    localOpen: boolean
    /** BOARD_MCP_READONLY=1 이면 쓰기 도구를 감춰요 */
    readonly: boolean
  }
  /** 맥 주인에게만 보여요. 읽기 전용 */
  paths: { db: string; vault: string } | null
}

/** 연결별 MCP 토큰. 서버는 해시만 저장하고 원문(secret)은 만들 때 한 번만 돌려줘요 */
export type McpToken = {
  id: string
  name: string
  /** 원문 앞부분(dbt_xxxxxx). 어떤 토큰인지 알아보는 용도 */
  prefix: string
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}
export type McpTokenList = { tokens: McpToken[] }
export type McpTokenCreated = { token: McpToken; secret: string }

/** POST /api/mcp/check: 서버가 자기 로컬 리스너 /mcp 에 initialize → tools/list 를 실제로 보낸 결과 */
export type McpCheck = {
  ok: boolean
  /** 실패한 단계. 성공이면 null */
  step: 'initialize' | 'tools/list' | null
  tools: number
  ms: number
  error: string | null
  checkedAt: number
}
