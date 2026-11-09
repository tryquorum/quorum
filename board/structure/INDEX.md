# 구조 색인

`manifest.json`에서 손으로 만든 읽는 순서와 원본 지도예요. 구조가 바뀌면 manifest와 함께 고쳐요.

## 읽는 순서

- 1. [전체 구조](overview.md): 제품 경계와 원본
- 2. [계약](contracts.md): 문서와 웹 계약 및 워크스페이스
- 3. [서버](server.md): 서버 입구와 중복 처리
- 4. [웹](web.md): 웹 진입과 대화
- 4. [모바일](mobile.md): 모바일 앱, 정보 구조와 빌드 도구
- 5. [로컬 상태](local-state.md): DB와 거울

## 원본 → 문서

- `apps/server/server.ts` → [전체 구조](overview.md), [서버](server.md), [로컬 상태](local-state.md)
- `apps/server/server/` → [전체 구조](overview.md)
- `apps/web/` → [전체 구조](overview.md)
- `packages/contracts/src/docs.ts` → [계약](contracts.md)
- `apps/web/src/lib/api.ts` → [계약](contracts.md)
- `package.json` → [계약](contracts.md)
- `packages/contracts/src/` → [계약](contracts.md)
- `packages/design-tokens/src/` → [계약](contracts.md)
- `apps/mobile/` → [모바일](mobile.md)
- `apps/mobile/src/` → [모바일](mobile.md)
- `apps/mobile/scripts/` → [모바일](mobile.md)
- `apps/mobile/src/navigation/` → [모바일](mobile.md)
- `apps/mobile/src/ui/` → [모바일](mobile.md)
- `apps/mobile/src/api/query.ts` → [모바일](mobile.md)
- `apps/mobile/src/notes/` → [모바일](mobile.md)
- `apps/server/server/signals.ts` → [서버](server.md)
- `apps/server/server/ops.ts` → [서버](server.md)
- `apps/server/server/runs.ts` → [서버](server.md)
- `apps/server/server/mcp/handler.ts` → [서버](server.md)
- `apps/server/server/actions.ts` → [서버](server.md)
- `apps/server/server/dedup.ts` → [서버](server.md)
- `apps/server/server/settings.ts` → [서버](server.md)
- `apps/server/server/spaces.ts` → [서버](server.md)
- `apps/server/server/pilot.ts` → [서버](server.md)
- `apps/server/server/google-auth.ts` → [서버](server.md)
- `apps/server/server/access.ts` → [서버](server.md)
- `apps/server/server/issues.ts` → [서버](server.md)
- `apps/web/src/App.tsx` → [웹](web.md)
- `apps/web/src/components/command-dock.tsx` → [웹](web.md)
- `apps/web/src/components/settings/` → [웹](web.md)
- `apps/server/server/vault/` → [로컬 상태](local-state.md)

## 결정

- [문서 층](decisions/ADR-0001-document-layer.md) → [overview.md](overview.md)
- [메타데이터](decisions/ADR-0002-metadata.md) → [contracts.md](contracts.md)
- [같은 일](decisions/ADR-0003-dedup.md) → [server.md](server.md)
- [대화 기본값](decisions/ADR-0004-new-conversation.md) → [web.md](web.md)
- [워크스페이스](decisions/ADR-0005-monorepo.md) → [contracts.md](contracts.md)
- [iOS 앱](decisions/ADR-0006-ios.md) → [mobile.md](mobile.md)
- [MCP 연결 토큰](decisions/ADR-0007-mcp-tokens.md) → [server.md](server.md)
- [문서 계층](decisions/ADR-0008-doc-hierarchy.md) → [contracts.md](contracts.md)
- [iOS 정보 구조](decisions/ADR-0010-mobile-ia.md) → [mobile.md](mobile.md)
- [할 일 공간](decisions/ADR-0011-spaces.md) → [server.md](server.md)
- [파일럿 Google 로그인](decisions/ADR-0012-pilot-google-login.md) → [server.md](server.md)
