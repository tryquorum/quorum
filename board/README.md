# 방향판 (direction-board)

내가 해야 할 일, 에이전트가 하는 일, 나를 기다리는 결정을 한 화면에 모으는 개인 보드예요.
에이전트와 수집기는 사건(signal)을 `POST /api/signals` 로 보내고, 서버가 규칙으로 칸(지금 봐야 함 / 결정 대기 / 하는 중 / AI가 처리함 …)에 나눠 꽂아요.
일마다 요약 노트와 AI 대화가 붙고, 운영 순회가 정해진 주기로 `aside exec` 를 돌려 새 일과 노트 초안을 올려요.

## 바로 시작

```sh
cp .env.example .env.local      # 값 채우기 (로컬이면 HOST=127.0.0.1, DEV_LOCAL_USER=내 이메일)
bun install                     # 워크스페이스 전체(apps/*, packages/*) 한 번에
bun run build                   # apps/web/dist 만들기
bun run dev                     # http://127.0.0.1:3070 (bun --watch apps/server/server.ts)
```

화면만 고칠 때는 `bun run web:dev` (vite 5173, API 는 3070 으로 넘김). 서버 파일을 고치면 `bun --watch` 가 서버를 다시 띄우고, 그때 돌던 AI 실행은 끊긴 것으로 표시돼요.

에이전트·기여 규칙은 [AGENTS.md](AGENTS.md), 문서 색인은 [docs/README.md](docs/README.md), 지금 구조 지도는 [structure/INDEX.md](structure/INDEX.md) 에 있어요.

## 구조

bun workspaces 모노레포예요.

```
apps/server/
  server.ts          진입점: 인증, 보드/카드 API, 정적 파일(apps/web/dist, 옛 화면은 /legacy/)
  server/
    paths.ts           기본 경로(DB·거울은 저장소 루트 data/, 웹 빌드는 apps/web/dist)
    signals.ts         사건 입구 + 규칙 분류(triage), 수집기 상태
    works.ts           일 상세(노트, 연결, 같은 흐름, 기록), 노트 저장
    runs.ts            AI 실행(aside exec): 대화, 노트 초안, 진행 단계 읽기, 실패 분류·다시 시도·대화 목록
    run-errors.ts      실패 원인 분류(Aside 꺼짐·로그인·한도·모델·네트워크)와 사람이 읽을 안내
    ops.ts             운영 순회: 프롬프트 저장, 주기 실행, 보고 받아 사건·카드·노트 초안으로 넣기
    ops-prompt.md      운영 순회 기본 프롬프트("내가 해야 할 모든 것")
    files.ts           노트 이미지 업로드(data/uploads), AI 결과물 속 로컬 이미지 보여주기
    md.ts              마크다운 → 노트(Tiptap) HTML
  public/            옛 화이트보드 — "보드" 화면에서 iframe 으로 보여줘요
  scripts/           샘플 사건 넣기(seed-signals.ts)
apps/web/            새 화면 (React + shadcn + Tiptap, vite)
  src/components/    home · list-view(전체 목록) · roadmap-view · work-view(일 상세) · ops/(순회 칩·지난 순회·지시문 편집기, 설정 › 운영 순회)
                     command-dock(어디서나 AI 명령창) · command-palette(⌘K) · run-view(AI 실행 기록)
                     page-header · data-state(불러오기·실패 안내) · note-editor · chat-pane
  src/hooks/         use-data(보드·사건 조회, 한 번에 하나씩 폴링) · use-run-watch(완료 알림)
  src/lib/           api.ts(API 호출) · brand.ts(이름·탭 제목) · tasks.ts
  scripts/           Terminal.app 용 웹 빌드·의존성 추가 스크립트
apps/mobile/         iOS 앱(Expo·React Native), TestFlight 스크립트 scripts/testflight.ts
packages/contracts/  서버·웹·모바일이 함께 쓰는 계약: docs.ts(문서 층), api.ts(API 응답 타입)
tools/               oxlint 저장소 규칙·코드 예산, 서버 타입 오류 예산
infra/               launchd·Cloudflare 터널 설정
data/                SQLite(board.db)와 업로드 이미지. git 에 안 올림
```

