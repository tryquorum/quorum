// Mirror of src/contract.ts (Quorum contract v1, owned by the integration thread). Keep in sync; do not extend here.
export type EventType =
  | "run.start" | "recall" | "proposal" | "critique" | "verdict"
  | "execute.start" | "execute.result"
  | "recipe.run" | "recipe.broken" | "recipe.repaired"
  | "memory.saved" | "board.posted" | "run.end" | "error"
  | "info"

export type QuorumEvent = {
  runId: string
  seq: number
  at: string
  mode: "live" | "replay"
  type: EventType
  actor: string
  text: string
  data?: Record<string, unknown>
}

export type Executor = "aside" | "codex" | "board" | "none"
export type Role = "ceo" | "reviewer" | "qa" | "cso"
export type Decision = "pass" | "hold" | "reject"
export type Stance = "keep" | "cut" | "escalate"

export type RunSummary = {
  runId: string
  request: string
  mode: "live" | "replay"
  startedAt: string
  status: "running" | "done" | "error"
}

export type Health = {
  ok: boolean
  version?: string
  executors?: Partial<Record<"aside" | "codex" | "gbrain" | "board", boolean>>
  details?: Partial<Record<string, { ok: boolean; hint?: string; reason?: string | null; account?: string | null; email?: string | null }>>
}
