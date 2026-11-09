# 공간

할 일·목표·사건마다 **공간**이 있어요. 개인(`personal`) 또는 워크스페이스(`ws_` + 12 hex)예요. 결정은 [ADR-0011](../../structure/decisions/ADR-0011-spaces.md), 원본은 [spaces.ts](../../apps/server/server/spaces.ts)예요.

## 값과 이행

- `items.space`·`signals.space` 칸이 NULL 이면 개인이에요. 서버 시작 때 칸만 더하고 기존 행은 쓰지 않아요.
- 워크스페이스는 `workspaces` 표에 있어요. `/api/state` 가 살아 있는 워크스페이스가 없으면 "회사" 하나를 한 문장(`INSERT … WHERE NOT EXISTS`)으로 만들어요. 이름은 설정 › 일반 › 공간에서 바꿔요. 이름은 겹칠 수 없고 `personal`·`개인`·`ws_…` 는 쓸 수 없어요.
- 보낸 값은 별칭(`personal`·`개인`) → id → 이름(대소문자 무시) 순서로 찾아요. 모르는 값은 거절이에요(400 또는 결과의 error). 조용히 개인으로 바꾸면 회사 일이 개인에 섞여요.

## 쓰기 규칙

- 공간을 보내지 않은 쓰기는 기존 공간을 지켜요(`ON CONFLICT … space=COALESCE(excluded.space, items.space)`). 그래서 옛 iOS·옛 웹 탭의 PUT, 완료·메타·노트 갱신이 공간을 지우지 않아요.
- 새 일: 보낸 공간 → 연결한 일(`link`·`goalId`·사건의 `work`)의 공간 → 회사 판이면 기본 워크스페이스 → 개인.
- 같은 제목 일 판정(`dedup.findSameTodo`)은 공간 안에서만이에요. 개인 "견적서 보내기"와 회사 "견적서 보내기"는 다른 일이에요.
- 결정 질문 ref 는 개인이면 `decide:<제목>`(옛 모양), 워크스페이스면 `decide:<ws>:<제목>` 이에요.
- 같은 ref 의 사건이나 같은 key 의 순회 카드가 다른 공간에 있으면 그 일에 아무것도 쓰지 않고 거절해요. 공간은 사람만 옮겨요.
- 목표를 옮겨도 하위 할 일은 그대로예요(화면이 알려 줘요). 권한이 생기는 주기 3 에서 다시 정해요.

## 입구

- 웹: 사이드바 머리 드롭다운에서 공간 보기(모든 공간·개인·워크스페이스)를 골라요. 홈·전체 목록·로드맵·사이드바 오늘이 그 공간만 보여요. 모든 공간을 볼 때 워크스페이스 일에 공간 칩이 붙어요. 빠른 추가 시트의 "공간" 줄, 일 화면 머리의 공간 고르기.
- REST: 항목 POST·PUT 의 `space`, `GET /api/spaces`, `POST /api/spaces`, `PATCH /api/spaces/:id`, `/api/state`·`/api/changes` 의 `spaces`(공간 이벤트가 `seq` 를 올려 다른 탭이 알아채요), `GET /api/docs/search?space=`.
- `/api/act`·MCP: `task`·`update`·`decide` 의 `space`, `board_search` 의 `space`, `board_schema` 의 `spaces`.
- 운영 순회: 프롬프트에 공간 목록이 들어가고, 보고의 `cards`·`signals` 에 `space` 를 붙여요.
- iOS: 계약의 선택 필드만 더했어요. 화면은 iOS 레인 몫이에요.

## 한계

- 문서 검색은 `doc_index`(노트가 있는 일·사건·대화·문서) 범위예요. 독립 문서·대화는 모두 개인이에요.
- 노트·태그·속성은 아직 사람(`owner`)마다 따로예요. 같은 회사 일을 두 사람이 보면 노트가 따로예요. 범위 키 이행은 [주기 3](../../devlog/_plan/261107_enterprise/030_cycle3_pilot_members.md)이에요.
