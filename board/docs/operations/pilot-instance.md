# 파일럿 인스턴스(newa.lidgeai.com)

뉴럴아케이드 파일럿 방향판을 이 맥에서 개인 방향판과 따로 돌리는 절차예요. 설계는 [파일럿](../internals/pilot.md), 결정은 [ADR-0012](../../structure/decisions/ADR-0012-pilot-google-login.md)예요.

## 분리

| | 개인 방향판 | 파일럿 |
|---|---|---|
| 코드 | `~/Developer/direction-board`(main, `bun --watch`) | `~/Developer/direction-board-newa`(배포본, watch 없음) |
| 데이터 | `data/` | `~/Developer/direction-board-newa-data`(DB·거울·첨부·`.env.local` 600) |
| 포트 | 3070(로컬)·3090(공개) | 3082(로컬, 무인증 없음)·3092(공개) |
| launchd | `com.lidgeai.direction-board.server`·`.tunnel` | `com.lidgeai.direction-board.newa`·`.newa-tunnel` |
| 터널 | `80c2d28f…`(direction.lidgeai.com, Access) | 별도 터널 `direction-board-newa`(newa.lidgeai.com, Access 앱 없음) |
| 로그인 | Cloudflare Access | 앱 자체 Google 로그인 |

파일럿 env 에는 `DEV_LOCAL_USER` 를 두지 않아요(있어도 서버가 버리고 경고를 남겨요). 운영 순회는 파일럿에서 꺼져 있어요(스케줄러도 돌지 않고 `/api/ops` 는 403). `AGENT_OWNER` 는 `nobody@invalid` 로 둬요.

## 처음 한 번

1. Google Cloud 프로젝트 `direction-board-newa` 에 웹 OAuth 클라이언트(리디렉션 `https://newa.lidgeai.com/auth/google/callback`, 범위 openid·email·profile, 외부 사용자 유형 — 사용자가 다른 Workspace 조직이라서). 비밀은 `~/Developer/direction-board-newa-data/.env.local`(600)에만.
2. `infra/newa/env.example` 을 보고 `.env.local` 을 채워요(비밀 두 줄은 손으로).
3. `infra/newa/deploy.sh`: 브랜치 머리를 `git archive` 로 배포본에 풀고 `bun install`·웹 빌드 후 서버를 다시 띄워요(개인 방향판은 건드리지 않음).
4. 터널: `cloudflared --origincert ~/.cloudflared/cert.pem.lidgeai tunnel create direction-board-newa`, `… tunnel route dns direction-board-newa newa.lidgeai.com`, `infra/newa/newa-tunnel.yml` 과 plist 를 `~/.cloudflared`·`~/Library/LaunchAgents` 에 두고 `launchctl bootstrap`.

## 확인

- `curl -sI https://newa.lidgeai.com/` → 401 과 로그인 화면(Access 로 가면 안 됨). `/auth/google/start` → `accounts.google.com` 302.
- `curl -s http://127.0.0.1:3082/api/state` → 401(로컬도 무인증 없음).
- 개인 방향판: `launchctl list | grep direction-board.server` 의 PID 가 배포 전과 같아요.
- 비밀 확인: 받은 JSON 의 비밀이 콘솔에서 이미 바뀌었을 수 있어요. 가짜 코드로 `https://oauth2.googleapis.com/token` 에 한 번 보내 `invalid_grant` 면 클라이언트 인증은 통과한 거예요(`invalid_client` 면 비밀이 틀림). 로그·출력은 `GOCSPX` 를 걸러 읽어요.
- 이 맥에서 `newa.lidgeai.com` 을 DNS 만들기 전에 조회했으면 시스템 리졸버가 없는 이름을 30분 넘게 기억해요. 공개 리졸버(`dig @1.1.1.1`)로 확인하고 기다리거나 `sudo killall -HUP mDNSResponder`.

## 비밀 교체

Google Cloud 콘솔 › 프로젝트 `direction-board-newa` › 클라이언트 "newa web" › 보안 비밀 추가(한 클라이언트에 2개까지라 먼저 하나를 사용 중지·삭제해야 할 수 있어요). 새 값은 복사 단추 → `pbpaste` 로 `.env.local` 의 `GOOGLE_CLIENT_SECRET` 한 줄만 바꾸고 클립보드를 비워요. `launchctl kickstart -k gui/$UID/com.lidgeai.direction-board.newa`, 로그아웃 후 다시 로그인, 옛 비밀 사용 중지·삭제.

## 되돌리기

`launchctl bootout gui/$UID/com.lidgeai.direction-board.newa`·`…newa-tunnel`. DNS 는 `cloudflared tunnel route dns` 로 만든 CNAME 하나라 대시보드에서 지우면 돼요. 데이터 폴더는 남겨 둬요.
