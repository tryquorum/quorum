# 로컬 상태

`apps/server/server.ts`는 기본 DB 경로와 거울 경로를 정해요. `apps/server/server/vault/`는 DB에서 마크다운 거울을 만들어요. 실사용 `data/`는 테스트 대상이 아니며 쓰기 실험에는 격리된 복사본이나 메모리 DB를 사용해요.
