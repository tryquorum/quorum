# Quorum 계약 v1

모든 레인이 이 계약을 따라요. 바꾸려면 통합 담당에게 알리고 이 파일을 먼저 고쳐요. 타입 원본: src/contract.ts.

## 이벤트

한 번의 실행(run)은 순서 있는 이벤트 흐름이에요.

```ts
type QuorumEvent = {
  runId: string; seq: number; at: string;        // ISO
  mode: "live" | "replay";
  type: EventType; actor: string;                 // "council", "bot:ceo", "aside", "codex", "gbrain", "board", "recipe:luma-blasts"
  text: string;                                   // 사람이 읽는 한 줄
  data?: Record<string, unknown>;
};
type EventType =
  | "run.start" | "recall" | "proposal" | "critique" | "verdict"
  | "execute.start" | "execute.result"
  | "recipe.run" | "recipe.broken" | "recipe.repaired"
  | "memory.saved" | "board.posted" | "run.end" | "error";
```

- proposal.data: { proposalId, title, executor: "aside" | "codex" | "board" | "none", why }
- critique.data: { proposalId, role: "ceo" | "reviewer" | "qa" | "cso", stance: "keep" | "cut" | "escalate", reason }
- verdict.data: { proposalId, decision: "pass" | "hold" | "reject", reason, reusedFrom?: string }  (reusedFrom = gbrain 판정 id)
- recall.data: { hits: { id, summary, decision, score }[] }
- recipe.*.data: { recipeId, version, endpoint, status?, reason? }

## HTTP (기본 포트 4317)

| 메서드·경로 | 설명 |
|---|---|
| GET /api/health | { ok, version, executors: { aside, codex, gbrain, board } } 각 도구 사용 가능 여부 |
| POST /api/runs | body { request: string, mode?: "live" \| "replay", replayId?: string } → { runId } |
| GET /api/runs | 최근 실행 목록 { runId, request, mode, startedAt, status }[] |
| GET /api/runs/:id/events | SSE. 각 메시지 data = QuorumEvent JSON. 끝나면 event: done |
| GET /api/recipes | 레시피 목록과 현재 버전 |
| POST /api/recipes/:id/run | 레시피 실행(깨지면 수리 시도). 이벤트를 run으로 남기고 { runId } |
| GET /api/memory?q= | gbrain 검색 결과 |

정적 파일: site/ 를 / 에서 제공해요. 랜딩은 /, 의회 콘솔은 /app.

## 실행기

- 봇(제안·반박): `aside exec --json` (env QUORUM_BOT_RUNNER=aside 기본, codex도 가능: `codex exec`).
- 브라우저 일: `aside exec` 또는 정해진 단계는 `aside repl --file`.
- 코딩 일: `codex exec`를 .quorum/sandbox/<runId> 작업 폴더에서 실행.
- 기억: gbrain CLI(`gbrain put`/`search`), 실패하면 error 이벤트로 드러내요(조용히 건너뛰지 않음).
- 방향판: 읽기 MCP/REST, 쓰기는 QUORUM_BOARD_WRITE=1.
