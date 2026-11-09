// 문서 층 계약: 서버(코어·거울·MCP)·웹·모바일이 함께 쓰는 타입. 설계: docs/internals/docs-layer.md
// 이 파일은 타입만 둔다. 바꾸려면 설계 문서와 함께 바꾸고 다른 레인에 알린다.
import type { GoalProgress } from "./order.ts"
export type { GoalProgress }

export type DocKind = "todo" | "goal" | "signal" | "run" | "doc"
export type DocStatus = "open" | "done" | "archived"
export type TagBy = "auto" | "person" | "agent" | "body"

/**
 * 사용자 속성(노션 속성·옵시디언 frontmatter). 타입은 키 이름마다 하나(옵시디언처럼 판 전체에서 같은 키는 같은 타입).
 * 키: 1~40자, 글자·숫자로 시작, 글자·숫자·공백·_-./ 만(REST props=key:op:value 와 YAML 키에 안전). 값 null 은 "값 없는 속성"
 */
export type PropType = "text" | "number" | "date" | "datetime" | "checkbox" | "url" | "select" | "list"
export type PropValue = string | number | boolean | string[] | null
export type DocProp = { key: string; type: PropType; value: PropValue }
/** 사용자 속성 키로 쓸 수 없는 이름(기본 메타데이터) */
/** parent 는 문서 계층(docs/internals/doc-hierarchy.md 7절): 새로 만들기·바꾸기만 막고, 이미 있던 속성은 검색·정렬·지우기가 그대로 */
export const RESERVED_PROP_KEYS = ["ref", "kind", "title", "area", "status", "tags", "links", "version", "created", "updated", "source", "due", "remindAt", "parent"] as const

/** 색인 한 줄 = 문서 하나. ref 는 item:<bid>:<iid> | signal:<id> | run:<threadId> | doc:<id> */
export type DocRecord = {
  owner: string
  ref: string
  kind: DocKind
  title: string
  area: string | null
  status: DocStatus
  source: string | null
  tags: { tag: string; by: TagBy }[]
  links: { ref: string; label: string; direction: "out" | "in" }[]
  md: string
  version: number
  personEdited: boolean
  /** 사용자 속성. 거울 frontmatter 에도 그대로 나간다 */
  props: DocProp[]
  /** 기본 메타데이터 중 날짜: 목표 마감(due) 또는 할 일 알림(remindAt), YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM */
  due: string | null
  createdAt: number
  updatedAt: number
  /** 부모 독립 문서 ref(맨 위면 null). 독립 문서만 계층을 가져요 */
  parent?: string | null
  /** 거울 경로에 쓸 조상 폴더 이름(맨 위부터). 서버 거울이 채워요 */
  folders?: string[]
}

/** 사람 노트(Tiptap html) → 마크다운. L2 가 구현하고 코디네이터가 L1 에 꽂는다. 없으면 L1 은 평문(text)을 쓴다 */
export type HtmlToMarkdown = (html: string) => string

/** L2 거울이 받는 것. L1 은 문서가 바뀔 때 upsert, 사라질 때 remove, 시작할 때 rebuild 를 부른다 */
export interface VaultSink {
  upsert(doc: DocRecord): Promise<{ path: string }>
  remove(owner: string, ref: string): Promise<void>
  rebuild(owner: string, docs: DocRecord[]): Promise<{ written: number; removed: number }>
}

export type SearchInput = {
  q?: string
  kinds?: DocKind[]
  tags?: string[]
  area?: string
  status?: DocStatus
  since?: number
  sort?: "relevance" | "updated" | "tree" | `prop:${string}` | `-prop:${string}`
  /** AI 초안(ai/초안 태그 = 사람이 안 고친 에이전트 노트) 처리. 기본 include. 화면 기본 보기는 exclude */
  drafts?: "include" | "exclude" | "only"
  /** 속성 조건(AND). REST 는 props=key:op:value 를 쉼표로(값은 encodeURIComponent) */
  props?: { key: string; op: "eq" | "neq" | "exists" | "missing" | "gt" | "gte" | "lt" | "lte" | "contains"; value?: PropValue }[]
  /** 정렬에 속성 키도 허용: sort="prop:<key>" (오름차순), "-prop:<key>" (내림차순) */
  limit?: number
  cursor?: string
  /** 계층: 부모가 이 문서인 독립 문서만(null = 맨 위). 주면 kinds 는 doc 로 좁혀져요. sort "tree"(형제 순서)는 parent 와 함께만 */
  parent?: string | null
  /** 같은 제목 찾기: normTitle 이 이 값과 같은 문서만(q 는 무시). 4자 미만이면 빈 결과. 화면의 같은 제목 경고용 */
  sameTitle?: string
  /** 공간(personal·워크스페이스 id·이름). 할 일·목표·사건은 그 공간 것만, 문서·대화는 개인으로 봐요. 모르는 값은 400 */
  space?: string
}
/**
 * 검색 결과 한 줄(본문 없음). snippet 은 검색어 근처 원문 200자.
 * excerpt·cover 는 카드·갤러리 미리보기용 선택 필드: excerpt 는 본문 앞 160자 평문, cover 는 본문 첫 이미지 주소(http(s) 또는 /…, 없으면 null).
 * 옛 서버는 두 필드를 주지 않으므로 받는 쪽은 없을 때를 처리해요
 */
