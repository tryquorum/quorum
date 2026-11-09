# Hosted lane 로드맵 (lane/hosted)

목표: 심사위원이 **자기 Aside만 연결해서** Quorum 을 바로 써요. 단계 1은 자기 맥에서 `bun run dev`, 단계 2는 quorum.lidgeai.com 에서 사람마다 따로.
배포(main 병합·서버 재시작·Access 정책)는 통합 스레드가 해요. 이 레인은 lane/hosted 에만 커밋·푸시해요.

## 설계 결정 (사이클 0에서 고정)

| 주제 | 결정 | 이유 |
|---|---|---|
| 사용자 | 공개 리스너는 Access JWT 이메일, `/mcp` 는 그 사람 연결 토큰(Bearer)도 받아요. 로컬 4317 은 언제나 소유자 | 토큰 주인 = 사용자. 로컬 리스너는 이 맥 안 요청만 들어와요(local-guard) |
| 소유자 | `QUORUM_OWNER_EMAIL` 한 명만 이 맥의 실행기(aside·codex·방향판·3070·레시피·gbrain)를 써요. 비어 있으면 공개 리스너에는 소유자가 없어요(fail closed) | 남의 요청이 jun 의 브라우저·계정에서 도는 길을 0 으로 |
| 테넌시 | 비소유자마다 `.quorum/tenants/<sha256(email) 24자>/` 에 자기 `quorum.db`(엔진)·`workspace.db`(사건·항목·노트·대기열·기억)를 따로 열어요. 소유자는 지금 파일 그대로 | 조회마다 owner 조건을 다는 것보다 구조로 막아요: 다른 사람 DB 를 여는 코드 경로가 없어요. runId·사건 id 를 알아도 다른 DB 에서는 404 |
| 연결 토큰 | 방향판 `mcp-tokens.ts` 를 가져와요(`qmcp_` 접두사, 원문 한 번만, SHA-256 해시, 이름·마지막 사용·폐기). 목록·폐기는 자기 토큰만. `.quorum/hosted.db` | 이미 감사받은 구현 |
| 실행 방향 | 비소유자의 통과·승인된 브라우저 일은 그 사람의 대기열로. 그 사람 Aside 가 MCP `quorum_next_task`(리스) → `quorum_report_result`(멱등) 로 가져가 실행·보고 | 서버는 비소유자 대신 aside exec·codex 를 절대 안 돌려요 |
| 봇 의견(비소유자) | 기본 `client`: 의견 7개도 그 사람 대기열의 `opinion` 일로 넣고 그 사람 Aside 가 답해요. 선택 `api`: OpenAI 호환 chat completions(도구 없음, 키는 서버 env) + 사용자별 시간당 의회 5회 | codex exec 는 read-only 샌드박스여도 이 맥 파일을 읽고 jun 의 MCP 설정을 실어요 → 비소유자에게 쓰면 유출 경로. 자세한 비교는 docs/hosted/README.md |
| 기억 | 소유자는 gbrain, 비소유자는 자기 workspace.db 의 판정 표만(이름공간을 나누지 않고 파일을 나눠요) | 다른 사람 판정이 섞이지 않아요 |
| Aside 연결 | Aside 설정 `mcp.servers` 의 `streamable-http` + `auth.type: headers` 형식(이 맥의 ~/.aside/u/0/settings.json 에서 GOAT 서버 항목으로 확인) | 지어내지 않기 |
| Access | `/mcp` 는 Access 앞단 우회(Bypass)가 필요해요(Aside 는 Access 로그인을 못 해요). 서버가 Bearer 토큰으로 막아요 | 통합 스레드 배포 체크리스트 |
| 계약 | 이벤트 종류에 `info` 를 더해요(기억 꺼짐 등 오류 아닌 알림). 통합 스레드에 보고 | "memory off 는 오류가 아니에요" |

## 사이클

| # | 범위 | 완료 증거 |
|---|---|---|
| 0 | 이 문서 | 커밋·푸시 |
| 1 | 단계 1 서버: Aside 계정 자동 감지(`aside account list --json`), health 상세(이유·설치 안내), 3070 가져오기 opt-in(`QUORUM_BOARD_IMPORT_URL`), 방향판 맥락은 닿을 때만, gbrain 없으면 `info` memory off, codex 없으면 제안에서 뺌, 빈 Workspace 에 데모 항목 1개, `bun run dev -- --open` | 실패 먼저 → 통과 시험, bun test, tsc |
| 2 | 단계 1 화면·문서: /w 연결 카드(Aside 이메일·gbrain·codex·비용 안내), README 맨 위 "Run it with your own Aside" | 웹 tsc·빌드, 화면 확인 |
| 3 | 단계 2 테넌시: tenants 레지스트리, 소유자 게이트, 요청마다 테넌트 고르기(/api/runs·SSE·memory·ws·recipes·MCP), 교차 접근 시험 | A↔B 교차 시험 |
| 4 | 연결 토큰·/mcp Bearer·감사 로그·크기/속도 제한 | 토큰 시험(한 번만, 해시, 폐기 즉시) |
| 5 | 대기열·비소유자 의회(client/api)·MCP next_task/report_result/propose·승인→대기열 | 2사용자 시뮬레이션(가짜 JWKS, jun aside 호출 0회 기록) |
| 6 | /w 설정(토큰 발급·Aside 설정 조각·대기열 상태), docs/hosted/README.md(위협 모델·데이터 흐름·심사위원 3단계), 웹 빌드 | 빌드 결과물 커밋 |
| 7 | 독립 보안 리뷰(GOAT task.create, fresh) → 반영 → 재리뷰, 종합 보고 | 리뷰 결과, 배포 체크리스트 |

## 하지 않는 것

main 병합·force-push·rebase, launchd·Cloudflare·Access 변경, 3070 쓰기, 실제 사용자 데이터 커밋, 시험에서 유료 aside exec.
