# 서버와 인증

[서버 진입점](../../apps/server/server.ts)은 HTTP와 정적 화면, 데이터 및 AI 실행을 같은 프로세스에서 다뤄요. 사람은 Cloudflare Access JWT 검증을 거치고 에이전트는 `AGENT_TOKEN` Bearer를 써요. 서버는 이 맥 전용 로컬 리스너(`PORT`)와 Cloudflare 터널이 붙는 공개 리스너(`PUBLIC_PORT`)를 함께 열어요. 로컬 개발자 로그인(`DEV_LOCAL_USER`)은 로컬 리스너에서 실제 접속 주소가 루프백이고 Host·Origin 이 로컬일 때만 켜져요. AI 실행·운영 순회 같은 맥 주인 기능은 로컬 리스너이거나, 공개 리스너에서 Access 로 로그인한 맥 주인 계정일 때만 열려요.

MCP의 로컬 우회는 URL만 믿지 않고 실제 접속 주소와 Host·Origin을 확인해요. 프록시를 거친 요청을 루프백으로 취급하지 마세요. 외부 배포는 [배포 안내](../operations/deploy.md)를 보세요.
