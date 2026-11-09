# 웹

`apps/web/src/App.tsx`는 React 화면을 조합해요. `apps/web/src/components/command-dock.tsx`는 어디서나 AI에 묻는 입구예요. 왼쪽 사이드바의 목표 섹션은 `apps/web/src/components/goal-sidebar.tsx`에 있고, 목표를 열면 `apps/web/src/components/goal-view.tsx`가 진행률 바·다음 행동·하위 할 일 목록·빠른 할 일 추가를 보여줘요.

문서 목록(`#/docs`)은 `apps/web/src/components/docs-view.tsx`가 검색·필터·쪽 읽기를 맡고, Finder 식 보기 4종(아이콘·목록·열·갤러리)과 빠른 미리보기·제목 바로 고치기는 `apps/web/src/components/docs-views/`에 있어요. 보기 상태는 `apps/web/src/lib/docs-view-state.ts`, 설계는 [문서 층 13절](../docs/internals/docs-layer.md)이에요. 문서 계층 화면은 사이드바 트리 `apps/web/src/components/doc-tree-nav.tsx`, 문서 페이지 머리의 브레드크럼·⋯ 메뉴 `doc-crumbs.tsx`, 이동 대화상자 `doc-move.tsx`(App 의 `DocMoveProvider`), 열 보기 폴더 축 `docs-views/column-axes.ts`, 순수 함수 `lib/doc-tree.ts` 예요(설계 [문서 계층](../docs/internals/doc-hierarchy.md)). 새 문서 한 줄·상세 시트·+ 버튼은 `apps/web/src/components/doc-create.tsx`(App 의 `DocCreateProvider` 가 시트 하나를 둬요), 만들기 단계와 같은 제목 판정은 `apps/web/src/lib/doc-create.ts` 예요.

단축키는 `apps/web/src/lib/shortcuts.ts` 레지스트리 한 곳에서 정해요. 전역 키는 `apps/web/src/components/shortcut-dispatch.tsx` 의 창 하나 디스패처가 `useShortcut(id, 처리기)` 로 나눠 주고, 도움말 패널(`shortcut-help.tsx`)과 [사용자 표](../docs/user/shortcuts.md)도 같은 목록에서 나와요.

색·글자·포커스 같은 화면 값은 `apps/web/src/index.css` 의 CSS 변수가 공유 토큰([계약](contracts.md#디자인-토큰))과 같은 값을 써요. 규칙은 [디자인 코어](../docs/internals/design-core.md)예요.

설정창(`#/settings`)은 `apps/web/src/components/settings/`에 있고, 섹션·항목과 ⌘K 검색의 "설정" 그룹은 `apps/web/src/lib/settings-registry.ts` 한 파일을 읽어요. 에이전트별 MCP 연결 조각은 `apps/web/src/lib/mcp-snippets.ts`예요.

## 대화 기본값

> Decision record: [ADR-0004](decisions/ADR-0004-new-conversation.md)
