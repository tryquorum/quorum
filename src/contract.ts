export type EventType =
  | "run.start" | "recall" | "proposal" | "critique" | "verdict"
  | "execute.start" | "execute.result"
  | "recipe.run" | "recipe.broken" | "recipe.repaired"
  | "memory.saved" | "board.posted" | "run.end" | "error";

export type QuorumEvent = {
  runId: string;
  seq: number;
  at: string;
  mode: "live" | "replay";
  type: EventType;
  actor: string;
  text: string;
  data?: Record<string, unknown>;
};

export type Executor = "aside" | "codex" | "board" | "none";
export type Role = "ceo" | "reviewer" | "qa" | "cso";
export type Decision = "pass" | "hold" | "reject";

export type RunSummary = {
  runId: string;
  request: string;
  mode: "live" | "replay";
  startedAt: string;
  status: "running" | "done" | "error";
};

export const PORT = Number(process.env.QUORUM_PORT ?? 4317);
