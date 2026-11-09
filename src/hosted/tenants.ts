// 사람마다 따로 쓰는 저장소(테넌트). 공개 리스너에서 로그인한 이메일로 테넌트를 고르고, 모든 /api·SSE·/api/ws·/mcp 가 그 테넌트만 봐요.
// 격리는 조건문이 아니라 파일로 해요: 비소유자는 .quorum/tenants/<sha256(email) 앞 24자>/ 에 자기 quorum.db·workspace.db 를 따로 열어요.
// 그래서 다른 사람 runId·사건 id 를 알아도 자기 DB 에는 없어서 404 예요. 소유자(QUORUM_OWNER_EMAIL, 로컬 리스너)만 이 맥의 실행기를 가진 테넌트를 써요.
import type { Store } from "../engine/store"
import type { RunManager } from "../engine/runs"
import type { User } from "../engine/access"
import type { Health, Listener, RecipesModule } from "../server"
import type { McpQueue } from "../engine/mcp"

export type TenantRole = "owner" | "guest"
export type StartResult = { runId: string } | { status: number; error: string }
export type Tenant = {
  email: string | null
  role: TenantRole
  key: string
  store: Store
  runs: RunManager
  /** /api/ws/* 처리(테넌트의 workspace.db). me 는 로그인한 이메일 */
  workspace?: (req: Request, parts: string[], me?: string | null) => Promise<Response>
  memory: (q: string) => Promise<unknown>
  recipes: () => Promise<RecipesModule | null>
  health: () => Promise<Health & { mode?: string }>
  /** 의회 열기. 비소유자는 속도·길이 제한을 여기서 걸어요 */
  start: (request: string) => StartResult
  /** MCP quorum_propose 를 보여 줄지 */
  mcpPropose: boolean
  /** 호스팅 비소유자의 작업 대기열 MCP 도구 */
  queue?: McpQueue
}

export const tenantKey = (email: string) => new Bun.CryptoHasher("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24)

/** 테넌트 하나를 만들어요. start 를 주지 않으면 runs.start 그대로 */
export function tenantFrom(p: Omit<Tenant, "key" | "start"> & { start?: Tenant["start"] }): Tenant {
  return { ...p, key: p.email ? tenantKey(p.email) : "owner", start: p.start ?? ((request) => ({ runId: p.runs.start(request).runId })) }
}

export type TenantRegistry = {
  resolve: (user: User | null, listener: Listener) => Tenant | { status: number; error: string }
  owner: Tenant
  guests: () => Tenant[]
}

export function createTenants(o: { owner: Tenant; ownerEmail: string | null; makeGuest: (email: string, key: string) => Tenant; maxGuests?: number }): TenantRegistry {
  const guests = new Map<string, Tenant>()
  const ownerEmail = o.ownerEmail?.trim().toLowerCase() || null
  const max = o.maxGuests ?? 200
  function resolve(user: User | null, listener: Listener): Tenant | { status: number; error: string } {
    // 로컬 리스너는 이 맥 안에서 온 요청만 들어와요(local-guard). 그 사람은 맥 주인이에요
    if (listener === "local") return o.owner
    if (!user?.email) return { status: 401, error: "login required" }
    const email = user.email.trim().toLowerCase()
    // 소유자 이메일을 정하지 않았으면 공개 리스너의 누구도 이 맥의 실행기를 쓰지 못해요
    if (ownerEmail && email === ownerEmail) return o.owner
    const have = guests.get(email)
    if (have) return have
    if (guests.size >= max) return { status: 503, error: "this Quorum is full right now; ask the host to raise QUORUM_MAX_GUESTS" }
    const t = o.makeGuest(email, tenantKey(email))
    guests.set(email, t)
    return t
  }
  return { resolve, owner: o.owner, guests: () => [...guests.values()] }
}
