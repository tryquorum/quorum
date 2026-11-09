// 설정 › 연결: 연결 토큰(GET/POST/DELETE /api/mcp-tokens)과 연결 확인(POST /api/mcp/check). 맥 주인 사람만(서버가 403).
import type { McpCheck, McpTokenCreated, McpTokenList } from '@direction-board/contracts'
import { request, type ScopedClient } from './client'

export const connectionsApi = {
  tokens: (origin: string) => request<McpTokenList>(origin, '/api/mcp-tokens'),
  /** 원문(secret)은 이 응답에만 있어요. 화면 상태에만 두고 파일·로그에 쓰지 않아요 */
  create: (s: ScopedClient, name: string) => s.write<McpTokenCreated>('/api/mcp-tokens', 'POST', { name }),
  revoke: (s: ScopedClient, id: string) => s.write<unknown>(`/api/mcp-tokens/${encodeURIComponent(id)}`, 'DELETE'),
  check: (s: ScopedClient) => s.write<McpCheck>('/api/mcp/check', 'POST', {}),
}
