# 레인

| 레인 | 기기 | 브랜치 | 소유 경로 |
|---|---|---|---|
| site | linux | lane/site | site/** |
| engine | 이 맥(Aside 세션) | lane/engine | src/engine/**, src/server.ts, src/executors/** |
| recipes | clisu-oracle | lane/recipes | src/recipes/**, docs/recipes.md |
| 통합 | 최상위 스레드 | main | src/contract.ts, docs/**, README, 병합 |

다른 레인 경로는 고치지 말고, 계약 변경이 필요하면 origin.report로 알려요.
