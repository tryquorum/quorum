# MCP

문서 부모와 이동 규칙은 [문서 계층 설계](doc-hierarchy.md)를 따릅니다.

`/mcp`는 REST와 같은 문서 연산을 호출하는 별도 입구예요. Aside 실행은 REST를 쓰고 MCP 클라이언트는 다음 일곱 도구를 써요: `board_search`, `board_fetch`, `board_related`, `board_schema`, `board_act`, `board_write`, `board_archive`. `board_act`는 `/api/act`의 동작 묶음과 같은 뜻이에요. 변경 전에 읽고 버전을 확인해야 사람 글을 보호할 수 있어요.

[핸들러](../../apps/server/server/mcp/handler.ts)는 실제 루프백 연결 또는 Bearer 인증(`AGENT_TOKEN`이나 [연결 토큰](mcp-tokens.md))을 확인해요. 에이전트에 붙이는 조각은 웹 설정 › 연결에서 복사해요. `BOARD_MCP_READONLY=1`이면 쓰기 도구를 감춰요. 리소스와 오류 형식은 [설계](docs-layer.md)를 보세요.
