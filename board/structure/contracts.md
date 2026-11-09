# 계약

`packages/contracts/src/docs.ts`는 문서 연산·버전·메타데이터의 계약이고, `packages/contracts/src/api.ts`는 보드·사건·실행 API 응답 타입, `packages/contracts/src/order.ts`는 할 일·목표·사건 공용 정렬과 목표 진행률(`GoalProgress`)·상태(`GoalState`) 계산 규칙이에요. 웹과 iOS 가 같은 판단을 하도록 순수 로직도 여기 둬요: 모델 카탈로그·고르기(`models.ts`), 설정 섹션·항목·검색(`settings-registry.ts`), 검색의 할 일·사건 결과(`palette.ts`·`palette-rank.ts`), 운영 순회 표시(`ops-labels.ts`)·지시문 조각(`ops-prompt.ts`), MCP 연결 조각(`mcp-snippets.ts`), AI 실행 문구(`run-labels.ts`). 서버는 `@direction-board/contracts`·`@direction-board/contracts/docs`, 웹은 `apps/web/src/lib/api.ts`·`docs-api.ts`에서, 모바일은 `apps/mobile/src/api/`에서 이 패키지를 import 해요. 여러 입구에서 계약을 바꿀 때 호환성을 함께 확인해요.

## 디자인 토큰

`packages/design-tokens/src/`는 색(라이트·다크)·글자·간격·반경·층·모션 값의 원본이에요. 웹은 `apps/web/src/index.css` 의 CSS 변수에 같은 값을 적고 패키지 시험이 맞는지 봐요. 모바일은 `apps/mobile/src/common.tsx`에서 import 해요. 사용 규칙은 [디자인 코어](../docs/internals/design-core.md)예요.

> Decision record: [ADR-0009](decisions/ADR-0009-design-tokens.md)

## 메타데이터

> Decision record: [ADR-0002](decisions/ADR-0002-metadata.md)

## 워크스페이스

`package.json`의 Bun 워크스페이스는 `apps/*`(server·web·mobile)와 `packages/*`(contracts·design-tokens)예요. 의존성 잠금은 루트 `bun.lock` 하나예요.

> Decision record: [ADR-0005](decisions/ADR-0005-monorepo.md)

## 문서 계층

독립 문서는 `parent` 로 부모를 가져요. 계약 변경은 더하기만이고, 이동은 `DocsOps.move` 하나로 REST·`/api/act`·MCP 가 함께 써요. 설계는 [문서 계층](../docs/internals/doc-hierarchy.md)이에요.

> Decision record: [ADR-0008](decisions/ADR-0008-doc-hierarchy.md)
