# 레시피: 스스로 고치는 API

레시피는 사이트 한 곳의 의도 하나(예: "Luma 행사 공지 읽기")를 부르는 방법이에요. 호출이 깨지면(404·로그인 필요·응답 모양이 달라짐·빈 결과) 새 경로를 찾아 검증 예시를 통과한 것만 새 버전으로 저장하고, 이전 버전과 깨진 이유를 gbrain에 남겨요. 코드: `src/recipes/`.

## 쓰기

엔진 연결 지점은 `src/recipes/index.ts`의 두 함수예요.

```ts
import { runRecipe, listRecipes, asideRunner } from "./recipes"

listRecipes()                                  // GET /api/recipes: { id, site, intent, version, endpoint, health }[]
const out = await runRecipe("luma-blasts", {
  runId, seqStart: 1,                           // seq 는 seqStart 부터, 끝나면 out.nextSeq
  vars: { slug: "compiled-8lsr", eventApiId: "evt-tt3sFLIW9Ee1SUU" },
  aside: asideRunner(),                         // 맥(엔진)에서만. 생략 + QUORUM_ASIDE=1 이어도 켜져요
}, (event) => bus.push(event))                  // QuorumEvent (src/contract.ts)
// out = { ok, version, endpoint, result, repaired, reason, nextSeq }
```

ctx에서 생략한 값: `store`는 기본 저장소(`.quorum/recipes.db`, env QUORUM_RECIPES_DB), `memory`는 `new GbrainMemory()`(env QUORUM_GBRAIN_BIN)예요. `memory: null`이면 기억을 끄고 그 사실을 error 이벤트로 남겨요. `aside`가 없으면 http 후보까지만 시도해요. get-blasts처럼 로그인이 필요한 수리는 엔진이 맥에서 `aside`를 넘겨야 끝나요.

- `POST /api/recipes/:id/run` → `runRecipe(id, ctx, emit)`. id는 `[a-z0-9-]`만 받아요.
- 주기 점검: `watchRecipes(store, [{ id, vars }], ms, { memory, aside }, emit)` — DB를 닫으면 멈춰요.

## 이벤트

| type | actor | data |
|---|---|---|
| recipe.run | recipe:<id> | 호출 시작, 정상 결과(status, count), 수리 후보마다(phase: "discover", via, ok, reason) |
| recipe.broken | recipe:<id> | status, reason, kind(http·auth·network·parse·schema·verify) |
| recall | gbrain | hits: { id(슬러그), summary, decision: "repair", score }[] — 깨졌을 때 gbrain에서 찾은 지난 수리 기록 |
| recipe.repaired | recipe:<id> | version(새), previousVersion, endpoint, previousEndpoint, via(http·aside) |
| memory.saved | gbrain | slug (recipes/<id>-v<n>), duplicate(다른 기기가 같은 수리를 먼저 남김) |
| error | recipe:<id>·aside·gbrain | 수리 실패, Aside 실패(분류된 이유), gbrain 실패, 기억 미연결, 값 누락 |

모든 data에 `recipeId, version, endpoint`가 있어요. endpoint는 템플릿 그대로이고(`{{eventApiId}}`) 비밀처럼 보이는 질의 값은 `***`로 가려서, id나 쿠키가 이벤트에 실리지 않아요.

## 레시피 정의 (src/recipes/defs/*.json)

```json
{ "id": "luma-blasts", "site": "luma.com", "intent": "Luma 행사 공지 읽기", "version": 1, "vars": ["eventApiId", "slug"],
  "request": { "method": "GET", "url": "https://api2.luma.com/event/get-posts?event_api_id={{eventApiId}}", "headers": { "cookie": "{{env.LUMA_COOKIE}}" } },
  "parse": { "path": "entries|blasts|posts", "pick": { "id": "api_id|blast_id|id", "message": "message|content_md" }, "markdown": ["message"] },
  "verify": { "schema": { "type": "array", "minItems": 1, "items": { "type": "object", "required": ["id"] } }, "nonEmpty": true },
  "discover": { "http": { "candidates": [{ "request": { "method": "GET", "url": "https://api2.luma.com/event/get-blasts?event_api_id={{eventApiId}}" } }] },
                "aside": { "startUrl": "https://luma.com/{{slug}}", "match": "api2.luma.com/event/" } } }
```

