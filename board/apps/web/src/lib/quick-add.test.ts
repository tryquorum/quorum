import { describe, expect, test } from "bun:test"
import type { Item } from "@direction-board/contracts"
import { createWork, findSameOpen, noteFromText, parseQuick, parseTags, type Draft } from "./quick-add"

const areas = [{ id: "a1", name: "업무", color: "#0a0" }, { id: "a2", name: "Family", color: "#00a" }]
const item = (p: Partial<Item>): Item => ({ id: "i", boardId: "b", type: "todo", text: "", x: 0, y: 0, w: 1, h: 1, ...p })
// when.js 대신: "내일" 을 고정 날짜로 바꾸는 작은 파서
const when = (t: string) => { const i = t.indexOf("내일"); return i < 0 ? null : { at: "2026-11-08T15:00", title: (t.slice(0, i) + t.slice(i + 2)).replace(/\s+/g, " ").trim(), spans: [[i, i + 2]] as [number, number][] } }

describe("parseTags", () => {
  test("the first area name becomes the area, other words become tags once", () => {
    const r = parseTags("계약서 #업무 보내기 #family #계약 #계약", areas)
    expect(r.area?.id).toBe("a1")
    expect(r.tags).toEqual(["family", "계약"])
    expect(r.rest).toBe("계약서 보내기")
  })
  test("# inside a word is not a tag and area matching ignores case", () => {
    const r = parseTags("C#언어 공부 #Family", areas)
    expect(r.area?.id).toBe("a2")
    expect(r.tags).toEqual([])
    expect(r.rest).toBe("C#언어 공부")
  })
  test("without tags (company board) other words stay in the title", () => {
    expect(parseTags("#업무 #계약 보내기", areas, false)).toEqual({ rest: "#계약 보내기", area: areas[0], tags: [] })
  })
})

describe("parseQuick", () => {
  test("combines date, area and tags and strips them from the title", () => {
    expect(parseQuick("내일 #업무 #계약 계약서 보내기", areas, when)).toEqual({ title: "계약서 보내기", at: "2026-11-08T15:00", area: areas[0], tags: ["계약"] })
  })
  test("plain text keeps its title and has no date", () => {
    expect(parseQuick("  보고서 쓰기 ", areas, when)).toEqual({ title: "보고서 쓰기", at: null, area: null, tags: [] })
  })
})

describe("findSameOpen", () => {
  const items = [
    item({ id: "open", text: "계약서 보내기!" }),
    item({ id: "done", text: "보고서 쓰기", done: true }),
    item({ id: "other", boardId: "x", text: "회의 준비하기" }),
    item({ id: "sticky", type: "sticky", text: "메모 정리하기" }),
    item({ id: "goal", type: "goal", text: "Q4 목표 세우기" }),
  ]
  test("matches open todo or goal on the same board with the server's normalization", () => {
    expect(findSameOpen(items, "b", " 계약서  보내기 ")?.id).toBe("open")
    expect(findSameOpen(items, "b", "q4 목표세우기.")?.id).toBe("goal")
  })
  test("ignores done items, other boards, other types and short titles", () => {
    expect(findSameOpen(items, "b", "보고서 쓰기")).toBeNull()
    expect(findSameOpen(items, "b", "회의 준비하기")).toBeNull()
    expect(findSameOpen(items, "b", "메모 정리하기")).toBeNull()
    expect(findSameOpen([item({ text: "답장" })], "b", "답장")).toBeNull()
  })
})

test("noteFromText escapes HTML and keeps paragraphs", () => {
  expect(noteFromText("<b>a</b> & 'b'\n둘째 줄\n\n새 문단")).toEqual({ html: "<p>&lt;b&gt;a&lt;/b&gt; &amp; &#39;b&#39;<br>둘째 줄</p><p>새 문단</p>", text: "<b>a</b> & 'b'\n둘째 줄\n\n새 문단", md: "<b>a</b> & 'b'\n둘째 줄\n\n새 문단" })
})

