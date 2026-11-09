# 서버

`apps/server/server.ts`는 인증과 HTTP를 받고 `apps/server/server/signals.ts`, `apps/server/server/ops.ts`, `apps/server/server/runs.ts`가 각 도메인을 맡아요. `apps/server/server/mcp/handler.ts`와 `apps/server/server/actions.ts`는 에이전트의 입구예요.

## 같은 일

`apps/server/server/dedup.ts`는 AI 동작과 운영 보고에서 중복 할 일을 막아요.

> Decision record: [ADR-0003](decisions/ADR-0003-dedup.md)

## 설정과 MCP 연결 토큰

`apps/server/server/settings.ts`는 설정창이 읽는 `GET /api/settings`와 로컬 /mcp 연결 확인(`POST /api/mcp/check`)을 맡아요. 연결별 MCP 토큰의 설계는 [MCP 연결 토큰](../docs/internals/mcp-tokens.md)이에요.

> Decision record: [ADR-0007](decisions/ADR-0007-mcp-tokens.md)

## 공간

`apps/server/server/spaces.ts`는 할 일·사건의 공간(개인·워크스페이스)과 `/api/spaces`를 맡아요. 항목 쓰기·`/api/act`·운영 순회·사건·문서 검색이 같은 `resolveSpace`를 써요. 설계는 [공간](../docs/internals/spaces.md)이에요.

> Decision record: [ADR-0011](decisions/ADR-0011-spaces.md)

## 파일럿 로그인과 이슈

`AUTH_MODE=google` 서버에서 `apps/server/server/pilot.ts`가 `apps/server/server/google-auth.ts`(Google 로그인·세션), `apps/server/server/access.ts`(허용 목록·역할·감사), `apps/server/server/issues.ts`(이슈 보내기)를 묶고 멤버가 부를 수 있는 API 를 정해요. 설계는 [파일럿](../docs/internals/pilot.md)이에요.

> Decision record: [ADR-0012](decisions/ADR-0012-pilot-google-login.md)
