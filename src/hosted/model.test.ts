// 선택 api 봇 의견: 도구 없는 chat completions 한 번. 실제 모델은 부르지 않고 가짜 fetch 로 요청 모양을 확인해요.
import { describe, expect, test } from "bun:test"
import { modelAsk, modelFromEnv } from "./model"
import { makeGuestTenant } from "./guest"
import { openHosted } from "./hosted"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("api guest bots", () => {
  test("sends one tool-less chat completion with the key only in the header", async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const fake = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return Response.json({ choices: [{ message: { content: '{"critiques":[]}' } }] }) }) as unknown as typeof fetch
    const ask = modelAsk({ url: "https://api.example/v1/", key: "sk-test", model: "m1", fetch: fake })
    expect(await ask("hello")).toBe('{"critiques":[]}')
    expect(seen[0].url).toBe("https://api.example/v1/chat/completions")
    const body = JSON.parse(String(seen[0].init.body))
    expect(body.model).toBe("m1")
    expect(body.tools).toBeUndefined()
    expect(String(seen[0].init.body)).not.toContain("sk-test")
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe("Bearer sk-test")
  })
  test("HTTP errors and empty answers fail; config needs all three variables", async () => {
    const bad = (async () => new Response("no", { status: 429 })) as unknown as typeof fetch
    await expect(modelAsk({ url: "u", key: "k", model: "m", fetch: bad })("x")).rejects.toThrow("429")
    const empty = (async () => Response.json({ choices: [{ message: { content: "" } }] })) as unknown as typeof fetch
    await expect(modelAsk({ url: "u", key: "k", model: "m", fetch: empty })("x")).rejects.toThrow("empty")
    expect(modelFromEnv({ QUORUM_GUEST_MODEL_URL: "u", QUORUM_GUEST_MODEL_KEY: "k" })).toBeNull()
    expect(modelFromEnv({ QUORUM_GUEST_MODEL_URL: "u", QUORUM_GUEST_MODEL_KEY: "k", QUORUM_GUEST_MODEL: "m" })).toEqual({ url: "u", key: "k", model: "m" })
  })
  test("a guest council in api mode asks the model and still queues the passed browser task for the person's Aside", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorum-api-"))
    try {
      const fake = (async (_u: string, init: RequestInit) => {
        const prompt = JSON.parse(String(init.body)).messages[1].content as string
        const content = prompt.includes("정찰병") ? JSON.stringify({ proposals: [{ title: "Read the page", executor: "aside", why: "w", task: "read", risk: [] }] })
          : prompt.includes("제안 봇") ? JSON.stringify({ proposals: [] }) : JSON.stringify({ critiques: [{ proposalId: "p1", stance: "keep", reason: "ok" }] })
        return Response.json({ choices: [{ message: { content } }] })
      }) as unknown as typeof fetch
      const g = makeGuestTenant({ email: "judge@example.com", key: "k", dir, hosted: openHosted(":memory:"), bots: "api", model: { url: "https://api.example/v1", key: "k", model: "m", fetch: fake } })
      const r = g.start("read the page")
      if (!("runId" in r)) throw new Error("start failed")
      for (let i = 0; i < 200 && g.store.getRun(r.runId)?.status !== "done"; i++) await Bun.sleep(1)
      expect(g.store.getRun(r.runId)?.status).toBe("done")
      expect(g.tasks.counts().queued).toBe(1)
      expect(g.tasks.recent(5).map((t) => t.kind)).toEqual(["browser"])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