흐름: 수집기·에이전트·운영 순회 → `apps/server/server/signals.ts` (분류) → 첫 화면 칸 → 일 상세(`apps/server/server/works.ts`) → AI 대화·초안(`apps/server/server/runs.ts`).

## API

에이전트용 설명은 서버가 직접 내줘요: `GET /api/agent-guide` (Bearer `AGENT_TOKEN`).
화면이 쓰는 주요 경로:

| 경로 | 하는 일 |
|---|---|
| `GET/POST /api/signals`, `PATCH /api/signals/:id` | 사건 목록·추가, 처리/다시 열기, `{ status, lane, reason }`, 규칙 피드백 |
| `GET /api/work/:ref`, `PUT /api/work/:ref/note` | 일 상세, 요약 노트 저장 |
| `POST /api/work/links`, `DELETE /api/work/links/:id` | 일 잇기·끊기 |
| `GET/POST /api/runs`, `POST /api/runs/:id/stop` | AI 실행 목록·시작(`kind: chat|draft`, 이어 묻기는 `parent`)·멈춤 |
| `GET /api/runs?thread=<id>` | 대화 하나의 턴(최신 500개, 더 있으면 `truncated`), 없으면 404 |
| `GET /api/runs/threads?limit=40` | 최근 대화 목록 |
| `POST /api/runs/:id/retry` | 실패·멈춘 실행을 새 대화로 다시 시작(원본당 한 번, 이미 했으면 409 + 그 실행) |
| `POST /api/runs/:id/seen` | 끝난 대화를 봤으면 그 확인 기다림을 확인함으로 |
| `POST /api/files`, `GET /api/files/:name`, `GET /api/files/local?path=` | 이미지 올리기·보기, AI 결과물 속 로컬 이미지 보기 |
| `GET/PUT /api/ops`, `POST /api/ops/run`, `POST /api/ops/report?sweep=<토큰>` | 운영 순회 설정(`?lite=1` 가벼운 상태, PUT `base_rev` 충돌 검사)·지금 돌리기·보고(루프백만, 순회별 결과 저장) |

## 쓰는 법 메모

- **어디서나 AI 명령창**: 오른쪽 아래. 기본은 새 대화예요(⌘K 의 "AI에게 묻기"도 늘 새 대화). 지난 대화는 대화 목록에서 골라야 이어 물어요. 일 화면에서는 "현재 일 함께 보내기"로 그 일을 맥락으로 붙여요. 실패하면 원인과 다음 행동이 보이고 "다시 시도"로 새 대화로 다시 시작해요.
- **AI가 보는 화면** (`apps/server/server/page-context.ts`): 명령창은 보낼 때마다 지금 화면(홈·전체 목록·로드맵·보드·문서, 판, 열어 둔 일. 서버는 옛 클라이언트의 운영 화면도 받아요)을 같이 보내요. 서버가 그 화면에 보이는 할 일·결정·카드를 ref 와 함께 다시 읽어 프롬프트 앞에 붙여서 "이거", "여기 있는 것"이 무엇인지 AI가 알아요. 이어 묻기에도 매번 새로 붙고, 다시 시도는 처음 보낸 화면을 써요.
- **⌘K / Ctrl+K** (또는 사이드바 "검색"): 화면 이동, 할 일·목표·사건 찾아 열기, 새 미리알림, 결과가 없으면 그대로 AI에게 묻기(입력만 채우고 보내지는 않아요).
- **완료 알림**: 헤더 오른쪽 종 버튼. 탭이 가려져 있을 때 끝난 AI 대화만 탭 제목 "(n) 방향판"과(켜면) 시스템 알림으로 알려줘요. 알림에는 질문·답 내용을 넣지 않아요. 최근 30개 실행만 보고, 두 번 확인하는 사이에 시작해서 끝난 실행은 놓칠 수 있고 탭마다 따로 알려요.
- **좁은 화면**: 일은 팝업 대신 페이지로 열리고 사이드바는 시트로 열려요. 사이드바에서 이동하면 시트가 닫히고 새 화면 제목으로 포커스가 가요.
- **불러오기 실패**: 보드·소식·운영을 따로 알려요. 마지막으로 불러온 내용은 그대로 두고 "다시 불러오기"만 보여요.
- **같은 일 두 번 안 만들기** (`apps/server/server/dedup.ts`): AI 대화(`/api/act` task)와 운영 순회(`/api/ops/report` cards)는 새 할 일을 만들기 전에 내 판을 봐요. 띄어쓰기·문장부호·대소문자만 빼고 제목이 같은 열린 할 일이 있으면 새로 만들지 않고 그 일 노트에 덧붙여요(`existing:true` / `merged`). 14일 안에 끝낸 같은 일은 다시 만들지 않아요(act는 거절, 순회는 `skipped`). 표현이 다른 비슷한 일은 프롬프트에 기존 목록(`ref`)을 보여 줘서 AI가 고르게 하고, 순회는 카드에 `"ref":"item:…"`를 보내면 그 할 일에 알림 시각·노트만 더해요(제목을 바꾸거나 닫지 않음). 같은 노트를 두 번 덧붙이지 않아요.

