# 문서 층 설계 — 노트를 문서로, AI가 탐색하기 쉽게

독립 문서의 부모·이동·보관과 거울 경로 규칙은 [문서 계층 설계](doc-hierarchy.md)를 따릅니다.

상태: 설계 확정(2026-11-06). 구현은 레인 4개(L1~L4)가 이 문서와 [계약](../../packages/contracts/src/docs.ts) 를 계약으로 삼아 나눠 한다.
경로 메모(2026-11-07): 이 문서의 `server/…`, `web/…` 경로는 모노레포 이동 전 기준이에요. 지금은 `apps/server/server/…`, `apps/web/…`, 계약은 `packages/contracts/src/docs.ts` 예요.
근거: Aside 조사(Acard·Notion·Obsidian·Logseq·Anytype MCP 비교, /Users/jun/.aside/u/0/artifacts/db-design/research.md), 이 저장소 코드, bun:sqlite 실측.

## 1. 목표와 비목표

목표
- 할 일·목표·사건·AI 대화에 붙은 요약 노트와, 일에 묶이지 않은 독립 문서를 모두 "문서"로 다룬다. 일이 끝나거나 지워져도 문서는 남고 찾을 수 있다.
- 문서마다 태그(자동 + 직접 + 본문 #태그)와 관계([[링크]], 기존 work_links)가 있다.
- DB가 원본이다. 마크다운 거울(data/vault/*.md)을 저장할 때마다 다시 써서 옵시디언·grep·git·AI 파일 도구로 읽을 수 있게 한다.
- AI는 같은 조작을 REST(curl, aside exec)와 MCP(/mcp, Codex·Claude Code·GOAT)로 쓴다. 검색 → 가져오기 2단계, 작은 결과, 다음 행동 안내.
- 사람과 AI가 같은 문서를 고쳐도 서로 덮지 않는다(버전 확인, AI는 덧붙이기 우선, 사람 글 보호).

비목표(이번 단위)
- 노션식 사용자 정의 컬럼·롤업·수식, 실시간 공동 편집(CRDT), 거울 파일 → DB 역반영(다음 단위), 회사 판 문서, 문서 삭제(보관만).
- 사용자 데이터 삭제·수정. 마이그레이션은 표·칸 추가만 한다.

## 2. 현재 상태 근거

- work_notes(owner, ref, html, text, by, updated_at): 52개(그중 에이전트 37개). ref 는 item:<판>:<id> 34개, signal:<id> 18개. 마크다운 원문은 저장하지 않는다(html + 평문).
- 노트 쓰기 길: 화면 PUT /api/work/:ref/note {html,text} (server/works.ts), AI writeAgentNote(draft|append) (server/notes.ts, md → html).
- 관계: work_links(owner, a, b, label, by). 검색: GET /api/work/search?q= (LIKE, 최대 40).
- AI 입구: POST /api/act (server/actions.ts, ACT_GUIDE), 운영 순회 보고 POST /api/ops/report, AI가 보는 화면 블록(server/page-context.ts).
- bun:sqlite 는 SQLite 3.54.0. FTS5 trigram 이 된다: "계약서", "서명본", "좌석 지정", "yp07" 은 맞고, 두 글자 "회신" 은 trigram 으로 안 맞는다(3글자 미만은 LIKE 로 대신해야 함). 실측 /tmp/fts-probe.ts, 2026-11-06.
- aside exec 에는 MCP 서버를 붙이는 옵션이 없다(aside exec --help, 1.26.1104). 그래서 aside exec 는 REST+curl, 다른 에이전트는 MCP 를 쓴다. 두 길은 같은 연산 층을 부른다.

## 3. 데이터 모델 (L1 소유)

모든 문서의 주소는 기존 ref 를 그대로 쓴다: item:<bid>:<iid>, signal:<id>, run:<threadId>, 그리고 새 doc:<id>(독립 문서). URI 가 필요할 때는 board://doc/<ref 를 encodeURIComponent>.

추가 표(모두 CREATE TABLE IF NOT EXISTS, 기존 표는 칸 추가만):

    -- 독립 문서 본체(일에 묶이지 않은 문서). 본문은 work_notes(ref='doc:<id>') 에 둔다
    docs(owner, id, title, area, created_at, updated_at, archived INTEGER DEFAULT 0, PRIMARY KEY(owner,id))
    -- work_notes 에 칸 추가
    ALTER work_notes ADD md TEXT            -- 마크다운 원문(AI 가 쓴 것은 그대로, 사람이 쓴 것은 html → md 변환)
    ALTER work_notes ADD version INTEGER NOT NULL DEFAULT 1
    ALTER work_notes ADD created_at INTEGER
    ALTER work_notes ADD person_edited INTEGER NOT NULL DEFAULT 0   -- 사람이 한 번이라도 고쳤으면 1
    -- 태그: by = auto | person | agent | body
    doc_tags(owner, ref, tag, by, created_at, PRIMARY KEY(owner, ref, tag))
    -- 색인(조회 전용, 언제든 다시 만들 수 있음). 노트·일·사건이 바뀔 때 갱신
    doc_index(owner, ref, kind, title, area, status, source, updated_at, created_at, version, chars, person_edited, mirror_path, PRIMARY KEY(owner, ref))
    doc_fts USING fts5(owner UNINDEXED, ref UNINDEXED, title, body, tags, tokenize='trigram')

kind: todo | goal | signal | run | doc. status: open | done | archived.

자동 태그(by=auto, 색인 때 다시 계산): 영역/<영역 이름>, 종류/<kind 한글: 할일·목표·사건·대화·문서>, 출처/<source>, 상태/<열림·끝남·보관>, ai/초안(에이전트만 쓰고 사람이 안 고친 노트). 태그 이름 규칙: 앞뒤 공백 제거, 소문자, 공백 → -, 최대 40자, '/' 로 계층.
본문 태그(by=body): 마크다운의 #태그(코드 블록 제외). 본문 링크: [[ref]] 또는 [[제목]] → work_links(label='언급', by='body'), 저장 때 다시 계산.

버전 규칙
- 모든 노트 쓰기는 version 을 1 올린다.
- 화면 PUT 은 expectedVersion 을 보낸다. 어긋나면 409 {error, current:{version, md}}. 화면은 "다른 곳에서 바뀌었어요" 를 보이고 덮지 않는다.
- AI 덧붙이기(append)는 버전 없이 된다(같은 내용 두 번 금지는 이미 있음). AI 교체(replace)·부분 수정(patch)은 expected_version 이 필수다.
- person_edited=1 인 노트를 AI 가 교체·수정하려 하면 바꾸지 않고 "## AI 제안" 단락으로 덧붙인다(Acard 의 사람 글 보호).

## 4. 마크다운 거울 (L2 소유)

- 경로: data/vault/<kind 폴더>/<제목 슬러그>--<짧은 id>.md. kind 폴더: 할일, 목표, 사건, 대화, 문서. 제목 슬러그는 파일명에 못 쓰는 글자만 바꾸고 한글은 그대로, 60자.
- frontmatter: ref, kind, title, area, status, tags(목록), links(ref 목록), version, created, updated, source. 본문은 work_notes.md.
- 쓰기: 임시 파일 → rename(원자적). 제목이 바뀌어 경로가 바뀌면 옛 파일은 지운다(거울은 DB 에서 다시 만들 수 있는 사본이라 지워도 된다).
- data/vault/_index.md(종류별 목록, 최근 순)와 data/vault/_tags.md(태그별 목록)를 함께 다시 쓴다. AI 는 파일 도구로 이 두 파일부터 읽으면 된다.
- 시작할 때 전체 다시 쓰기 1회, 이후 문서가 바뀐 ref 만. 한 방향(DB → 파일)만.
- html → md 변환: 사람이 Tiptap 으로 쓴 노트용. 체크리스트(taskList), 제목, 목록, 링크, 코드, 인용을 지원한다. 변환은 서버에서 한다(turndown + gfm 류 또는 직접 구현). 화면 PUT 이 md 를 같이 보내면 그것을 우선한다.

## 5. 조회·쓰기 연산 (L1 소유, contract.ts 의 DocsOps)

REST 와 MCP 가 같은 연산을 부른다. 결과는 작게, 잘리면 이유와 다음 행동을 붙인다. 응답 문자열 상한 20,000자.

| 연산 | REST | 입력 | 출력 |
|---|---|---|---|
| search | GET /api/docs/search | q?, kinds?, tags?(AND), area?, status?, since?, sort(relevance·updated), limit(기본 20, 최대 50), cursor?, sameTitle?(normTitle 이 같은 제목만, q 무시, 4자 미만은 빈 결과. REST 만, 화면의 같은 제목 경고용) | {results:[{ref, kind, title, snippet(≤200자), tags, area, status, updated_at, path}], total, nextCursor?, hint?} 본문 없음 |
| fetch | GET /api/docs/:ref | view(markdown·outline·meta·section), section?(제목 경로 "가/나"), maxChars(기본 8000, 최대 20000), offset? | {ref, kind, title, version, frontmatter, markdown, outline?, truncated, nextOffset?, links:{out, in}} |
| related | GET /api/docs/:ref/related | direction(out·in·both), depth(1~2), limit(기본 30) | {edges:[{label, direction, node:{ref, kind, title, status}}]} 본문 없음 |
| schema | GET /api/docs/schema | — | {kinds, statuses, areas, tags:[{tag, count}], linkLabels, fields} |
| create | POST /api/docs | title, md, area?, tags?, links?, id?(소문자 UUID, 같은 id·같은 요청이면 처음 결과 + existing, 다른 요청이면 409. 기록은 doc_create_requests) | {ref, version, existing?} |
| write | POST /api/docs/:ref/write | mode(append·replace·patch), md?, edits?(제목 경로 대상 append·replace 또는 old/new), expectedVersion?(replace·patch 필수), idempotencyKey? | {ref, version, applied, suggested?, warnings} |
| tag | POST /api/docs/:ref/tags | add?, remove? | {ref, tags} |
| archive | POST /api/docs/:ref/archive | archived(bool) | {ref, status} 독립 문서만 |

검색 규칙: q 가 3글자 이상이면 doc_fts MATCH(trigram, 구문은 큰따옴표로 감쌈), 3글자 미만이거나 결과가 없으면 doc_index.title + work_notes.md LIKE. 보관(archived)은 status 로 명시할 때만. cursor 는 불투명 문자열(base64 offset+질의 해시), 다른 질의의 cursor 는 400.

/api/act 확장(L1): {"do":"doc", title, md, tags?, area?, link?} 로 독립 문서를 만든다(같은 제목 독립 문서가 열려 있으면 그 문서에 덧붙이고 existing:true — dedup.ts 와 같은 규칙). {"do":"tag", ref, add?, remove?}. 기존 note 는 그대로 append.
ACT_GUIDE·sweepPrompt 에 "먼저 GET /api/docs/search 로 찾고, 읽을 때는 /api/docs/:ref?view=outline 다음 section" 한 줄을 넣는다.

## 6. MCP 서버 (L3 소유)

- 위치: 같은 서버의 /mcp(Streamable HTTP, @modelcontextprotocol/sdk). 루프백은 인증 없이, 그 밖은 AGENT_TOKEN Bearer. 서버 이름 direction-board.
- 도구 7개(이름 접두 board_):

| 도구 | 연산 | annotations |
|---|---|---|
| board_search | search | readOnly, idempotent, closedWorld |
| board_fetch | fetch | readOnly, idempotent |
| board_related | related | readOnly, idempotent |
| board_schema | schema(+ 리소스 board://schema) | readOnly, idempotent |
| board_act | /api/act 와 같은 actions[] 묶음(task·done·update·note·doc·tag) | write, destructive=false |
| board_write | write(append·replace·patch) | write, destructive=true(replace·patch) |
| board_archive | archive | write, destructive=true |

- 모든 결과: outputSchema + structuredContent + 같은 JSON 의 text 사본. 오류는 isError 와 고칠 방법 한 줄.
- 서버 instructions(한국어, 10줄 이하): 검색 먼저, 고치기 전 fetch 로 version 받기, 사람 글은 제안으로, 새로 만들기 전 같은 일 찾기, 태그 계층 규칙.
- 리소스: board://doc/{ref}(fetch 의 markdown 보기), board://schema.
- 쓰기 도구를 숨기는 BOARD_MCP_READONLY=1.

## 7. 화면 (L4 소유)

- 사이드바에 "문서" 화면(#/docs) 추가. 검색창(q), 태그 칩(자동 태그는 회색, 직접 태그는 검정), 종류·영역·상태 필터, 최근 순. 목록/표 전환은 Finder 식 보기 4종으로 바뀌었다(13절).
- 기본 보기는 ai/초안 이 아닌 문서와 내가 고친 문서. "AI 초안 보기" 칩으로 켠다.
- "새 문서" 버튼 → 독립 문서 생성 후 일 화면과 같은 노트 편집기로 연다.
- 일 화면: 태그 칩 줄(추가·빼기), "여기를 가리키는 글" 목록(related in).
- ⌘K 에 문서 묶음, AI가 보는 화면에 docs 보기(L1 이 page-context 에 view "docs" 추가, 화면은 view 값만 보낸다).
- 노트 저장은 expectedVersion 과 md 를 함께 보낸다. 409 면 덮지 않고 안내.
- Paper 파일 01M6NDAYZS6W3GPRA3S433KTTX: 컴포넌트 페이지에 "문서 화면" 아트보드, UX 개선 기록에 한 줄.

## 8. 레인과 소유 파일

| 레인 | 브랜치 | 소유 파일 | 의존 |
|---|---|---|---|
| L1 문서 코어 | docs/l1-core | server/docs/*.ts(contract.ts 제외 수정 금지 → 바꾸면 이 문서와 함께), server/notes.ts, server/works.ts(노트 PUT·검색), server/actions.ts, server/ops.ts(프롬프트 한 줄), server/page-context.ts(docs view), server.ts 의 /api/docs 연결, 테스트 | 없음 |
| L2 거울 | docs/l2-vault | server/vault/*.ts, 테스트 | contract.ts 의 DocRecord·VaultSink 만 |
| L3 MCP | docs/l3-mcp | server/mcp/*.ts, 루트 package.json 의존성, 테스트 | contract.ts 의 DocsOps 만(가짜 구현으로 시험) |
| L4 화면 | docs/l4-ui | web/src/**(문서 화면·태그·역링크·⌘K), Paper | REST 계약(5절)만, 가짜 응답으로 개발 |

통합(코디네이터): L1 → L2 → L3 → L4 순으로 main 에 합치고, server.ts 에서 L2 의 VaultSink 를 L1 에 꽂고 L3 의 /mcp 를 연결한다. 그다음 bun test server, web typecheck·build, 3070 재시작(실행 중 AI 0개 확인 후)과 실제 화면 확인.

## 9. 검증

- L1: bun test server — 색인 재구성, 자동·본문 태그, [[링크]] 관계, 버전 409, 사람 글 보호(제안으로 덧붙임), 검색(3글자 trigram·2글자 LIKE·cursor·한도·잘림 안내), /api/act doc·tag, 기존 테스트 전부.
- L2: 거울 경로·frontmatter·원자적 쓰기·제목 바뀜·_index/_tags, html → md(체크리스트·제목·목록·링크·코드).
- L3: MCP SDK 클라이언트로 initialize → tools/list(7개, annotations) → 각 도구 호출(가짜 DocsOps) → 오류 isError, READONLY 모드.
- L4: web typecheck·build, 문서 화면 1280·390 렌더, 409 안내, 빈/로딩/오류 상태.
- 통합: 실제 DB 복사본으로 색인 52개 노트가 문서가 되는지, 3070 에서 /api/docs/search?q=계약서 와 /mcp tools/list, 화면 확인. 사용자 데이터는 읽기만(쓰기 시험은 DB 복사본이나 :memory:).

## 10. 위험

- html → md 변환 손실: 사람 노트의 표·이미지 등. 원본 html 은 그대로 두므로 화면은 영향 없음, 거울만 근사.
- 서버 재시작: server/ 파일을 main 에 합치면 bun --watch 가 다시 뜬다. 합치기 전에 실행 중 AI 0개 확인.
- 색인 비용: 문서 수백 개 규모라 전체 재색인도 1초 안쪽 목표. 넘으면 바뀐 ref 만.
- 2글자 한국어 검색은 LIKE 라 느릴 수 있음(규모상 문제 없음).



## 11. 통합 결정 1 (2026-11-06, 코디네이터)

레인 감사에서 나온 질문에 대한 결정. contract.ts 도 함께 바꿨다(커밋 메시지 "계약 결정 1").

1. **20,000자 상한**은 읽기 결과(search·fetch·related·schema)의 직렬화 JSON 전체에 건다. 쓰기 결과(create·write·tag·archive·act)는 본문을 돌려주지 않는 영수증이라 상한 대상이 아니다. act 는 이미 actions 30개로 잘리고 결과에 본문이 없다.
2. **409**: current = DocsConflict {version, md(앞 8,000자), truncated}. 전체 본문은 fetch 를 offset 으로 이어 읽는다. 413 은 쓰기 본문이 너무 클 때만(md 200,000자 초과).
3. **마이그레이션**: L1 은 initDocs(db) 를 내보내고 server.ts 시작부(initWorks 옆)에서 부른다(L1 이 server.ts 의 그 한 줄과 /api/docs 라우팅을 소유). 시작 때 표가 이미 있으므로 ops/report·스케줄러 앞 preflight 는 필요 없다. ops.ts 는 프롬프트 한 줄만.
4. **색인 갱신**: 노트 쓰기(notes.ts writeAgentNote, works.ts 노트 PUT, docs 연산)는 즉시 그 ref 를 다시 색인한다. 할 일·사건의 제목·상태 변경은 따로 훅을 걸지 않고, 증분 색인(items·signals·work_notes 의 updated_at > 마지막 색인 시각)을 search·fetch 호출 때와 60초 타이머로 돈다.
5. **원본이 사라진 노트**: 색인 행을 지우지 않는다. 마지막으로 본 제목·종류를 유지하고 status=archived(태그 상태/보관). 처음부터 원본이 없으면 제목 = 노트 첫 줄, kind 는 ref 접두로 정한다. 회사 판 항목의 노트는 색인하지 않는다(개인 판·내 사건·내 대화·내 문서만). 한 번 개인 판 것으로 색인됐다가 원본이 사라진 경우는 남긴다.
6. **노트 버전과 화면**: 일 상세 GET 의 note 에 version 과 md 를 넣는다. PUT /api/work/:ref/note 본문 {html, text, md?, expectedVersion?}. expectedVersion 이 있으면 엄격하게 확인(어긋나면 409 + DocsConflict), 없으면 예전처럼 받되 응답에 새 version 을 준다(L4 통합 전에도 화면이 깨지지 않게). 응답 {ok, updated_at, version}. 새 노트의 첫 version 은 1. 사람 저장은 html·text·md 를 한 트랜잭션으로 함께 바꾸고 md 가 없으면 HtmlToMarkdown(코디네이터가 L2 것을 꽂음, 없으면 text)으로 만든다. resolveRef 는 doc:<id>·run:<threadId> 도 받는다(독립 문서와 대화 노트도 같은 PUT 경로로 고친다).
7. **write 의미**: applied = 실제로 반영된 편집 수(append·replace 는 1), suggested = 사람 글 보호로 "## AI 제안" 덧붙이기로 바뀌었으면 true, warnings = no_match·ambiguous·duplicate 같은 코드 문자열.
8. **fetch 이어 읽기**: offset·nextOffset 은 markdown 문자 위치. 끝이면 nextOffset 없음. 이어 읽는 동안 version 이 바뀌면 호출자가 처음부터 다시 읽는다(응답 version 비교).
9. **검색 질의 인코딩**: 배열은 쉼표로(kinds=todo,doc&tags=영역/업무,ai/초안). 시각은 모두 ms epoch 숫자(updatedAt, since). drafts 기본 include, 화면 기본 exclude. SearchHit.tags 는 {tag, by} 목록이고 personEdited 를 함께 준다. related 는 잘렸으면 truncated=true.


10. **빈 노트 첫 저장(결정 1 보충)**: 노트가 없을 때 expectedVersion 은 0 이다. PUT 에 expectedVersion:0 이 오면 "아직 없을 때만 만들기"로, 이미 있으면 409 + DocsConflict. 서버 판별: 일 상세 GET 응답 최상위에 noteVersioning: true 를 넣는다(노트가 null 이어도). 화면은 noteVersioning 이 true 면 항상 expectedVersion 을 보내고(없는 노트는 0), false·없음이면 옛 서버로 보고 예전처럼 저장하되 충돌 보호 꺼짐을 표시한다. 버전 확인과 쓰기는 한 트랜잭션.



## 12. 메타데이터 (2026-11-06, 사용자 지시: "중요한 건 메타데이터")

노션 속성과 옵시디언 frontmatter 처럼, 문서마다 기본 메타데이터와 사용자 속성을 보고 고칠 수 있어야 한다. contract.ts 에 PropType·DocProp·MetaInput·PropsInput·NoteSource 와 DocsOps.meta·props·note 를 더했다. 구현은 레인 L5(서버), 화면은 L4.

- 기본 메타데이터: 제목, 영역, 상태(열림·끝남·보관), 날짜(목표 due / 할 일 remindAt), 태그, 종류, 만든·고친 시각, 출처. 할 일·목표·독립 문서는 제목·영역·상태·날짜를 고칠 수 있고(원본 일도 함께 바뀜, 보드 기록에 남김), 사건·대화는 상태만. 보관 문서는 메타 수정 400.
- 사용자 속성: 키는 자유(예: 회사, 금액, 단계, 담당, 링크). 타입은 키마다 하나(text·number·date·datetime·checkbox·url·select·list), 처음 쓸 때 정하거나 값으로 추론, 이후 같은 키는 같은 타입만. 기본 메타데이터 이름은 키로 못 쓴다(RESERVED_PROP_KEYS).
- 저장: doc_props(owner, ref, key, value JSON, by, updated_at) + doc_prop_types(owner, key, type). 바뀌면 문서 version +1, 색인·거울에 반영.
- 조회: fetch frontmatter 와 search 결과에 props·due. search 에 속성 조건(eq·neq·exists·missing·gt·gte·lt·lte·contains)과 속성 정렬(prop:<key>). schema 에 쓰인 속성 키·타입·개수·select 값 목록.
- 거울: frontmatter 에 사용자 속성을 키 그대로(옵시디언에서 속성으로 보임). due 도.
- REST: PATCH /api/docs/:ref/meta, POST /api/docs/:ref/props, GET /api/docs/:ref/note (편집기 원문, 보관 포함), PUT /api/docs/:ref/note (일 노트 PUT 과 같은 규칙: expectedVersion·0·409). search 쿼리 props=key:op:value(쉼표 구분, 값 URL 인코딩), sort=prop:key.
- GET /api/docs/:ref/note 의 선택 필드 markdownEditable(REST 만, MCP·운영 순회는 이 경로를 쓰지 않음): iOS 가 md 로 고쳐도 사람이 쓴 웹 서식을 잃지 않는 노트인지. 판정 규칙과 이유는 [모바일 IA](mobile-ia.md#노트-편집). 웹은 이 필드를 쓰지 않아요.
- MCP: board_act 에 {"do":"meta", ref, ...} 와 {"do":"props", ref, set, remove} 추가, board_search 입력에 props·sort 확장. /api/act 도 같은 두 동작.
- 화면(L4): 문서 페이지 제목 아래 노션식 속성 줄 — 기본 메타데이터 행(영역 선택, 상태, 날짜 선택기, 태그 칩) 다음 사용자 속성 행들, "+ 속성 추가"(키 입력 + 타입 고르기), 값 클릭해서 고치기, 행 메뉴로 삭제. 목록 표 보기에서 속성을 열로 고르고, 속성으로 거르고 정렬.


L5 구현 메모(서버, 2026-11-06)
- 저장: doc_props·doc_prop_types·doc_status 표, docs.due·docs.done·doc_index.due 칸 추가만. 키는 1~40자(글자·숫자로 시작, 글자·숫자·공백·_-./), 예약 키는 대소문자 무시로 거부. 값 null = "값 없는 속성". 문서당 30개·JSON 4,000자 상한(읽기 20,000자 상한 보호). 마지막으로 쓰던 문서에서 지우면 그 키의 타입도 풀린다.
- version: 속성 변경은 +1. 기본 메타데이터(제목·영역·상태·날짜)는 색인이 바뀐 값을 볼 때 +1 — 보드 화면에서 바꾼 제목·완료도 포함되므로, 낡은 version 의 meta·노트 저장은 409. 화면은 meta·props 응답의 version 으로 편집기 version 을 갱신해야 한다.
- 대화(run:) 상태는 runs 를 건드리지 않고 doc_status 에 그때 본 실행 기록 서명(basis: 실행 id·상태·updated_at)과 함께 둔다. 실행 기록이 바뀌면(새 실행·상태 변화, 같은 밀리초여도) 실행 상태를 다시 따른다.
- REST props 쿼리는 원문 구분자(: ,)가 그대로면 값을 한 번, URLSearchParams 로 감싼(%3A %2C) 쿼리면 바깥을 풀고 값을 한 번 디코딩한다. sort 는 relevance|updated|prop:키|-prop:키 (contract SearchInput.sort 타입도 넓힘). fetch frontmatter 에 due·props(DocProp[]), schema.areas 에 개인 판 영역 이름도 합침, schema.props 의 options 는 select·list.

## 13. 문서 보기 4종 (2026-11-07, 사용자 요청: "웹 뷰에서 맥 Finder 처럼 as Icons / as List / as Columns / as Gallery")

계획과 검증 기록: [devlog/_plan/261107_finder_views](../../devlog/_plan/261107_finder_views/000_plan.md). 근거 조사: Aside 리서치(/Users/jun/.aside/u/0/artifacts/finder-views/research.md).

- 대상은 `#/docs` 목록 화면만이다. 전체화면 문서(`#/docs/<ref>`)는 그대로 두고 보기에서 더블클릭·열기로 간다.
- 미리보기 데이터: SearchHit 에 선택 필드 excerpt(본문 앞 160자 평문)·cover(본문 첫 이미지, http(s) 또는 / 로 시작, 코드 블록 안 제외, 없으면 null)를 검색 때 본문에서 계산한다([preview.ts](../../apps/server/server/docs/preview.ts)). 저장 칸은 늘리지 않는다. 옛 서버·클라이언트와 호환되도록 둘 다 선택 필드이고 MCP board_search outputSchema 에도 선택 필드로 넣었다. 본문은 목록에 싣지 않고, 미리보기 패널·빠른 미리보기가 고른 문서만 `view=markdown&maxChars=4000` 으로 읽는다.
- 목표 진행률(`progress`): `kind === "goal"` 인 문서(`item:<bid>:<goalId>`)는 검색(`SearchHit.progress`)과 조회(`FetchResult.frontmatter.progress`), MCP `board_search` 응답에 선택 필드 `progress: { done, total }`를 함께 실어 보낸다. 노트가 없는 할 일도 세기 위해 `doc_index`가 아니라 보드 `items`와 `work_links` 원본에서 계산한다([works.ts](../../apps/server/server/works.ts), [order.ts](../../packages/contracts/src/order.ts)).
- 20,000자 응답 상한: excerpt 가 붙어 한 쪽이 상한을 넘으면 서버가 결과를 줄이고 nextCursor 를 준다(기존 규칙). 화면은 한 쪽 50개를 요청하고, 아이콘·열·갤러리 보기는 1,000개까지 다음 쪽을 이어 읽는다. 서버 hint 는 AI 용 영어 안내라 화면에 보이지 않고 "N개 중 M개 표시"와 더 보기로 알린다.
- 열 보기 계층은 폴더 없이 세 축으로 만든다: 종류 → 영역 → 문서, 태그 계층(`/` 접두사 트리, 한 문서가 여러 경로에 나옴), 링크 따라가기(related direction=both, 고른 문서만 읽음). 순환은 막지 않고 지나온 문서에 ↻ 를 붙인다. 접근성은 열마다 독립 role=listbox(aria-activedescendant), 아이콘·갤러리·목록은 roving tabindex.
- 보기 키: Finder 의 ⌘1~4 는 브라우저 탭 전환과 겹치고 Windows·Linux 의 Ctrl+1~4 도 탭 전환이라, 입력·메뉴·대화상자 밖에서 숫자 1~4 만 쓴다. 화면 도구줄에 키를 보여 준다.
- 제목 바로 고치기(Enter)는 문서 속성 패널과 같은 meta 저장 규칙을 쓴다: 시작할 때 version 을 읽고 PATCH /meta 에 expectedVersion 으로 보낸다. 오류 분류(409 보존·400/413 거부·그 밖 확인 불가)는 [meta-save.ts](../../apps/web/src/lib/meta-save.ts) 하나를 두 곳이 같이 쓴다.
- 상태: view·size·group·axis·sel 은 주소에 replaceState 로(라우트 이벤트 없음), 같은 값을 localStorage `db:docs-view` 에 둔다. 주소 값이 먼저다.
- 성능: 수백 개 규모라 가상 스크롤 라이브러리 없이 content-visibility:auto 와 contain-intrinsic-size 로 화면 밖 카드·행의 그리기를 건너뛴다. 카드 크기는 CSS 변수라 슬라이더를 움직여도 카드를 다시 만들지 않는다. 수천 개가 되면 @tanstack/react-virtual 을 붙일 자리다.
