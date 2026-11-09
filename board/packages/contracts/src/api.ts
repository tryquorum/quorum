// 출처: 웹이 이 패키지에서 다시 내보내요(apps/web/src/lib/api.ts). GET /api/signals, GET /api/state.
export type Lane = 'now' | 'decide' | 'review' | 'running' | 'auto' | 'main' | 'info'

export type Signal = {
  id: string
  ref: string | null
  source: string
  kind: string
  title: string
  body: string | null
  url: string | null
  area: string | null
  task: string | null
  agent: string | null
  lane: Lane
  reason: string | null
  needs_ai: boolean
  status: 'open' | 'resolved' | 'snoozed'
  private: boolean
  sample: boolean
  due: number | null
  meta: Record<string, unknown> | null
  created_at: number
  updated_at: number
  resolved_at: number | null
  /** 공간(apps/server/server/spaces.ts). 옛 서버는 주지 않아요 → 개인 */
  space?: SpaceId
}
export type Collector = {
  name: string
  ok: number
  note: string | null
  last_seen: number
  last_ok: number | null
  every_min: number | null
  sample: number
}
export type Rule = {
  id: string
  source: string | null
  kind: string | null
  contains: string | null
  lane: Lane
  note: string | null
}
export type SignalsResponse = {
  signals: Signal[]
  collectors: Collector[]
  rules: Rule[]
  stats: { interrupts_today: number }
}

export type Area = { id: string; name: string; color: string }
// 출처: apps/server/server/spaces.ts (GET /api/spaces, /api/state·/api/changes 의 spaces). 설계: docs/internals/spaces.md
/** 공간 id: 개인은 "personal", 워크스페이스는 ws_ + 12 hex */
export type SpaceId = 'personal' | `ws_${string}`
export type Space = { id: SpaceId; kind: 'personal' | 'workspace'; name: string }
export type SpacesResponse = { spaces: Space[] }
// 출처: apps/server/server/issues.ts (POST/GET /api/issues, PATCH /api/issues/:id). 파일럿의 "이슈 보내기"
export type IssueUrgency = 'low' | 'normal' | 'high' | 'urgent'
/** received 접수, in_progress 진행, done 끝(회사 공간 할 일을 끝내면 끝) */
export type IssueStatus = 'received' | 'in_progress' | 'done'
export type Issue = {
  id: string; title: string; body: string; urgency: IssueUrgency; status: IssueStatus; reporter: string
  /** 이 이슈가 들어간 회사 공간 할 일. merged 면 같은 제목의 열린 할 일에 합쳐졌어요 */
  itemRef: string; merged: boolean
  files: { name: string; type: string; size: number; url: string }[]
  createdAt: number; updatedAt: number
}
export type IssuesResponse = { issues: Issue[] }
/** /api/state 의 me. role·issues 는 파일럿(Google 로그인) 서버만 줘요 */
export type Me = { email: string; agent?: boolean; role?: 'admin' | 'member'; issues?: boolean; auth?: 'access' | 'google' }
// 출처: apps/server/server/access.ts (GET /api/access, POST·DELETE /api/access/rules, PATCH /api/access/members/:email). 관리자만
export type AccessRule = { kind: 'email' | 'domain'; value: string; addedBy: string; addedAt: number }
/** allowed: 지금 허용 규칙에 맞는지(규칙을 지우면 false, 들어올 수 없어요) */
export type AccessMember = { email: string; role: 'admin' | 'member'; disabled: boolean; name: string | null; firstLoginAt: number | null; lastLoginAt: number | null; allowed: boolean }
export type AccessAudit = { id: number; actor: string; at: number; action: string; target: string; detail: string | null }
export type AccessResponse = { rules: AccessRule[]; members: AccessMember[]; audit: AccessAudit[] }
export type Board = {
  id: string
  name: string
  kind: 'personal' | 'company'
  mine: boolean
  deleted: boolean
  areas: Area[]
}
export type Item = {
  id: string
  boardId: string
  type: 'sticky' | 'text' | 'goal' | 'frame' | 'todo' | 'link'
  text: string
  x: number
  y: number
  w: number
  h: number
  z?: number
  done?: boolean
  due?: string | null
  remindAt?: string
  area?: string
  goalId?: string
  deleted?: boolean
  /** 공간. 서버는 늘 보내고, 보내지 않은 PUT 은 기존 공간을 지켜요 */
  space?: SpaceId
  [k: string]: unknown
}
export type StateResponse = { me: Me; seq: number; boards: Board[]; items: Item[]; spaces?: Space[] }
export type ChangesResponse = { seq: number; boards: Board[]; items: Item[]; spaces?: Space[] }
// 출처: apps/server/server/runs.ts (GET/POST /api/runs).
export type ErrorKind =
  'interrupted' | 'aside_offline' | 'launch' | 'auth' | 'rate_limit' | 'model' | 'network' | 'unknown'

