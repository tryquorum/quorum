import { describe, expect, test } from "bun:test"
import { appendPage, collectDescendants, createGenerations, crumbs, dropZone, moveCandidates, moveError, moveFor } from "./doc-tree.ts"

describe("끌어 놓기", () => {
  test("dropZone: 위 4분의 1 앞, 아래 4분의 1 뒤, 가운데 안", () => {
    expect(dropZone(2, 28)).toBe("before")
    expect(dropZone(14, 28)).toBe("inside")
    expect(dropZone(26, 28)).toBe("after")
    expect(dropZone(5, 0)).toBe("inside")
  })
  test("moveFor: 안은 그 아래, 앞·뒤는 같은 부모의 before/after", () => {
    const t = { ref: "doc:b", parent: "doc:p" }
    expect(moveFor("doc:a", t, "inside")).toEqual({ ref: "doc:a", parent: "doc:b" })
    expect(moveFor("doc:a", t, "before")).toEqual({ ref: "doc:a", parent: "doc:p", before: "doc:b" })
    expect(moveFor("doc:a", { ref: "doc:b", parent: null }, "after")).toEqual({ ref: "doc:a", parent: null, after: "doc:b" })
  })
  test("moveFor: 자기 위·자기 아래(조상 사슬에 자기)는 놓을 수 없음", () => {
    expect(moveFor("doc:a", { ref: "doc:a", parent: null }, "inside")).toBeNull()
    expect(moveFor("doc:a", { ref: "doc:c", parent: "doc:b" }, "inside", ["doc:a", "doc:b"])).toBeNull()
    expect(moveFor("doc:a", { ref: "doc:c", parent: "doc:a" }, "after", ["doc:a"])).toBeNull()
  })
})

describe("이동 대화상자·브레드크럼·오류", () => {
  test("moveCandidates: 독립 문서만, 자기·자손·보관 빼기", () => {
    const hits = [{ ref: "doc:a", kind: "doc", status: "open" }, { ref: "doc:b", kind: "doc", status: "open" }, { ref: "doc:c", kind: "doc", status: "archived" }, { ref: "item:x:y", kind: "todo", status: "open" }, { ref: "doc:d", kind: "doc", status: "done" }]
    expect(moveCandidates(hits, "doc:a", new Set(["doc:b"])).map((h) => h.ref)).toEqual(["doc:d"])
  })
  test("crumbs: 3개 넘으면 맨 위 + … + 가까운 둘", () => {
    const a = ["1", "2", "3", "4", "5"].map((n) => ({ ref: "doc:" + n, title: n }))
    expect(crumbs(a.slice(0, 3))).toEqual(a.slice(0, 3))
    expect(crumbs(a)).toEqual([a[0], { gap: true }, a[3], a[4]])
    expect(crumbs([])).toEqual([])
  })
  test("moveError: 서버 409·404·400 을 사람 말로", () => {
    expect(moveError(409, "Cannot move a document under itself")).toContain("하위 문서 아래")
    expect(moveError(409, "Too deep; at most 8 levels")).toContain("8단")
    expect(moveError(404, "Document not found")).toContain("찾지 못했어요")
    expect(moveError(400, "Cannot move under an archived document")).toContain("보관")
  })
})

describe("목록 이어 읽기·늦은 응답·자손", () => {
  test("appendPage: 겹친 ref 는 한 번만", () => {
    expect(appendPage([{ ref: "a" }, { ref: "b" }], [{ ref: "b" }, { ref: "c" }]).map((x) => x.ref)).toEqual(["a", "b", "c"])
  })
  test("createGenerations: 새로 읽기 뒤에는 옛 세대 응답을 버리고, 이어 읽기는 같은 세대를 써요", () => {
    const g = createGenerations()
    const before = g.fresh("root")
    const after = g.fresh("root")
    expect(g.isCurrent("root", before)).toBe(false)
    expect(g.isCurrent("root", after)).toBe(true)
    expect(g.current("root")).toBe(after)
    const other = g.fresh("doc:a")
    g.reset()
    expect(g.isCurrent("root", after)).toBe(false)
    expect(g.isCurrent("doc:a", other)).toBe(false)
    expect(g.isCurrent("root", g.fresh("root"))).toBe(true)
  })
  test("collectDescendants: 쪽을 넘겨 손자까지, cap 에서 멈추면 complete=false", async () => {
    const tree: Record<string, { ref: string; children?: number }[][]> = {
      "doc:a": [[{ ref: "doc:b", children: 1 }], [{ ref: "doc:c" }]],
      "doc:b": [[{ ref: "doc:d" }]],
    }
    const load = async (p: string, cursor?: string) => {
      const pages = tree[p] ?? [[]]
      const i = cursor ? Number(cursor) : 0
      return { results: pages[i] ?? [], ...(i + 1 < pages.length ? { nextCursor: String(i + 1) } : {}) }
    }
    const all = await collectDescendants("doc:a", load)
    expect([...all.refs].sort()).toEqual(["doc:b", "doc:c", "doc:d"])
    expect(all.complete).toBe(true)
    const capped = await collectDescendants("doc:a", load, 1)
    expect(capped.complete).toBe(false)
  })
})
