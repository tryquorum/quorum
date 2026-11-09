# 방향판 iOS TestFlight

이 Mac에서 Xcode로 앱을 만들고 서명해요. 팀은 `U9ATA49N28`, 앱 이름은 **방향판**, 번들 ID는 `com.lidgeai.direction`이에요.

## 한 번만 준비해요

1. Xcode의 **Settings > Accounts**에서 팀에 속한 Apple 계정으로 로그인해요. 또는 저장소 밖의 키 파일과 함께 `ASC_KEY_PATH`, `ASC_KEY_ID`, `ASC_ISSUER_ID` 세 값을 모두 설정해요. 팀이 다르면 `DIRECTION_IOS_TEAM_ID`로 바꿔요.
2. CocoaPods를 설치해요 (`brew install cocoapods`).
3. 팀에 iPhone을 하나 이상 등록해요. 처음 자동 서명할 때 잠금 해제한 기기를 Mac에 연결하고 신뢰하면 등록할 수 있어요.
4. App Store Connect에 iOS 앱 레코드가 있어요. 이름은 **방향판**, Apple ID는 `6831662974`, SKU는 `direction-board-ios`, 번들 ID는 `com.lidgeai.direction`이에요. App ID는 새로 등록했어요.

## 빌드할 때마다

저장소 루트에서 실행해요.

```sh
bun apps/mobile/scripts/testflight.ts --simulator    # 서명 없는 Release 시뮬레이터 앱
bun apps/mobile/scripts/testflight.ts --export-only  # 서명된 IPA만 만들고 업로드하지 않음
bun apps/mobile/scripts/testflight.ts --dry-run      # 실행할 명령 확인
bun apps/mobile/scripts/testflight.ts                # 아카이브 후 TestFlight 업로드
```

결과는 `apps/mobile/.testflight/<빌드번호>/`에 있어요. 빌드 번호는 기본적으로 Unix 에포크 이후 분 단위예요. 같은 분에 다시 만들면 번호가 같으니 업로드를 다시 시도할 때 `--build-number 12345678`처럼 더 큰 정수를 지정해요. 업로드 후 App Store Connect의 **TestFlight > Internal Testing**에서 빌드를 내부 테스트 그룹에 추가해요.

앱 아이콘과 시작 화면·웹 아이콘은 [render-brand-icons.py](../../apps/mobile/scripts/render-brand-icons.py) 한 곳에서 그려요. 도형이나 색을 바꾸면 저장소 루트에서 `uv run --no-project --with pillow python apps/mobile/scripts/render-brand-icons.py`로 다시 만들어요. iOS 아이콘은 1024 꽉 찬 정사각형(알파·둥근 모서리·여백·그림자 없음)이어야 홈 화면에서 흰 테두리가 생기지 않아요.

푸시와 OTA 업데이트는 꺼져 있어요. 앱의 Cloudflare Access 로그인은 서버의 `GET /api/mobile/auth` 에 기대요([ADR-0006](../../structure/decisions/ADR-0006-ios.md)). 그래서 순서가 있어요. 이 경로를 담은 서버가 머지되고 공개 리스너(127.0.0.1:3090)를 띄운 서버가 다시 시작돼야 앱 로그인이 끝나요. 그 전에는 Access 로그인 뒤 404 가 보여요. 서버는 AI 실행을 그 맥의 로컬 화면이나, 공개 주소에서 Access 로 로그인한 맥 주인 계정에만 허용해요([server.ts](../../apps/server/server.ts) 의 macOwner). 앱에 주인 계정으로 로그인하면 AI 명령창도 돌아요.

로그인 흐름을 손으로 확인하려면 앱의 **설정 > 로그인**으로 Access 로그인 화면이 열리는지, 로그인 뒤 설정에 계정·만료 시각이 보이고 홈이 불러와지는지 봐요. `--simulator` 빌드는 서명이 없어 키체인 저장이 실패할 수 있어요. 그때 앱은 "이 기기에 저장하지 못했어요"를 보여 주고 그 실행 동안만 로그인을 써요.

`prebuild --clean` 은 `apps/mobile/ios` 를 지우고 다시 만들어요. 스크립트는 자기가 만든 폴더에 `.direction-prebuild` 표시 파일을 남기고, 표시가 없는 ios 폴더가 있으면 지우기 전에 멈춰요. 네이티브 설정은 ios 폴더를 손으로 고치지 말고 app.config.ts 나 config plugin 에 두세요.