- `{{name}}`은 vars로 채워요(url은 인코딩). `{{env.NAME}}`은 환경 변수이고, 값이 없으면 그 머리글만 빠져요.
- `path`·`pick`의 `a|b`는 앞에서부터 값이 있는 첫 경로예요. `markdown` 필드는 HTML을 마크다운으로 바꿔요.
- 수리 순서: ① gbrain 회상 — 지난 수리 기록의 `new endpoint` 경로를 먼저 시도해요(레시피에 적힌 호스트만, 쿠키가 다른 곳으로 새지 않게). ② http 후보를 순서대로 시도하고(깨진 경로는 건너뜀), 모두 실패하면 Aside가 `startUrl`을 열어 그 페이지가 부른 `match` 요청과 후보 경로를 로그인된 페이지 안에서 불러 봐요(`aside repl --account $ASIDE_ACCOUNT --file <script>`). 찾은 URL의 값은 다시 `{{eventApiId}}`로 바꿔 저장해요(질의 값·경로 조각이 정확히 같을 때만, 레시피에 적힌 고정 경로 단어는 그대로). 머리글은 같은 호스트로 선언된 요청의 것(예: `cookie: {{env.LUMA_COOKIE}}`)을 물려받고, 비밀 질의값(access_token·api_key·session·sig 등 키 이름 전체로 판정)이 필요한 URL은 저장하지 않고, 회상한 기록의 비밀 질의값은 빼고 다시 검증해요. 머리글은 같은 출처(scheme+host+port)일 때만 물려받아요. 지금 버전과 똑같은 요청이 브라우저에서만 되면 새 버전을 만들지 않고 "서버에는 로그인 쿠키가 필요해요"로 알려요.
- 기록: `recipes/<id>-v<n>` 페이지. 다른 기기가 같은 번호를 먼저 썼으면(gbrain revision_required) 그 페이지를 읽어 같은 수리면 duplicate로, 다른 수리면 `-<runId>`를 붙여 남겨요(board dedup의 normTitle 규칙).

## 실제 Luma (2026-11-09 확인)

- `luma-event`: `api2.luma.com/url?url=compiled-8lsr` → 200, c0mpiled-17: Seoul (evt-tt3sFLIW9Ee1SUU).
- `luma-blasts` v1 `event/get-posts` → 404로 깨짐. 후보 `event/get-blasts`는 로그인 없이 401이라 http만으로는 수리하지 않아요. Aside(로그인된 브라우저)나 `LUMA_COOKIE`가 있어야 v2로 고쳐져요.

## 환경

| 변수 | 기본값 | 뜻 |
|---|---|---|
| QUORUM_RECIPES_DB | .quorum/recipes.db | 버전·상태 DB |
| QUORUM_GBRAIN_BIN | gbrain | gbrain CLI (`bun install -g github:garrytan/gbrain#stable`, `gbrain init --pglite --no-embedding`) |
| ASIDE_BIN / ASIDE_ACCOUNT | ~/.local/bin/aside / u0 | board runs.ts와 같은 규칙 |
| LUMA_COOKIE | (없음) | Luma 로그인 쿠키. 있으면 get-blasts를 서버에서 바로 불러요 |

## 방향판(board/)에서 가져온 것

| board/ 원본 | 새 위치 |
|---|---|
| apps/server/server/run-errors.ts | src/recipes/errors.ts (+ RecipeBreak, "not signed in"·"timed out" 분류) |
| apps/server/server/db-timers.ts | src/recipes/db-timers.ts (그대로) → watch.ts |
| apps/server/server/vault/html-to-markdown.ts (+test) | src/recipes/html-to-markdown.ts (+test, notes 렌더러 의존 1건 제외) |
| apps/server/server/runs.ts 실행 방식(ASIDE_BIN·ASIDE_ACCOUNT, NO_COLOR, ANSI 제거) | src/recipes/aside.ts |
| apps/server/server/signals.ts collectors 하트비트 | src/recipes/store.ts recipe_health |
| packages/contracts/src/text.ts normTitle | src/recipes/memory.ts |
| *.test.ts 격리(:memory: DB, 임시 폴더, /usr/bin/false) | src/recipes/*.test.ts |

## 시험

`bun test src/recipes` — 로컬 Bun.serve로 깨짐 감지, 모양이 다른 후보 탈락, 버전 증가, 401 후보 거절, gbrain·Aside 실패가 error 이벤트로 드러나는지 확인해요. 실제 Luma·Aside·gbrain은 부르지 않아요.
