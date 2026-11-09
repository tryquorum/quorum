# 모바일

모바일 앱은 `apps/mobile/` 워크스페이스에 있어요. 화면과 API 호출은 `apps/mobile/src/`, Cloudflare Access 로그인 상태는 `apps/mobile/src/auth.tsx`·`apps/mobile/src/api/session.ts`, 서버 쪽 로그인 경로는 `apps/server/server/mobile-auth.ts`, iOS 빌드 도구는 `apps/mobile/scripts/`에 있어요. 사용자 연결 안내는 [모바일](../docs/user/mobile.md)에 있어요.

## 화면 구조

> Decision record: [ADR-0010](decisions/ADR-0010-mobile-ia.md)

탭과 탭마다의 쌓기, 공용 상세 라우트, 딥링크는 `apps/mobile/src/navigation/`(라우트 이름·인자 원본 `routes.ts`, 탭 구성 `tabs.ts`, 딥링크 `linking.ts`)에 있어요. 하단 필은 `apps/mobile/src/TabPill.tsx` 예요. 공용 화면 부품(스크롤 화면, 묶음·행, 칩, 시트, 빈·로딩·오류, 토스트, 아래 입력 줄)과 색·글자 값은 `apps/mobile/src/ui/`에 있고, 색은 공유 디자인 토큰([계약](contracts.md#디자인-토큰))에서 가져와요. 읽기 캐시·낙관적 쓰기·409 는 `apps/mobile/src/api/query.ts`(순수 규칙 `queryStore.ts`), 판·사건 읽기와 할 일 저장은 `apps/mobile/src/api/board.ts` 예요. 노트 읽기 렌더·저장 상태 기계·허용 문법·초안 보관은 `apps/mobile/src/notes/`, 그 편집 가능 판정은 서버 `apps/server/server/docs/ops.ts`(`markdownEditable`)와 `note-model.ts` 예요. 화면은 기능별 `apps/mobile/src/features/<board|docs|ai|search|settings>/`에 있고 각 폴더의 `screens.tsx`가 자기 라우트를 등록해요. AI 대화 요청은 `apps/mobile/src/api/runs.ts`, 운영 순회 요청과 폴러는 `apps/mobile/src/api/ops.ts`(순수 규칙 `opsStore.ts`), 연결 토큰·연결 확인은 `apps/mobile/src/api/connections.ts`, 앱 설정(테마·시작 탭·기본 모델) 파일은 `apps/mobile/src/features/settings/prefs.ts` 예요. 설정은 탭이 아니라 루트 쌓기의 `Settings` 안 쌓기예요. 설계와 이유는 [모바일 IA](../docs/internals/mobile-ia.md), 레인별 담당은 [iOS 동등 로드맵](../devlog/_plan/261107_ios_parity/000_roadmap.md)이에요.

## iOS 앱

> Decision record: [ADR-0006](decisions/ADR-0006-ios.md)