export type RunThread = {
  id: string
  first: string
  last_status: Run['status']
  last_at: number
  count: number
  target: string | null
  model_name: string | null
}

/** AI 실행 하나 (aside exec). 대화(chat), 노트 초안(draft), 운영 순회(sweep), AI로 할 일 추가(capture) */
export type Run = {
  id: string
  target: string | null
  prompt: string
  provider: string
  model: string
  model_name: string | null
  effort: string | null
  status: 'running' | 'done' | 'error' | 'stopped'
  session_id: string | null
  parent: string | null
  thread?: string | null
  output: string
  error: string | null
  error_kind: ErrorKind | null
  retry_of: string | null
  last_activity_at: number | null
  created_at: number
  finished_at: number | null
  kind?: 'chat' | 'draft' | 'sweep' | 'capture'
  /** capture 의 힌트(CaptureHints JSON) */
  hints?: string | null
  applied?: number
  steps?: { tool: string; arg: string }[]
}
// 출처: apps/server/server/capture.ts (POST /api/runs kind:'capture', GET /api/runs/:id/effects, POST /api/runs/:id/undo).
/** 빠른 추가에서 같이 보내는 힌트. 영역은 이름, 날짜는 YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM */
export type CaptureHints = {
  area?: string
  at?: string
  tags?: string[]
  type?: 'todo' | 'goal'
  props?: { key: string; type: string; value: string }[]
}
export type CaptureStart = { kind: 'capture'; prompt: string; clientKey: string; hints?: CaptureHints; page?: unknown; provider?: string; model?: string; effort?: string }
/** created: 새로 만듦, decision: 결정 칸 사건, merged: 기존 일에 덧붙임, updated: 기존 일을 고침 */
export type CaptureEffectOp = 'created' | 'decision' | 'merged' | 'updated'
export type CaptureEffect = {
  ref: string
  op: CaptureEffectOp
  title: string
  at: number
  run: string
  undone: boolean
  /** 서버 판정: 이 실행이 만든 할 일·결정이고 그 뒤 아무도 바꾸지 않았음 */
  undoable: boolean
  /** 지금 상태. 되돌렸거나 사라졌으면 null */
  now: { title: string; type: string; area: string | null; due: number | null; status: string } | null
}
/** runs: 다시 시도 계보(최신 → 처음) */
export type CaptureResponse = { run: Run; runs: string[]; effects: CaptureEffect[] }

// 출처: apps/server/server/ops.ts (GET/PUT /api/ops, POST /api/ops/run, POST /api/ops/report?sweep=<토큰>). 웹 설정 › 운영 순회와 사이드바 순회 칩이 읽어요.
export type OpsSettings = {
  owner: string
  text: string
  enabled: boolean
  every_min: number
  active_from: number
  active_to: number
  provider: string | null
  model: string | null
  effort: string | null
  updated_at: number
  last_run_at: number | null
  last_run_id: string | null
  /** 지시문(text)을 쓸 때마다 1씩 올라요. text 와 함께 보낸 base_rev 가 다르면 409. 설정만 바꾸면 그대로예요 */
  rev: number
}
/** signal: 올린 사건, card: 새 할 일, merged: 기존 할 일에 더함, closed: 끝나서 닫은 카드 */
export type OpsReportItem = { ref: string; title: string; kind: 'signal' | 'card' | 'merged' | 'closed'; lane?: string }
export type OpsReportCounts = { signals: number; cards: number; merged: number; skipped: number; closed: number; checked: number; notes: number; errors: number }
/** 그 순회가 보낸 보고. 보고 없이 끝난 순회는 null */
export type OpsReport = { summary: string; counts: OpsReportCounts; items: OpsReportItem[]; at: number }
export type OpsRun = {
  id: string
  status: Run['status']
  model_name: string | null
  effort: string | null
  session_id: string | null
  error: string | null
  created_at: number
  finished_at: number | null
  report: OpsReport | null
  /** ?lite=1 이면 빠져요 */
  prompt?: string
  output?: string
}
export type OpsResponse = {
  ops: OpsSettings
  runs: OpsRun[]
  /** 다음 자동 순회가 시작될 수 있는 시각(활동 시간 반영). 꺼져 있으면 null */
  next_at: number | null
  in_window: boolean
  /** ?lite=1 이면 빠져요 */
  default_text?: string
}
// 출처: ./docs.ts SearchResult·FetchResult; apps/server/server/docs/api.ts (문서 목록과 본문).
export type { SearchResult as DocsListResponse, FetchResult as DocResponse } from './docs.ts'
// 출처: apps/server/server/actions.ts (POST /api/act).
export type ActResponse = {
  results: { ok: boolean; do: string; ref?: string; error?: string; existing?: boolean; unchanged?: boolean }[]
}
