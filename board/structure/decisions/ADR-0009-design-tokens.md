# ADR-0009 — 디자인 토큰 패키지

- 소유 문서: [계약](../contracts.md)의 "디자인 토큰" 절, 이유와 사용 규칙은 [디자인 코어](../../docs/internals/design-core.md)
- 근거: 사용자 요청 "cxc-dev-uiux-design 한번 계속 pabcd 돌려봐 디자인코어랑 해서", [경험 감사와 간극 장부](../../devlog/_plan/261107_design_core/003_gap_ledger.md), [주기 1 계획과 감사](../../devlog/_plan/261107_design_core/010_design_core.md)

## 결정 기록

- 목적: 웹과 iOS 가 같은 색·글자·간격 값을 쓰고, 대비 기준을 한 곳에서 시험으로 지켜요.
- 제약: 웹은 Tailwind v4 + shadcn CSS 변수, iOS 는 React Native(CSS 변수를 못 읽음), 보드는 옛 HTML iframe. 빌드 단계를 늘리지 않아요.
- 선택: 새 워크스페이스 패키지 `packages/design-tokens` 가 원본(sRGB hex 와 숫자). 웹 CSS 변수는 손으로 같은 값을 적고 패키지 시험(css-sync)이 맞는지 확인해요. iOS 는 패키지를 import 해요. 옛 보드는 글자 색만 맞추고 사례 시험으로 지켜요. 새 임의 값은 lint `no-raw-style` 이 막아요.
- 검토한 대안: `packages/contracts` 에 넣기(API 계약과 화면 값이 한 패키지에 섞임), CSS 를 토큰에서 만들어 내기(빌드 단계와 생성 파일이 늘어남), Tailwind 설정을 공유하기(React Native 가 못 읽음).
- 남는 위험: CSS 변수가 손으로 적은 값이라 고칠 때 두 곳을 고쳐야 해요(시험이 어긋남을 잡아요). 이어 붙여 만든 클래스 이름은 lint 가 못 봐요. 보드 iframe 은 다크 모드와 포커스 규칙 밖이에요.

