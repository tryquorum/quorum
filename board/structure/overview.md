# 전체 구조

`apps/server/server.ts`는 서버 진입점이고 `apps/server/server/`는 도메인·문서·거울·MCP를 담당해요. `apps/web/`은 React 화면, `apps/mobile/`은 iOS 앱, `packages/contracts/`는 셋이 함께 쓰는 계약이에요. 서버 SQLite가 원본이며 거울은 단방향 사본이에요. 이동 기록은 [이동 계획](../devlog/_plan/261106_monorepo/README.md)에 있어요.

## 문서 층

> Decision record: [ADR-0001](decisions/ADR-0001-document-layer.md)
