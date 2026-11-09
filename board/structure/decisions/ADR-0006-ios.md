# ADR-0006 — iOS 앱 결정

- 소유 문서: [mobile.md](../mobile.md)
- 근거: 레인 작업 지시(Expo 선택), [Access 로그인 계획](../../devlog/_plan/261107_mobile_access_login/000_plan.md)과 [감사 기록](../../devlog/_plan/261107_mobile_access_login/001_audit1.md).

## 결정 기록

- 목적과 의도: iOS에서 방향판에 접속할 앱을 만들어요.
- 선택: Expo와 React Native를 써요(레인 작업 지시). TestFlight 내부 테스트로 배포해요([절차](../../docs/operations/mobile-testflight.md)).
- 장단점과 영향: 웹과 같은 공용 계약(packages/contracts)을 써요. 네이티브 설정은 app.config.ts 에만 두고 ios 폴더는 매번 다시 만들어요.

## Cloudflare Access 로그인 (2026-11-07)

- 문제: 공개 주소는 Cloudflare Access 뒤에 있어요. 앱의 fetch 에는 Access 자격이 없어 모든 요청이 Access 로그인 페이지로 302 돼요. 시스템 브라우저(ASWebAuthenticationSession)의 HttpOnly `CF_Authorization` 쿠키는 앱 fetch 와 공유되지 않아요.
- 선택: 앱이 시스템 로그인 창으로 `/api/mobile/auth?state=<무작위>` 를 열어요. Access 가 로그인시킨 뒤 이 요청이 공개 리스너에 오면, 서버는 Access 가 붙인 `Cf-Access-Jwt-Assertion` 을 다시 검증하고 고정 콜백 `direction://auth?state&token` 으로 302 해요([mobile-auth.ts](../../apps/server/server/mobile-auth.ts)). 앱은 state 를 확인하고 토큰을 키체인에 둔 뒤, 그 토큰을 받은 https 서버로 보내는 요청에만 `cf-access-token` 헤더로 붙여요. Cloudflare 가 비브라우저 클라이언트에 안내하는 헤더예요([CLI 문서](https://developers.cloudflare.com/cloudflare-one/tutorials/cli/)).
- 거절하는 요청: 로컬 리스너(DEV_LOCAL_USER 포함), 에이전트 Bearer, 쿠키만 있는 요청, 허용 목록 밖 이메일, 형식이 틀리거나 중복된 state. 콜백 주소는 요청 파라미터로 바꿀 수 없어요.
- 검토한 대안: 웹뷰에서 쿠키 꺼내기(IdP 가 웹뷰 로그인을 막고 HttpOnly 쿠키라 불가), 일회용 코드 교환(교환 요청도 Access 뒤라 Access 정책에 우회 경로가 필요), 서비스 토큰(사람 신원이 아니라 macOwner 판단이 깨짐), https 유니버설 링크 콜백(Access 뒤에서 apple-app-site-association 을 내보내야 해 정책 변경 필요).
- 남는 위험: 다른 앱이 `direction://` 스킴을 등록하고 사용자를 이 주소로 보내면 토큰을 받을 수 있어요. 토큰은 이 Access 앱(aud) 전용이고 세션 시간 뒤 끝나며, 서버가 허용 이메일만 받아들여요. 유니버설 링크로 옮기면 없어져요.
- 만료 처리: 앱은 만료 30초 전부터 토큰을 보내지 않고, 토큰을 붙인 요청이 401 이나 Access 로그인 페이지로 끝나면 그 요청이 쓴 세션만 지워요(다시 로그인한 세션은 남아요). 키체인 저장·삭제는 순서대로 하고 실패하면 모든 화면 머리에 알려요([sessionStore.ts](../../apps/mobile/src/api/sessionStore.ts)). 리디렉트 때 RN iOS 네트워크 층은 쿠키 외 헤더를 모두 지워서 토큰이 다른 주소로 따라가지 않아요.
- 배포 순서: 이 서버 경로가 머지되고 공개 리스너 서버가 다시 시작되기 전에는 `/api/mobile/auth` 가 404 예요. 그동안 새 앱의 로그인은 Access 로그인 뒤 404 로 끝나요.
