# 배포

현재 [설정 예시](../../.env.example)는 루프백 `HOST=127.0.0.1`, `PORT=3070`을 사용해요. 환경값이 없으면 [서버](../../apps/server/server.ts)는 포트 3060과 `0.0.0.0`을 기본값으로 써요. 서버는 launchd 로 돌아요: [infra/launchd](../../infra/launchd/com.lidgeai.direction-board.server.plist) 가 저장소 루트에서 `.env.local` 을 읽고 `bun --watch apps/server/server.ts` 를 띄워요. 터널은 [infra/cloudflare](../../infra/cloudflare/README.md) 예요. plist 를 바꾸면 `~/Library/LaunchAgents` 의 사본도 바꾸고 `launchctl kickstart -k` 로 다시 띄워요.

`direction.lidgeai.com` 은 Cloudflare Access(허용 메일만) 뒤 공개 리스너로 열려 있어요. 실행 중인 AI가 끊길 수 있으므로 서버 재시작 전 실행 상태를 확인해요. 순서는 [릴리스](release.md)를 보세요.
