# MCP 연결 토큰

에이전트를 방향판 MCP 에 붙이는 연결마다 따로 만들고 따로 폐기하는 Bearer 토큰이에요. 지금까지 원격 /mcp 는 서버 env 의 `AGENT_TOKEN` 하나만 받았어요. 그 값은 화면에 보여줄 수 없고, 한 에이전트를 끊으려면 모든 에이전트의 값을 바꿔야 했어요. 결정 기록은 [ADR-0007](../../structure/decisions/ADR-0007-mcp-tokens.md)이에요.

## 지키는 것

- 서버는 토큰 원문을 저장하지 않아요. SQLite `mcp_tokens` 에는 SHA-256 해시, 알아보기용 앞부분(`dbt_` + 8자), 이름, 만든 사람, 만든 시각, 마지막 사용, 폐기 시각만 있어요.
- 원문은 만드는 요청의 응답에서 한 번만 나와요(`cache-control: no-store`). 다시 볼 수 없고, 잃으면 폐기하고 새로 만들어요. 서버 로그·이벤트 기록에도 원문을 남기지 않아요.
- 토큰은 `/mcp` 에서만 통해요. `/api/*` 에 Authorization 이 있는데 `AGENT_TOKEN` Bearer 가 아니면(연결 토큰, 다른 인증 방식 포함. 방식 이름 `Bearer` 는 대소문자를 가리지 않아요) 로컬 개발자 로그인이나 Access 쿠키로 넘어가지 않고 401 이에요. 그래서 연결 토큰을 쥔 에이전트가 사람 권한으로 REST 를 쓸 수 없어요.
- 만들기·목록·폐기는 맥 주인 사람만 해요: 로컬 리스너(루프백 HOST) 또는 공개 리스너의 맥 주인 Access 계정이면서 `!u.agent`. `AGENT_TOKEN` 으로 온 요청은 로컬 리스너에서도 거절해요.
- 만들기·폐기는 같은 Origin 의 요청만 받아요: Origin 이 있으면 그 리스너의 자기 Origin(로컬은 `http://<Host>`, 공개는 `PUBLIC_ORIGIN`)과 정확히 같아야 하고, `Sec-Fetch-Site` 가 있으면 same-origin·none 만 받아요. 다른 포트의 localhost 페이지가 보내는 POST 도 막아요. Origin 없는 CLI 요청은 받아요(로컬은 이 Mac 안, 공개는 Access 를 지난 요청).
- `AGENT_TOKEN` 은 그대로 동작하고 화면·API 응답 어디에도 나오지 않아요.

## 형식과 검사

- 원문: `dbt_` + 32바이트 무작위의 base64url(43자). 256비트 무작위라 해시는 느린 비밀번호 해시가 아닌 SHA-256 으로 충분하고, 해시로 바로 찾아요.
- /mcp 의 Bearer 는 먼저 `AGENT_TOKEN` 과 상수 시간 비교해요(기존 값이 `dbt_` 로 시작해도 그대로 통과). 아니면 해시로 찾아 폐기되지 않은 행일 때 그 행의 만든 사람을 MCP 주인으로 써요. Bearer 가 있는데 둘 다 아니면 401 이고, 로컬 루프백 무인증으로 넘어가지 않아요(지금과 같음).
- 해시 열은 UNIQUE 색인이고, 활성 20개 한도는 트랜잭션 안에서 세고 넣어요. 폐기 여부는 요청마다 DB 에서 확인해요(캐시 없음).
- 마지막 사용은 인증에 성공한 요청마다 기록하되, 조건부 UPDATE 로 같은 토큰은 60초에 한 번만 DB 에 써요.
- 폐기는 `revoked_at` 을 적고 행은 남겨 이력으로 보여줘요. 폐기된 토큰은 다음 요청부터 401 이에요(캐시 없음).
- 활성 토큰은 20개까지, 이름은 1~40자(앞뒤 공백 제거, 제어 문자 거절)예요.

## 입구

| 입구 | 동작 |
|---|---|
| `GET /api/mcp-tokens` | 활성 토큰 전부 + 폐기된 토큰 최근 20개(원문·해시 없음) |
| `POST /api/mcp-tokens` `{ name }` | 201 `{ token, secret }` — secret 은 이때만 |
| `DELETE /api/mcp-tokens/:id` | 폐기, 200 `{ token }`. 없는 id 404 |
| `/mcp` | `Authorization: Bearer dbt_…` 허용(두 리스너) |
| 웹 설정 › 연결 | 토큰 목록·만들기(한 번 표시 + 복사 + `export DIRECTION_TOKEN=…`)·폐기 |

계약은 [settings.ts](../../packages/contracts/src/settings.ts)(`McpToken`, `McpTokenCreated`)예요. 모바일은 토큰을 다루지 않아요.

## 원격 연결과 Cloudflare Access

공개 주소의 /mcp 는 Cloudflare Access 뒤에 있어요. 원격 에이전트는 연결 토큰(`Authorization`)과 함께 Access 서비스 토큰 두 헤더 `CF-Access-Client-Id`·`CF-Access-Client-Secret` 을 보내야 하고, Access 앱에 Service Auth 정책이 있어야 해요. 없으면 Access 가 로그인 페이지로 302 해요([Cloudflare 문서](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)). 방향판은 Cloudflare 설정을 바꾸지 않아요. 같은 Mac 의 에이전트는 `http://127.0.0.1:<PORT>/mcp`(`HOST=::1` 이면 `[::1]`)를 쓰고, 로컬 무인증(`DEV_LOCAL_USER`)이 꺼져 있으면 연결 토큰만 붙이면 돼요.

## 연결 확인

설정 › 연결의 "연결 확인"은 서버가 자기 로컬 리스너 /mcp 에 실제 HTTP 로 initialize → tools/list 를 보내요. 로컬 무인증 루프백 경로만 확인하고 원격(Cloudflare) 경로와 각 토큰은 확인하지 않아요. 토큰이 실제로 쓰였는지는 목록의 마지막 사용 시각으로 봐요.

## 남는 위험과 하지 않은 것

- 토큰에 만료와 권한 범위(읽기 전용 토큰)는 아직 없어요. 읽기 전용은 서버 전체 `BOARD_MCP_READONLY=1` 로만 정해요.
- 원문은 만드는 사람의 브라우저 화면과 클립보드를 지나요. 화면을 떠나면 다시 보이지 않아요.
- 무차별 대입 제한은 두지 않아요. 256비트 무작위라 추측할 수 없어요.

감사 기록: [감사 1(설계)](../../devlog/_plan/261107_settings_panel/001_audit1.md), [감사 2(구현)](../../devlog/_plan/261107_settings_panel/002_audit2.md).
