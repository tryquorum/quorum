# Quorum

Quorum은 여러 봇이 할 일을 제안하고 서로 반박해서 필요한 일만 통과시키는 에이전트 의회예요. 통과한 브라우저 일은 Aside가, 코딩 일은 Codex CLI가 실행하고, gbrain이 판정을 기억해요. 사람은 방향판에서 결과와 승인 대기를 봐요. 스펙: docs/spec.pdf, 계약: docs/contract.md, 레인: docs/lanes.md.

## 해커톤 규칙 (c0mpiled-17 Seoul, 2026-11-09)

- board/ 는 방향판(direction-board, 2ee6e8a) 코드예요. 먼저 읽고 최대한 가져다 쓰고, 복사해서 Quorum에 맞게 더 낫게 고쳐요. 출처는 README에 적혀 있어요.
- Aside, gbrain(MIT), gstack(MIT), 방향판은 외부 도구예요. README에 출처를 밝혀요.
- force-push, 이력 재작성 금지. 레인 브랜치에만 커밋하고 main 병합은 통합 담당(최상위 스레드)이 해요.

## 안전

- 비밀값(.env, 토큰)은 커밋하지 않아요. 로컬 상태는 .quorum/ (gitignore)에 둬요.
- 방향판 실제 DB(~/Developer/direction-board/data)를 직접 열지 않아요. 방향판에는 REST/MCP로만 붙고, 쓰기는 QUORUM_BOARD_WRITE=1일 때만 해요.
- aside exec는 유료 세션이에요. 테스트에서 호출하지 말고, 실행기(executor) 경계 뒤로 숨겨 실제 데모 경로에서만 불러요.
- 가짜 성공 금지. 기록된 실행을 다시 보여 줄 때는 화면과 이벤트에 mode: "replay"를 표시해요.

## 개발

- Bun 1.4.4+, 의존성 최소화(가능하면 0). TypeScript.
- `bun run dev` 서버(기본 포트 4317), `bun test` 테스트.
- 검증하지 않은 것은 보고에 NOT RUN으로 적어요.
