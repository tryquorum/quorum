import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GbrainMemory, MemoryError, normTitle, noteSlug, repairNote } from "./memory.ts"

// 진짜 gbrain 은 부르지 않는다. 임시 디렉터리에 argv·stdin 을 남기는 가짜 실행 파일을 만든다.
let dir: string
let argsFile: string
let stdinFile: string
let envFile: string

const CANNED = [
  {
    slug: "recipes/smoke-test",
    page_id: 1,
    title: "smoke",
    type: "concept",
    chunk_text: "# smoke\nhello recipe",
    chunk_source: "compiled_truth",
    chunk_id: 1,
    chunk_index: 0,
    score: 1.250001,
    stale: false,
  },
  {
    slug: "recipes/checkout-v2",
    page_id: 2,
    title: "checkout v2",
    type: "concept",
    chunk_text: "# checkout v2\nendpoint moved",
    chunk_id: 5,
    chunk_index: 1,
    score: 0.75,
  },
]

async function fakeBin(body = "", searchBody = 'cat "$CANNED_FILE"'): Promise<string> {
  const path = join(dir, "fake-gbrain")
  const script = `#!/bin/sh
printf '%s\\n' "$@" >> "$ARGS_FILE"
printf '%s\\n' "$NO_COLOR" > "$ENV_FILE"
cat > "$STDIN_FILE"
if [ "$1" = "search" ]; then
${searchBody}
  exit 0
fi
${body}
exit 0
`
  await writeFile(path, script, { mode: 0o755 })
  return path
}

const readArgs = async () => (await readFile(argsFile, "utf8")).split("\n").filter((l, i, a) => l !== "" || i < a.length - 1)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "quorum-memory-test-"))
  argsFile = join(dir, "args.txt")
  stdinFile = join(dir, "stdin.txt")
  envFile = join(dir, "env.txt")
  await writeFile(argsFile, "")
  await writeFile(join(dir, "canned.json"), JSON.stringify(CANNED, null, 2) + "\n")
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("GbrainMemory", () => {
  test("put sends exact argv and the markdown on stdin; search parses hits", async () => {
    const bin = await fakeBin()
    const memory = new GbrainMemory({ bin, env: { ARGS_FILE: argsFile, STDIN_FILE: stdinFile, ENV_FILE: envFile, CANNED_FILE: join(dir, "canned.json") } })
    const markdown = "# checkout v2\n\n- reason: selector moved\n"

    await memory.put(noteSlug("checkout", 2), markdown, "endpoint moved")

    expect(await readArgs()).toEqual(["put", "recipes/checkout-v2", "--content-origin", "tool_output", "--reason", "endpoint moved"])
    expect(await readFile(stdinFile, "utf8")).toBe(markdown)
    expect((await readFile(envFile, "utf8")).trim()).toBe("1")

    await writeFile(argsFile, "")
    const hits = await memory.search("smoke", 2)

    expect(await readArgs()).toEqual(["search", "smoke", "--limit", "2", "--json"])
    expect(hits).toEqual([
      { slug: "recipes/smoke-test", score: 1.250001, snippet: "# smoke\nhello recipe" },
      { slug: "recipes/checkout-v2", score: 0.75, snippet: "# checkout v2\nendpoint moved" },
    ])
  })

  test("put omits --reason when none is given", async () => {
    const bin = await fakeBin()
    const memory = new GbrainMemory({ bin, env: { ARGS_FILE: argsFile, STDIN_FILE: stdinFile, ENV_FILE: envFile, CANNED_FILE: join(dir, "canned.json") } })

    await memory.put("recipes/x-v1", "# x v1\n")

    expect(await readArgs()).toEqual(["put", "recipes/x-v1", "--content-origin", "tool_output"])
  })

  test("non-zero exit rejects with MemoryError carrying the code and stderr", async () => {
    const memory = new GbrainMemory({ bin: "/usr/bin/false" })

    const err = await memory.put("recipes/x-v1", "# x v1\n").catch((e) => e)

    expect(err).toBeInstanceOf(MemoryError)
    expect((err as MemoryError).code).toBe(1)
    expect((err as MemoryError).stderr).toBe("")
  })

  test("missing binary rejects with MemoryError instead of throwing uncaught", async () => {
    const memory = new GbrainMemory({ bin: join(dir, "does-not-exist", "gbrain") })

    const err = await memory.put("recipes/x-v1", "# x v1\n").catch((e) => e)

    expect(err).toBeInstanceOf(MemoryError)
    expect((err as MemoryError).code).toBeNull()
    expect((err as MemoryError).message).toContain("could not start")
  })

  test("hung gbrain is killed and rejects with MemoryError", async () => {
    const bin = await fakeBin("while :; do :; done")
    const memory = new GbrainMemory({ bin, timeoutMs: 150, env: { ARGS_FILE: argsFile, STDIN_FILE: stdinFile, ENV_FILE: envFile, CANNED_FILE: join(dir, "canned.json") } })

    const err = await memory.put("recipes/x-v1", "# x v1\n").catch((e) => e)

    expect(err).toBeInstanceOf(MemoryError)
    expect((err as MemoryError).code).toBeNull()
    expect((err as MemoryError).message).toContain("timed out")
  })

  test("unparsable search JSON rejects instead of returning empty hits", async () => {
    const bin = await fakeBin()
    await writeFile(join(dir, "canned.json"), "not json at all\n")
    const memory = new GbrainMemory({ bin, env: { ARGS_FILE: argsFile, STDIN_FILE: stdinFile, ENV_FILE: envFile, CANNED_FILE: join(dir, "canned.json") } })

    const err = await memory.search("smoke").catch((e) => e)

    expect(err).toBeInstanceOf(MemoryError)
  })

  test("stdout noise before the JSON is skipped", async () => {
    const bin = await fakeBin("", `printf '%s\\n' '[gbrain] thinking out loud'
cat "$CANNED_FILE"
printf '%s\\n' '[gbrain degraded: embed_unavailable]'`)
    const memory = new GbrainMemory({ bin, env: { ARGS_FILE: argsFile, STDIN_FILE: stdinFile, ENV_FILE: envFile, CANNED_FILE: join(dir, "canned.json") } })

    const hits = await memory.search("smoke")

    expect(hits.map((h) => h.slug)).toEqual(["recipes/smoke-test", "recipes/checkout-v2"])
    expect(hits[0].score).toBe(1.250001)
  })
})

describe("note helpers", () => {
  test("normTitle follows the Direction Board same-title rule", () => {
    expect(normTitle("Get-Posts 404!")).toBe(normTitle("get posts 404"))
    expect(normTitle("Get Posts 404")).toBe("getposts404")
  })

  test("noteSlug is recipes/<id>-v<version>", () => {
    expect(noteSlug("checkout", 2)).toBe("recipes/checkout-v2")
  })

  test("repairNote carries the title, both endpoints and the reason", () => {
    const note = repairNote({
      recipeId: "checkout",
      site: "shop.example",
      intent: "add to cart",
      fromVersion: 1,
      toVersion: 2,
      previousEndpoint: "/api/v1/cart",
      endpoint: "/api/v2/cart",
      reason: "POST /cart returned 404",
      at: "2026-11-09T02:00:00Z",
    })

    expect(note.split("\n")[0]).toBe("# checkout v2")
    expect(note).toContain("/api/v1/cart")
    expect(note).toContain("/api/v2/cart")
    expect(note).toContain("POST /cart returned 404")
    expect(note).toContain("2026-11-09T02:00:00Z")
  })
})
