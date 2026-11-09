# 코드 품질

이행 중인 품질 검사는 oxlint와 저장소 규칙, 파일 크기 예산, knip을 함께 써요. 규칙 이름은 `direction-board/code-budget`, `direction-board/no-live-data-path`, `direction-board/no-hardcoded-origin`, `direction-board/no-direct-fetch`예요. 예산은 `tools/oxlint-plugin-direction-board/code-budgets.json`, 예외는 `tools/oxlint-plugin-direction-board/backlogs.json`에서 관리할 예정이에요. 해당 도구는 다른 레인에서 만드는 중이므로 통합 후 실제 설정과 실행 결과를 확인해요.

예산 초과는 책임 경계에 맞춰 나누고, 불가피한 예외는 이유와 범위를 남겨요. 검사를 통과시키려고 실패를 숨기지 않아요.