/** parent·children 은 계층(독립 문서만, 옛 서버는 주지 않음): 부모 ref(맨 위 null), 살아 있는 자식 수. progress 는 목표만 */
/** space 는 공간(personal 또는 워크스페이스 id, 옛 서버는 주지 않음) */
export type SearchHit = { ref: string; kind: DocKind; title: string; snippet: string; tags: { tag: string; by: TagBy }[]; personEdited: boolean; area: string | null; status: DocStatus; due: string | null; props: DocProp[]; updatedAt: number; path: string | null; excerpt?: string; cover?: string | null; progress?: GoalProgress; parent?: string | null; children?: number; space?: string }
export type SearchResult = { results: SearchHit[]; total: number; nextCursor?: string; hint?: string }

export type FetchInput = { ref: string; view?: "markdown" | "outline" | "meta" | "section"; section?: string; maxChars?: number; offset?: number }
export type FetchResult = {
  ref: string
  kind: DocKind
  title: string
  version: number
  frontmatter: Record<string, unknown>
  markdown: string
  outline?: { level: number; title: string; path: string }[]
  truncated: boolean
  nextOffset?: number
  links: { out: number; in: number }
  /** 계층: 맨 위부터 부모까지(독립 문서만, 옛 서버는 주지 않음). frontmatter.parent 에도 부모 ref */
  ancestors?: { ref: string; title: string }[]
}

export type RelatedInput = { ref: string; direction?: "out" | "in" | "both"; depth?: 1 | 2; limit?: number }
export type RelatedResult = { edges: { label: string; direction: "out" | "in"; node: { ref: string; kind: DocKind; title: string; status: DocStatus } }[]; truncated: boolean }

export type SchemaResult = {
  kinds: DocKind[]
  statuses: DocStatus[]
  areas: string[]
  tags: { tag: string; count: number }[]
  /** 쓰이고 있는 사용자 속성 키와 타입, 쓰인 문서 수. select 는 쓰인 값 목록(options) */
  props: { key: string; type: PropType; count: number; options?: string[] }[]
  linkLabels: string[]
  fields: string[]
  /** 쓸 수 있는 공간(옛 서버는 주지 않음). board_act task·update 의 space 와 검색 space 에 넣는 값 */
  spaces?: { id: string; name: string }[]
}

/**
 * 문서 만들기. id 는 선택(소문자 UUID): 그 id 로 만들고, 같은 id·같은 요청을 다시 보내면 새로 만들지 않고 처음 결과(existing:true)를 돌려준다.
 * 같은 id 로 다른 요청을 보내면 409. 응답을 놓친 만들기를 안전하게 다시 보내려고 둔다(REST POST /api/docs 만, /api/act 의 doc 은 제목 합치기 규칙 그대로)
 */
export type CreateInput = { title: string; md: string; area?: string; tags?: string[]; links?: string[]; id?: string; /** 부모 독립 문서 ref. 보내면 멱등 해시에도 들어가요(생략한 요청의 해시는 그대로) */ parent?: string }
/**
 * 문서 옮기기(독립 문서만). parent null = 맨 위. before·after 는 하나만(새 부모의 살아 있는 자식), 둘 다 없으면 맨 뒤.
 * 자기·자손 아래로(순환), 8단 넘김은 409. 노트 version·updated_at 은 그대로
 */
export type MoveInput = { ref: string; parent: string | null; before?: string; after?: string }
export type WriteEdit = { heading?: string; op: "append" | "replace"; md: string } | { oldStr: string; newStr: string }
/**
 * idempotencyKey: 같은 요청의 영수증을 다시 줘요(본문이 다르면 400).
 * onceKey(선택, 예 "run:<실행 id>"): 같은 (ref, 키) 는 한 번만 적용해요. 다시 오면 버전 검사보다 먼저 applied 0·duplicate true. 있으면 append 의 본문 포함 판정을 하지 않아요
 */
