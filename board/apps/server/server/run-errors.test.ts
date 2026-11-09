import { describe, expect, test } from "bun:test"
import { classifyRunError, RUN_ERROR_MESSAGE } from "./run-errors.ts"

describe("run error classification", () => {
  const cases: [string, string, { interrupted?: boolean; spawnError?: boolean }?][] = [
    ["anything", "interrupted", { interrupted: true }],
    ["profile u0 is not connected to the daemon", "aside_offline"],
    ["ECONNREFUSED ENOENT", "aside_offline", { spawnError: true }],
    ["spawn ENOENT", "launch", { spawnError: true }],
    ["spawn EACCES", "launch", { spawnError: true }],
    ["HTTP 401", "auth"], ["403 forbidden", "auth"], ["token expired", "auth"],
    ["HTTP 429", "rate_limit"], ["usage limit", "rate_limit"],
    ["unsupported model", "model"], ["ETIMEDOUT", "network"],
    ["401 429", "unknown"], ["ENOENT", "unknown"], ["login quota", "auth"],
    ["quota unknown model", "rate_limit"], ["unknown model network", "model"],
  ]
  for (const [message, kind, context] of cases) test(`${message} → ${kind}`, () => {
    expect(classifyRunError(message, context)).toBe(kind as any)
    expect(RUN_ERROR_MESSAGE[kind as keyof typeof RUN_ERROR_MESSAGE]).toBeTruthy()
  })
})