describe("createWork", () => {
  const draft: Draft = { boardId: "b", kind: "todo", title: "계약서 보내기", at: "2026-11-08T15:00", areaId: "a1", tags: ["계약"], note: "조건 확인", props: [{ key: "금액", type: "number", value: "500" }, { key: "", type: "text", value: "x" }] }
  const run = (fail: Record<string, boolean> = {}, saveOk = true) => {
    const calls: { path: string; method?: string; body: unknown }[] = []
    const saved: Item[] = []
    const deps = {
      save: async (it: Item) => { saved.push(it); return saveOk },
      call: async <T,>(path: string, init: RequestInit): Promise<T> => {
        calls.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined })
        if (Object.entries(fail).some(([k, v]) => v && path.endsWith(k))) throw new Error("boom")
        return {} as T
      },
      id: () => "new1",
      now: () => 42,
    }
    return { calls, saved, deps }
  }
  test("saves the item first, then note with expectedVersion 0, tags and typed props", async () => {
    const { calls, saved, deps } = run()
    expect(await createWork(draft, deps)).toMatchObject({ kind: "done", ref: "item:b:new1" })
    expect(saved[0]).toMatchObject({ id: "new1", boardId: "b", type: "todo", text: "계약서 보내기", remindAt: "2026-11-08T15:00", area: "a1", done: false, z: 42 })
    // 태그·속성은 갓 만든 항목이어도 먼저 읽고 없는 것만, 속성은 읽은 버전과 함께(iOS PR #39 리뷰 15 — 이 시험의 서버는 버전을 주지 않아요)
    expect(calls).toEqual([
      { path: "/api/work/item%3Ab%3Anew1/note", method: "PUT", body: { html: "<p>조건 확인</p>", text: "조건 확인", md: "조건 확인", expectedVersion: 0 } },
      { path: "/api/docs/item%3Ab%3Anew1?view=meta", method: "GET", body: undefined },
      { path: "/api/docs/item%3Ab%3Anew1/tags", method: "POST", body: { add: ["계약"] } },
      { path: "/api/docs/item%3Ab%3Anew1?view=meta", method: "GET", body: undefined },
      { path: "/api/docs/item%3Ab%3Anew1/props", method: "POST", body: { set: { 금액: 500 }, types: { 금액: "number" } } },
    ])
  })
  test("goal keeps only the date as due", async () => {
    const { saved, deps } = run()
    await createWork({ ...draft, kind: "goal", note: "", tags: [], props: [] }, deps)
    expect(saved[0]).toMatchObject({ type: "goal", due: "2026-11-08" })
    expect(saved[0].remindAt).toBeUndefined()
  })
  test("todo linked to a goal saves goalId on the item", async () => {
    const { saved, deps } = run()
    await createWork({ ...draft, kind: "todo", goalId: "g-target", note: "", tags: [], props: [] }, deps)
    expect(saved[0]).toMatchObject({ type: "todo", goalId: "g-target" })
  })
  test("stops when the item is not saved", async () => {
    const { calls, deps } = run({}, false)
    expect(await createWork(draft, deps)).toEqual({ kind: "failed", ref: null, id: "new1", at: "item" })
    expect(calls).toEqual([])
  })
  test("tags alone still create an empty note first so the document exists", async () => {
    const { calls, deps } = run()
    await createWork({ ...draft, note: "", props: [] }, deps)
    expect(calls.map((c) => [c.path.split("/").pop(), c.body])).toEqual([["note", { html: "", text: "", md: "", expectedVersion: 0 }], ["item%3Ab%3Anew1?view=meta", undefined], ["tags", { add: ["계약"] }]])
  })
  test("nothing but a title sends only the item", async () => {
    const { calls, deps } = run()
    await createWork({ ...draft, note: "", tags: [], props: [] }, deps)
    expect(calls).toEqual([])
  })
  test("resume keeps the id, skips finished steps and accepts a note conflict only when the saved note matches", async () => {
    const { calls, saved, deps } = run()
    deps.call = async <T,>(path: string, init: RequestInit): Promise<T> => {
      calls.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined })
      if (path.endsWith("note")) throw Object.assign(new Error("conflict"), { status: 409 })
      if (init.method === "GET") return { note: { text: "조건 확인" } } as T
      return {} as T
    }
    expect(await createWork(draft, deps, { id: "old7", from: "note" })).toMatchObject({ kind: "done", ref: "item:b:old7", id: "old7" })
    expect(saved).toEqual([])
    // 이어 하기의 태그·속성 단계는 먼저 읽어 이미 있는 것은 다시 보내지 않고, 속성은 사람이 바꾼 값이 없는지 본 뒤 읽은 버전과 함께 보내요(iOS PR #39 리뷰 9·14, 공용 createWork)
    expect(calls.map((c) => [c.method, c.path.split("/").pop()])).toEqual([["PUT", "note"], ["GET", "item%3Ab%3Aold7"], ["GET", "item%3Ab%3Aold7?view=meta"], ["POST", "tags"], ["GET", "item%3Ab%3Aold7?view=meta"], ["POST", "props"]])
  })
  test("resume with a conflicting different note stops as conflict (never overwrites)", async () => {
    const { deps } = run()
    deps.call = async <T,>(path: string, init: RequestInit): Promise<T> => {
      if (path.endsWith("note")) throw Object.assign(new Error("conflict"), { status: 409 })
      if (init.method === "GET") return { note: { text: "다른 사람이 쓴 글" } } as T
      return {} as T
    }
    expect(await createWork(draft, deps, { id: "old7", from: "note" })).toMatchObject({ kind: "conflict", at: "note" })
  })
  test("a note conflict on the first try: a different saved note is a conflict, an unreadable one is unknown", async () => {
    const { deps } = run()
    deps.call = async <T,>(path: string, init: RequestInit): Promise<T> => {
      if (path.endsWith("note")) throw Object.assign(new Error("conflict"), { status: 409 })
      if (init.method === "GET") return { note: { text: "사람이 먼저 쓴 글" } } as T
      return {} as T
    }
    expect(await createWork(draft, deps)).toMatchObject({ kind: "conflict", at: "note" })
    deps.call = async () => { throw Object.assign(new Error("conflict"), { status: 409 }) }
    expect(await createWork(draft, deps)).toMatchObject({ kind: "unknown", at: "note" })
  })
  test("a failed note keeps the item and skips tags and props", async () => {
    const { calls, deps } = run({ note: true })
    expect(await createWork(draft, deps)).toMatchObject({ kind: "failed", ref: "item:b:new1", at: "note" })
    expect(calls.map((c) => c.path.split("/").pop())).toEqual(["note"])
  })
})