export type WriteInput = { ref: string; mode: "append" | "replace" | "patch"; md?: string; edits?: WriteEdit[]; expectedVersion?: number; idempotencyKey?: string; onceKey?: string }
export type WriteResult = { ref: string; version: number; applied: number; suggested?: boolean; warnings: string[]; duplicate?: boolean }

/** 기본 메타데이터 고치기. 할 일·목표(item:)와 독립 문서(doc:)만. 사건(signal:)·대화(run:)는 status 만. 보관(원본 없음)은 400 */
export type MetaInput = { ref: string; title?: string; area?: string | null; status?: "open" | "done"; due?: string | null; expectedVersion?: number }
/** 사용자 속성 고치기. set 의 값은 그 키의 타입으로 검사(타입이 없던 새 키는 types 로 정하거나 값으로 추론). remove 는 키 삭제 */
export type PropsInput = { ref: string; set?: Record<string, PropValue>; types?: Record<string, PropType>; remove?: string[]; expectedVersion?: number }
/** 편집기용 원문. 보관 문서(원본 일이 지워진 노트)도 포함 */
/**
 * markdownEditable(REST 만, 선택): iOS 가 md 로 고쳐도 사람이 쓴 웹 서식을 잃지 않는 노트인지. 서버가 엄격 HTML→md 변환이
 * 저장된 md 와 같을 때만 true. 없으면 false 로 읽어요(옛 서버)
 */
/** onceKey: 이 서버가 docs write 의 onceKey 를 지켜요(없으면 옛 서버 — 결과 불명 뒤 자동 재전송을 하지 않아요) */
/** onceApplied: GET ...note?onceKey=<키> 로 물었을 때만 — 그 키가 이 노트에 이미 적용됐는지(앱 복구의 읽기 확인, PR #39 리뷰 9) */
export type NoteSource = { ref: string; html: string; md: string; version: number; personEdited: boolean; markdownEditable?: boolean; onceKey?: boolean; onceApplied?: boolean }

/** 409 때 함께 주는 지금 상태. md 는 앞 8,000자까지, 더 있으면 truncated=true (전체는 fetch 를 offset 으로 이어 읽기) */
export type DocsConflict = { version: number; md: string; truncated: boolean }

/** 오류는 status 와 고칠 방법 한 줄. 409 는 current 를 같이 준다 */
export class DocsError extends Error {
  // 웹 tsconfig 의 erasableSyntaxOnly 로도 읽히게 매개변수 속성 대신 필드를 직접 둬요.
  status: number
  current?: DocsConflict
  constructor(status: number, message: string, current?: DocsConflict) {
    super(message)
    this.status = status
    this.current = current
  }
}

/** REST(/api/docs) 와 MCP(/mcp) 가 함께 부르는 연산. owner 는 호출한 사람 */
export interface DocsOps {
  search(owner: string, input: SearchInput): SearchResult
  fetch(owner: string, input: FetchInput): FetchResult
  related(owner: string, input: RelatedInput): RelatedResult
  schema(owner: string): SchemaResult
  create(owner: string, input: CreateInput, by: "person" | "agent"): { ref: string; version: number; existing?: boolean }
  write(owner: string, input: WriteInput, by: "person" | "agent"): WriteResult
  tag(owner: string, ref: string, change: { add?: string[]; remove?: string[] }, by: "person" | "agent"): { ref: string; tags: string[] }
  archive(owner: string, ref: string, archived: boolean): { ref: string; status: DocStatus }
  /** 기본 메타데이터(제목·영역·상태·날짜). 바뀌면 version 이 오른다. expectedVersion 이 어긋나면 409 */
  meta(owner: string, input: MetaInput, by: "person" | "agent"): { ref: string; version: number }
  /** 사용자 속성. 바뀌면 version 이 오른다 */
  props(owner: string, input: PropsInput, by: "person" | "agent"): { ref: string; version: number; props: DocProp[] }
  /** 문서 계층 옮기기(docs/internals/doc-hierarchy.md 4절) */
  move(owner: string, input: MoveInput, by: "person" | "agent"): { ref: string; parent: string | null }
  /** 편집기가 쓰는 노트 원문(html·md·version). 저장은 기존 노트 PUT 과 같은 규칙의 putNote 로. onceKey 를 주면 그 키의 적용 여부(onceApplied)도 */
  note(owner: string, ref: string, onceKey?: string): NoteSource
  /** /api/act 와 같은 actions 묶음. results 는 actions.ts 의 Result 와 같은 모양 */
  act(owner: string, actions: Record<string, unknown>[]): { results: { ok: boolean; do: string; ref?: string; error?: string; existing?: boolean }[] }
}

