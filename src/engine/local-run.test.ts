// 단계 1(자기 맥에서 바로) 시험: gbrain·codex·방향판이 없어도 의회가 돌고, 없는 것은 오류가 아니라 정보로 보여요.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { EventType } from "../contract"
import { runCouncil, type CouncilDeps } from "./council"
import { PROPOSERS, proposalPrompt } from "./roles"
import { boardImportBase, liveHealth } from "../server"
import { createWorkspace, DEMO_TEXT } from "../workspace/api"

type Ev = { type: EventType; actor: string; text: string; data?: Record<string, unknown> }
let dir = ""
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "quorum-local-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe("council without gbrain, codex or Direction Board", () => {
  test("memory off is an info event, never an error; the run still ends done", async () => {
    const events: Ev[] = []
    const prompts: string[] = []
    const deps: CouncilDeps = {
      ask: async (actor, prompt) => {
        prompts.push(prompt)
        if (actor === "bot:scout") return JSON.stringify({ proposals: [{ title: "공지 읽고 정리", executor: "aside", why: "w", task: "t" }] })
        if (actor.startsWith("bot:") && ["bot:builder", "bot:keeper"].includes(actor)) return JSON.stringify({ proposals: [] })
        return JSON.stringify({ critiques: [{ proposalId: "p1", stance: "keep", reason: "ok" }] })
      },
      memoryOff: "gbrain is not installed",
      executors: { aside: async () => ({ summary: "done" }) },
      now: () => 1,
    }
    const r = await runCouncil("r1", "공지 읽어 줘", deps, (type, actor, text, data) => { events.push({ type, actor, text, data }) })
    expect(r.status).toBe("done")
    expect(events.filter((e) => e.type === "error")).toEqual([])
    const info = events.filter((e) => e.type === "info")
    expect(info.length).toBe(1)
    expect(info[0].data).toMatchObject({ stage: "memory", memory: "off" })
    expect(events.find((e) => e.type === "recall")?.data).toMatchObject({ memory: "off" })
    // 쓸 수 있는 실행기만 봇에게 알려요(codex 가 없으면 codex 를 제안하지 않게)
    expect(prompts.filter((p) => p.includes("제안 봇")).every((p) => !p.includes("codex =") && p.includes("aside ="))).toBe(true)
  })
  test("proposalPrompt lists every executor when none is given (unchanged default)", () => {
    const p = proposalPrompt(PROPOSERS[0], "x", [])
    expect(p).toContain("codex =")
    expect(p).toContain("board =")
  })
})

describe("health and Direction Board import are opt-in", () => {
  test("3070 import only with QUORUM_BOARD_IMPORT_URL", () => {
    expect(boardImportBase({})).toBeUndefined()
    expect(boardImportBase({ QUORUM_BOARD_IMPORT_URL: " http://127.0.0.1:3070 " })).toBe("http://127.0.0.1:3070")
    expect(boardImportBase({ QUORUM_BOARD_IMPORT_URL: "http://127.0.0.1:3070", QUORUM_BOARD_IMPORT: "0" })).toBeUndefined()
  })
  test("health reports why each executor is off and how to fix it", async () => {
    const h = await liveHealth({ available: async () => false }, {
      asideBin: async () => true,
      account: async () => ({ account: "u0", email: "me@example.com", source: "detected", reason: null }),
      which: (name) => (name === "codex" ? "/usr/bin/codex" : null),
    })
    expect(h).toMatchObject({ aside: true, codex: true, gbrain: false, board: false })
    expect(h.details.aside).toMatchObject({ ok: true, account: "u0", email: "me@example.com" })
    expect(h.details.gbrain.ok).toBe(false)
    expect(h.details.gbrain.hint).toContain("gbrain")
    expect(h.details.board.hint).toBeTruthy()
    const none = await liveHealth({ available: async () => false }, { asideBin: async () => true, account: async () => ({ account: null, email: null, source: "none", reason: "no signed-in Aside account: run aside login" }), which: () => null })
    expect(none.aside).toBe(false)
    expect(none.details.aside.reason).toContain("aside login")
    expect(none.details.codex.hint).toContain("QUORUM_BOT_RUNNER")
  })
})

describe("first run demo item", () => {
  test("a brand-new workspace gets one demo item once; deleting it does not bring it back", async () => {
    const path = join(dir, "workspace.db")
    const ws = createWorkspace({ path, demo: true, now: () => 1000 })
    const list = await (await ws.handle(new Request("http://127.0.0.1/api/ws/items"), ["api", "ws", "items"])).json() as { id: string; text: string }[]
    expect(list.map((i) => i.text)).toEqual([DEMO_TEXT])
    await ws.handle(new Request("http://127.0.0.1/api/ws/items/" + list[0].id, { method: "DELETE" }), ["api", "ws", "items", list[0].id])
    ws.db.close()
    const again = createWorkspace({ path, demo: true, now: () => 2000 })
    expect(await (await again.handle(new Request("http://127.0.0.1/api/ws/items"), ["api", "ws", "items"])).json()).toEqual([])
    again.db.close()
  })
  test("a workspace that already has items is never seeded", async () => {
    const path = join(dir, "w2.db")
    const first = createWorkspace({ path, now: () => 1000 })
    await first.handle(new Request("http://127.0.0.1/api/ws/items", { method: "POST", body: JSON.stringify({ text: "내 일" }) }), ["api", "ws", "items"])
    first.db.close()
    const ws = createWorkspace({ path, demo: true, now: () => 2000 })
    const list = await (await ws.handle(new Request("http://127.0.0.1/api/ws/items"), ["api", "ws", "items"])).json() as { text: string }[]
    expect(list.map((i) => i.text)).toEqual(["내 일"])
    ws.db.close()
  })
})