## 확인

```sh
bun run check                                  # lint·타입(서버 오류 예산 포함)·테스트·knip 한 번에
bun run build                                  # 웹 빌드 (500kB 넘는 청크 경고 없음)
bun test apps/server/server                    # 서버 단위 테스트만
```

## 설정

`.env.example` 에 쓰는 이름이 다 있어요. 비밀값(`AGENT_TOKEN` 등)은 `.env.local` 에만 두고 git 에 올리지 마세요.

### Cloudflare Access 배포

로컬 리스너 `PORT`/`HOST`는 그대로 두고, Cloudflare 터널의 `direction.lidgeai.com`을 공개 전용 리스너 `http://127.0.0.1:3090`에 연결하세요. `.env.local`에 `PUBLIC_PORT=3090`, `PUBLIC_ORIGIN=https://direction.lidgeai.com`, `ACCESS_TEAM=lidgeai`, Cloudflare Access 애플리케이션의 `ACCESS_AUD`, 쉼표로 구분한 `ALLOWED_EMAILS`를 설정합니다. `PUBLIC_PORT`는 `PORT`와 달라야 합니다. `ACCESS_AUD` 또는 `ALLOWED_EMAILS`가 비어 있으면 공개 리스너는 열리지 않습니다. 공개 요청은 Access JWT 또는 에이전트 토큰이 필요하며, 공개 MCP는 에이전트 토큰만 받습니다.

## 배포 (direction.lidgeai.com, 나만 로그인)

이 맥에서 서버 하나가 두 입구를 연다. 127.0.0.1:3070 은 이 맥 전용(로컬 사용자), 127.0.0.1:3090 은 공개용이라 Cloudflare Access JWT(ALLOWED_EMAILS 의 본인)나 에이전트 Bearer 토큰만 들어온다. Cloudflare 터널 direction-board 가 direction.lidgeai.com 을 3090 으로 보내고, Access 앱 direction-board 가 jun@lidgeai.com 만 허용한다. AI 실행은 웹에서 눌러도 이 맥에서 돈다.

- 서버: infra/launchd/com.lidgeai.direction-board.server.plist (~/Library/LaunchAgents 에 복사, 로그인 때 자동 시작, 죽으면 다시 시작, 로그 /tmp/direction-board.log)
- 터널: infra/cloudflare/ (설정 ~/.cloudflared/direction-board.yml, plist com.lidgeai.direction-board.tunnel). 관리 명령은 --origincert ~/.cloudflared/cert.pem.lidgeai
- .env.local 키: PUBLIC_PORT, PUBLIC_ORIGIN, ACCESS_TEAM, ACCESS_AUD, ALLOWED_EMAILS
- 다시 띄우기: launchctl kickstart -k gui/<uid>/com.lidgeai.direction-board.server

